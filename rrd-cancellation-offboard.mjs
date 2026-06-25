#!/usr/bin/env node
// rrd-cancellation-offboard.mjs — cancellation form → prorated final payment → offboard.
//
// Commands:
//   prepare <message_json_file>  Parse a completed AgentMail message, create final payment link or offboard if zero due.
//   poll                         Poll pending final-payment links; offboard + email confirmation when paid.
//   list                         Show local cancellation state.
//   calc-demo                    Local helper for quick proration checks.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import {
  parseOffboardingForm,
  isAuthorizedOffboardingForm,
  parseDateToUnix,
  calculateProrationCents,
  formatMoney,
  normalizeCompany,
  buildFinalAmountEmail,
  buildOffboardConfirmationEmail,
} from './rrd-cancellation-core.mjs';
import { assertInboundSafeForAutomation, normalizeInboundEmailText } from './rrd-email-security.mjs';
import { withJobLock } from './rrd-job-lock.mjs';
import { loadJsonState, writeJsonState } from './rrd-state-file.mjs';

const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || '/Users/AIAgenterminal';
const PROFILE_ENV = `${OPERATOR_HOME}/.hermes/profiles/recoverydesk/.env`;
const OPENCLAW_ENV = `${OPERATOR_HOME}/.openclaw/.env`;
const LOCAL_ENV = `${OPERATOR_HOME}/.env.local`;
const STATE_PATH = process.env.RRD_CANCELLATION_STATE || `${OPERATOR_HOME}/.openclaw/rrd-cancellations.json`;
const API_BASE = process.env.AGENTMAIL_API_BASE || 'https://api.agentmail.to/v0';
const SUPPORT_INBOX = process.env.RRD_SUPPORT_INBOX_ID || 'flowaudit-support@agentmail.to';
const STRIPE_API_VERSION = '2024-06-20';

function loadDotenv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotenv(OPENCLAW_ENV);
loadDotenv(PROFILE_ENV);
loadDotenv(LOCAL_ENV);

function readState() { return loadJsonState(STATE_PATH, { version: 1, pending: {}, completed: {} }, 'cancellation/offboarding state'); }
function writeState(s) { writeJsonState(STATE_PATH, s); }

function supabaseConfig() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for web offboarding queue processing');
  return { url, key };
}
async function supabaseRest(pathname, init = {}) {
  const { url, key } = supabaseConfig();
  const res = await fetch(`${url}/rest/v1/${pathname}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`Supabase REST ${res.status}: ${text}`);
  return data;
}

function stripeKey() {
  const k = process.env.FLOW_AUDIT_STRIPE_SECRET_KEY;
  if (!k) throw new Error('FLOW_AUDIT_STRIPE_SECRET_KEY is not configured');
  return k;
}
function agentmailKey() {
  const k = process.env.AGENTMAIL_API_KEY;
  if (!k) throw new Error('AGENTMAIL_API_KEY is not configured');
  return k;
}
async function stripe(method, endpoint, params = undefined) {
  const url = new URL(`https://api.stripe.com/v1/${endpoint.replace(/^\//, '')}`);
  const opts = { method, headers: { Authorization: `Bearer ${stripeKey()}`, 'Stripe-Version': STRIPE_API_VERSION } };
  if (method === 'GET') {
    if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  } else {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(params || {}).toString();
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Stripe API error ${res.status}: ${data?.error?.message || text}`);
  return data;
}
async function agentmail(method, endpoint, body = undefined) {
  const url = `${API_BASE}/${endpoint.replace(/^\//, '')}`;
  const opts = { method, headers: { Authorization: `Bearer ${agentmailKey()}` } };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`AgentMail API error ${res.status}: ${data?.message || text}`);
  return data;
}

function messageBody(message) {
  return normalizeInboundEmailText(message);
}

function harness(command, jsonArg) {
  const args = [command];
  if (jsonArg !== undefined) args.push(JSON.stringify(jsonArg));
  const out = execFileSync('/Users/AIAgenterminal/rrd-harness', args, { encoding: 'utf8' });
  return JSON.parse(out);
}

function isWebOffboardingQueueRecord(c) {
  return c?.catalyst === 'OFFBOARDING_REQUEST_WEB' || c?.businessProfile?.requestType === 'offboarding';
}

function findClientByForm(form) {
  if (form.sourceSubmissionId) {
    const byId = harness('get', form.sourceSubmissionId);
    if (byId?.id && !isWebOffboardingQueueRecord(byId)) return byId;
  }
  const candidates = [];
  if (form.companyName) candidates.push(...harness('search', form.companyName));
  if (form.billingEmail) candidates.push(...harness('search', form.billingEmail));
  const seen = new Set();
  const uniq = candidates.filter(c => c?.id && !seen.has(c.id) && seen.add(c.id)).filter(c => !isWebOffboardingQueueRecord(c));
  const wanted = normalizeCompany(form.companyName);
  return uniq.find(c => normalizeCompany(c.company) === wanted)
    || uniq.find(c => normalizeCompany(c.company || '').includes(wanted) || wanted.includes(normalizeCompany(c.company || '')))
    || uniq[0]
    || null;
}

function assertFormMatchesClient(form, client) {
  const formCompany = normalizeCompany(form.companyName);
  const clientCompany = normalizeCompany(client?.company);
  const formEmail = String(form.billingEmail || '').trim().toLowerCase();
  const clientEmail = String(client?.email || '').trim().toLowerCase();
  const lockedCompany = normalizeCompany(form.lockedCompany || form.companyName);
  const lockedEmail = String(form.lockedBillingEmail || form.billingEmail || '').trim().toLowerCase();
  if (!client?.id) throw new Error('No active client matched this offboarding request');
  if (!form.sourceSubmissionId) throw new Error('Missing locked source client id on web offboarding request');
  if (form.sourceSubmissionId !== client.id) throw new Error('Locked client id does not match active client record');
  if (!formCompany || formCompany !== clientCompany || lockedCompany !== clientCompany) throw new Error('Company name does not match the active client record');
  if (!formEmail || formEmail !== clientEmail || lockedEmail !== clientEmail) throw new Error('Business/billing email does not match the company email on file');
  return true;
}

async function findSubscriptionForClient(client, form) {
  const state = readJson(`${OPERATOR_HOME}/.openclaw/rrd-sales-retainers.json`, { entries: {} });
  const name = normalizeCompany(client?.company || form.companyName);
  const entries = Object.values(state.entries || {}).filter(e => normalizeCompany(e.client) === name || normalizeCompany(e.client).includes(name) || name.includes(normalizeCompany(e.client)));
  for (const e of entries) {
    for (const ps of Object.values(e.processedSessions || {})) {
      if (ps.subscriptionId) {
        const sub = await stripe('GET', `/subscriptions/${ps.subscriptionId}`);
        return { subscription: sub, source: 'retainer_state', retainerAmountCents: Number(e.retainerAmount || 0) * 100 || null, currency: e.retainerCurrency || sub.currency || 'usd' };
      }
    }
  }
  // Fallback: search subscriptions by customer email if available.
  if (form.billingEmail) {
    const customers = await stripe('GET', '/customers/search', { query: `email:'${form.billingEmail}'`, limit: 5 });
    for (const customer of customers.data || []) {
      const subs = await stripe('GET', '/subscriptions', { customer: customer.id, status: 'all', limit: 10 });
      const active = (subs.data || []).find(s => ['active', 'trialing', 'past_due'].includes(s.status));
      if (active) return { subscription: active, source: 'stripe_customer_email', retainerAmountCents: active.items?.data?.[0]?.price?.unit_amount || null, currency: active.currency || 'usd' };
    }
  }
  return null;
}

async function createFinalPaymentLink({ client, form, amountCents, currency }) {
  const company = client?.company || form.companyName;
  const product = await stripe('POST', '/products', {
    name: `${company} — Final Revenue Recovery Desk Offboarding Invoice`,
    description: `Final prorated amount due up to ${form.desiredCancellationDate}.`,
    'metadata[client_id]': client?.id || '',
    'metadata[client]': company,
    'metadata[source]': 'revenue_recovery_desk_offboarding',
  });
  const price = await stripe('POST', '/prices', {
    unit_amount: String(Math.max(0, Math.round(amountCents))),
    currency: (currency || 'usd').toLowerCase(),
    product: product.id,
    'metadata[type]': 'final_prorated_offboarding_invoice',
  });
  const link = await stripe('POST', '/payment_links', {
    'line_items[0][price]': price.id,
    'line_items[0][quantity]': '1',
    'after_completion[type]': 'redirect',
    'after_completion[redirect][url]': `${(process.env.RRD_WEB_BASE || 'https://flowaudit.co.uk/revenue-recovery').replace(/\/+$/, '')}/offboarded`,
    'metadata[client_id]': client?.id || '',
    'metadata[client]': company,
    'metadata[source]': 'revenue_recovery_desk_offboarding',
    'metadata[cancellation_date]': form.desiredCancellationDate,
  });
  return { product, price, link };
}

async function replyTo(message, text) {
  return agentmail('POST', `/inboxes/${encodeURIComponent(SUPPORT_INBOX)}/messages/${encodeURIComponent(message.message_id || message.id)}/reply`, { text });
}
async function labelMessage(message, labels) {
  return agentmail('PATCH', `/inboxes/${encodeURIComponent(SUPPORT_INBOX)}/messages/${encodeURIComponent(message.message_id || message.id)}`, { add_labels: labels });
}

async function offboardClient({ client, form, recovered = 0 }) {
  const notes = `Cancellation requested via AgentMail. Desired cancellation date: ${form.desiredCancellationDate}. Reason: ${form.reason || 'not provided'}. Handover notes: ${form.handoverNotes || 'none'}.`;
  const result = harness('offboard', { id: client.id, reason: `Cancellation — ${form.reason || 'no reason provided'}`, notes, recovered });
  // Finalize the go-live readiness card so it stops showing pending steps for a
  // client that has left. Visibility only — never block offboarding.
  try {
    const mon = `${process.env.RRD_OPERATOR_HOME || '/Users/AIAgenterminal'}/.openclaw/scripts/readiness-monitor.py`;
    if (fs.existsSync(mon)) {
      execFileSync(mon, ['close', '--client', String(client.id), '--lane', 'recovery_desk', '--reason', 'offboarded'],
        { encoding: 'utf8', timeout: 30000, env: { ...process.env, HOME: process.env.RRD_OPERATOR_HOME || '/Users/AIAgenterminal' } });
    }
  } catch { /* readiness card is visibility only */ }
  return result;
}

async function prepare(message) {
  assertInboundSafeForAutomation(message);
  const form = parseOffboardingForm(messageBody(message));
  if (!isAuthorizedOffboardingForm(form)) return { ok: false, status: 'incomplete_or_unauthorized', form };
  const client = findClientByForm(form);
  if (!client?.id) throw new Error(`Could not match offboarding form to active client: ${form.companyName} / ${form.billingEmail}`);
  const cancelAt = parseDateToUnix(form.desiredCancellationDate);
  if (!cancelAt) throw new Error(`Invalid cancellation date: ${form.desiredCancellationDate}`);
  const subInfo = await findSubscriptionForClient(client, form);
  let amountCents = 0;
  let currency = 'usd';
  let periodStart = null;
  let periodEnd = null;
  let subscriptionId = null;
  if (subInfo?.subscription) {
    const sub = subInfo.subscription;
    subscriptionId = sub.id;
    currency = subInfo.currency || sub.currency || 'usd';
    periodStart = sub.current_period_start;
    periodEnd = sub.current_period_end;
    const retainerCents = subInfo.retainerAmountCents || sub.items?.data?.[0]?.price?.unit_amount || 0;
    amountCents = calculateProrationCents({ amountCents: retainerCents, periodStart, periodEnd, cancelAt });
  }
  const state = readState();
  const key = message.message_id || message.id || `${client.id}:${form.desiredCancellationDate}`;
  if (state.pending[key] || state.completed[key]) return { ok: true, status: 'already_tracked', key };

  if (amountCents <= 0) {
    const off = await offboardClient({ client, form, recovered: 0 });
    await replyTo(message, buildFinalAmountEmail({ company: client.company || form.companyName, amountCents, currency, cancellationDate: form.desiredCancellationDate }));
    await replyTo(message, buildOffboardConfirmationEmail({ company: client.company || form.companyName }));
    await labelMessage(message, ['rrd_offboarded', 'rrd_processed']);
    state.completed[key] = { completedAt: new Date().toISOString(), clientId: client.id, client: client.company, amountCents, currency, offboardResult: off };
    writeState(state);
    return { ok: true, status: 'offboarded_zero_due', client: client.company, amountCents };
  }

  const finalLink = await createFinalPaymentLink({ client, form, amountCents, currency });
  await replyTo(message, buildFinalAmountEmail({ company: client.company || form.companyName, amountCents, currency, cancellationDate: form.desiredCancellationDate, paymentUrl: finalLink.link.url }));
  await labelMessage(message, ['rrd_final_payment_sent', 'rrd_processed']);
  state.pending[key] = {
    createdAt: new Date().toISOString(),
    sourceMessageId: message.message_id || message.id,
    clientId: client.id,
    client: client.company || form.companyName,
    billingEmail: form.billingEmail,
    form,
    amountCents,
    currency,
    periodStart,
    periodEnd,
    subscriptionId,
    paymentLinkId: finalLink.link.id,
    paymentUrl: finalLink.link.url,
    priceId: finalLink.price.id,
  };
  writeState(state);
  return { ok: true, status: 'final_payment_link_sent', client: client.company, amount: formatMoney(amountCents, currency), paymentLinkId: finalLink.link.id, paymentUrl: finalLink.link.url };
}

async function paidSessions(paymentLinkId) {
  const sessions = await stripe('GET', '/checkout/sessions', { payment_link: paymentLinkId, limit: 100 });
  return (sessions.data || []).filter(s => s.payment_status === 'paid' && s.status === 'complete');
}

async function sendEmail(to, subject, text) {
  return agentmail('POST', `/inboxes/${encodeURIComponent(SUPPORT_INBOX)}/messages/send`, { to, subject, text });
}

async function processWebOffboardingRow(row) {
  const bp = row.business_profile || {};
  const form = {
    sourceSubmissionId: bp.sourceSubmissionId,
    lockedCompany: bp.lockedCompany,
    lockedBillingEmail: bp.lockedBillingEmail,
    companyName: row.company || bp.companyName,
    primaryContactName: row.contact_name || bp.primaryContactName,
    billingEmail: row.email || bp.billingEmail,
    desiredCancellationDate: bp.desiredCancellationDate,
    reason: bp.reason,
    didNotWork: bp.didNotWork,
    handoverNotes: bp.handoverNotes,
    authorization: row.consent || bp.authorization ? 'Yes' : 'No',
  };
  if (!isAuthorizedOffboardingForm(form)) throw new Error(`Web offboarding request ${row.id} is incomplete or unauthorized`);

  const client = findClientByForm(form);
  if (!client?.id) throw new Error(`Could not match web offboarding form to active client: ${form.companyName} / ${form.billingEmail}`);
  assertFormMatchesClient(form, client);

  await sendEmail(
    form.billingEmail,
    'Offboarding request received',
    `Thanks — your offboarding form has been successfully submitted.\n\nWe will review the request, calculate any final prorated amount if one is due, and reach out with either a final payment link or confirmation once offboarding is complete.\n\nCompany: ${form.companyName}\nRequested cancellation date: ${form.desiredCancellationDate}\n\nPlease do not send API keys, passwords, or card details by email.`
  );

  const cancelAt = parseDateToUnix(form.desiredCancellationDate);
  if (!cancelAt) throw new Error(`Invalid cancellation date: ${form.desiredCancellationDate}`);

  const subInfo = await findSubscriptionForClient(client, form);
  let amountCents = 0;
  let currency = 'usd';
  let periodStart = null;
  let periodEnd = null;
  let subscriptionId = null;
  if (subInfo?.subscription) {
    const sub = subInfo.subscription;
    subscriptionId = sub.id;
    currency = subInfo.currency || sub.currency || 'usd';
    periodStart = sub.current_period_start;
    periodEnd = sub.current_period_end;
    const retainerCents = subInfo.retainerAmountCents || sub.items?.data?.[0]?.price?.unit_amount || 0;
    amountCents = calculateProrationCents({ amountCents: retainerCents, periodStart, periodEnd, cancelAt });
  }

  const state = readState();
  const key = `web:${row.id}`;
  if (state.pending[key] || state.completed[key]) return { ok: true, status: 'already_tracked', key };

  if (amountCents <= 0) {
    const off = await offboardClient({ client, form, recovered: 0 });
    await sendEmail(form.billingEmail, `${client.company || form.companyName} offboarding confirmed`, buildOffboardConfirmationEmail({ company: client.company || form.companyName }));
    state.completed[key] = { completedAt: new Date().toISOString(), source: 'web', queueRowId: row.id, clientId: client.id, client: client.company, amountCents, currency, offboardResult: off };
    writeState(state);
    await supabaseRest(`submissions?id=eq.${encodeURIComponent(row.id)}`, { method: 'DELETE' });
    return { ok: true, status: 'offboarded_zero_due', client: client.company, amountCents };
  }

  const finalLink = await createFinalPaymentLink({ client, form, amountCents, currency });
  await sendEmail(form.billingEmail, `${client.company || form.companyName} final offboarding payment`, buildFinalAmountEmail({ company: client.company || form.companyName, amountCents, currency, cancellationDate: form.desiredCancellationDate, paymentUrl: finalLink.link.url }));
  state.pending[key] = {
    createdAt: new Date().toISOString(),
    source: 'web',
    queueRowId: row.id,
    clientId: client.id,
    client: client.company || form.companyName,
    billingEmail: form.billingEmail,
    form,
    amountCents,
    currency,
    periodStart,
    periodEnd,
    subscriptionId,
    paymentLinkId: finalLink.link.id,
    paymentUrl: finalLink.link.url,
    priceId: finalLink.price.id,
  };
  writeState(state);
  await supabaseRest(`submissions?id=eq.${encodeURIComponent(row.id)}`, { method: 'DELETE' });
  return { ok: true, status: 'final_payment_link_sent', client: client.company, amount: formatMoney(amountCents, currency), paymentLinkId: finalLink.link.id, paymentUrl: finalLink.link.url };
}

async function processWebQueue() {
  const rows = await supabaseRest('submissions?select=*&catalyst=eq.OFFBOARDING_REQUEST_WEB&order=created_at.asc&limit=20');
  const events = [];
  for (const row of rows || []) {
    try {
      events.push({ rowId: row.id, ...(await processWebOffboardingRow(row)) });
    } catch (err) {
      events.push({ rowId: row.id, ok: false, status: 'error', error: err.message });
    }
  }
  console.log(JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), count: rows?.length || 0, events }, null, 2));
}

async function poll() {
  const state = readState();
  const events = [];
  for (const [key, pending] of Object.entries(state.pending || {})) {
    const paid = await paidSessions(pending.paymentLinkId);
    if (!paid.length) continue;
    const client = harness('get', pending.clientId);
    if (!client?.id) {
      events.push({ status: 'client_missing', key, client: pending.client, paymentLinkId: pending.paymentLinkId });
      continue;
    }
    const off = await offboardClient({ client, form: pending.form, recovered: pending.amountCents / 100 });
    const text = buildOffboardConfirmationEmail({ company: pending.client });
    await agentmail('POST', `/inboxes/${encodeURIComponent(SUPPORT_INBOX)}/messages/send`, {
      to: pending.billingEmail,
      subject: `${pending.client} offboarding confirmed`,
      text,
    });
    state.completed[key] = { ...pending, completedAt: new Date().toISOString(), paidSessionId: paid[0].id, offboardResult: off };
    delete state.pending[key];
    events.push({ status: 'offboarded_after_final_payment', client: pending.client, amount: formatMoney(pending.amountCents, pending.currency), paymentLinkId: pending.paymentLinkId });
  }
  writeState(state);
  console.log(JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), events }, null, 2));
}

async function prepareFromFile(file) {
  const msg = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(JSON.stringify(await prepare(msg), null, 2));
}

async function list() { console.log(JSON.stringify(readState(), null, 2)); }
async function calcDemo(args) {
  const [amount, start, end, cancel, currency = 'usd'] = args;
  const cents = calculateProrationCents({ amountCents: Number(amount) * 100, periodStart: parseDateToUnix(start), periodEnd: parseDateToUnix(end), cancelAt: parseDateToUnix(cancel) });
  console.log(JSON.stringify({ cents, amount: formatMoney(cents, currency) }, null, 2));
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'prepare') return prepareFromFile(args[0]);
  if (cmd === 'process-web') return processWebQueue();
  if (cmd === 'poll') return poll();
  if (cmd === 'list') return list();
  if (cmd === 'calc-demo') return calcDemo(args);
  throw new Error('Usage: rrd-cancellation-offboard.mjs prepare <message.json>|process-web|poll|list|calc-demo <amount> <periodStart> <periodEnd> <cancelDate> [currency]');
}

withJobLock('rrd-cancellation-offboard', main, { staleMs: 30 * 60 * 1000 }).catch(err => { console.error(err.message); process.exit(1); });
