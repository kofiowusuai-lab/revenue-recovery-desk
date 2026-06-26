import { buildDashboardProjection } from '../client-state/dashboard-view.mjs';
import {
  approveApprovalBatch,
  createApprovalBatch,
  dispatchApprovedScheduledActions,
  planNextRecoveryAction,
  reconcilePayment,
  syncProviderInvoices,
} from '../recovery/pipeline.mjs';
import { buildWeeklyRecoveryReport } from '../reports/weekly-report.mjs';

const DEFAULT_APPROVAL_TO = 'Kofi@traqd.io';
const DEFAULT_NOW = '2026-06-26T12:00:00.000Z';

function emptyState() {
  return {
    invoices: [],
    threads: [],
    actions: [],
    approvalBatches: [],
    replies: [],
    payments: [],
    reports: [],
    integrations: [{ id: 'int_stripe', provider: 'stripe', status: 'authorized', category: 'payments' }],
  };
}

function fakeOverdueInvoice() {
  return {
    provider: 'stripe',
    providerInvoiceId: 'in_sandbox_001',
    number: 'INV-SANDBOX-001',
    customerId: 'cus_sandbox',
    customerEmail: 'finance@example.test',
    customerName: 'Sandbox Customer Ltd',
    amountDue: 12500,
    amount_cents: 12500,
    currency: 'GBP',
    dueDate: '2026-06-01',
    status: 'open',
    raw: { authorization: 'Bearer should-not-leak', access_token: 'secret_token' },
  };
}

function summarizeBatch(batch) {
  if (!batch) return null;
  return {
    id: batch.id,
    status: batch.status,
    reviewerId: batch.reviewerId,
    approverId: batch.approverId ?? null,
    actionIds: batch.actionIds || [],
    approvedAt: batch.approvedAt ?? null,
  };
}

export async function runAutomationSandbox({ approvalTo = DEFAULT_APPROVAL_TO, now = DEFAULT_NOW } = {}) {
  const state = emptyState();
  const syncResult = await syncProviderInvoices(state, [fakeOverdueInvoice()], { now });
  const invoice = syncResult.invoices[0];
  const action = syncResult.actions[0] || planNextRecoveryAction(state, { invoiceId: invoice.id, now });
  const pendingBatch = createApprovalBatch(state, { now, reviewerId: approvalTo });
  const approvedBatch = approveApprovalBatch(state, pendingBatch.id, {
    approverId: approvalTo,
    now,
    scheduleFor: now,
  });

  const dispatchResult = await dispatchApprovedScheduledActions(state, {
    now,
    dryRun: true,
    recoverExecute: async (scheduledAction, context) => ({
      accepted: false,
      dryRun: context.dryRun === true,
      routedThrough: 'rrd-recover gate/send',
      actionId: scheduledAction.id,
    }),
  });

  const paymentResult = reconcilePayment(state, {
    provider: 'stripe',
    providerInvoiceId: 'in_sandbox_001',
    amount: 12500,
    currency: 'GBP',
    paidAt: now,
  }, { now });

  const dashboard = buildDashboardProjection(state, { now, weekStart: '2026-06-19T00:00:00.000Z', weekEnd: '2026-06-27T00:00:00.000Z' });
  const weeklyReport = buildWeeklyRecoveryReport(state, { weekStart: '2026-06-19T00:00:00.000Z', weekEnd: '2026-06-27T00:00:00.000Z', generatedAt: now });

  return {
    ok: true,
    approvalTo,
    syncedInvoices: state.invoices.length,
    actionId: action?.id || null,
    approvalBatch: summarizeBatch(approvedBatch),
    dispatch: {
      dryRun: true,
      dispatched: dispatchResult.sent.length,
      blocked: dispatchResult.blocked.length,
      routedThrough: 'rrd-recover gate/send',
    },
    paymentReconcile: {
      reconciled: paymentResult.payment ? 1 : 0,
      cancelled: paymentResult.cancelled.length,
    },
    dashboard: {
      recoveredCents: dashboard.moneyRecoveredCents,
      inRecoveryCents: dashboard.moneyInRecoveryCents,
      pendingApprovals: dashboard.pendingApprovals.count,
      upcomingActions: dashboard.upcomingActions.length,
    },
    weeklyReport: {
      shouldSend: weeklyReport.shouldSend,
      recoveredCents: weeklyReport.recoveredCents,
      payments: weeklyReport.payments,
      title: weeklyReport.title,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const approvalArgIndex = process.argv.indexOf('--approval-to');
  const approvalTo = approvalArgIndex >= 0 ? process.argv[approvalArgIndex + 1] : process.env.RRD_APPROVAL_TO_EMAIL || DEFAULT_APPROVAL_TO;
  const result = await runAutomationSandbox({ approvalTo });
  console.log(JSON.stringify(result, null, 2));
}
