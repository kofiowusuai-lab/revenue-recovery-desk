import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardProjection } from '../src/lib/client-state/dashboard-view.mjs';
import { buildWeeklyRecoveryReport } from '../src/lib/reports/weekly-report.mjs';
import { draftQuickWinNotification, draftBlockerNotification } from '../src/lib/notifications/client-success-drafts.mjs';

const week = { start: '2026-06-15T00:00:00.000Z', end: '2026-06-22T00:00:00.000Z' };

function sampleState() {
  return {
    invoices: [
      { id: 'inv_paid', number: 'INV-100', customer_name: 'Acme Ltd', status: 'paid', amount_cents: 100000, currency: 'GBP' },
      { id: 'inv_recovery', number: 'INV-101', customer_name: 'Beta Ltd', status: 'in_recovery', amount_cents: 250000, currency: 'GBP', due_date: '2026-06-01' },
      { id: 'inv_blocked', number: 'INV-102', customer_name: 'Gamma Ltd', status: 'disputed', amount_cents: 400000, currency: 'GBP' },
      { id: 'inv_open', number: 'INV-103', customer_name: 'Delta Ltd', status: 'overdue', amount_cents: 75000, currency: 'GBP' },
    ],
    payments: [
      { id: 'pay_1', invoice_id: 'inv_paid', amount_cents: 100000, currency: 'GBP', status: 'verified', received_at: '2026-06-18T10:00:00.000Z' },
      { id: 'pay_pending', invoice_id: 'inv_open', amount_cents: 999999, currency: 'GBP', status: 'pending', received_at: '2026-06-18T10:00:00.000Z' },
    ],
    actions: [
      { id: 'act_1', invoice_id: 'inv_recovery', status: 'queued_for_approval', channel: 'email', kind: 'friendly_reminder', scheduled_at: '2026-06-20T09:00:00.000Z' },
      { id: 'act_2', invoice_id: 'inv_open', status: 'scheduled', channel: 'sms', kind: 'follow_up', scheduled_at: '2026-06-21T09:00:00.000Z' },
      { id: 'act_3', invoice_id: 'inv_blocked', status: 'blocked', blocked_reason: 'dispute needs human review', updated_at: '2026-06-19T09:00:00.000Z' },
    ],
    approvals: [
      { id: 'apr_1', action_id: 'act_1', status: 'pending', requested_at: '2026-06-19T09:00:00.000Z' },
      { id: 'apr_done', action_id: 'act_old', status: 'approved', requested_at: '2026-06-10T09:00:00.000Z' },
    ],
    replies: [
      { id: 'rep_1', invoice_id: 'inv_blocked', classification: 'dispute', needs_attention: true, received_at: '2026-06-19T12:00:00.000Z', summary: 'Customer disputes service date' },
      { id: 'rep_2', invoice_id: 'inv_open', classification: 'positive', needs_attention: false, received_at: '2026-06-17T12:00:00.000Z' },
    ],
    integrations: [
      { id: 'int_payment', provider: 'Stripe', kind: 'payments', status: 'installed', last_checked_at: '2026-06-19T08:00:00.000Z' },
      { id: 'int_email', provider: 'AgentMail', kind: 'email', status: 'failed', last_error: 'token expired', last_checked_at: '2026-06-19T08:05:00.000Z' },
    ],
  };
}

test('dashboard projection summarizes visible recovery metrics from state', () => {
  const dashboard = buildDashboardProjection(sampleState(), { now: '2026-06-19T13:00:00.000Z', weekStart: week.start, weekEnd: week.end });

  assert.equal(dashboard.currency, 'GBP');
  assert.equal(dashboard.moneyRecoveredCents, 100000);
  assert.equal(dashboard.moneyInRecoveryCents, 325000);
  assert.equal(dashboard.blockedAmountCents, 400000);
  assert.equal(dashboard.pendingApprovals.count, 1);
  assert.deepEqual(dashboard.pendingApprovals.items.map((x) => x.id), ['apr_1']);
  assert.equal(dashboard.repliesNeedingAttention.count, 1);
  assert.deepEqual(dashboard.upcomingActions.map((x) => x.id), ['act_1', 'act_2']);
  assert.equal(dashboard.integrationHealth.ok, false);
  assert.deepEqual(dashboard.integrationHealth.failingProviders, ['AgentMail']);
  assert.equal(dashboard.lastActivity.at, '2026-06-19T12:00:00.000Z');
  assert.equal(dashboard.weeklyRoi.recoveredCents, 100000);
  assert.equal(dashboard.weeklyRoi.verifiedPayments, 1);
});

test('weekly report uses only verified payments/actions/replies and suppresses empty weeks', () => {
  const report = buildWeeklyRecoveryReport(sampleState(), { weekStart: week.start, weekEnd: week.end, generatedAt: '2026-06-22T08:00:00.000Z' });
  assert.equal(report.shouldSend, true);
  assert.equal(report.totals.recoveredCents, 100000);
  assert.equal(report.totals.verifiedPayments, 1);
  assert.equal(report.totals.actionsCompleted, 0);
  assert.equal(report.totals.repliesReceived, 2);
  assert.ok(report.sections.wins[0].body.includes('£1,000.00'));
  assert.doesNotMatch(report.plainText, /999999|£9,999.99/);

  const empty = buildWeeklyRecoveryReport(sampleState(), { weekStart: '2026-06-01T00:00:00.000Z', weekEnd: '2026-06-08T00:00:00.000Z' });
  assert.equal(empty.shouldSend, false);
  assert.equal(empty.reason, 'empty_week');
  assert.equal(empty.plainText, '');
});

test('high-value quick-win notification draft is safe and never invents recovered amounts', () => {
  const draft = draftQuickWinNotification({
    clientId: 'client_1',
    payment: { id: 'pay_1', invoice_id: 'inv_paid', amount_cents: 100000, currency: 'GBP', status: 'verified', received_at: '2026-06-18T10:00:00.000Z' },
    invoice: { id: 'inv_paid', number: 'INV-100', customer_name: 'Acme Ltd' },
    thresholdCents: 50000,
  });

  assert.equal(draft.type, 'client_success_quick_win');
  assert.equal(draft.send, false);
  assert.equal(draft.deliveryClaimed, false);
  assert.equal(draft.audience, 'internal_client_success');
  assert.equal(draft.amountCents, 100000);
  assert.match(draft.subject, /Quick win/);
  assert.match(draft.body, /verified payment/i);
  assert.match(draft.body, /approval/i);
  assert.doesNotMatch(draft.body, /sent to customer|delivered to customer/i);

  assert.equal(draftQuickWinNotification({ payment: { status: 'pending', amount_cents: 123456 } }), null);
});

test('blocker notification draft routes customer-facing output to action/approval concepts', () => {
  const draft = draftBlockerNotification({
    clientId: 'client_1',
    invoice: { id: 'inv_blocked', number: 'INV-102', customer_name: 'Gamma Ltd', amount_cents: 400000, currency: 'GBP' },
    blocker: { id: 'act_3', status: 'blocked', reason: 'dispute needs human review' },
    reply: { id: 'rep_1', classification: 'dispute', summary: 'Customer disputes service date' },
  });

  assert.equal(draft.type, 'client_success_blocker');
  assert.equal(draft.send, false);
  assert.equal(draft.audience, 'internal_client_success');
  assert.equal(draft.customerFacingAction.status, 'queued_for_approval');
  assert.equal(draft.customerFacingAction.requiresApproval, true);
  assert.match(draft.body, /blocked/i);
  assert.match(draft.body, /approval/i);
  assert.doesNotMatch(draft.body, /we recovered|sent to customer|delivered/i);
});

test('Lane C modules do not expose customer-facing send or direct provider calls', async () => {
  const modules = [
    await import('../src/lib/client-state/dashboard-view.mjs'),
    await import('../src/lib/reports/weekly-report.mjs'),
    await import('../src/lib/notifications/client-success-drafts.mjs'),
  ];
  for (const mod of modules) {
    assert.equal(typeof mod.sendEmail, 'undefined');
    assert.equal(typeof mod.sendSms, 'undefined');
    assert.equal(typeof mod.agentmail, 'undefined');
    assert.equal(typeof mod.twilio, 'undefined');
    assert.equal(typeof mod.stripe, 'undefined');
  }
});
