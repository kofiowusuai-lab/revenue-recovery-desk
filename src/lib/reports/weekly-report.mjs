import { __dashboardViewInternals } from '../client-state/dashboard-view.mjs';

const { cents, inWindow, verifiedPayments } = __dashboardViewInternals;

function list(value) {
  return Array.isArray(value) ? value : [];
}

function currencyOf(state) {
  return list(state?.payments).find((x) => x.currency)?.currency
    || list(state?.invoices).find((x) => x.currency)?.currency
    || 'USD';
}

function formatMoney(centsValue, currency) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format((centsValue || 0) / 100);
}

function atOf(row) {
  return row?.received_at ?? row?.receivedAt ?? row?.sent_at ?? row?.sentAt ?? row?.occurred_at ?? row?.occurredAt ?? row?.updated_at ?? row?.updatedAt ?? null;
}

function idOf(row) {
  return row?.id ?? row?.invoice_id ?? row?.invoiceId ?? null;
}

function invoiceIdOf(row) {
  return row?.invoice_id ?? row?.invoiceId ?? row?.id ?? null;
}

function invoiceLookup(state) {
  return new Map(list(state?.invoices).map((invoice) => [invoiceIdOf(invoice), invoice]));
}

function invoiceLabel(invoiceId, invoices) {
  const invoice = invoices.get(invoiceId) || {};
  const number = invoice.number ?? invoice.invoice_number ?? invoiceId ?? 'invoice';
  const customer = invoice.customer_name ?? invoice.customerName;
  return customer ? `${number} (${customer})` : String(number);
}

export function buildWeeklyRecoveryReport(state = {}, options = {}) {
  const weekStart = options.weekStart;
  const weekEnd = options.weekEnd;
  const currency = currencyOf(state);
  const invoices = invoiceLookup(state);
  const payments = verifiedPayments(state).filter((payment) => inWindow(payment, weekStart, weekEnd));
  const actions = list(state.actions ?? state.recovery_actions)
    .filter((action) => ['sent', 'completed'].includes(action.status))
    .filter((action) => inWindow(action, weekStart, weekEnd));
  const replies = list(state.replies ?? state.customer_replies)
    .filter((reply) => Boolean(reply.verified ?? true))
    .filter((reply) => inWindow(reply, weekStart, weekEnd));

  const recoveredCents = payments.reduce((sum, payment) => sum + cents(payment), 0);
  const hasActivity = payments.length > 0 || actions.length > 0 || replies.length > 0;
  if (!hasActivity) {
    return {
      shouldSend: false,
      reason: 'empty_week',
      weekStart,
      weekEnd,
      generatedAt: options.generatedAt ?? null,
      totals: { recoveredCents: 0, verifiedPayments: 0, actionsCompleted: 0, repliesReceived: 0 },
      sections: { wins: [], actions: [], replies: [] },
      plainText: '',
    };
  }

  const wins = payments.map((payment) => ({
    id: idOf(payment),
    invoiceId: invoiceIdOf(payment),
    amountCents: cents(payment),
    currency: payment.currency ?? currency,
    body: `${formatMoney(cents(payment), payment.currency ?? currency)} verified payment on ${invoiceLabel(invoiceIdOf(payment), invoices)}.`,
  }));
  const completedActions = actions.map((action) => ({
    id: idOf(action),
    invoiceId: invoiceIdOf(action),
    status: action.status,
    channel: action.channel ?? null,
    body: `${action.channel ?? 'Recovery'} action completed for ${invoiceLabel(invoiceIdOf(action), invoices)}.`,
  }));
  const replyItems = replies.map((reply) => ({
    id: idOf(reply),
    invoiceId: invoiceIdOf(reply),
    classification: reply.classification ?? null,
    body: `${reply.classification ?? 'Customer'} reply received for ${invoiceLabel(invoiceIdOf(reply), invoices)}.`,
  }));

  const lines = [
    `Weekly recovery report (${weekStart || 'start'} to ${weekEnd || 'end'})`,
    `Recovered: ${formatMoney(recoveredCents, currency)} from ${payments.length} verified payment${payments.length === 1 ? '' : 's'}.`,
  ];
  if (completedActions.length) lines.push(`Actions completed: ${completedActions.length}.`);
  if (replyItems.length) lines.push(`Replies received: ${replyItems.length}.`);
  if (wins.length) lines.push('Wins:', ...wins.map((win) => `- ${win.body}`));
  if (replyItems.length) lines.push('Replies:', ...replyItems.map((reply) => `- ${reply.body}`));

  return {
    shouldSend: true,
    weekStart,
    weekEnd,
    generatedAt: options.generatedAt ?? null,
    totals: {
      recoveredCents,
      verifiedPayments: payments.length,
      actionsCompleted: completedActions.length,
      repliesReceived: replyItems.length,
    },
    sections: { wins, actions: completedActions, replies: replyItems },
    plainText: lines.join('\n'),
  };
}
