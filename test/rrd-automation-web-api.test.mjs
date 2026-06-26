import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    end() { this.ended = true; return this; },
  };
}

function loadHandler(rel, common) {
  const commonPath = path.join(root, 'revenue-recovery-web/api/client-dashboard-common.js');
  const handlerPath = path.join(root, rel);
  delete require.cache[commonPath];
  delete require.cache[handlerPath];
  require.cache[commonPath] = { id: commonPath, filename: commonPath, loaded: true, exports: common };
  return require(handlerPath);
}

function sampleState() {
  return {
    invoices: [
      { id: 'inv_paid', number: 'INV-100', customer_name: 'Acme Ltd', status: 'paid', amount_cents: 100000, currency: 'GBP' },
      { id: 'inv_recovery', number: 'INV-101', customer_name: 'Beta Ltd', status: 'in_recovery', amount_cents: 250000, currency: 'GBP' },
      { id: 'inv_blocked', number: 'INV-102', customer_name: 'Gamma Ltd', status: 'disputed', amount_cents: 400000, currency: 'GBP', secret: 'fake-redacted-value' },
    ],
    payments: [
      { id: 'pay_1', invoice_id: 'inv_paid', amount_cents: 100000, currency: 'GBP', status: 'verified', received_at: '2026-06-18T10:00:00.000Z' },
    ],
    actions: [
      { id: 'act_1', invoice_id: 'inv_recovery', status: 'scheduled', channel: 'email', scheduled_at: '2026-06-21T09:00:00.000Z', body: 'customer-facing draft should not be exposed' },
      { id: 'act_blocked', invoice_id: 'inv_blocked', status: 'blocked', blocked_reason: 'dispute' },
    ],
    approvals: [{ id: 'apr_1', action_id: 'act_1', status: 'pending', requested_at: '2026-06-19T09:00:00.000Z' }],
    replies: [{ id: 'rep_1', invoice_id: 'inv_blocked', classification: 'dispute', needs_attention: true, received_at: '2026-06-19T12:00:00.000Z', summary: 'Customer disputes service date' }],
    integrations: [{ id: 'int_email', provider: 'AgentMail', kind: 'email', status: 'failed', access_token: 'x' }],
  };
}

const week = { weekStart: '2026-06-15T00:00:00.000Z', weekEnd: '2026-06-22T00:00:00.000Z', now: '2026-06-20T00:00:00.000Z' };

test('client automation dashboard authenticates and returns dashboard/report projections without secrets or send functions', async () => {
  let sent = false;
  const handler = loadHandler('revenue-recovery-web/api/automation-dashboard.js', {
    cors(res) { res.setHeader('Access-Control-Allow-Origin', 'https://app.example'); },
    bad(res, status, error) { return res.status(status).json({ ok: false, error }); },
    requireClient: async () => ({ submissionId: 'sub_1', user: { id: 'user_1', email: 'client@example.test' } }),
    sendEmail: async () => { sent = true; },
    rest: async () => { throw new Error('state should be injected in this test'); },
  });

  const res = response();
  await handler({ method: 'GET', headers: {}, automationState: sampleState(), query: week }, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.submissionId, 'sub_1');
  assert.equal(res.body.dashboard.moneyRecoveredCents, 100000);
  assert.equal(res.body.dashboard.moneyInRecoveryCents, 250000);
  assert.equal(res.body.dashboard.pendingApprovals.count, 1);
  assert.equal(res.body.report.totals.recoveredCents, 100000);
  assert.equal(res.body.report.shouldSend, true);
  assert.equal(sent, false, 'API must not send notifications');
  assert.equal(typeof handler.sendEmail, 'undefined');
  assert.equal(typeof handler.sendSms, 'undefined');
  const json = JSON.stringify(res.body);
  assert.doesNotMatch(json, /sk_live|secret_token|access_token|customer-facing draft/i);
});

test('client automation dashboard blocks unauthenticated callers before reading state', async () => {
  let stateRead = false;
  const handler = loadHandler('revenue-recovery-web/api/automation-dashboard.js', {
    cors() {},
    bad(res, status, error) { return res.status(status).json({ ok: false, error }); },
    requireClient: async () => { const e = new Error('Missing bearer token.'); e.status = 401; throw e; },
    rest: async () => { stateRead = true; return []; },
  });

  const res = response();
  await handler({ method: 'GET', headers: {}, automationState: sampleState(), query: week }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(stateRead, false);
});

test('client automation dashboard ignores public body state overrides and fetches server state', async () => {
  const handler = loadHandler('revenue-recovery-web/api/automation-dashboard.js', {
    cors() {},
    bad(res, status, error) { return res.status(status).json({ ok: false, error }); },
    requireClient: async () => ({ submissionId: 'sub_1', user: { id: 'user_1' } }),
    rest: async (path) => {
      if (path.startsWith('submissions?')) return [{ id: 'sub_1', client_id: 'client_1' }];
      if (path.startsWith('payments?')) return [{ id: 'pay_server', invoice_id: 'inv_server', amount_cents: 1000, status: 'verified', received_at: '2026-06-20T00:00:00.000Z' }];
      return [];
    },
  });

  const res = response();
  await handler({ method: 'POST', headers: {}, body: { state: sampleState(), ...week }, query: {} }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.dashboard.moneyRecoveredCents, 1000);
  assert.notEqual(res.body.dashboard.moneyRecoveredCents, 100000);
});

test('admin automation summary authenticates staff and aggregates client/live/blocker/approval/job-health data safely', async () => {
  const handler = loadHandler('revenue-recovery-web/api/admin-automation-summary.js', {
    cors(res) { res.setHeader('Access-Control-Allow-Origin', 'https://app.example'); },
    bad(res, status, error) { return res.status(status).json({ ok: false, error }); },
    requireStaff: async () => ({ id: 'staff_1', email: 'ops@example.test' }),
    sendEmail: async () => { throw new Error('must not send'); },
    rest: async () => { throw new Error('state should be injected in this test'); },
  });

  const res = response();
  await handler({
    method: 'GET',
    headers: {},
    automationState: {
      clients: [{ id: 'c1', status: 'live' }, { id: 'c2', status: 'onboarding' }],
      submissions: [{ id: 'sub1', go_live_status: 'live' }],
      invoices: sampleState().invoices,
      actions: sampleState().actions,
      approvals: sampleState().approvals,
      integrations: sampleState().integrations,
      jobs: [{ id: 'job1', status: 'failed', error: 'redacted failure should not leak' }, { id: 'job2', status: 'queued' }],
    },
    query: { now: week.now },
  }, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.summary.clients.total, 2);
  assert.equal(res.body.summary.clients.live, 1);
  assert.equal(res.body.summary.blockers.count, 2);
  assert.equal(res.body.summary.pendingApprovals.count, 1);
  assert.equal(res.body.summary.jobHealth.failed, 1);
  assert.equal(res.body.summary.jobHealth.queued, 1);
  assert.equal(res.body.summary.integrationHealth.failing, 1);
  const json = JSON.stringify(res.body);
  assert.doesNotMatch(json, /sk_live|secret|access_token|error/i);
});

test('admin automation summary blocks non-staff callers', async () => {
  const handler = loadHandler('revenue-recovery-web/api/admin-automation-summary.js', {
    cors() {},
    bad(res, status, error) { return res.status(status).json({ ok: false, error }); },
    requireStaff: async () => { const e = new Error('Staff access required.'); e.status = 403; throw e; },
    rest: async () => [],
  });
  const res = response();
  await handler({ method: 'GET', headers: {}, automationState: {}, query: {} }, res);
  assert.equal(res.statusCode, 403);
});

test('admin automation summary ignores public body state overrides and fetches server state', async () => {
  const handler = loadHandler('revenue-recovery-web/api/admin-automation-summary.js', {
    cors() {},
    bad(res, status, error) { return res.status(status).json({ ok: false, error }); },
    requireStaff: async () => ({ id: 'staff_1' }),
    rest: async (path) => {
      if (path.startsWith('clients?')) return [{ id: 'real_client', status: 'live' }];
      return [];
    },
  });
  const res = response();
  await handler({ method: 'POST', headers: {}, body: { state: { clients: [{ id: 'fake' }, { id: 'fake2' }] } }, query: {} }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.summary.clients.total, 1);
});
