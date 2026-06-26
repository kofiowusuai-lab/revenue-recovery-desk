import { randomUUID } from 'node:crypto';
import { assertValidStatus } from '../client-state/rrd-status.mjs';

export const RRD_TABLES = Object.freeze([
  'submissions',
  'clients',
  'client_settings',
  'client_integrations',
  'invoices',
  'recovery_threads',
  'recovery_actions',
  'approval_requests',
  'customer_replies',
  'payments',
  'reports',
  'agent_runs',
  'audit_events',
  'job_locks',
]);

const DEFAULTS = Object.freeze({
  clients: { status: 'submitted', timezone: 'UTC', raw_payload: {}, metadata: {} },
  client_settings: {
    approval_required: true,
    authorized_channels: [],
    business_hours: {},
    tone_rules: {},
    recovery_rules: {},
    do_not_contact_rules: {},
    discount_limits: {},
    escalation_rules: {},
    raw_payload: {},
  },
  client_integrations: { status: 'needed', config: {}, raw_payload: {} },
  invoices: { currency: 'USD', amount_due: 0, amount_paid: 0, status: 'open', raw_payload: {} },
  recovery_threads: { status: 'new', stage: 'preflight', raw_payload: {} },
  recovery_actions: { status: 'drafted', payload: {} },
  approval_requests: { status: 'pending', payload: {} },
  customer_replies: { classification: 'unknown', requires_human: true, raw_payload: {} },
  payments: { currency: 'USD', status: 'succeeded', raw_payload: {} },
  reports: { report_type: 'weekly', status: 'drafted', recovered_amount: 0, outstanding_amount: 0, blocked_amount: 0, payload: {} },
  agent_runs: { status: 'started', input: {}, output: {} },
  audit_events: { payload: {} },
  job_locks: { metadata: {} },
  submissions: { raw_payload: {} },
});

const STATUS_FIELDS = Object.freeze({
  clients: [['client', 'status']],
  client_integrations: [['integration', 'status']],
  invoices: [['invoice', 'status']],
  recovery_threads: [['thread', 'status'], ['threadStage', 'stage']],
  recovery_actions: [['action', 'status'], ['threadStage', 'stage']],
  approval_requests: [['approval', 'status']],
  customer_replies: [['replyClassification', 'classification']],
});

const SECRET_KEY_RE = /(password|passwd|secret|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|private[_-]?key|client[_-]?secret|authorization|bearer|webhook[_-]?secret)/i;
const SAFE_SECRET_REFERENCE_KEY_RE = /(^|[_-])(key|secret|token|credential)[_-]?name$/i;
const SECRET_VALUE_RE = /(^|\b)(sk|rk|pk)_(live|test)_[A-Za-z0-9]{6,}|xox[baprs]-[A-Za-z0-9-]{6,}|Bearer\s+[A-Za-z0-9._~+/-]+=*|-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----|[A-Za-z0-9+/]{40,}={0,2}/;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeProfileName(name) {
  return String(name || '').trim().toLowerCase();
}

function cleanObject(input) {
  const out = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function validateNoSecrets(value, path = 'record') {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNoSecrets(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(key) && !SAFE_SECRET_REFERENCE_KEY_RE.test(key)) {
        throw new Error(`Refusing to store secret-looking field in ${path}.${key}`);
      }
      validateNoSecrets(nested, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && SECRET_VALUE_RE.test(value)) {
    throw new Error(`Refusing to store secret-looking value in ${path}`);
  }
}

function assertKnownTable(table) {
  if (!RRD_TABLES.includes(table)) throw new Error(`Unknown RRD table: ${table}`);
}

function assertClientId(record, table) {
  if (!record.client_id) throw new Error(`${table} requires client_id`);
}

function validateStatuses(table, record) {
  for (const [group, field] of STATUS_FIELDS[table] || []) {
    if (record[field] !== undefined) assertValidStatus(group, record[field]);
  }
}

export class RrdMemoryStore {
  constructor({ now = () => new Date().toISOString(), idFactory } = {}) {
    this.now = now;
    this.idFactory = idFactory || ((table) => `${table}_${randomUUID()}`);
    this.tables = new Map(RRD_TABLES.map((table) => [table, new Map()]));
    this.counters = new Map();
  }

  nextId(table) {
    const count = (this.counters.get(table) || 0) + 1;
    this.counters.set(table, count);
    if (this.idFactory) return this.idFactory(table, count);
    return `${table}_${String(count).padStart(6, '0')}`;
  }

  table(table) {
    assertKnownTable(table);
    return this.tables.get(table);
  }

  stampFor(table, existing, record) {
    const at = this.now();
    const stamped = { ...record };
    if (table !== 'job_locks' && !stamped.created_at) stamped.created_at = existing?.created_at || at;
    if (['clients', 'client_settings', 'client_integrations', 'invoices', 'recovery_threads', 'recovery_actions', 'approval_requests', 'reports'].includes(table)) {
      stamped.updated_at = at;
    }
    if (table === 'agent_runs' && !stamped.started_at) stamped.started_at = existing?.started_at || at;
    if (table === 'customer_replies' && !stamped.received_at) stamped.received_at = existing?.received_at || at;
    if (table === 'job_locks') {
      stamped.acquired_at = existing?.acquired_at || stamped.acquired_at || at;
      stamped.heartbeat_at = stamped.heartbeat_at || at;
    }
    return stamped;
  }

  save(table, record, { merge = true, immutable = false } = {}) {
    assertKnownTable(table);
    const rows = this.table(table);
    const idField = table === 'job_locks' ? 'lock_key' : 'id';
    const id = record[idField] || this.nextId(table);
    const existing = rows.get(id);
    if (existing && immutable) return clone(existing);

    const merged = merge ? { ...(DEFAULTS[table] || {}), ...(existing || {}), ...cleanObject(record), [idField]: id } : { ...(DEFAULTS[table] || {}), ...cleanObject(record), [idField]: id };
    validateStatuses(table, merged);
    const stamped = this.stampFor(table, existing, merged);
    rows.set(id, clone(stamped));
    return clone(stamped);
  }

  find(table, id) {
    return clone(this.table(table).get(id) || null);
  }

  list(table, filter = {}) {
    assertKnownTable(table);
    const entries = [...this.table(table).values()].filter((row) => Object.entries(filter).every(([key, value]) => row[key] === value));
    return clone(entries);
  }

  upsertSubmission(input = {}) {
    if (!input.id) throw new Error('submissions require id for deterministic sync');
    return this.save('submissions', input);
  }

  findClientByProfileName(profileName) {
    const wanted = normalizeProfileName(profileName);
    return clone([...this.table('clients').values()].find((client) => normalizeProfileName(client.profile_name) === wanted) || null);
  }

  findClientBySubmissionId(submissionId) {
    return clone([...this.table('clients').values()].find((client) => client.submission_id === submissionId) || null);
  }

  upsertClient(input = {}) {
    if (!input.profile_name) throw new Error('clients require profile_name');
    if (!input.company_name) throw new Error('clients require company_name');
    const existing = this.findClientByProfileName(input.profile_name) || (input.submission_id ? this.findClientBySubmissionId(input.submission_id) : null);
    return this.save('clients', { ...input, id: existing?.id });
  }

  upsertClientSettings(input = {}) {
    assertClientId(input, 'client_settings');
    validateNoSecrets(input, 'client_settings');
    const existing = this.getClientSettings(input.client_id);
    return this.save('client_settings', { ...input, id: existing?.id });
  }

  getClientSettings(clientId) {
    return clone([...this.table('client_settings').values()].find((settings) => settings.client_id === clientId) || null);
  }

  upsertIntegration(input = {}) {
    assertClientId(input, 'client_integrations');
    if (!input.provider || !input.category) throw new Error('client_integrations require provider and category');
    validateNoSecrets(input, 'client_integrations');
    const existing = [...this.table('client_integrations').values()].find((row) => row.client_id === input.client_id && row.provider === input.provider && row.category === input.category);
    return this.save('client_integrations', { ...input, id: existing?.id });
  }

  listIntegrations(clientId, filter = {}) {
    return this.list('client_integrations', { ...filter, client_id: clientId });
  }

  upsertInvoice(input = {}) {
    assertClientId(input, 'invoices');
    if (!input.external_invoice_id) throw new Error('invoices require external_invoice_id');
    const existing = [...this.table('invoices').values()].find((row) => row.client_id === input.client_id && row.external_invoice_id === input.external_invoice_id);
    return this.save('invoices', { ...input, id: existing?.id });
  }

  findInvoiceByExternalId(clientId, externalInvoiceId) {
    return clone([...this.table('invoices').values()].find((row) => row.client_id === clientId && row.external_invoice_id === externalInvoiceId) || null);
  }

  listInvoices(clientId, filter = {}) {
    return this.list('invoices', { ...filter, client_id: clientId });
  }

  upsertRecoveryThread(input = {}) {
    assertClientId(input, 'recovery_threads');
    const existing = input.invoice_id
      ? [...this.table('recovery_threads').values()].find((row) => row.client_id === input.client_id && row.invoice_id === input.invoice_id)
      : null;
    return this.save('recovery_threads', { ...input, id: existing?.id });
  }

  createRecoveryAction(input = {}) {
    assertClientId(input, 'recovery_actions');
    if (!input.idempotency_key) throw new Error('recovery_actions require idempotency_key');
    if (!input.stage || !input.channel) throw new Error('recovery_actions require stage and channel');
    const existing = [...this.table('recovery_actions').values()].find((row) => row.client_id === input.client_id && row.idempotency_key === input.idempotency_key);
    if (existing) return clone(existing);
    return this.save('recovery_actions', input, { immutable: true });
  }

  listActions(clientId, filter = {}) {
    return this.list('recovery_actions', { ...filter, client_id: clientId });
  }

  createApprovalRequest(input = {}) {
    assertClientId(input, 'approval_requests');
    if (!input.action_id) throw new Error('approval_requests require action_id');
    const existing = [...this.table('approval_requests').values()].find((row) => row.action_id === input.action_id);
    if (existing) return clone(existing);
    return this.save('approval_requests', input, { immutable: true });
  }

  upsertCustomerReply(input = {}) {
    assertClientId(input, 'customer_replies');
    const existing = input.provider && input.external_message_id
      ? [...this.table('customer_replies').values()].find((row) => row.client_id === input.client_id && row.provider === input.provider && row.external_message_id === input.external_message_id)
      : null;
    return this.save('customer_replies', { ...input, id: existing?.id });
  }

  upsertPayment(input = {}) {
    assertClientId(input, 'payments');
    if (!input.external_payment_id) throw new Error('payments require external_payment_id');
    const existing = [...this.table('payments').values()].find((row) => row.client_id === input.client_id && row.external_payment_id === input.external_payment_id);
    return this.save('payments', { ...input, id: existing?.id });
  }

  upsertReport(input = {}) {
    assertClientId(input, 'reports');
    const existing = [...this.table('reports').values()].find((row) => row.client_id === input.client_id && row.report_type === (input.report_type || 'weekly') && row.period_start === input.period_start && row.period_end === input.period_end);
    return this.save('reports', { ...input, id: existing?.id });
  }

  upsertAgentRun(input = {}) {
    if (!input.job_name || !input.idempotency_key) throw new Error('agent_runs require job_name and idempotency_key');
    const existing = [...this.table('agent_runs').values()].find((row) => row.job_name === input.job_name && row.idempotency_key === input.idempotency_key);
    return this.save('agent_runs', { ...input, id: existing?.id });
  }

  upsertAuditEvent(input = {}) {
    if (!input.actor_type || !input.event_type) throw new Error('audit_events require actor_type and event_type');
    const existing = input.idempotency_key
      ? [...this.table('audit_events').values()].find((row) => row.client_id === input.client_id && row.idempotency_key === input.idempotency_key)
      : null;
    return this.save('audit_events', { ...input, id: existing?.id });
  }

  upsertJobLock(input = {}) {
    if (!input.lock_key || !input.owner || !input.locked_until) throw new Error('job_locks require lock_key, owner, and locked_until');
    return this.save('job_locks', input);
  }
}

export function createRrdMemoryStore(options = {}) {
  const deterministicIds = options.deterministicIds ?? true;
  const idFactory = options.idFactory || (deterministicIds ? ((table, count) => `${table}_${String(count).padStart(6, '0')}`) : undefined);
  return new RrdMemoryStore({ ...options, idFactory });
}

export function syncClientProfile(store, { submission, profile } = {}) {
  if (!store || typeof store.upsertClient !== 'function') throw new Error('syncClientProfile requires an RRD store');
  if (!profile?.profile_name && !submission?.company) throw new Error('profile_name or submission company is required');

  const savedSubmission = submission?.id ? store.upsertSubmission(submission) : null;
  const profileName = profile?.profile_name || String(submission.company).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const companyName = profile?.company_name || submission?.company || profileName;
  const client = store.upsertClient({
    submission_id: savedSubmission?.id,
    profile_name: profileName,
    company_name: companyName,
    primary_contact_name: profile?.primary_contact_name,
    primary_contact_email: profile?.primary_contact_email || submission?.email,
    status: profile?.status || 'submitted',
    timezone: profile?.timezone || 'UTC',
    raw_payload: profile?.raw_payload || {},
    metadata: profile?.metadata || {},
  });

  const settings = profile?.settings
    ? store.upsertClientSettings({ client_id: client.id, ...profile.settings })
    : (store.getClientSettings(client.id) || store.upsertClientSettings({ client_id: client.id }));

  const integrations = Array.isArray(profile?.integrations)
    ? profile.integrations.map((integration) => store.upsertIntegration({ client_id: client.id, ...integration }))
    : [];

  return { submission: savedSubmission, client, settings, integrations };
}

export { validateNoSecrets };
