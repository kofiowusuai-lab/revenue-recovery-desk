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

test('client vault link denies provider not declared by this client', async () => {
  const childProcess = require('child_process');
  const originalExec = childProcess.execFileSync;
  let execCalls = 0;
  childProcess.execFileSync = () => { execCalls++; return 'https://example.invalid/vault\n'; };
  try {
    const handler = loadHandler('revenue-recovery-web/api/client-vault-link.js', {
      WEB_BASE: 'https://app.example',
      cors() {},
      bad(res, status, error) { return res.status(status).json({ ok: false, error }); },
      requireClient: async () => ({ submissionId: 'sub_1', account: { user_id: 'u_1' } }),
      rest: async (resource) => {
        if (String(resource).startsWith('submissions?')) return [{
          id: 'sub_1',
          payment_platforms: ['Stripe'],
          payment_stack: {},
          crm: 'HubSpot',
          crm_data: {},
          outreach: {},
          recovery_process: {},
        }];
        return [];
      },
    });
    const res = response();
    await handler({ method: 'POST', body: { mode: 'connect', provider: 'salesforce' }, headers: {} }, res);
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /not declared/i);
    assert.equal(execCalls, 0);
  } finally {
    childProcess.execFileSync = originalExec;
  }
});

test('client vault link denies Composio-managed Dynamics/ServiceM8 as native OAuth connect providers', async () => {
  const childProcess = require('child_process');
  const originalExec = childProcess.execFileSync;
  let execCalls = 0;
  childProcess.execFileSync = () => { execCalls++; return 'https://example.invalid/vault\n'; };
  try {
    const handler = loadHandler('revenue-recovery-web/api/client-vault-link.js', {
      WEB_BASE: 'https://app.example',
      cors() {},
      bad(res, status, error) { return res.status(status).json({ ok: false, error }); },
      requireClient: async () => ({ submissionId: 'sub_1', account: { user_id: 'u_1' } }),
      rest: async (resource) => {
        if (String(resource).startsWith('submissions?')) return [{
          id: 'sub_1',
          payment_platforms: [],
          payment_stack: {},
          crm: 'Dynamics 365',
          crm_data: { crm: 'Dynamics 365', apiAccess: 'Yes' },
          outreach: {},
          recovery_process: {},
        }];
        return [];
      },
    });
    const res = response();
    await handler({ method: 'POST', body: { mode: 'connect', provider: 'dynamics365' }, headers: {} }, res);
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /not declared/i);
    assert.equal(execCalls, 0);
  } finally {
    childProcess.execFileSync = originalExec;
  }
});

test('client vault link allows declared OAuth provider and passes normalized provider id', async () => {
  const childProcess = require('child_process');
  const originalExec = childProcess.execFileSync;
  let captured = null;
  childProcess.execFileSync = (cmd, args) => {
    captured = { cmd, args };
    return 'create this link: https://example.invalid/oauth-start?token=abc\n';
  };
  try {
    const handler = loadHandler('revenue-recovery-web/api/client-vault-link.js', {
      WEB_BASE: 'https://app.example',
      cors() {},
      bad(res, status, error) { return res.status(status).json({ ok: false, error }); },
      requireClient: async () => ({ submissionId: 'sub_1', account: { user_id: 'u_1' } }),
      rest: async (resource) => {
        if (String(resource).startsWith('submissions?')) return [{ id: 'sub_1', crm: 'HubSpot', payment_platforms: [], payment_stack: {}, crm_data: {}, outreach: {}, recovery_process: {} }];
        return [];
      },
    });
    const res = response();
    await handler({ method: 'POST', body: { mode: 'connect', provider: 'hubspot' }, headers: {} }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(captured.args.slice(0, 3), ['connect', 'sub_1', 'hubspot']);
    assert.equal(res.body.provider, 'hubspot');
  } finally {
    childProcess.execFileSync = originalExec;
  }
});

test('client vault link mints Google connect serverlessly (no Mac binary) using the published public key', async () => {
  const prev = process.env.GOOGLE_OAUTH_CLIENT_ID;
  process.env.GOOGLE_OAUTH_CLIENT_ID = '463896558246-test.apps.googleusercontent.com';
  let dropInsert = null;
  try {
    const handler = loadHandler('revenue-recovery-web/api/client-vault-link.js', {
      WEB_BASE: 'https://revenue-recovery-web-ivory.vercel.app',
      cors() {},
      bad(res, status, error) { return res.status(status).json({ ok: false, error }); },
      requireClient: async () => ({ submissionId: 'sub_1', account: { user_id: 'u_1' } }),
      rest: async (resource, init) => {
        // No Google declared in the manifest (crm Salesforce) — self-serve still allowed.
        if (String(resource).startsWith('submissions?')) return [{ id: 'sub_1', company: 'Acme', crm: 'Salesforce', payment_platforms: [], payment_stack: {}, crm_data: {}, outreach: {}, recovery_process: {} }];
        if (String(resource).startsWith('vault_public_keys?')) return [{ profile: 'rr-acme', public_key: '-----BEGIN PUBLIC KEY-----\nMFAKE\n-----END PUBLIC KEY-----' }];
        if (resource === 'vault_drops') { dropInsert = JSON.parse(init.body); return []; }
        return [];
      },
    });
    const res = response();
    await handler({ method: 'POST', body: { mode: 'connect', provider: 'google' }, headers: {} }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.match(res.body.url, /\/oauth-start\?token=[0-9a-f]{64}$/);
    assert.equal(res.body.provider, 'google');
    // Minted a zero-knowledge oauth drop carrying the published PUBLIC key only.
    assert.ok(dropInsert, 'inserts a vault_drops row');
    assert.equal(dropInsert.kind, 'oauth');
    assert.equal(dropInsert.provider, 'google');
    assert.equal(dropInsert.status, 'pending');
    assert.match(String(dropInsert.public_key), /BEGIN PUBLIC KEY/);
    assert.match(String(dropInsert.token_hash), /^[0-9a-f]{64}$/);
    // authorize_url -> Google, read-only scopes, registered redirect, our client id.
    assert.match(dropInsert.authorize_url, /accounts\.google\.com\/o\/oauth2\/v2\/auth/);
    assert.match(dropInsert.authorize_url, /gmail\.readonly/);
    assert.match(dropInsert.authorize_url, /drive\.metadata\.readonly/);
    assert.match(dropInsert.authorize_url, /redirect_uri=https%3A%2F%2Frevenue-recovery-web-ivory\.vercel\.app%2Foauth-callback/);
    assert.match(dropInsert.authorize_url, /client_id=463896558246-test/);
  } finally {
    if (prev === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID; else process.env.GOOGLE_OAUTH_CLIENT_ID = prev;
  }
});

test('client vault link Google connect returns 409 when the account has no published vault key', async () => {
  const prev = process.env.GOOGLE_OAUTH_CLIENT_ID;
  process.env.GOOGLE_OAUTH_CLIENT_ID = '463896558246-test.apps.googleusercontent.com';
  try {
    const handler = loadHandler('revenue-recovery-web/api/client-vault-link.js', {
      WEB_BASE: 'https://revenue-recovery-web-ivory.vercel.app',
      cors() {},
      bad(res, status, error) { return res.status(status).json({ ok: false, error }); },
      requireClient: async () => ({ submissionId: 'sub_1', account: { user_id: 'u_1' } }),
      rest: async (resource) => {
        if (String(resource).startsWith('submissions?')) return [{ id: 'sub_1', company: 'Acme', crm: 'Salesforce', payment_platforms: [], payment_stack: {}, crm_data: {}, outreach: {}, recovery_process: {} }];
        if (String(resource).startsWith('vault_public_keys?')) return []; // not provisioned
        return [];
      },
    });
    const res = response();
    await handler({ method: 'POST', body: { mode: 'connect', provider: 'google' }, headers: {} }, res);
    assert.equal(res.statusCode, 409, JSON.stringify(res.body));
    assert.match(res.body.error, /not provisioned/i);
  } finally {
    if (prev === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID; else process.env.GOOGLE_OAUTH_CLIENT_ID = prev;
  }
});

test('client letter approval queues signed preview for gated PostGrid executor and does not select missing profile column', async () => {
  const oldKey = process.env.RRD_SIGNATURE_ENCRYPTION_KEY;
  process.env.RRD_SIGNATURE_ENCRYPTION_KEY = 'test-signature-key';
  const handler = loadHandler('revenue-recovery-web/api/client-letter-action.js', {
    cors() {},
    bad(res, status, error) { return res.status(status).json({ ok: false, error }); },
    requireClient: async () => ({ user: { id: 'user_1', email: 'client@example.com' }, submissionId: 'sub_1' }),
    rest: async (resource, init = {}) => {
      const r = String(resource);
      assert.doesNotMatch(r, /select=[^&]*profile/, 'submissions.profile must not be queried');
      if (r.startsWith('submissions?')) return [{ id: 'sub_1', company: 'Acme Ltd' }];
      if (r.startsWith('recovery_events?')) return [{ id: 10, invoice_id: 'inv_1', invoice_number: 'INV-1', channel: 'Letter', customer_name: 'Debtor Ltd', amount_usd: 1000, meta: { subject: 'Notice', draftText: 'Pay please' } }];
      if (r === 'recovery_events') {
        const body = JSON.parse(init.body);
        assert.equal(body.event_type, 'letter_approval');
        assert.equal(body.meta.sendGate, 'approved_for_executor_review');
        assert.equal(body.meta.postgridQueueStatus, 'queued_for_gated_executor');
        assert.equal(body.meta.signerName, 'Kofi Owusu');
        return [{ ...body, id: 11 }];
      }
      return [];
    },
  });
  const sig = 'data:image/png;base64,abc123';
  const res = response();
  await handler({ method: 'POST', body: { action: 'approve', letterKey: 'inv_1|Letter|Debtor Ltd', signerName: 'Kofi Owusu', signerTitle: 'Director', signatureData: sig }, headers: {} }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.eventId, 11);
  if (oldKey == null) delete process.env.RRD_SIGNATURE_ENCRYPTION_KEY; else process.env.RRD_SIGNATURE_ENCRYPTION_KEY = oldKey;
});

test('admin password reset does not return the generated password in JSON', async () => {
  let emailedText = '';
  const handler = loadHandler('revenue-recovery-web/api/admin-reset-password.js', {
    WEB_BASE: 'https://app.example',
    cors() {},
    bad(res, status, error) { return res.status(status).json({ ok: false, error }); },
    requireStaff: async () => ({ email: 'staff@example.com' }),
    initialClientPassword: () => 'TempPass123456789',
    authAdmin: async () => ({}),
    sendEmail: async (to, subject, text) => { emailedText = text; return { id: 'msg_1' }; },
    rest: async (resource) => {
      if (String(resource).startsWith('client_accounts?submission_id=')) return [{ user_id: 'user_1', submission_id: 'sub_1', email: 'client@example.com', company: 'Acme' }];
      return [{ user_id: 'user_1' }];
    },
  });
  const res = response();
  await handler({ method: 'POST', body: { submission_id: 'sub_1' }, headers: {} }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.email, 'client@example.com');
  assert.equal(res.body.temporaryPassword, undefined);
  assert.equal(res.body.password, undefined);
  assert.equal(res.body.passwordDelivered, true);
  assert.match(emailedText, /TempPass123456789/);
});
