import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-collections-test-'));
process.env.RRD_COLLECTIONS_DIR = TMP;

const { loadState, saveState, shouldDraftInvoice, markSeen, markDrafted, closeUnseen } = await import('../rrd-collections-state.mjs');
const { recover } = await import('../rrd-collect.mjs');

const inv = { id:'in_1', number:'INV-1', amount:1200, currency:'USD', daysOverdue:1, customerEmail:'a@example.com', customerName:'A', hostedInvoiceUrl:'https://pay/1' };

function execOk() { return { sent:false, wouldSend:true, decision:{ allowed:true, violations:[] } }; }

test('state suppresses duplicate same-rung drafts and allows next rung after cadence', () => {
  const now = Date.parse('2026-01-01T09:00:00Z');
  const state = loadState('rr-test', { nowMs: now });
  markSeen(state, inv, { nowMs: now });
  assert.equal(shouldDraftInvoice(state, inv, { rung:'reminder', nowMs: now }).draft, true);
  markDrafted(state, inv, { rung:'reminder', outcome:'would_send', subject:'s', nowMs: now, followUpDays: 7 });
  assert.equal(shouldDraftInvoice(state, inv, { rung:'reminder', nowMs: now + 3600_000 }).draft, false);
  assert.equal(shouldDraftInvoice(state, { ...inv, daysOverdue: 8 }, { rung:'follow_up', nowMs: now + 6*86400000, followUpDays:7 }).draft, false);
  assert.equal(shouldDraftInvoice(state, { ...inv, daysOverdue: 8 }, { rung:'follow_up', nowMs: now + 7*86400000, followUpDays:7 }).draft, true);
});

test('state marks active invoices closed when absent from overdue feed', () => {
  const now = Date.parse('2026-01-01T09:00:00Z');
  const state = loadState('rr-close', { nowMs: now });
  const key = markSeen(state, inv, { nowMs: now });
  const closed = closeUnseen(state, new Set(), { nowMs: now + 86400000 });
  assert.deepEqual(closed, [key]);
  assert.equal(state.invoices[key].status, 'paid_or_resolved');
});

test('recover with trackCollections does not redraft the same invoice on second run', async () => {
  const profile = 'rr-dedupe';
  const invoices = [inv];
  const deps = { manifest:{ company:'Acme', toolAllowlist:['send_via_executor'] }, listInvoices: async () => invoices, executeImpl: async () => execOk() };
  const first = await recover(profile, { now: Date.parse('2026-01-01T09:00:00Z'), send:false, trackCollections:true, deps });
  assert.equal(first.summary.byOutcome.would_send, 1);
  const second = await recover(profile, { now: Date.parse('2026-01-01T10:00:00Z'), send:false, trackCollections:true, deps });
  assert.equal(second.summary.byOutcome.already_tracked, 1);
  assert.equal(second.summary.byOutcome.would_send, undefined);
});
