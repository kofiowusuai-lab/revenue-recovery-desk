function cents(row) {
  const value = row?.amount_cents ?? row?.amountCents ?? 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function formatMoney(centsValue, currency = 'USD') {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format((centsValue || 0) / 100);
}

function invoiceNumber(invoice = {}) {
  return invoice.number ?? invoice.invoice_number ?? invoice.id ?? invoice.invoice_id ?? 'invoice';
}

function customerName(invoice = {}) {
  return invoice.customer_name ?? invoice.customerName ?? 'customer';
}

function baseDraft(type, clientId) {
  return {
    type,
    clientId: clientId ?? null,
    audience: 'internal_client_success',
    send: false,
    deliveryClaimed: false,
    createdFor: 'draft_review',
  };
}

export function draftQuickWinNotification(input = {}) {
  const payment = input.payment ?? {};
  if (!(payment.status === 'verified' || payment.verified === true)) return null;
  const amountCents = cents(payment);
  if (amountCents <= 0) return null;
  const thresholdCents = Number.isFinite(input.thresholdCents) ? input.thresholdCents : 0;
  if (amountCents < thresholdCents) return null;

  const invoice = input.invoice ?? {};
  const currency = payment.currency ?? invoice.currency ?? 'USD';
  const amount = formatMoney(amountCents, currency);
  const number = invoiceNumber(invoice);
  const customer = customerName(invoice);

  return {
    ...baseDraft('client_success_quick_win', input.clientId),
    paymentId: payment.id ?? null,
    invoiceId: payment.invoice_id ?? payment.invoiceId ?? invoice.id ?? null,
    amountCents,
    currency,
    subject: `Quick win: ${amount} verified on ${number}`,
    body: [
      `${amount} verified payment has been received for ${number} (${customer}).`,
      'Recommended client-success action: share the win internally and ask the client whether any follow-up approval or reconciliation note is needed.',
      'No customer-facing delivery is claimed by this draft; any customer-facing output must be created as a recovery action and pass the approval gate.',
    ].join('\n\n'),
    customerFacingAction: {
      status: 'approval_required',
      requiresApproval: true,
      concept: 'client_success_update_only',
    },
  };
}

export function draftBlockerNotification(input = {}) {
  const invoice = input.invoice ?? {};
  const blocker = input.blocker ?? {};
  const reply = input.reply ?? null;
  const amountCents = cents(invoice);
  const currency = invoice.currency ?? 'USD';
  const number = invoiceNumber(invoice);
  const customer = customerName(invoice);
  const reason = blocker.reason ?? blocker.blocked_reason ?? blocker.last_error ?? reply?.classification ?? 'needs human review';
  const replySummary = reply?.summary ? ` Reply summary: ${reply.summary}.` : '';

  return {
    ...baseDraft('client_success_blocker', input.clientId),
    invoiceId: invoice.id ?? blocker.invoice_id ?? blocker.invoiceId ?? null,
    blockerId: blocker.id ?? null,
    amountCents: amountCents || null,
    currency,
    subject: `Blocker needs review: ${number}`,
    body: [
      `${number} (${customer}) is blocked: ${reason}.${replySummary}`,
      amountCents > 0 ? `Amount at risk: ${formatMoney(amountCents, currency)}.` : 'Amount at risk is not stated in this draft.',
      'Recommended next step: prepare a customer-facing recovery action only after the client-success owner confirms the path, then route it through approval before any dispatch.',
    ].join('\n\n'),
    customerFacingAction: {
      status: 'queued_for_approval',
      requiresApproval: true,
      concept: 'resolve_blocker_before_outreach',
    },
  };
}
