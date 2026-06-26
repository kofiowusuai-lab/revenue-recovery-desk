export const CLIENT_STATUSES = Object.freeze([
  'submitted',
  'provisioning',
  'awaiting_client',
  'readiness_blocked',
  'ready',
  'live',
  'paused',
  'offboarding',
  'offboarded',
]);

export const INTEGRATION_STATUSES = Object.freeze([
  'needed',
  'link_sent',
  'authorized',
  'installed',
  'failed',
  'revoked',
]);

export const INVOICE_STATUSES = Object.freeze([
  'open',
  'overdue',
  'in_recovery',
  'payment_promised',
  'paid',
  'disputed',
  'do_not_contact',
  'escalated',
  'written_off',
]);

export const THREAD_STATUSES = Object.freeze([
  'new',
  'drafting',
  'awaiting_approval',
  'scheduled',
  'sent',
  'replied',
  'payment_promised',
  'paid',
  'blocked',
  'escalated',
  'closed',
]);

export const THREAD_STAGES = Object.freeze([
  'preflight',
  'friendly_reminder',
  'follow_up',
  'firm_notice',
  'pre_escalation',
  'final_notice',
  'handback',
]);

export const ACTION_STATUSES = Object.freeze([
  'drafted',
  'queued_for_approval',
  'approved',
  'rejected',
  'scheduled',
  'sent',
  'blocked',
  'cancelled',
  'failed',
]);

export const APPROVAL_STATUSES = Object.freeze([
  'pending',
  'approved',
  'rejected',
  'expired',
  'edited',
]);

export const REPLY_CLASSIFICATIONS = Object.freeze([
  'paid',
  'promise_to_pay',
  'dispute',
  'hardship',
  'stop_contact',
  'wrong_person',
  'needs_invoice_copy',
  'question',
  'angry',
  'positive',
  'unknown',
]);

export const STATUS_GROUPS = Object.freeze({
  client: CLIENT_STATUSES,
  integration: INTEGRATION_STATUSES,
  invoice: INVOICE_STATUSES,
  thread: THREAD_STATUSES,
  threadStage: THREAD_STAGES,
  action: ACTION_STATUSES,
  approval: APPROVAL_STATUSES,
  replyClassification: REPLY_CLASSIFICATIONS,
});

const TRANSITIONS = Object.freeze({
  client: Object.freeze({
    submitted: ['provisioning', 'awaiting_client', 'readiness_blocked', 'offboarding'],
    provisioning: ['awaiting_client', 'readiness_blocked', 'ready', 'paused', 'offboarding'],
    awaiting_client: ['readiness_blocked', 'ready', 'paused', 'offboarding'],
    readiness_blocked: ['awaiting_client', 'ready', 'paused', 'offboarding'],
    ready: ['live', 'paused', 'readiness_blocked', 'offboarding'],
    live: ['paused', 'offboarding'],
    paused: ['awaiting_client', 'ready', 'live', 'offboarding'],
    offboarding: ['offboarded'],
    offboarded: [],
  }),
  integration: Object.freeze({
    needed: ['link_sent', 'authorized', 'installed', 'failed'],
    link_sent: ['authorized', 'installed', 'failed', 'revoked', 'needed'],
    authorized: ['installed', 'failed', 'revoked'],
    installed: ['failed', 'revoked', 'needed'],
    failed: ['link_sent', 'authorized', 'installed', 'needed'],
    revoked: ['link_sent', 'authorized', 'needed'],
  }),
  invoice: Object.freeze({
    open: ['overdue', 'paid', 'disputed', 'do_not_contact', 'written_off'],
    overdue: ['in_recovery', 'paid', 'disputed', 'do_not_contact', 'escalated', 'written_off'],
    in_recovery: ['payment_promised', 'paid', 'disputed', 'do_not_contact', 'escalated', 'written_off'],
    payment_promised: ['paid', 'in_recovery', 'disputed', 'do_not_contact', 'escalated', 'written_off'],
    paid: [],
    disputed: ['escalated', 'paid', 'written_off'],
    do_not_contact: ['paid', 'written_off'],
    escalated: ['paid', 'disputed', 'do_not_contact', 'written_off'],
    written_off: [],
  }),
  thread: Object.freeze({
    new: ['drafting', 'blocked', 'closed'],
    drafting: ['awaiting_approval', 'scheduled', 'blocked', 'closed'],
    awaiting_approval: ['scheduled', 'blocked', 'closed'],
    scheduled: ['sent', 'blocked', 'closed'],
    sent: ['replied', 'payment_promised', 'paid', 'escalated', 'closed'],
    replied: ['payment_promised', 'paid', 'blocked', 'escalated', 'closed'],
    payment_promised: ['paid', 'scheduled', 'blocked', 'escalated', 'closed'],
    paid: ['closed'],
    blocked: ['drafting', 'awaiting_approval', 'escalated', 'closed'],
    escalated: ['blocked', 'closed'],
    closed: [],
  }),
  action: Object.freeze({
    drafted: ['queued_for_approval', 'approved', 'scheduled', 'blocked', 'cancelled'],
    queued_for_approval: ['approved', 'rejected', 'cancelled', 'blocked'],
    approved: ['scheduled', 'sent', 'blocked', 'cancelled', 'failed'],
    rejected: [],
    scheduled: ['sent', 'blocked', 'cancelled', 'failed'],
    sent: [],
    blocked: ['queued_for_approval', 'approved', 'cancelled'],
    cancelled: [],
    failed: ['scheduled', 'blocked', 'cancelled'],
  }),
  approval: Object.freeze({
    pending: ['approved', 'rejected', 'expired', 'edited'],
    edited: ['approved', 'rejected', 'expired'],
    approved: [],
    rejected: [],
    expired: [],
  }),
});

export function getAllowedValues(group) {
  const values = STATUS_GROUPS[group];
  if (!values) throw new Error(`Unknown RRD status group: ${group}`);
  return [...values];
}

export function isValidStatus(group, value) {
  return Boolean(STATUS_GROUPS[group]?.includes(value));
}

export function assertValidStatus(group, value) {
  if (!isValidStatus(group, value)) {
    throw new Error(`Invalid ${group} status/value: ${value}`);
  }
  return value;
}

export function canTransition(group, from, to) {
  assertValidStatus(group, from);
  assertValidStatus(group, to);
  if (from === to) return true;
  const allowed = TRANSITIONS[group]?.[from];
  if (!allowed) throw new Error(`No transition model for RRD status group: ${group}`);
  return allowed.includes(to);
}

export function assertTransition(group, from, to) {
  if (!canTransition(group, from, to)) {
    throw new Error(`Invalid ${group} transition: ${from} -> ${to}`);
  }
  return { group, from, to };
}
