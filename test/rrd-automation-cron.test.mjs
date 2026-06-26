import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAutomationRuntime } from '../src/lib/jobs/automation-runtime.mjs';
import { runInvoiceSync } from '../cron/invoice-sync.mjs';
import { runRecoveryPlanner } from '../cron/recovery-planner.mjs';
import { runPaymentReconcile } from '../cron/payment-reconcile.mjs';
import { runWeeklyReport } from '../cron/weekly-report.mjs';
import { runSendDispatcher } from '../cron/send-dispatcher.mjs';

const NOW = '2026-06-26T12:00:00.000Z';
const SECRET = 'test-secret';

function opts(runtime, extra = {}) {
  return {
    runtime,
    now: NOW,
    secret: SECRET,
    env: {
      RRD_CRON_SECRET: SECRET,
      RRD_JOB_AUDIT_DIR: mkdtempSync(join(tmpdir(), 'rrd-cron-audit-')),
    },
    ...extra,
  };
}

test('automation runtime holds and loads a repository-like state object for cron tests', () => {
  const state = { invoices: [{ id: 'existing' }] };
  const runtime = createAutomationRuntime({ state });
  assert.equal(runtime.repo, state);
  assert.deepEqual(runtime.loadState().invoices, [{ id: 'existing' }]);
  assert.equal(runtime.loadState(), state, 'test runtime returns the same mutable repository object');
});

test('invoice-sync creates invoices, threads, and queued actions from injected provider invoices', async () => {
  const runtime = createAutomationRuntime({
    state: {},
    provider: {
      async listInvoices() {
        return [{
          provider: 'stripe',
          providerInvoiceId: 'in_001',
          number: 'INV-001',
          customerId: 'cus_1',
          customerEmail: 'ap@example.test',
          amountDue: 12500,
          currency: 'usd',
          dueDate: '2026-06-01',
          status: 'open',
          raw: { authorization: 'Bearer should-not-leak', access_token: 'secret_token' },
        }];
      },
    },
  });

  const out = await runInvoiceSync(opts(runtime));

  assert.equal(out.ok, true);
  assert.equal(out.result.synced, 1);
  assert.equal(runtime.repo.invoices.length, 1);
  assert.equal(runtime.repo.threads.length, 1);
  assert.equal(runtime.repo.actions.length, 1);
  assert.equal(runtime.repo.actions[0].status, 'queued_for_approval');
  assert.equal(runtime.repo.actions[0].channel, 'email');
  assert.doesNotMatch(JSON.stringify(out), /should-not-leak|access_token|secret_token|authorization/i);
});

test('recovery-planner queues approval for existing recoverable invoices', async () => {
  const runtime = createAutomationRuntime({
    state: {
      invoices: [{
        id: 'inv_manual', provider: 'stripe', providerInvoiceId: 'in_002', number: 'INV-002',
        customerId: 'cus_2', customerEmail: 'two@example.test', amountDue: 5000,
        currency: 'usd', dueDate: '2026-05-01', status: 'in_recovery',
      }],
    },
  });

  const out = await runRecoveryPlanner(opts(runtime));

  assert.equal(out.ok, true);
  assert.equal(out.result.planned, 1);
  assert.equal(runtime.repo.actions[0].status, 'queued_for_approval');
  assert.equal(runtime.repo.approvalBatches.length, 1);
  assert.deepEqual(runtime.repo.approvalBatches[0].actionIds, [runtime.repo.actions[0].id]);
});

test('payment-reconcile records payment and cancels future sends', async () => {
  const runtime = createAutomationRuntime({
    state: {
      invoices: [{ id: 'inv_paid', provider: 'stripe', providerInvoiceId: 'in_paid', amountDue: 9900, status: 'in_recovery' }],
      threads: [{ id: 'thr_paid', invoiceId: 'inv_paid', status: 'scheduled' }],
      actions: [{ id: 'act_future', invoiceId: 'inv_paid', status: 'scheduled', scheduledFor: '2026-06-27T00:00:00.000Z' }],
    },
    provider: {
      async listPayments() {
        return [{ provider: 'stripe', providerInvoiceId: 'in_paid', amount: 9900, paidAt: NOW }];
      },
    },
  });

  const out = await runPaymentReconcile(opts(runtime));

  assert.equal(out.ok, true);
  assert.equal(out.result.reconciled, 1);
  assert.equal(runtime.repo.invoices[0].status, 'paid');
  assert.equal(runtime.repo.actions[0].status, 'cancelled');
  assert.equal(runtime.repo.actions[0].cancelReason, 'invoice paid');
});

test('weekly-report returns shouldSend false for an empty week and does not live send by default', async () => {
  const runtime = createAutomationRuntime({ state: { invoices: [], actions: [], replies: [], payments: [] } });

  const out = await runWeeklyReport(opts(runtime, { weekStart: '2026-06-19', weekEnd: '2026-06-26' }));

  assert.equal(out.ok, true);
  assert.equal(out.result.report.shouldSend, false);
  assert.equal(out.result.report.reason, 'empty_week');
  assert.equal(out.result.dryRun, true);
  assert.equal(out.result.sent, false);
});

test('weekly-report rejects direct live report send hooks', async () => {
  const runtime = createAutomationRuntime({
    state: {
      invoices: [],
      actions: [],
      replies: [],
      payments: [{ id: 'pay_1', status: 'verified', amount_cents: 1000, received_at: '2026-06-20T00:00:00.000Z' }],
    },
    reportSend: async () => ({ sent: true }),
  });

  const out = await runWeeklyReport(opts(runtime, { dryRun: false, weekStart: '2026-06-19', weekEnd: '2026-06-26' }));

  assert.equal(out.ok, false);
  assert.match(out.error, /approved notification boundary/i);
});

test('send-dispatcher uses only the recover boundary and rejects direct send hooks', async () => {
  let recoverCalls = 0;
  const runtime = createAutomationRuntime({
    state: {
      invoices: [{ id: 'inv_send', status: 'in_recovery', amountDue: 1000 }],
      threads: [{ id: 'thr_send', invoiceId: 'inv_send', status: 'scheduled' }],
      actions: [{ id: 'act_send', invoiceId: 'inv_send', threadId: 'thr_send', status: 'scheduled', scheduledFor: '2026-06-26T00:00:00.000Z', channel: 'email' }],
    },
    recoverExecute: async (action, context) => {
      recoverCalls += 1;
      assert.equal(action.id, 'act_send');
      assert.equal(context.send, false);
      assert.equal(context.dryRun, true);
      return { accepted: true, dryRun: true };
    },
  });

  await assert.rejects(() => runSendDispatcher(opts(runtime, { sendEmail: async () => {} })), /refuses direct provider sends/);

  const out = await runSendDispatcher(opts(runtime));

  assert.equal(out.ok, true);
  assert.equal(out.result.dispatched, 1);
  assert.equal(recoverCalls, 1);
  assert.equal(runtime.repo.actions[0].status, 'scheduled');
  assert.equal(runtime.repo.actions[0].receipt, undefined);
  assert.equal(out.result.result.sent[0].dryRun, true);
});
