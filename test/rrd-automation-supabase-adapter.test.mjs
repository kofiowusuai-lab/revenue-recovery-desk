import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseAutomationAdapter } from '../src/lib/db/supabase-automation-adapter.mjs';

class FakeQuery {
  constructor(fake, table) {
    this.fake = fake;
    this.table = table;
    this.filters = [];
    this.op = null;
  }

  _record(method, payload, options) {
    this.op = { table: this.table, method, payload, options, filters: this.filters };
    this.fake.calls.push(this.op);
    return this;
  }

  select(columns = '*') {
    if (!this.op) this._record('select', columns);
    else this.op.select = columns;
    return this;
  }

  upsert(payload, options) { return this._record('upsert', payload, options); }
  insert(payload, options) { return this._record('insert', payload, options); }
  update(payload, options) { return this._record('update', payload, options); }
  delete(options) { return this._record('delete', undefined, options); }
  eq(column, value) {
    this.filters.push({ column, value });
    if (this.op) this.op.filters = this.filters;
    return this;
  }
  lt(column, value) {
    this.filters.push({ column, operator: 'lt', value });
    if (this.op) this.op.filters = this.filters;
    return this;
  }
  order(column, options) {
    this.orderBy = { column, options };
    if (this.op) this.op.order = this.orderBy;
    return this;
  }
  limit(count) {
    this.limitCount = count;
    if (this.op) this.op.limit = count;
    return this;
  }
  single() { return this._result(true); }
  maybeSingle() { return this._result(true); }
  then(resolve, reject) { return this._result(false).then(resolve, reject); }

  async _result(single) {
    const response = this.fake.respond(this.op || { table: this.table, method: 'select', filters: this.filters }, single);
    if (response.error) return { data: null, error: response.error };
    return { data: response.data, error: null };
  }
}

class FakeSupabase {
  constructor() {
    this.calls = [];
    this.rows = new Map();
  }
  from(table) { return new FakeQuery(this, table); }
  respond(op, single) {
    if (op.method === 'select') {
      const row = this.rows.get(op.table) || null;
      return { data: single ? row : (row ? [row] : []) };
    }
    if (op.method === 'delete') return { data: [] };
    const payload = Array.isArray(op.payload) ? op.payload[0] : op.payload;
    this.rows.set(op.table, payload);
    return { data: single ? payload : [payload] };
  }
  last(method) { return [...this.calls].reverse().find((call) => call.method === method); }
}

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';

function adapterWithFake() {
  const supabase = new FakeSupabase();
  return { supabase, adapter: createSupabaseAutomationAdapter({ supabase, now: () => '2026-06-26T12:00:00.000Z' }) };
}

test('Supabase automation adapter maps canonical upserts to table names and conflict keys', async () => {
  const { supabase, adapter } = adapterWithFake();

  await adapter.upsertClientProfile({ profile_name: 'acme', company_name: 'Acme Co' });
  await adapter.upsertClientSettings({ client_id: CLIENT_ID, authorized_channels: ['email'] });
  await adapter.upsertIntegration({ client_id: CLIENT_ID, provider: 'stripe', category: 'payment', status: 'installed', config: { key_name: 'STRIPE_ACME' } });
  await adapter.upsertInvoice({ client_id: CLIENT_ID, external_invoice_id: 'INV-1', status: 'overdue' });
  await adapter.upsertRecoveryThread({ client_id: CLIENT_ID, invoice_id: '22222222-2222-4222-8222-222222222222' });
  await adapter.createRecoveryAction({ client_id: CLIENT_ID, idempotency_key: 'act-1', stage: 'friendly_reminder', channel: 'email' });
  await adapter.createApprovalRequest({ client_id: CLIENT_ID, action_id: '33333333-3333-4333-8333-333333333333' });
  await adapter.upsertCustomerReply({ client_id: CLIENT_ID, provider: 'agentmail', external_message_id: 'msg-1' });
  await adapter.upsertPayment({ client_id: CLIENT_ID, external_payment_id: 'pay-1', amount: 42, paid_at: '2026-06-26T00:00:00.000Z' });
  await adapter.upsertReport({ client_id: CLIENT_ID, report_type: 'weekly', period_start: '2026-06-15', period_end: '2026-06-22' });
  await adapter.upsertAgentRun({ client_id: CLIENT_ID, job_name: 'weekly-report', idempotency_key: 'run-1' });
  await adapter.upsertAuditEvent({ client_id: CLIENT_ID, actor_type: 'agent', event_type: 'invoice_checked', idempotency_key: 'audit-1' });

  const upserts = supabase.calls.filter((call) => call.method === 'upsert');
  assert.deepEqual(upserts.map((call) => call.table), [
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
  ]);
  assert.deepEqual(upserts.map((call) => call.options.onConflict), [
    'profile_name',
    'client_id',
    'client_id,provider,category',
    'client_id,external_invoice_id',
    'client_id,invoice_id',
    'client_id,idempotency_key',
    'action_id',
    'client_id,provider,external_message_id',
    'client_id,external_payment_id',
    'client_id,report_type,period_start,period_end',
    'job_name,idempotency_key',
    'client_id,idempotency_key',
  ]);
  assert.ok(upserts.slice(1, 10).every((call) => call.payload.client_id === CLIENT_ID));
});

test('Supabase automation adapter uses canonical job_locks lock_key schema and token metadata', async () => {
  const { supabase, adapter } = adapterWithFake();
  const lock = await adapter.acquireJobLock({
    lock_key: 'rrd-weekly-report:client-1',
    client_id: CLIENT_ID,
    owner: 'agent-runner',
    ttlMs: 60_000,
    token: 'tok_safe_123',
    metadata: { attempt: 1 },
  });

  assert.equal(lock.acquired, true);
  const upsert = supabase.last('upsert');
  assert.equal(upsert.table, 'job_locks');
  assert.equal(upsert.options.onConflict, 'lock_key');
  assert.equal(upsert.payload.lock_key, 'rrd-weekly-report:client-1');
  assert.equal(upsert.payload.client_id, CLIENT_ID);
  assert.equal(upsert.payload.owner, 'agent-runner');
  assert.equal(upsert.payload.locked_until, '2026-06-26T12:01:00.000Z');
  assert.deepEqual(upsert.payload.metadata, { attempt: 1, token: 'tok_safe_123' });

  await adapter.releaseJobLock({ lock_key: 'rrd-weekly-report:client-1', token: 'tok_safe_123' });
  const del = supabase.last('delete');
  assert.equal(del.table, 'job_locks');
  assert.deepEqual(del.filters, [
    { column: 'lock_key', value: 'rrd-weekly-report:client-1' },
    { column: 'metadata->>token', value: 'tok_safe_123' },
  ]);
});

test('Supabase automation adapter rejects secret-looking keys and values before forwarding', async () => {
  const { supabase, adapter } = adapterWithFake();

  await assert.rejects(
    adapter.upsertIntegration({ client_id: CLIENT_ID, provider: 'quickbooks', category: 'accounting', config: { access_token: 'x' } }),
    /secret/i,
  );
  await assert.rejects(
    adapter.upsertClientSettings({ client_id: CLIENT_ID, raw_payload: { api_key: 'abc123' } }),
    /secret/i,
  );
  await assert.rejects(
    adapter.acquireJobLock({ lock_key: 'safe', owner: 'runner', token: 'Bearer should-not-store' }),
    /secret/i,
  );

  assert.equal(supabase.calls.length, 0);
});

test('Supabase automation adapter enforces client_id scope for client-owned rows', async () => {
  const { adapter } = adapterWithFake();
  await assert.rejects(adapter.upsertInvoice({ external_invoice_id: 'INV-1' }), /client_id/);
  await assert.rejects(adapter.createRecoveryAction({ idempotency_key: 'a', stage: 'friendly_reminder', channel: 'email' }), /client_id/);
  await assert.rejects(adapter.upsertPayment({ external_payment_id: 'pay-1', amount: 1, paid_at: '2026-06-26T00:00:00.000Z' }), /client_id/);
});

test('Supabase automation adapter validates canonical statuses before forwarding', async () => {
  const { supabase, adapter } = adapterWithFake();
  await assert.rejects(adapter.upsertInvoice({ client_id: CLIENT_ID, external_invoice_id: 'INV-2', status: 'totally_fake' }), /invalid invoice status/i);
  await assert.rejects(adapter.createRecoveryAction({ client_id: CLIENT_ID, idempotency_key: 'a2', stage: 'fake_stage', channel: 'email', status: 'queued_for_approval' }), /invalid threadStage status/i);
  await assert.rejects(adapter.createApprovalRequest({ client_id: CLIENT_ID, action_id: 'act_1', status: 'rubber_stamped' }), /invalid approval status/i);
  assert.equal(supabase.calls.length, 0);
});
