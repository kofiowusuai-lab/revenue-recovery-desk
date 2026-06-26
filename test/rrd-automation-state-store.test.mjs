import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRrdMemoryStore,
  syncClientProfile,
} from '../src/lib/db/rrd-store.mjs';

function clock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
}

test('client profile sync treats submission/profile data as source of truth', () => {
  const store = createRrdMemoryStore({ now: clock() });

  const first = syncClientProfile(store, {
    submission: { id: 'sub_001', email: 'ops@acme.test', company: 'Acme Co', raw_payload: { form: 'v1' } },
    profile: {
      profile_name: 'acme',
      company_name: 'Acme Co',
      primary_contact_name: 'Ava Ops',
      primary_contact_email: 'ava@acme.test',
      timezone: 'America/New_York',
      status: 'submitted',
      settings: {
        approval_required: true,
        authorized_channels: ['email', 'letter'],
        business_hours: { weekdays: ['Mon'] },
        tone_rules: { style: 'firm but kind' },
      },
    },
  });

  const second = syncClientProfile(store, {
    submission: { id: 'sub_001', email: 'new@acme.test', company: 'Acme Incorporated', raw_payload: { form: 'v2' } },
    profile: {
      profile_name: 'acme',
      company_name: 'Acme Incorporated',
      primary_contact_name: 'Ava Finance',
      primary_contact_email: 'finance@acme.test',
      timezone: 'America/Chicago',
      status: 'awaiting_client',
      settings: {
        approval_required: false,
        authorized_channels: ['email'],
        recovery_rules: { max_days_overdue: 120 },
      },
    },
  });

  assert.equal(first.client.id, second.client.id);
  assert.equal(store.list('clients').length, 1);
  assert.equal(store.findClientByProfileName('ACME').company_name, 'Acme Incorporated');
  assert.equal(store.find('submissions', 'sub_001').email, 'new@acme.test');
  assert.deepEqual(store.getClientSettings(second.client.id).authorized_channels, ['email']);
  assert.equal(store.getClientSettings(second.client.id).approval_required, false);
  assert.ok(second.client.updated_at > first.client.updated_at);
});

test('integration status upsert is deterministic, idempotent, and secret-safe', () => {
  const store = createRrdMemoryStore({ now: clock() });
  const { client } = syncClientProfile(store, { profile: { profile_name: 'northwind', company_name: 'Northwind' } });

  const installed = store.upsertIntegration({
    client_id: client.id,
    provider: 'stripe',
    category: 'payment',
    status: 'installed',
    external_account_id: 'acct_safe_123',
    config: { key_name: 'STRIPE_CONNECT_NORTHWIND', mode: 'live' },
  });
  const failed = store.upsertIntegration({
    client_id: client.id,
    provider: 'stripe',
    category: 'payment',
    status: 'failed',
    health_status: 'degraded',
    last_error: 'oauth_revoked',
  });

  assert.equal(installed.id, failed.id);
  assert.equal(store.listIntegrations(client.id).length, 1);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.config.key_name, 'STRIPE_CONNECT_NORTHWIND');
  assert.throws(() => store.upsertIntegration({
    client_id: client.id,
    provider: 'quickbooks',
    category: 'accounting',
    status: 'authorized',
    config: { access_token: 'x' },
  }), /secret/i);
});

test('invoice upsert idempotency preserves client isolation', () => {
  const store = createRrdMemoryStore({ now: clock() });
  const a = syncClientProfile(store, { profile: { profile_name: 'alpha', company_name: 'Alpha' } }).client;
  const b = syncClientProfile(store, { profile: { profile_name: 'beta', company_name: 'Beta' } }).client;

  const first = store.upsertInvoice({ client_id: a.id, external_invoice_id: 'INV-100', amount_due: 100, status: 'overdue' });
  const updated = store.upsertInvoice({ client_id: a.id, external_invoice_id: 'INV-100', amount_due: 75, amount_paid: 25, status: 'in_recovery' });
  const otherClient = store.upsertInvoice({ client_id: b.id, external_invoice_id: 'INV-100', amount_due: 200, status: 'open' });

  assert.equal(first.id, updated.id);
  assert.notEqual(updated.id, otherClient.id);
  assert.equal(store.listInvoices(a.id).length, 1);
  assert.equal(store.listInvoices(b.id).length, 1);
  assert.equal(store.findInvoiceByExternalId(a.id, 'INV-100').amount_due, 75);
  assert.deepEqual(store.listInvoices(a.id).map((invoice) => invoice.client_id), [a.id]);
});

test('thread, action, and approval creation obey idempotency and status defaults', () => {
  const store = createRrdMemoryStore({ now: clock() });
  const client = syncClientProfile(store, { profile: { profile_name: 'gamma', company_name: 'Gamma' } }).client;
  const invoice = store.upsertInvoice({ client_id: client.id, external_invoice_id: 'G-1', status: 'overdue' });

  const thread = store.upsertRecoveryThread({ client_id: client.id, invoice_id: invoice.id, customer_ref: 'cust_1' });
  const action = store.createRecoveryAction({
    client_id: client.id,
    thread_id: thread.id,
    invoice_id: invoice.id,
    idempotency_key: 'gamma:G-1:friendly:email',
    stage: 'friendly_reminder',
    channel: 'email',
    subject: 'Invoice reminder',
    body: 'Please review invoice G-1.',
  });
  const sameAction = store.createRecoveryAction({
    client_id: client.id,
    idempotency_key: 'gamma:G-1:friendly:email',
    stage: 'friendly_reminder',
    channel: 'email',
    subject: 'Changed subject ignored for idempotency',
  });
  const approval = store.createApprovalRequest({ client_id: client.id, action_id: action.id, requested_by: 'approval-agent' });
  const sameApproval = store.createApprovalRequest({ client_id: client.id, action_id: action.id, requested_by: 'other-agent' });

  assert.equal(thread.status, 'new');
  assert.equal(thread.stage, 'preflight');
  assert.equal(action.status, 'drafted');
  assert.equal(action.id, sameAction.id);
  assert.equal(action.subject, sameAction.subject);
  assert.equal(approval.status, 'pending');
  assert.equal(approval.id, sameApproval.id);
  assert.equal(store.listActions(client.id, { thread_id: thread.id }).length, 1);
});

test('settings and integration records reject secret-looking keys and values', () => {
  const store = createRrdMemoryStore({ now: clock() });
  const client = syncClientProfile(store, { profile: { profile_name: 'safe', company_name: 'Safe Co' } }).client;

  assert.throws(() => store.upsertClientSettings({
    client_id: client.id,
    raw_payload: { api_key: 'abc123' },
  }), /secret/i);

  assert.throws(() => store.upsertIntegration({
    client_id: client.id,
    provider: 'salesforce',
    category: 'crm',
    status: 'authorized',
    config: { key_name: 'SALESFORCE_SAFE', refresh_token_name: 'SALESFORCE_REFRESH', access_token: 'x' },
  }), /secret/i);
});
