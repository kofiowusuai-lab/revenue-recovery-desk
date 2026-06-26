import test from 'node:test';
import assert from 'node:assert/strict';

import {
  approveApprovalBatch,
  classifyRecoveryReply,
  createApprovalBatch,
  dispatchApprovedScheduledActions,
  handleInboundReply,
  reconcilePayment,
  syncProviderInvoices,
} from '../src/lib/recovery/pipeline.mjs';

function memoryRepo(seed = {}) {
  return {
    invoices: seed.invoices ? structuredClone(seed.invoices) : [],
    threads: seed.threads ? structuredClone(seed.threads) : [],
    actions: seed.actions ? structuredClone(seed.actions) : [],
    approvalBatches: seed.approvalBatches ? structuredClone(seed.approvalBatches) : [],
    replies: seed.replies ? structuredClone(seed.replies) : [],
    payments: seed.payments ? structuredClone(seed.payments) : [],
  };
}

const now = '2026-06-26T12:00:00.000Z';
const tomorrow = '2026-06-27T12:00:00.000Z';

test('invoice sync creates recovery thread, action, approval batch, then gated dispatch executes only through injected boundary', async () => {
  const repo = memoryRepo();

  const sync = await syncProviderInvoices(repo, [{
    provider: 'stripe',
    providerInvoiceId: 'in_001',
    customerId: 'cust_001',
    customerEmail: 'ap@example.test',
    amountDue: 12500,
    currency: 'usd',
    dueDate: '2026-06-01',
    status: 'open',
  }], { now });

  assert.equal(sync.invoices.length, 1);
  assert.equal(repo.invoices[0].status, 'in_recovery');
  assert.equal(repo.threads[0].status, 'awaiting_approval');
  assert.equal(repo.actions[0].status, 'queued_for_approval');
  assert.equal(repo.actions[0].stage, 'friendly_reminder');
  assert.equal(repo.actions[0].channel, 'email');

  const batch = createApprovalBatch(repo, { now });
  assert.equal(batch.actions.length, 1);
  assert.equal(repo.approvalBatches[0].status, 'pending');

  approveApprovalBatch(repo, batch.id, { approverId: 'ops-1', now, scheduleFor: now });
  assert.equal(repo.actions[0].status, 'scheduled');

  const calls = [];
  const result = await dispatchApprovedScheduledActions(repo, {
    now,
    recoverExecute: async (action) => {
      calls.push(action.id);
      return { providerMessageId: 'msg_001' };
    },
  });

  assert.deepEqual(result.sent.map((a) => a.id), [repo.actions[0].id]);
  assert.deepEqual(calls, [repo.actions[0].id]);
  assert.equal(repo.actions[0].status, 'sent');
  assert.equal(repo.threads[0].status, 'sent');
});

test('paid invoice reconciliation cancels pending/scheduled sends and blocks dispatch', async () => {
  const repo = memoryRepo();
  await syncProviderInvoices(repo, [{ provider: 'stripe', providerInvoiceId: 'in_paid', customerEmail: 'paid@example.test', amountDue: 5000, currency: 'usd', dueDate: '2026-06-01', status: 'open' }], { now });
  const batch = createApprovalBatch(repo, { now });
  approveApprovalBatch(repo, batch.id, { now, scheduleFor: tomorrow });

  const payment = reconcilePayment(repo, { provider: 'stripe', providerInvoiceId: 'in_paid', amount: 5000, paidAt: now }, { now });

  assert.equal(payment.invoice.status, 'paid');
  assert.equal(repo.threads[0].status, 'paid');
  assert.equal(repo.actions[0].status, 'cancelled');
  assert.match(repo.actions[0].cancelReason, /paid/i);

  let executed = false;
  const result = await dispatchApprovedScheduledActions(repo, { now: tomorrow, recoverExecute: async () => { executed = true; } });
  assert.equal(executed, false);
  assert.equal(result.sent.length, 0);
});

test('inbound reply is classified deterministically and cancels future sends', async () => {
  const repo = memoryRepo();
  await syncProviderInvoices(repo, [{ provider: 'stripe', providerInvoiceId: 'in_reply', customerEmail: 'reply@example.test', amountDue: 7500, currency: 'usd', dueDate: '2026-06-01', status: 'open' }], { now });
  const batch = createApprovalBatch(repo, { now });
  approveApprovalBatch(repo, batch.id, { now, scheduleFor: tomorrow });

  assert.equal(classifyRecoveryReply('Can you send me a copy of the invoice?'), 'needs_invoice_copy');
  const reply = await handleInboundReply(repo, { providerInvoiceId: 'in_reply', body: 'Please stop contacting me', receivedAt: now }, { now });

  assert.equal(reply.classification, 'stop_contact');
  assert.equal(repo.invoices[0].status, 'do_not_contact');
  assert.equal(repo.threads[0].status, 'blocked');
  assert.equal(repo.actions[0].status, 'cancelled');

  const result = await dispatchApprovedScheduledActions(repo, { now: tomorrow, recoverExecute: async () => assert.fail('must not dispatch after reply/DNC') });
  assert.equal(result.sent.length, 0);
});

test('planner prevents duplicate action for same invoice/stage/channel across repeated syncs', async () => {
  const repo = memoryRepo();
  const invoice = { provider: 'stripe', providerInvoiceId: 'in_dupe', customerEmail: 'dupe@example.test', amountDue: 9900, currency: 'usd', dueDate: '2026-06-01', status: 'open' };

  await syncProviderInvoices(repo, [invoice], { now });
  await syncProviderInvoices(repo, [invoice], { now });
  await syncProviderInvoices(repo, [invoice], { now });

  assert.equal(repo.invoices.length, 1);
  assert.equal(repo.threads.length, 1);
  assert.equal(repo.actions.length, 1);
  assert.equal(repo.actions[0].dedupeKey, 'stripe:in_dupe:friendly_reminder:email');
});

test('dispatch rejects direct provider hooks and re-checks unpaid/no-reply/not-DNC immediately before send', async () => {
  const repo = memoryRepo();
  await syncProviderInvoices(repo, [{ provider: 'stripe', providerInvoiceId: 'in_gate', customerEmail: 'gate@example.test', amountDue: 1000, currency: 'usd', dueDate: '2026-06-01', status: 'open' }], { now });
  const batch = createApprovalBatch(repo, { now });
  approveApprovalBatch(repo, batch.id, { now, scheduleFor: now });

  await assert.rejects(
    () => dispatchApprovedScheduledActions(repo, { now, providerSend: async () => ({}) }),
    /recoverExecute boundary is required/i,
  );

  repo.invoices[0].status = 'paid';
  const paidResult = await dispatchApprovedScheduledActions(repo, { now, recoverExecute: async () => assert.fail('must re-check unpaid before send') });
  assert.equal(paidResult.sent.length, 0);
  assert.equal(repo.actions[0].status, 'blocked');
  assert.match(repo.actions[0].blockReason, /paid/i);
});
