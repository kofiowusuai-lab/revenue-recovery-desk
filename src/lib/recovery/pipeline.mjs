import { actionKey } from './action-key.mjs';

const ACTIVE_ACTION_STATUSES = new Set(['drafted', 'queued_for_approval', 'approved', 'scheduled']);
const BLOCKING_INVOICE_STATUSES = new Set(['paid', 'do_not_contact', 'disputed', 'escalated', 'written_off']);
const BLOCKING_THREAD_STATUSES = new Set(['replied', 'paid', 'blocked', 'escalated', 'closed']);

function asArray(repo, collection) {
  if (!repo || typeof repo !== 'object') throw new Error('repository object is required');
  if (!Array.isArray(repo[collection])) repo[collection] = [];
  return repo[collection];
}

function iso(value = new Date()) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function dateOnly(value) {
  if (!value) return undefined;
  return String(value).slice(0, 10);
}

function id(prefix, payload) {
  return actionKey(payload, { prefix, length: 20 });
}

function providerKey({ provider = 'unknown', providerInvoiceId, id: invoiceId }) {
  return `${provider}:${providerInvoiceId || invoiceId}`;
}

function findInvoice(repo, ref = {}) {
  const invoices = asArray(repo, 'invoices');
  if (ref.invoiceId) return invoices.find((invoice) => invoice.id === ref.invoiceId);
  if (ref.providerInvoiceId) {
    return invoices.find((invoice) => invoice.providerInvoiceId === ref.providerInvoiceId && (!ref.provider || invoice.provider === ref.provider));
  }
  return undefined;
}

function findThread(repo, invoiceId) {
  return asArray(repo, 'threads').find((thread) => thread.invoiceId === invoiceId);
}

function shouldRecoverInvoice(invoice) {
  return invoice && !BLOCKING_INVOICE_STATUSES.has(invoice.status) && Number(invoice.amountDue || 0) > 0;
}

function daysOverdue(invoice, now) {
  const due = invoice.dueDate ? Date.parse(`${dateOnly(invoice.dueDate)}T00:00:00.000Z`) : Number.NaN;
  const at = Date.parse(now);
  if (!Number.isFinite(due) || !Number.isFinite(at)) return 0;
  return Math.floor((at - due) / 86_400_000);
}

function chooseStage(invoice, thread, now, policy = {}) {
  if (policy.stage) return policy.stage;
  const sentCount = asNumber(thread?.sentCount, 0);
  // The first automated touch is always friendly. Aging and sent-count then
  // combine to escalate future touches without skipping the initial approval gate.
  if (sentCount <= 0) return 'friendly_reminder';
  const overdue = daysOverdue(invoice, now);
  if (sentCount >= 4 || overdue >= 45) return 'final_notice';
  if (sentCount >= 3 || overdue >= 30) return 'pre_escalation';
  if (sentCount >= 2 || overdue >= 21) return 'firm_notice';
  return 'follow_up';
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function chooseChannel(invoice, policy = {}) {
  return policy.channel || invoice.preferredChannel || (invoice.customerEmail ? 'email' : 'manual_review');
}

function draftBody(invoice, stage) {
  const amount = `${(asNumber(invoice.amountDue) / 100).toFixed(2)} ${String(invoice.currency || '').toUpperCase()}`.trim();
  const number = invoice.number || invoice.providerInvoiceId || invoice.id;
  return `Reminder: invoice ${number} for ${amount} is overdue. Please pay or reply if you have questions.`;
}

export function normalizeProviderInvoice(providerInvoice = {}, { now = new Date().toISOString() } = {}) {
  const provider = providerInvoice.provider || providerInvoice.source || 'unknown';
  const providerInvoiceId = providerInvoice.providerInvoiceId || providerInvoice.invoiceId || providerInvoice.id;
  if (!providerInvoiceId) throw new Error('providerInvoiceId is required');

  const rawStatus = String(providerInvoice.status || '').toLowerCase();
  let status = rawStatus === 'paid' || rawStatus === 'succeeded' ? 'paid' : 'open';
  const amountDue = asNumber(providerInvoice.amountDue ?? providerInvoice.amount_remaining ?? providerInvoice.balance ?? providerInvoice.total);
  const dueDate = dateOnly(providerInvoice.dueDate || providerInvoice.due_date || providerInvoice.due_at);
  if (status !== 'paid' && dueDate && Date.parse(`${dueDate}T23:59:59.999Z`) < Date.parse(now)) status = 'overdue';

  return {
    id: id('inv', { provider, providerInvoiceId }),
    provider,
    providerInvoiceId,
    number: providerInvoice.number,
    customerId: providerInvoice.customerId || providerInvoice.customer_id,
    customerEmail: providerInvoice.customerEmail || providerInvoice.customer_email || providerInvoice.email,
    amountDue,
    currency: String(providerInvoice.currency || 'usd').toLowerCase(),
    dueDate,
    providerStatus: providerInvoice.status || 'unknown',
    status,
    syncedAt: iso(now),
  };
}

export async function syncProviderInvoices(repo, providerInvoices = [], options = {}) {
  const now = iso(options.now || new Date());
  const invoices = asArray(repo, 'invoices');
  const synced = [];
  const threads = [];
  const actions = [];

  for (const providerInvoice of providerInvoices) {
    const normalized = normalizeProviderInvoice(providerInvoice, { now });
    const existing = invoices.find((invoice) => invoice.provider === normalized.provider && invoice.providerInvoiceId === normalized.providerInvoiceId);
    let invoice;
    if (existing) {
      const previousStatus = existing.status;
      Object.assign(existing, normalized, {
        status: previousStatus === 'do_not_contact' ? 'do_not_contact' : normalized.status,
        updatedAt: now,
      });
      invoice = existing;
    } else {
      invoice = { ...normalized, createdAt: now, updatedAt: now };
      invoices.push(invoice);
    }

    if (invoice.status === 'overdue') invoice.status = 'in_recovery';
    synced.push(invoice);

    if (shouldRecoverInvoice(invoice)) {
      const thread = ensureRecoveryThread(repo, invoice, { now });
      threads.push(thread);
      const action = planNextRecoveryAction(repo, { invoiceId: invoice.id, now, policy: options.policy });
      if (action) actions.push(action);
    } else if (invoice.status === 'paid') {
      cancelFutureActionsForInvoice(repo, invoice.id, { now, reason: 'invoice paid at sync' });
      const thread = findThread(repo, invoice.id);
      if (thread) Object.assign(thread, { status: 'paid', updatedAt: now });
    }
  }

  return { invoices: synced, threads, actions };
}

export function ensureRecoveryThread(repo, invoice, { now = new Date().toISOString() } = {}) {
  const at = iso(now);
  const threads = asArray(repo, 'threads');
  let thread = threads.find((item) => item.invoiceId === invoice.id);
  if (!thread) {
    thread = {
      id: id('thr', { invoiceId: invoice.id }),
      invoiceId: invoice.id,
      provider: invoice.provider,
      providerInvoiceId: invoice.providerInvoiceId,
      customerId: invoice.customerId,
      status: 'new',
      stage: 'preflight',
      sentCount: 0,
      createdAt: at,
      updatedAt: at,
    };
    threads.push(thread);
  }
  if (!BLOCKING_THREAD_STATUSES.has(thread.status) && shouldRecoverInvoice(invoice)) {
    thread.status = 'drafting';
    thread.updatedAt = at;
  }
  return thread;
}

export function planNextRecoveryAction(repo, { invoiceId, now = new Date().toISOString(), policy = {} } = {}) {
  const at = iso(now);
  const invoice = findInvoice(repo, { invoiceId });
  if (!shouldRecoverInvoice(invoice)) return undefined;
  const thread = findThread(repo, invoice.id) || ensureRecoveryThread(repo, invoice, { now: at });
  if (BLOCKING_THREAD_STATUSES.has(thread.status)) return undefined;

  const stage = chooseStage(invoice, thread, at, policy);
  const channel = chooseChannel(invoice, policy);
  if (channel === 'manual_review') {
    thread.status = 'blocked';
    thread.blockReason = 'no approved recovery channel';
    thread.updatedAt = at;
    return undefined;
  }

  const dedupeKey = `${providerKey(invoice)}:${stage}:${channel}`;
  const actions = asArray(repo, 'actions');
  const duplicate = actions.find((action) => action.dedupeKey === dedupeKey);
  if (duplicate) return duplicate;

  const action = {
    id: id('act', { dedupeKey }),
    dedupeKey,
    invoiceId: invoice.id,
    threadId: thread.id,
    provider: invoice.provider,
    providerInvoiceId: invoice.providerInvoiceId,
    stage,
    channel,
    status: 'queued_for_approval',
    scheduledFor: null,
    to: invoice.customerEmail,
    subject: `Overdue invoice ${invoice.number || invoice.providerInvoiceId}`,
    body: draftBody(invoice, stage),
    createdAt: at,
    updatedAt: at,
  };
  actions.push(action);
  Object.assign(thread, { status: 'awaiting_approval', stage, updatedAt: at });
  return action;
}

export function createApprovalBatch(repo, { now = new Date().toISOString(), reviewerId = null } = {}) {
  const at = iso(now);
  const actions = asArray(repo, 'actions').filter((action) => action.status === 'queued_for_approval' && !action.approvalBatchId);
  const batch = {
    id: id('apb', { actions: actions.map((action) => action.id), at }),
    status: 'pending',
    reviewerId,
    actionIds: actions.map((action) => action.id),
    actions,
    createdAt: at,
    updatedAt: at,
  };
  asArray(repo, 'approvalBatches').push(batch);
  for (const action of actions) {
    action.approvalBatchId = batch.id;
    action.updatedAt = at;
  }
  return batch;
}

export function approveApprovalBatch(repo, batchId, { approverId = null, now = new Date().toISOString(), scheduleFor = now } = {}) {
  const at = iso(now);
  const batch = asArray(repo, 'approvalBatches').find((item) => item.id === batchId);
  if (!batch) throw new Error(`approval batch not found: ${batchId}`);
  if (batch.status !== 'pending' && batch.status !== 'edited') throw new Error(`approval batch is not approvable: ${batch.status}`);
  batch.status = 'approved';
  batch.approverId = approverId;
  batch.approvedAt = at;
  batch.updatedAt = at;

  const actionIds = new Set(batch.actionIds || []);
  const actions = asArray(repo, 'actions').filter((action) => actionIds.has(action.id));
  for (const action of actions) {
    if (action.status === 'queued_for_approval' || action.status === 'approved') {
      action.status = 'scheduled';
      action.scheduledFor = iso(scheduleFor);
      action.updatedAt = at;
      const thread = findThread(repo, action.invoiceId);
      if (thread && !BLOCKING_THREAD_STATUSES.has(thread.status)) Object.assign(thread, { status: 'scheduled', updatedAt: at });
    }
  }
  return { ...batch, actions };
}

function dispatchBlockReason(repo, action) {
  const invoice = findInvoice(repo, { invoiceId: action.invoiceId });
  const thread = findThread(repo, action.invoiceId);
  if (!invoice) return 'invoice missing';
  if (invoice.status === 'paid') return 'invoice paid';
  if (invoice.status === 'do_not_contact') return 'invoice do-not-contact';
  if (BLOCKING_INVOICE_STATUSES.has(invoice.status)) return `invoice ${invoice.status}`;
  if (thread?.status === 'replied') return 'thread already has reply';
  if (thread && BLOCKING_THREAD_STATUSES.has(thread.status)) return `thread ${thread.status}`;
  if (asArray(repo, 'replies').some((reply) => reply.invoiceId === action.invoiceId)) return 'invoice has reply';
  return null;
}

export async function dispatchApprovedScheduledActions(repo, { now = new Date().toISOString(), recoverExecute, providerSend, send, directSend, dryRun = false } = {}) {
  if (providerSend || send || directSend || typeof recoverExecute !== 'function') {
    throw new Error('recoverExecute boundary is required; direct provider hooks are rejected');
  }
  const at = iso(now);
  const sent = [];
  const blocked = [];
  const dueActions = asArray(repo, 'actions').filter((action) => action.status === 'scheduled' && (!action.scheduledFor || Date.parse(action.scheduledFor) <= Date.parse(at)));

  for (const action of dueActions) {
    const reason = dispatchBlockReason(repo, action);
    if (reason) {
      action.status = 'blocked';
      action.blockReason = reason;
      action.updatedAt = at;
      blocked.push(action);
      continue;
    }

    const receipt = await recoverExecute(Object.freeze({ ...action }), { now: at, dryRun });
    if (dryRun) {
      sent.push({ ...action, dryRun: true, receipt: receipt || null });
      continue;
    }
    action.status = 'sent';
    action.sentAt = at;
    action.receipt = receipt || null;
    action.updatedAt = at;
    sent.push(action);
    const thread = findThread(repo, action.invoiceId);
    if (thread) {
      thread.status = 'sent';
      thread.sentCount = asNumber(thread.sentCount) + 1;
      thread.lastSentAt = at;
      thread.updatedAt = at;
    }
  }
  return { sent, blocked };
}

export function cancelFutureActionsForInvoice(repo, invoiceId, { now = new Date().toISOString(), reason = 'cancelled' } = {}) {
  const at = iso(now);
  const cancelled = [];
  for (const action of asArray(repo, 'actions')) {
    if (action.invoiceId === invoiceId && ACTIVE_ACTION_STATUSES.has(action.status)) {
      action.status = 'cancelled';
      action.cancelReason = reason;
      action.cancelledAt = at;
      action.updatedAt = at;
      cancelled.push(action);
    }
  }
  return cancelled;
}

export function classifyRecoveryReply(body = '', { llmClassification } = {}) {
  if (llmClassification) return llmClassification;
  const text = String(body).toLowerCase();
  if (/\b(stop|unsubscribe|do not contact|don't contact|remove me)\b/.test(text)) return 'stop_contact';
  if (/\b(paid|payment sent|already paid|receipt)\b/.test(text)) return 'paid';
  if (/\b(will pay|promise|pay on|pay by|next week|friday)\b/.test(text)) return 'promise_to_pay';
  if (/\b(dispute|wrong|incorrect|not my|invalid)\b/.test(text)) return 'dispute';
  if (/\b(hardship|can't pay|cannot pay|layoff|bankrupt)\b/.test(text)) return 'hardship';
  if (/\b(wrong person|not me|who is this)\b/.test(text)) return 'wrong_person';
  if (/\b(copy|invoice|statement|details|pdf)\b/.test(text)) return 'needs_invoice_copy';
  if (/\?/.test(text) || /\b(question|why|how|when)\b/.test(text)) return 'question';
  if (/\b(thanks|thank you|ok|okay)\b/.test(text)) return 'positive';
  return 'unknown';
}

export async function handleInboundReply(repo, reply = {}, { now = new Date().toISOString(), classify = classifyRecoveryReply } = {}) {
  const at = iso(reply.receivedAt || now);
  const invoice = findInvoice(repo, reply);
  if (!invoice) throw new Error('invoice not found for reply');
  const classification = await classify(reply.body || '', reply);
  const record = {
    id: id('rep', { invoiceId: invoice.id, at, body: reply.body }),
    invoiceId: invoice.id,
    provider: invoice.provider,
    providerInvoiceId: invoice.providerInvoiceId,
    body: reply.body || '',
    classification,
    receivedAt: at,
  };
  asArray(repo, 'replies').push(record);
  cancelFutureActionsForInvoice(repo, invoice.id, { now: at, reason: `reply received: ${classification}` });

  const thread = findThread(repo, invoice.id);
  if (classification === 'stop_contact') {
    invoice.status = 'do_not_contact';
    if (thread) Object.assign(thread, { status: 'blocked', replyClassification: classification, updatedAt: at });
  } else if (classification === 'paid') {
    invoice.status = 'paid';
    if (thread) Object.assign(thread, { status: 'paid', replyClassification: classification, updatedAt: at });
  } else if (classification === 'promise_to_pay') {
    invoice.status = 'payment_promised';
    if (thread) Object.assign(thread, { status: 'payment_promised', replyClassification: classification, updatedAt: at });
  } else if (classification === 'dispute') {
    invoice.status = 'disputed';
    if (thread) Object.assign(thread, { status: 'escalated', replyClassification: classification, updatedAt: at });
  } else if (thread) {
    Object.assign(thread, { status: 'replied', replyClassification: classification, updatedAt: at });
  }
  invoice.updatedAt = at;
  return record;
}

export function reconcilePayment(repo, payment = {}, { now = new Date().toISOString() } = {}) {
  const at = iso(payment.paidAt || now);
  const invoice = findInvoice(repo, payment);
  if (!invoice) throw new Error('invoice not found for payment');
  const record = {
    id: id('pay', { invoiceId: invoice.id, at, amount: payment.amount }),
    invoiceId: invoice.id,
    provider: invoice.provider,
    providerInvoiceId: invoice.providerInvoiceId,
    amount: asNumber(payment.amount, invoice.amountDue),
    amount_cents: asNumber(payment.amount, invoice.amountDue),
    currency: payment.currency || invoice.currency || 'USD',
    status: 'verified',
    paidAt: at,
    received_at: at,
  };
  asArray(repo, 'payments').push(record);
  invoice.status = 'paid';
  invoice.amountDue = 0;
  invoice.paidAt = at;
  invoice.updatedAt = at;
  const thread = findThread(repo, invoice.id);
  if (thread) Object.assign(thread, { status: 'paid', updatedAt: at });
  const cancelled = cancelFutureActionsForInvoice(repo, invoice.id, { now: at, reason: 'invoice paid' });
  return { payment: record, invoice, cancelled };
}
