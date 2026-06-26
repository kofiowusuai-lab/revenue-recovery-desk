import { validateNoSecrets } from './rrd-store.mjs';
import { assertValidStatus } from '../client-state/rrd-status.mjs';

const CLIENT_SCOPED_TABLES = new Set([
  'client_settings',
  'client_integrations',
  'invoices',
  'recovery_threads',
  'recovery_actions',
  'approval_requests',
  'customer_replies',
  'payments',
  'reports',
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
});

function cleanObject(input = {}) {
  const out = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function assertSupabaseClient(supabase) {
  if (!supabase || (typeof supabase.from !== 'function' && typeof supabase.upsert !== 'function')) {
    throw new Error('createSupabaseAutomationAdapter requires an injected Supabase/PostgREST client');
  }
}

function assertClientId(record, table) {
  if (!record?.client_id) throw new Error(`${table} requires client_id`);
}

function assertRequired(record, table, fields) {
  for (const field of fields) {
    if (!record?.[field]) throw new Error(`${table} requires ${field}`);
  }
}

function stamp(table, record, now) {
  const at = now();
  const row = { ...(DEFAULTS[table] || {}), ...cleanObject(record) };
  if (table !== 'job_locks' && !row.created_at) row.created_at = at;
  if (['clients', 'client_settings', 'client_integrations', 'invoices', 'recovery_threads', 'recovery_actions', 'approval_requests', 'reports'].includes(table)) {
    row.updated_at = at;
  }
  if (table === 'agent_runs' && !row.started_at) row.started_at = at;
  if (table === 'customer_replies' && !row.received_at) row.received_at = at;
  if (table === 'job_locks') {
    if (!row.acquired_at) row.acquired_at = at;
    if (!row.heartbeat_at) row.heartbeat_at = at;
  }
  return row;
}

function assertStatusRecord(record, table) {
  if (table === 'clients' && record.status) assertValidStatus('client', record.status);
  if (table === 'client_integrations' && record.status) assertValidStatus('integration', record.status);
  if (table === 'invoices' && record.status) assertValidStatus('invoice', record.status);
  if (table === 'recovery_threads') {
    if (record.status) assertValidStatus('thread', record.status);
    if (record.stage) assertValidStatus('threadStage', record.stage);
  }
  if (table === 'recovery_actions') {
    if (record.status) assertValidStatus('action', record.status);
    if (record.stage) assertValidStatus('threadStage', record.stage);
  }
  if (table === 'approval_requests' && record.status) assertValidStatus('approval', record.status);
  if (table === 'customer_replies' && record.classification) assertValidStatus('replyClassification', record.classification);
}

function assertSafeRecord(record, table) {
  validateNoSecrets(record, table);
  assertStatusRecord(record, table);
}

function assertClientScoped(record, table) {
  if (CLIENT_SCOPED_TABLES.has(table)) assertClientId(record, table);
}

async function resolveResult(result, action) {
  const awaited = await result;
  if (awaited?.error) throw awaited.error;
  if (Array.isArray(awaited?.data)) return awaited.data[0] || null;
  return awaited?.data ?? awaited ?? null;
}

export function createSupabaseAutomationAdapter({ supabase, now = () => new Date().toISOString() } = {}) {
  assertSupabaseClient(supabase);

  async function upsert(table, record, onConflict) {
    assertClientScoped(record, table);
    assertSafeRecord(record, table);
    const payload = stamp(table, record, now);

    if (typeof supabase.upsert === 'function' && typeof supabase.from !== 'function') {
      return resolveResult(supabase.upsert(table, payload, { onConflict, returning: 'representation' }), `upsert ${table}`);
    }

    const query = supabase
      .from(table)
      .upsert(payload, { onConflict, ignoreDuplicates: false })
      .select('*');
    return resolveResult(typeof query.single === 'function' ? query.single() : query, `upsert ${table}`);
  }

  async function selectOne(table, filters = []) {
    if (typeof supabase.selectOne === 'function' && typeof supabase.from !== 'function') {
      return resolveResult(supabase.selectOne(table, filters), `select ${table}`);
    }
    let query = supabase.from(table).select('*');
    for (const filter of filters) query = query.eq(filter.column, filter.value);
    if (typeof query.maybeSingle === 'function') return resolveResult(query.maybeSingle(), `select ${table}`);
    if (typeof query.single === 'function') return resolveResult(query.single(), `select ${table}`);
    const rows = await resolveResult(query, `select ${table}`);
    return Array.isArray(rows) ? rows[0] || null : rows;
  }

  async function deleteWhere(table, filters = []) {
    if (typeof supabase.delete === 'function' && typeof supabase.from !== 'function') {
      return resolveResult(supabase.delete(table, filters), `delete ${table}`);
    }
    let query = supabase.from(table).delete();
    for (const filter of filters) query = query.eq(filter.column, filter.value);
    return resolveResult(query, `delete ${table}`);
  }

  function lockedUntilFrom({ locked_until, ttlMs = 5 * 60_000 } = {}) {
    if (locked_until) return locked_until;
    return new Date(new Date(now()).getTime() + ttlMs).toISOString();
  }

  return {
    upsertClientProfile(input = {}) {
      assertRequired(input, 'clients', ['profile_name', 'company_name']);
      return upsert('clients', input, 'profile_name');
    },

    upsertClient(input = {}) {
      return this.upsertClientProfile(input);
    },

    upsertClientSettings(input = {}) {
      return upsert('client_settings', input, 'client_id');
    },

    upsertIntegration(input = {}) {
      assertRequired(input, 'client_integrations', ['provider', 'category']);
      return upsert('client_integrations', input, 'client_id,provider,category');
    },

    upsertInvoice(input = {}) {
      assertRequired(input, 'invoices', ['external_invoice_id']);
      return upsert('invoices', input, 'client_id,external_invoice_id');
    },

    upsertRecoveryThread(input = {}) {
      return upsert('recovery_threads', input, 'client_id,invoice_id');
    },

    createRecoveryAction(input = {}) {
      assertRequired(input, 'recovery_actions', ['idempotency_key', 'stage', 'channel']);
      return upsert('recovery_actions', input, 'client_id,idempotency_key');
    },

    createApprovalRequest(input = {}) {
      assertRequired(input, 'approval_requests', ['action_id']);
      return upsert('approval_requests', input, 'action_id');
    },

    upsertCustomerReply(input = {}) {
      return upsert('customer_replies', input, 'client_id,provider,external_message_id');
    },

    upsertPayment(input = {}) {
      assertRequired(input, 'payments', ['external_payment_id', 'amount', 'paid_at']);
      return upsert('payments', input, 'client_id,external_payment_id');
    },

    upsertReport(input = {}) {
      assertRequired(input, 'reports', ['period_start', 'period_end']);
      return upsert('reports', input, 'client_id,report_type,period_start,period_end');
    },

    upsertAgentRun(input = {}) {
      assertRequired(input, 'agent_runs', ['job_name', 'idempotency_key']);
      assertSafeRecord(input, 'agent_runs');
      return upsert('agent_runs', input, 'job_name,idempotency_key');
    },

    upsertAuditEvent(input = {}) {
      assertRequired(input, 'audit_events', ['actor_type', 'event_type']);
      assertSafeRecord(input, 'audit_events');
      return upsert('audit_events', input, 'client_id,idempotency_key');
    },

    async acquireJobLock(input = {}) {
      assertRequired(input, 'job_locks', ['lock_key', 'owner']);
      const token = input.token || input.metadata?.token;
      if (!token) throw new Error('job_locks requires token');
      const metadata = { ...(input.metadata || {}), token };
      const locked_until = lockedUntilFrom(input);
      const row = cleanObject({
        lock_key: input.lock_key,
        client_id: input.client_id,
        owner: input.owner,
        locked_until,
        acquired_at: now(),
        heartbeat_at: now(),
        metadata,
      });
      assertSafeRecord(row, 'job_locks');

      const existing = await selectOne('job_locks', [{ column: 'lock_key', value: input.lock_key }]);
      if (existing?.locked_until && new Date(existing.locked_until).getTime() > new Date(now()).getTime() && existing.metadata?.token !== token) {
        return { acquired: false, lock: existing };
      }

      const lock = await upsert('job_locks', row, 'lock_key');
      return { acquired: true, lock, token };
    },

    async releaseJobLock(input = {}) {
      assertRequired(input, 'job_locks', ['lock_key', 'token']);
      assertSafeRecord(input, 'job_locks.release');
      await deleteWhere('job_locks', [
        { column: 'lock_key', value: input.lock_key },
        { column: 'metadata->>token', value: input.token },
      ]);
      return { released: true };
    },
  };
}
