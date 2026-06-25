#!/usr/bin/env node
/**
 * FlowAudit Stripe 72-hour due reminder watcher.
 *
 * Sends one reminder per Stripe invoice when its due_date is roughly 72 hours away.
 * Dedupe state prevents repeat reminders for the same invoice.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sendEmail } from './rrd-email.mjs';
import { withJobLock } from './rrd-job-lock.mjs';
import { loadJsonState, writeJsonState } from './rrd-state-file.mjs';

const OP = process.env.RRD_OPERATOR_HOME || '/Users/AIAgenterminal';
const STATE = process.env.RRD_DUE_REMINDER_STATE || path.join(OP, '.openclaw', 'rrd-flowaudit-due-reminders.json');
const PROFILE_ENV = path.join(OP, '.hermes', 'profiles', 'rr-flowaudit-internal', '.env');
const RECOVERY_ENV = path.join(OP, '.hermes', 'profiles', 'recoverydesk', '.env');
const OPENCLAW_ENV = path.join(OP, '.openclaw', '.env');

function loadDotenv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotenv(OPENCLAW_ENV);
loadDotenv(RECOVERY_ENV);
loadDotenv(PROFILE_ENV);
process.env.RRD_SUPPORT_INBOX_ID ||= process.env.RRD_AGENTMAIL_INBOX_ID || 'flowaudit-support@agentmail.to';

function loadState() { return loadJsonState(STATE, { sent: {}, runs: [] }, 'due reminder state'); }
function saveState(s) { writeJsonState(STATE, s); }
function money(cents, currency='gbp') { return new Intl.NumberFormat('en-GB', { style:'currency', currency: String(currency).toUpperCase() }).format((Number(cents)||0)/100); }
async function stripeGet(pathname, params={}) {
  const key = process.env.STRIPE_API_KEY || process.env.FLOW_AUDIT_STRIPE_SECRET_KEY;
  if (!key) throw new Error('Missing FlowAudit Stripe key');
  const url = new URL('https://api.stripe.com/v1/' + pathname.replace(/^\//, ''));
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${key}`, 'Stripe-Version':'2024-06-20' } });
  const body = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(`Stripe ${r.status}: ${body.error?.message || JSON.stringify(body).slice(0,300)}`);
  return body;
}
async function listDueSoon({ now = Math.floor(Date.now()/1000), minHours=66, maxHours=78, limit=100 } = {}) {
  const dueMin = now + Math.round(minHours*3600);
  const dueMax = now + Math.round(maxHours*3600);
  const out = [];
  let starting_after = null;
  do {
    const params = { status:'open', limit: Math.min(limit, 100) };
    if (starting_after) params.starting_after = starting_after;
    const page = await stripeGet('invoices', params);
    for (const inv of page.data || []) {
      const due = Number(inv.due_date || 0);
      if (due && due >= dueMin && due <= dueMax) out.push(inv);
    }
    starting_after = page.has_more && page.data?.length ? page.data[page.data.length-1].id : null;
  } while (starting_after && out.length < limit);
  return out;
}
function customerEmail(inv) { return inv.customer_email || inv.customer_details?.email || inv.customer?.email || null; }
function messageFor(inv) {
  const co = 'FlowAudit';
  const ref = inv.number || inv.id;
  const amount = money(inv.amount_remaining ?? inv.amount_due, inv.currency || 'gbp');
  const due = inv.due_date ? new Date(inv.due_date*1000).toLocaleDateString('en-GB', { dateStyle:'medium' }) : 'in 72 hours';
  const url = inv.hosted_invoice_url || inv.invoice_pdf || '';
  const subject = `Payment due in 72 hours — invoice ${ref}`;
  const text = [
    `Hi ${inv.customer_name || inv.customer_details?.name || 'there'},`, '',
    `A quick reminder that your ${co} payment is due in 72 hours.`, '',
    `Invoice: ${ref}`,
    `Amount due: ${amount}`,
    `Due date: ${due}`,
    url ? `Pay securely: ${url}` : null,
    '',
    'If you have already paid, thank you — you can ignore this reminder.',
    'If anything looks wrong, reply to this email and we will help.', '',
    'Thank you,', 'FlowAudit'
  ].filter(Boolean).join('\n');
  return { subject, text };
}
export async function run({ send=false, now=Math.floor(Date.now()/1000), minHours=66, maxHours=78 } = {}) {
  const state = loadState();
  const invoices = await listDueSoon({ now, minHours, maxHours });
  const results = [];
  for (const inv of invoices) {
    const email = customerEmail(inv);
    if (!email) { results.push({ invoiceId: inv.id, outcome:'skipped', reason:'no customer email' }); continue; }
    if (state.sent[inv.id]) { results.push({ invoiceId: inv.id, outcome:'already_sent', at: state.sent[inv.id].at }); continue; }
    const msg = messageFor(inv);
    if (!send) { results.push({ invoiceId: inv.id, email, outcome:'would_send', subject: msg.subject }); continue; }
    const accepted = await sendEmail({ to: { email, name: inv.customer_name || inv.customer_details?.name }, subject: msg.subject, text: msg.text });
    state.sent[inv.id] = { at: new Date().toISOString(), email, provider: accepted.provider, id: accepted.id || null };
    results.push({ invoiceId: inv.id, email, outcome:'sent', provider: accepted.provider, id: accepted.id || null });
  }
  state.runs.push({ at: new Date().toISOString(), send, found: invoices.length, results });
  if (state.runs.length > 100) state.runs = state.runs.slice(-100);
  if (send) saveState(state); else saveState({ ...state, runs: state.runs });
  return { ok:true, send, windowHours:[minHours,maxHours], found: invoices.length, results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  withJobLock('rrd-flowaudit-due-reminders', async () => {
    const send = process.argv.includes('--send');
    const minArg = process.argv.indexOf('--min-hours');
    const maxArg = process.argv.indexOf('--max-hours');
    const r = await run({ send, minHours: minArg>=0 ? Number(process.argv[minArg+1]) : 66, maxHours: maxArg>=0 ? Number(process.argv[maxArg+1]) : 78 });
    console.log(JSON.stringify(r, null, 2));
  }, { staleMs: 30 * 60 * 1000 }).catch(e => { console.error('Error: ' + (e.message || e)); process.exit(1); });
}
