#!/usr/bin/env node
/**
 * rrd-stripe.mjs — Stripe read + payment-link module for the Revenue Recovery Desk.
 *
 * Backs the `read_payments` and `generate_payment_link` tools in the agent's
 * allowlist with REAL code (they were previously names only). Lists a client's
 * overdue invoices straight from the Stripe API and hands back the customer's
 * contact and a ready-to-pay link — no browser, no CRM, no npm deps (Node 18+
 * global fetch). A Stripe invoice already carries the customer's email/name and a
 * hosted payment page, so for Stripe-billed clients this one call replaces both
 * the payment-platform read AND the CRM contact lookup.
 *
 *   export STRIPE_API_KEY="sk_live_..."   # required (Developers -> API keys; a restricted
 *                                         #   read key with Invoices:read + Customers:read works)
 *   export STRIPE_API_VERSION="2024-06-20"   # optional pin
 *
 *   node rrd-stripe.mjs overdue '{"minAmountUsd":50,"minDaysOverdue":1,"limit":100}'
 *   node rrd-stripe.mjs payurl '"in_123"'
 *   node rrd-stripe.mjs help
 *
 * All network calls go through stripeApi(); the parsing/selection helpers
 * (normalizeInvoice, paymentUrlFor) are PURE so the executor and tests stay
 * deterministic and offline.
 */

const API_BASE = (process.env.STRIPE_API_BASE || "https://api.stripe.com/v1").replace(/\/+$/, "");
const API_VERSION = process.env.STRIPE_API_VERSION || "2024-06-20";
const ENV_KEY = process.env.STRIPE_API_KEY || "";

const METHODS = new Set(["overdue", "payurl", "help"]);

/** Low-level Stripe REST call. Throws on a non-2xx with the Stripe error message. */
export async function stripeApi(method, pathQ, { key, base = API_BASE, fetchImpl = fetch, form } = {}) {
  if (!key) throw new Error("Missing STRIPE_API_KEY (Stripe -> Developers -> API keys; a restricted read key works).");
  const headers = {
    "Authorization": `Bearer ${key}`,
    "Stripe-Version": API_VERSION
  };
  const init = { method, headers };
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(form).toString();
  }
  const res = await fetchImpl(`${base}/${pathQ}`, init);
  const text = await res.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  if (!res.ok) {
    const msg = body && typeof body === "object" && body.error
      ? (body.error.message || body.error.type || JSON.stringify(body.error))
      : (typeof body === "string" && body ? body : `HTTP ${res.status}`);
    throw new Error(`Stripe ${res.status}: ${msg}`);
  }
  return body;
}

/**
 * normalizeInvoice — PURE. Maps a raw Stripe invoice to the shape the recovery
 * loop needs. Amounts are Stripe minor units (cents); we expose both. "Overdue"
 * is measured from due_date when present, else the invoice creation date.
 */
export function normalizeInvoice(raw = {}, nowMs = Date.now()) {
  const cents = Number.isFinite(raw.amount_remaining) ? raw.amount_remaining
    : (Number.isFinite(raw.amount_due) ? raw.amount_due : 0);
  const dueMs = raw.due_date ? raw.due_date * 1000 : null;
  const createdMs = raw.created ? raw.created * 1000 : null;
  const effectiveDueMs = dueMs != null ? dueMs : createdMs;
  const daysOverdue = effectiveDueMs != null ? Math.floor((nowMs - effectiveDueMs) / 86400000) : 0;
  return {
    id: raw.id,
    number: raw.number || null,
    status: raw.status || null,
    currency: (raw.currency || "usd").toUpperCase(),
    customerId: raw.customer || null,
    customerEmail: raw.customer_email || null,
    customerName: raw.customer_name || null,
    amountCents: cents,
    amount: Math.round(cents) / 100,
    dueDate: dueMs != null ? new Date(dueMs).toISOString().slice(0, 10) : null,
    created: createdMs != null ? new Date(createdMs).toISOString().slice(0, 10) : null,
    daysOverdue,
    hostedInvoiceUrl: raw.hosted_invoice_url || null
  };
}

/** paymentUrlFor — PURE. The customer-facing pay page for an invoice, if Stripe has one. */
export function paymentUrlFor(inv = {}) {
  return inv.hostedInvoiceUrl || inv.hosted_invoice_url || null;
}

/**
 * listOverdueInvoices — page through open invoices, normalize, and keep the ones
 * that are actually overdue and worth chasing. Returns oldest-debt-first.
 *   opts: { key, now, minAmountUsd, minDaysOverdue, limit, maxPages, base, fetchImpl }
 */
export async function listOverdueInvoices(opts = {}) {
  const {
    key = ENV_KEY, now = Date.now(), minAmountUsd = 0, minDaysOverdue = 1,
    limit = 100, maxPages = 20, base = API_BASE, fetchImpl = fetch
  } = opts;

  const out = [];
  let startingAfter = null;
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ status: "open", limit: "100" });
    if (startingAfter) qs.set("starting_after", startingAfter);
    const res = await stripeApi("GET", `invoices?${qs.toString()}`, { key, base, fetchImpl });
    const data = (res && Array.isArray(res.data)) ? res.data : [];
    for (const raw of data) {
      const inv = normalizeInvoice(raw, now);
      if (inv.daysOverdue >= minDaysOverdue && inv.amount >= minAmountUsd) out.push(inv);
    }
    if (!res || !res.has_more || !data.length) break;
    startingAfter = data[data.length - 1].id;
  }
  out.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return limit ? out.slice(0, limit) : out;
}

/**
 * ensurePaymentUrl — return the invoice's hosted pay page, finalizing the invoice
 * first if Stripe hasn't generated one yet (draft invoices). Network; needs a write key.
 */
export async function ensurePaymentUrl(inv, { key = ENV_KEY, base = API_BASE, fetchImpl = fetch } = {}) {
  const existing = paymentUrlFor(inv);
  if (existing) return existing;
  if (!inv || !inv.id) return null;
  const fin = await stripeApi("POST", `invoices/${encodeURIComponent(inv.id)}/finalize`, { key, base, fetchImpl, form: {} });
  return (fin && fin.hosted_invoice_url) || null;
}

/* ---------------- CLI ---------------- */
function usage() {
  console.error(`rrd-stripe — Stripe read + payment links for the Revenue Recovery Desk

Usage:  node rrd-stripe.mjs <method> [jsonArg]

Methods: ${[...METHODS].join(", ")}

Setup:  export STRIPE_API_KEY="sk_..."   (a restricted Invoices:read + Customers:read key works)

Examples:
  node rrd-stripe.mjs overdue '{"minAmountUsd":50,"minDaysOverdue":1,"limit":100}'
  node rrd-stripe.mjs payurl '"in_123"'`);
}

async function run(method, arg) {
  if (method === "help") {
    return {
      name: "rrd-stripe", backend: "Stripe API " + API_VERSION, base: API_BASE,
      configured: !!ENV_KEY,
      methods: [
        ["overdue(opts?)", "list overdue open invoices (minAmountUsd, minDaysOverdue, limit)"],
        ["payurl(invoiceId)", "the hosted pay page for one invoice (finalizes if needed)"],
        ["help", "this manifest"]
      ]
    };
  }
  if (method === "overdue") {
    const o = (arg && typeof arg === "object") ? arg : {};
    const invoices = await listOverdueInvoices(o);
    const totalUsd = invoices.reduce((s, i) => s + i.amount, 0);
    return { count: invoices.length, totalOutstanding: Math.round(totalUsd * 100) / 100, invoices };
  }
  if (method === "payurl") {
    const id = typeof arg === "string" ? arg : (arg && arg.id);
    if (!id) throw new Error("payurl expects an invoice id");
    const raw = await stripeApi("GET", `invoices/${encodeURIComponent(id)}`, { key: ENV_KEY });
    return { id, url: await ensurePaymentUrl(normalizeInvoice(raw), { key: ENV_KEY }) };
  }
  throw new Error("Unhandled method: " + method);
}

async function main() {
  const [, , method, rawArg] = process.argv;
  if (!method || method === "-h" || method === "--help") { usage(); process.exit(method ? 0 : 1); }
  if (!METHODS.has(method)) { console.error(`Unknown method: ${method}\n`); usage(); process.exit(1); }
  let arg;
  if (rawArg != null && rawArg !== "") { try { arg = JSON.parse(rawArg); } catch { arg = rawArg; } }
  const result = await run(method, arg);
  console.log(JSON.stringify(result, null, 2));
}

const invokedDirectly = process.argv[1] && (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1]));
if (invokedDirectly) {
  main().catch((e) => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
}
