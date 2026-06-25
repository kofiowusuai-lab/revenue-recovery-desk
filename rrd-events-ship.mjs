#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { withJobLock } from './rrd-job-lock.mjs';
import { loadJsonState, writeJsonState } from './rrd-state-file.mjs';

const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || '/Users/AIAgenterminal';
const EVENT_DIR = process.env.RRD_EVENTS_DIR || path.join(OPERATOR_HOME, '.openclaw', 'rrd-events');
const STATE_FILE = process.env.RRD_EVENTS_SHIP_STATE || path.join(OPERATOR_HOME, '.openclaw', '.rrd-events-ship-state.json');
const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function headers(extra = {}) { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...extra }; }
async function rest(pathname, init = {}) {
  if (!URL_BASE || !SERVICE_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  const res = await fetch(`${URL_BASE}/rest/v1/${pathname}`, { ...init, headers: headers(init.headers) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}
function notificationFor(e) {
  if (e.event_type === 'collection_paid') return { kind: 'collection_success', title: `${e.amount_usd ? `£${Number(e.amount_usd).toLocaleString('en-GB')} recovered` : 'Collection recorded'}`, body: e.customer_name ? `Recovered from ${e.customer_name}.` : 'A recovery was marked paid/resolved.', amount_usd: e.recovered_usd || e.amount_usd || null };
  if (e.event_type === 'agreement') return { kind: 'agreement_created', title: 'Payment agreement created', body: e.customer_name ? `Agreement recorded for ${e.customer_name}.` : 'Payment agreement recorded.', amount_usd: e.amount_usd || null };
  if (e.event_type === 'gate_decision' && e.requires_human) return { kind: 'approval_needed', title: 'Approval needed', body: e.customer_name ? `${e.channel || 'Outreach'} draft for ${e.customer_name} needs approval.` : 'A recovery draft needs approval.', amount_usd: e.amount_usd || null };
  if (e.event_type === 'gate_decision' && e.allowed === false) return { kind: 'action_blocked', title: 'Recovery action blocked', body: (e.violations || []).join(', ') || 'Guardrail blocked an action.', amount_usd: e.amount_usd || null };
  if (e.event_type === 'reprovisioned') return { kind: 'setting_applied', title: 'Dashboard settings applied', body: 'Your recovery agent has been updated with the latest settings.' };
  return null;
}
async function shipRows(rows) {
  if (!rows.length) return;
  await rest('recovery_events', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(rows) });
  const notices = rows.map((e) => ({ e, n: notificationFor(e) })).filter(x => x.n).map(({ e, n }) => ({ submission_id: e.submission_id, event_id: null, ...n }));
  if (notices.length) await rest('notifications', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(notices) }).catch((e) => console.error('notification insert failed: ' + e.message));
}
export async function shipOnce({ dir = EVENT_DIR, stateFile = STATE_FILE, batchSize = 100 } = {}) {
  const state = loadJsonState(stateFile, { files: {} }, 'rrd events ship state');
  if (!fs.existsSync(dir)) return { files: 0, rows: 0 };
  let files = 0, rows = 0;
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.ndjson')).sort()) {
    const file = path.join(dir, name);
    const start = Number(state.files[file]?.offset || 0);
    const text = fs.readFileSync(file, 'utf8').slice(start);
    if (!text.trim()) continue;
    const lines = text.split(/\n/);
    if (lines.at(-1) !== '') lines.pop();
    const batch = [];
    for (const line of lines) { if (line.trim()) batch.push(JSON.parse(line)); if (batch.length >= batchSize) { await shipRows(batch.splice(0)); rows += batchSize; } }
    if (batch.length) { await shipRows(batch); rows += batch.length; }
    state.files[file] = { offset: fs.statSync(file).size, shipped_at: new Date().toISOString() };
    files++;
  }
  writeJsonState(stateFile, state);
  return { files, rows };
}
if (import.meta.url === `file://${process.argv[1]}`) withJobLock('rrd-events-ship', async () => { const r = await shipOnce(); if (r.rows) console.log(`shipped ${r.rows} event row(s) from ${r.files} file(s)`); }).catch(e => { console.error(e.stack || e.message); process.exit(1); });
