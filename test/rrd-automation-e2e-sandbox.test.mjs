import assert from 'node:assert/strict';
import test from 'node:test';

import { runAutomationSandbox } from '../src/lib/jobs/automation-sandbox.mjs';
import { cliOptions } from '../cron/_runner.mjs';
import { runApprovalReminder } from '../cron/approval-reminder.mjs';
import { createAutomationRuntime } from '../src/lib/jobs/automation-runtime.mjs';

const SECRET = 'test-secret';
const NOW = '2026-06-26T12:00:00.000Z';

function opts(runtime, extra = {}) {
  const env = { RRD_CRON_SECRET: SECRET, ...(extra.env || {}) };
  return {
    runtime,
    now: NOW,
    secret: SECRET,
    ...extra,
    env,
  };
}

test('cliOptions captures approval destination without treating it as a secret', () => {
  const out = cliOptions(['--approval-to', 'Kofi@traqd.io', '--dry-run'], { RRD_CRON_SECRET: SECRET });
  assert.equal(out.approvalTo, 'Kofi@traqd.io');
  assert.equal(out.dryRun, true);
});

test('approval reminder routes approval batches to Kofi@traqd.io only when explicitly configured', async () => {
  const runtime = createAutomationRuntime({
    state: {
      actions: [{ id: 'act_1', status: 'queued_for_approval', invoiceId: 'inv_1' }],
    },
  });

  const out = await runApprovalReminder(opts(runtime, { env: { RRD_APPROVAL_TO_EMAIL: 'Kofi@traqd.io' } }));

  assert.equal(out.ok, true);
  assert.equal(out.result.approvalTo, 'Kofi@traqd.io');
  assert.equal(runtime.repo.approvalBatches[0].reviewerId, 'Kofi@traqd.io');
  assert.deepEqual(out.result.batch, {
    id: runtime.repo.approvalBatches[0].id,
    reviewerId: 'Kofi@traqd.io',
    actionIds: ['act_1'],
    status: 'pending',
  });
});

test('approval reminder does not globally default real clients to Kofi@traqd.io', async () => {
  const runtime = createAutomationRuntime({
    state: {
      actions: [{ id: 'act_2', status: 'queued_for_approval', invoiceId: 'inv_2' }],
    },
  });

  const out = await runApprovalReminder(opts(runtime));

  assert.equal(out.ok, true);
  assert.equal(out.result.approvalTo, null);
  assert.equal(runtime.repo.approvalBatches[0].reviewerId, null);
  assert.doesNotMatch(JSON.stringify(out), /Kofi@traqd\.io/i);
});

test('automation sandbox proves invoice to approval to dry-run dispatch to payment report', async () => {
  const out = await runAutomationSandbox({ approvalTo: 'Kofi@traqd.io', now: NOW });

  assert.equal(out.ok, true);
  assert.equal(out.approvalTo, 'Kofi@traqd.io');
  assert.equal(out.syncedInvoices, 1);
  assert.equal(out.approvalBatch.status, 'approved');
  assert.equal(out.approvalBatch.reviewerId, 'Kofi@traqd.io');
  assert.equal(out.dispatch.dispatched, 1);
  assert.equal(out.dispatch.dryRun, true);
  assert.equal(out.paymentReconcile.reconciled, 1);
  assert.equal(out.dashboard.pendingApprovals, 0);
  assert.equal(out.dashboard.recoveredCents, 12500);
  assert.equal(out.weeklyReport.shouldSend, true);
  assert.doesNotMatch(JSON.stringify(out), /access_token|authorization|secret_token|should-not-leak/i);
});
