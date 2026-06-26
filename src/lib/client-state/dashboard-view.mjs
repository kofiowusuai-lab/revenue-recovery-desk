const RECOVERY_STATUSES = new Set(['in_recovery', 'payment_promised', 'overdue']);
const BLOCKED_INVOICE_STATUSES = new Set(['disputed', 'do_not_contact', 'escalated']);
const ATTENTION_REPLY_CLASSES = new Set(['dispute', 'hardship', 'stop_contact', 'wrong_person', 'needs_invoice_copy', 'question', 'angry', 'unknown']);

function list(value) {
  return Array.isArray(value) ? value : [];
}

function cents(row) {
  const value = row?.amount_cents ?? row?.amountCents ?? row?.amount ?? 0;
  if (Number.isFinite(value)) return Math.round(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function currencyOf(state) {
  return list(state?.payments).find((x) => x.currency)?.currency
    || list(state?.invoices).find((x) => x.currency)?.currency
    || 'USD';
}

function idOf(row) {
  return row?.id ?? row?.invoice_id ?? row?.invoiceId ?? null;
}

function invoiceIdOf(row) {
  return row?.invoice_id ?? row?.invoiceId ?? row?.id ?? null;
}

function atOf(row) {
  return row?.received_at ?? row?.receivedAt ?? row?.occurred_at ?? row?.occurredAt ?? row?.updated_at ?? row?.updatedAt ?? row?.scheduled_at ?? row?.scheduledAt ?? row?.requested_at ?? row?.requestedAt ?? row?.last_checked_at ?? row?.lastCheckedAt ?? null;
}

function inWindow(row, start, end) {
  const at = atOf(row);
  if (!at) return false;
  const time = new Date(at).getTime();
  if (!Number.isFinite(time)) return false;
  if (start && time < new Date(start).getTime()) return false;
  if (end && time >= new Date(end).getTime()) return false;
  return true;
}

function verifiedPayments(state) {
  return list(state?.payments).filter((p) => p.status === 'verified' || p.verified === true);
}

function simplifyAction(action) {
  return {
    id: idOf(action),
    invoiceId: invoiceIdOf(action),
    status: action.status,
    channel: action.channel ?? null,
    kind: action.kind ?? action.type ?? null,
    scheduledAt: action.scheduled_at ?? action.scheduledAt ?? null,
  };
}

function simplifyApproval(approval, context = {}) {
  const actionId = approval.action_id ?? approval.actionId ?? null;
  const action = context.actionById?.get(actionId) || {};
  const invoiceId = action.invoice_id ?? action.invoiceId ?? approval.invoice_id ?? approval.invoiceId ?? null;
  const invoice = context.invoiceById?.get(invoiceId) || {};
  return {
    id: idOf(approval),
    actionId,
    invoiceId,
    status: approval.status,
    requestedAt: approval.requested_at ?? approval.requestedAt ?? null,
    channel: action.channel ?? approval.channel ?? null,
    kind: action.kind ?? action.type ?? approval.kind ?? approval.type ?? null,
    customerName: action.customer_name ?? action.customerName ?? invoice.customer_name ?? invoice.customerName ?? null,
    customerEmail: action.customer_email ?? action.customerEmail ?? invoice.customer_email ?? invoice.customerEmail ?? null,
    invoiceNumber: action.invoice_number ?? action.invoiceNumber ?? invoice.number ?? invoice.invoice_number ?? invoice.invoiceNumber ?? invoiceId,
    amountCents: cents(action.amount_cents != null || action.amount != null ? action : invoice),
    currency: action.currency ?? invoice.currency ?? null,
    subject: action.subject ?? approval.subject ?? null,
    draftText: action.draft_text ?? action.draftText ?? action.body ?? action.message ?? action.text ?? null,
  };
}

function simplifyReply(reply) {
  return {
    id: idOf(reply),
    invoiceId: invoiceIdOf(reply),
    classification: reply.classification ?? null,
    summary: reply.summary ?? null,
    receivedAt: reply.received_at ?? reply.receivedAt ?? null,
  };
}

export function buildDashboardProjection(state = {}, options = {}) {
  const invoices = list(state.invoices);
  const payments = verifiedPayments(state);
  const actions = list(state.actions ?? state.recovery_actions);
  const approvals = list(state.approvals ?? state.approval_requests);
  const replies = list(state.replies ?? state.customer_replies);
  const integrations = list(state.integrations ?? state.client_integrations);
  const invoiceById = new Map(invoices.map((invoice) => [invoiceIdOf(invoice), invoice]));
  const actionById = new Map(actions.map((action) => [idOf(action), action]));
  const paidInvoiceIds = new Set(payments.map((payment) => invoiceIdOf(payment)).filter(Boolean));

  const moneyRecoveredCents = payments.reduce((sum, payment) => sum + cents(payment), 0);
  const moneyInRecoveryCents = invoices
    .filter((invoice) => RECOVERY_STATUSES.has(invoice.status) && !paidInvoiceIds.has(invoiceIdOf(invoice)))
    .reduce((sum, invoice) => sum + cents(invoice), 0);
  const blockedAmountCents = invoices
    .filter((invoice) => BLOCKED_INVOICE_STATUSES.has(invoice.status))
    .reduce((sum, invoice) => sum + cents(invoice), 0);

  const pendingApprovalItems = approvals
    .filter((approval) => approval.status === 'pending')
    .map((approval) => simplifyApproval(approval, { actionById, invoiceById }))
    .sort((a, b) => String(a.requestedAt || '').localeCompare(String(b.requestedAt || '')));

  const attentionReplies = replies
    .filter((reply) => reply.needs_attention === true || ATTENTION_REPLY_CLASSES.has(reply.classification))
    .map(simplifyReply)
    .sort((a, b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')));

  const upcomingActions = actions
    .filter((action) => ['queued_for_approval', 'approved', 'scheduled'].includes(action.status))
    .map(simplifyAction)
    .sort((a, b) => String(a.scheduledAt || '').localeCompare(String(b.scheduledAt || '')));

  const failing = integrations.filter((integration) => ['failed', 'revoked', 'needed'].includes(integration.status));
  const nowMs = options.now ? new Date(options.now).getTime() : Number.POSITIVE_INFINITY;
  const activityCandidates = [
    ...payments.map((row) => ({ kind: 'payment', at: atOf(row), id: idOf(row) })),
    ...actions.map((row) => ({ kind: 'action', at: atOf(row), id: idOf(row) })),
    ...approvals.map((row) => ({ kind: 'approval', at: atOf(row), id: idOf(row) })),
    ...replies.map((row) => ({ kind: 'reply', at: atOf(row), id: idOf(row) })),
    ...integrations.map((row) => ({ kind: 'integration', at: atOf(row), id: idOf(row) })),
  ].filter((row) => row.at && new Date(row.at).getTime() <= nowMs);
  activityCandidates.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const weeklyPayments = payments.filter((payment) => inWindow(payment, options.weekStart, options.weekEnd));

  return {
    generatedAt: options.now ?? new Date().toISOString(),
    currency: currencyOf(state),
    moneyRecoveredCents,
    moneyInRecoveryCents,
    blockedAmountCents,
    pendingApprovals: { count: pendingApprovalItems.length, items: pendingApprovalItems },
    repliesNeedingAttention: { count: attentionReplies.length, items: attentionReplies },
    upcomingActions,
    integrationHealth: {
      ok: failing.length === 0,
      total: integrations.length,
      failing: failing.length,
      failingProviders: [...new Set(failing.map((integration) => integration.provider ?? integration.kind ?? integration.id).filter(Boolean))].sort(),
    },
    lastActivity: activityCandidates[0] ?? null,
    weeklyRoi: {
      weekStart: options.weekStart ?? null,
      weekEnd: options.weekEnd ?? null,
      recoveredCents: weeklyPayments.reduce((sum, payment) => sum + cents(payment), 0),
      verifiedPayments: weeklyPayments.length,
    },
    invoiceLookup: Object.fromEntries([...invoiceById.entries()].filter(([key]) => key).map(([key, invoice]) => [key, { number: invoice.number ?? invoice.invoice_number ?? null, customerName: invoice.customer_name ?? invoice.customerName ?? null }])),
  };
}

export const __dashboardViewInternals = { cents, inWindow, verifiedPayments };
