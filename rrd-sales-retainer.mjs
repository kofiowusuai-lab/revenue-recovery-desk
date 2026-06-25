#!/usr/bin/env node
// rrd-sales-retainer.mjs — auto-start 4-week retainers after setup-fee checkout.
//
// Pattern: Payment Link collects setup fee now and saves card for off-session use.
// This poller detects paid setup Checkout Sessions and creates the agreed retainer
// subscription 28 days later using the same saved card. It avoids customer-facing
// Stripe "trial/free" wording.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { withJobLock } from './rrd-job-lock.mjs';
import { loadJsonState, writeJsonState } from './rrd-state-file.mjs';

const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || '/Users/AIAgenterminal';
const PROFILE_ENV = `${OPERATOR_HOME}/.hermes/profiles/recoverydesk/.env`;
const OPENCLAW_ENV = `${OPERATOR_HOME}/.openclaw/.env`;
const STATE_PATH = process.env.RRD_SALES_RETAINERS_STATE || `${OPERATOR_HOME}/.openclaw/rrd-sales-retainers.json`;
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

function stripeKey() {
  const k = process.env.FLOW_AUDIT_STRIPE_SECRET_KEY;
  if (!k) throw new Error('FLOW_AUDIT_STRIPE_SECRET_KEY is not configured');
  if (!k.startsWith('sk_live_') && !k.startsWith('sk_test_')) throw new Error('Configured Stripe secret key does not look valid');
  return k;
}

async function stripe(method, endpoint, params = undefined) {
  const url = new URL(`https://api.stripe.com/v1/${endpoint.replace(/^\//, '')}`);
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${stripeKey()}`,
      'Stripe-Version': STRIPE_API_VERSION,
    },
  };
  if (method === 'GET') {
    if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  } else {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(params || {}).toString();
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || text || `Stripe HTTP ${res.status}`;
    throw new Error(`Stripe API error ${res.status}: ${msg}`);
  }
  return data;
}

function readState() { return loadJsonState(STATE_PATH, { version: 1, entries: {} }, 'sales retainer state'); }

function writeState(state) { writeJsonState(STATE_PATH, state); }

function plusDaysUnix(fromUnix, days) {
  return Number(fromUnix) + Math.round(Number(days) * 24 * 60 * 60);
}

async function verifyPrice(priceId) {
  const price = await stripe('GET', `/prices/${priceId}`);
  if (!price.recurring) throw new Error(`${priceId} is not a recurring retainer price`);
  if (price.recurring.interval !== 'week' || Number(price.recurring.interval_count || 1) !== 4) {
    throw new Error(`${priceId} is recurring but not every 4 weeks`);
  }
  return price;
}

async function register(args) {
  const [paymentLinkId, retainerPriceId, client, setupAmount = '3500', retainerAmount = '3000'] = args;
  if (!paymentLinkId || !retainerPriceId || !client) {
    throw new Error('Usage: rrd-sales-retainer register <payment_link_id> <retainer_price_id> <client_name> [setup_amount] [retainer_amount]');
  }
  const [plink, price] = await Promise.all([
    stripe('GET', `/payment_links/${paymentLinkId}`),
    verifyPrice(retainerPriceId),
  ]);
  const state = readState();
  state.entries[paymentLinkId] = {
    paymentLinkId,
    retainerPriceId,
    client,
    setupAmount: Number(setupAmount),
    retainerAmount: Number(retainerAmount),
    cadence: 'every_4_weeks',
    delayDays: 28,
    active: true,
    createdAt: new Date().toISOString(),
    stripePaymentLinkActive: Boolean(plink.active),
    retainerCurrency: price.currency,
    processedSessions: state.entries[paymentLinkId]?.processedSessions || {},
  };
  writeState(state);
  console.log(JSON.stringify({ ok: true, registered: state.entries[paymentLinkId] }, null, 2));
}

async function paidSessionsForPaymentLink(paymentLinkId) {
  const sessions = await stripe('GET', '/checkout/sessions', { payment_link: paymentLinkId, limit: 100 });
  return (sessions.data || []).filter((s) => s.payment_status === 'paid' && s.status === 'complete');
}

async function ensureDefaultPaymentMethod(customerId, paymentIntentId) {
  if (!paymentIntentId) return null;
  const pi = await stripe('GET', `/payment_intents/${paymentIntentId}`);
  const pm = typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id;
  if (!pm) return null;
  await stripe('POST', `/customers/${customerId}`, { 'invoice_settings[default_payment_method]': pm });
  return pm;
}

async function createRetainerSubscription(entry, session) {
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (!customerId) throw new Error(`Checkout session ${session.id} has no customer`);
  const paymentMethodId = await ensureDefaultPaymentMethod(customerId, session.payment_intent);
  const anchor = plusDaysUnix(session.created, entry.delayDays || 28);
  const params = {
    customer: customerId,
    'items[0][price]': entry.retainerPriceId,
    billing_cycle_anchor: String(anchor),
    proration_behavior: 'none',
    collection_method: 'charge_automatically',
    'metadata[source]': 'revenue_recovery_desk',
    'metadata[client]': entry.client,
    'metadata[setup_checkout_session]': session.id,
    'metadata[setup_payment_link]': entry.paymentLinkId,
    'metadata[retainer_terms]': `${entry.retainerAmount || 3000}_every_4_weeks_after_first_month`,
  };
  if (paymentMethodId) params.default_payment_method = paymentMethodId;
  return await stripe('POST', '/subscriptions', params);
}

async function poll() {
  const state = readState();
  const results = [];
  for (const entry of Object.values(state.entries || {})) {
    if (!entry.active) continue;
    const sessions = await paidSessionsForPaymentLink(entry.paymentLinkId);
    for (const session of sessions) {
      entry.processedSessions ||= {};
      if (entry.processedSessions[session.id]?.subscriptionId) {
        results.push({ client: entry.client, session: session.id, status: 'already_processed', subscriptionId: entry.processedSessions[session.id].subscriptionId });
        continue;
      }
      try {
        const sub = await createRetainerSubscription(entry, session);
        entry.processedSessions[session.id] = {
          processedAt: new Date().toISOString(),
          subscriptionId: sub.id,
          customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
          billingCycleAnchor: sub.billing_cycle_anchor,
          status: sub.status,
        };
        results.push({ client: entry.client, session: session.id, status: 'created', subscriptionId: sub.id, billingCycleAnchor: sub.billing_cycle_anchor, subscriptionStatus: sub.status });
      } catch (err) {
        entry.processedSessions[session.id] = {
          attemptedAt: new Date().toISOString(),
          error: err.message,
        };
        results.push({ client: entry.client, session: session.id, status: 'error', error: err.message });
      }
    }
  }
  writeState(state);
  console.log(JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), results }, null, 2));
}

async function list() {
  const state = readState();
  console.log(JSON.stringify(state, null, 2));
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'register') return register(args);
  if (cmd === 'poll') return poll();
  if (cmd === 'list') return list();
  throw new Error('Usage: rrd-sales-retainer register|poll|list');
}

withJobLock('rrd-sales-retainer', main, { staleMs: 30 * 60 * 1000 }).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
