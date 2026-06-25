import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initialClientPassword,
  normalizeRecoveryEvent,
  appendRecoveryEvents,
  mergeClientSettings,
} from '../rrd-client-dashboard-core.mjs';

test('initial client password is 25 chars, alphanumeric, and excludes ambiguous characters', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const p = initialClientPassword();
    assert.equal(p.length, 25);
    assert.match(p, /^[A-HJ-NP-Za-km-z2-9]{25}$/);
    assert.doesNotMatch(p, /[0O1lI]/);
    seen.add(p);
  }
  assert.ok(seen.size > 190, 'password generator should not repeat in a small sample');
});

test('normalizes recovery results to idempotent secret-free recovery_events rows', () => {
  const row = normalizeRecoveryEvent({
    profile: 'rr-acme',
    submissionId: '11111111-1111-4111-8111-111111111111',
    occurredAt: '2026-06-23T10:00:00.000Z',
    result: {
      invoiceId: 'in_1', number: 'INV-1', customer: 'Acme Customer', email: 'ar@example.com', amountUsd: 1234.56,
      currency: 'GBP', daysOverdue: 31, rung: 'firm', subject: 'Invoice reminder', paymentUrl: 'https://pay.example/in_1',
      outcome: 'blocked', requiresHuman: true, violations: [{ code: 'APPROVAL_REQUIRED', msg: 'approval required' }],
      result: { id: 'msg_1', secretLike: 'must not be copied' }
    }
  });
  assert.equal(row.event_type, 'gate_decision');
  assert.equal(row.allowed, false);
  assert.equal(row.requires_human, true);
  assert.deepEqual(row.violations, ['APPROVAL_REQUIRED']);
  assert.equal(row.invoice_id, 'in_1');
  assert.equal(row.payment_url, 'https://pay.example/in_1');
  assert.equal(row.meta.subject, 'Invoice reminder');
  assert.equal(row.meta.result_id, 'msg_1');
  assert.equal(row.meta.secretLike, undefined);
  assert.match(row.dedupe_key, /^[a-f0-9]{40}$/);
});

test('appendRecoveryEvents writes NDJSON queue rows under the profile file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-events-'));
  const out = appendRecoveryEvents('rr-acme', {
    manifest: { submissionId: '22222222-2222-4222-8222-222222222222' },
    occurredAt: '2026-06-23T11:00:00.000Z',
    results: [{ invoiceId: 'in_2', number: 'INV-2', customer: 'Beta', amountUsd: 200, outcome: 'sent', rung: 'reminder' }]
  }, { dir });
  assert.equal(out.written, 1);
  const lines = fs.readFileSync(path.join(dir, 'rr-acme.ndjson'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const row = JSON.parse(lines[0]);
  assert.equal(row.submission_id, '22222222-2222-4222-8222-222222222222');
  assert.equal(row.event_type, 'send_dispatch');
});

test('client settings merge whitelists editable fields and rejects Letter auto-send', () => {
  const row = {
    id: '33333333-3333-4333-8333-333333333333',
    contacts: [{ name: 'Old', email: 'old@example.com' }],
    guardrails: { approvalModel: 'all', autoSendChannels: [], batchSize: 5, doNotContact: ['vip@example.com'] },
    recovery_process: { letter: { mailClass: 'standard', returnAddress: { line1: 'Old' } }, untouched: true },
  };
  const merged = mergeClientSettings(row, {
    businessInfo: { company: 'New Co', industry: 'Facilities', size: '50 invoices/month', website: 'https://new.example', primaryContact: 'Kofi Owusu', phone: '+44000', address: '1 Test Street, London' },
    contacts: [{ name: 'Kofi', role: 'Finance', email: 'kofi@example.com', phone: '+44123', tags: ['approver'] }],
    approvalRouting: { approvers: ['kofi@example.com'], preferredChannel: 'dashboard', slaHours: 24 },
    outreachMode: 'auto',
    letters: { mailClass: 'certified', returnAddress: { line1: '1 High Street', city: 'London' }, templatePath: '33333333-3333-4333-8333-333333333333/template.pdf' },
    ignored: { consent: true }
  }, { submissionId: '33333333-3333-4333-8333-333333333333' });
  assert.equal(merged.patch.company, 'New Co');
  assert.equal(merged.patch.primary_contact, 'Kofi Owusu');
  assert.equal(merged.patch.business_profile.address, '1 Test Street, London');
  assert.equal(merged.patch.contacts[0].email, 'kofi@example.com');
  assert.deepEqual(merged.patch.guardrails.autoSendChannels, ['Email', 'SMS']);
  assert.equal(merged.patch.guardrails.batchSize, 5);
  assert.equal(merged.patch.guardrails.approvalRouting.preferredChannel, 'dashboard');
  assert.equal(merged.patch.recovery_process.untouched, true);
  assert.equal(merged.patch.recovery_process.letter.mailClass, 'certified');
  assert.equal(merged.patch.recovery_process.letter.templatePath, '33333333-3333-4333-8333-333333333333/template.pdf');
  assert.deepEqual(merged.reasons.sort(), ['approval_changed', 'business_info_changed', 'contacts_changed', 'letter_changed', 'policy_changed'].sort());

  assert.throws(() => mergeClientSettings(row, { guardrails: { autoSendChannels: ['Email', 'Letter'] } }, { submissionId: row.id }), /Letter.*cannot be auto-sent/);
  assert.throws(() => mergeClientSettings(row, { letters: { templatePath: 'other-client/template.pdf' } }, { submissionId: row.id }), /template path/);
});
