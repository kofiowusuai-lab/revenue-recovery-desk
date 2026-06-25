/**
 * Tests for the Stripe read module (rrd-stripe.mjs).
 * Pure helpers tested directly; the network layer tested with an injected fetch —
 * no real Stripe calls. Run: node --test test/rrd-stripe.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeInvoice, paymentUrlFor, listOverdueInvoices, stripeApi } from "../rrd-stripe.mjs";

const NOW = Date.UTC(2026, 5, 21); // fixed clock
const dayS = 86400;
const agoSec = (days) => Math.floor(NOW / 1000) - days * dayS;
const inSec = (days) => Math.floor(NOW / 1000) + days * dayS;

function raw(over = {}) {
  return {
    id: "in_1", number: "INV-1", status: "open", currency: "usd",
    customer: "cus_1", customer_email: "jane@cust.com", customer_name: "Jane Cust",
    amount_remaining: 120000, amount_due: 120000,
    due_date: agoSec(30), created: agoSec(40), hosted_invoice_url: "https://pay.stripe/in_1",
    ...over
  };
}

// fake fetch returning JSON with provider-list pagination
function fakeFetch(pages) {
  let call = 0;
  return async (url) => {
    const page = pages[Math.min(call, pages.length - 1)];
    call++;
    return { ok: true, status: 200, text: async () => JSON.stringify(page) };
  };
}

test("normalizeInvoice maps fields, amount in major units, days overdue from due_date", () => {
  const inv = normalizeInvoice(raw(), NOW);
  assert.equal(inv.id, "in_1");
  assert.equal(inv.amount, 1200);
  assert.equal(inv.amountCents, 120000);
  assert.equal(inv.currency, "USD");
  assert.equal(inv.customerEmail, "jane@cust.com");
  assert.equal(inv.customerName, "Jane Cust");
  assert.equal(inv.daysOverdue, 30);
  assert.equal(inv.hostedInvoiceUrl, "https://pay.stripe/in_1");
});

test("normalizeInvoice falls back to created date when no due_date", () => {
  const inv = normalizeInvoice(raw({ due_date: null }), NOW);
  assert.equal(inv.daysOverdue, 40);
});

test("normalizeInvoice prefers amount_remaining over amount_due", () => {
  const inv = normalizeInvoice(raw({ amount_remaining: 5000, amount_due: 120000 }), NOW);
  assert.equal(inv.amount, 50);
});

test("paymentUrlFor reads either shape", () => {
  assert.equal(paymentUrlFor({ hostedInvoiceUrl: "x" }), "x");
  assert.equal(paymentUrlFor({ hosted_invoice_url: "y" }), "y");
  assert.equal(paymentUrlFor({}), null);
});

test("listOverdueInvoices filters not-yet-due and sub-threshold, sorts oldest first", async () => {
  const fetchImpl = fakeFetch([{
    data: [
      raw({ id: "in_old", due_date: agoSec(60), amount_remaining: 90000 }),   // 60d, $900 keep
      raw({ id: "in_new", due_date: agoSec(10), amount_remaining: 90000 }),   // 10d, $900 keep
      raw({ id: "in_future", due_date: inSec(5), amount_remaining: 90000 }),  // not overdue drop
      raw({ id: "in_tiny", due_date: agoSec(20), amount_remaining: 1000 })    // $10 below min drop
    ],
    has_more: false
  }]);
  const got = await listOverdueInvoices({ key: "sk_test", now: NOW, minAmountUsd: 50, minDaysOverdue: 1, fetchImpl });
  assert.deepEqual(got.map((i) => i.id), ["in_old", "in_new"]);
  assert.equal(got[0].daysOverdue, 60);
});

test("listOverdueInvoices paginates with starting_after", async () => {
  const fetchImpl = fakeFetch([
    { data: [raw({ id: "in_a", due_date: agoSec(5) })], has_more: true },
    { data: [raw({ id: "in_b", due_date: agoSec(9) })], has_more: false }
  ]);
  const got = await listOverdueInvoices({ key: "sk_test", now: NOW, fetchImpl });
  assert.deepEqual(got.map((i) => i.id).sort(), ["in_a", "in_b"]);
});

test("limit caps the result count", async () => {
  const data = Array.from({ length: 5 }, (_, n) => raw({ id: "in_" + n, due_date: agoSec(n + 1) }));
  const got = await listOverdueInvoices({ key: "sk_test", now: NOW, limit: 2, fetchImpl: fakeFetch([{ data, has_more: false }]) });
  assert.equal(got.length, 2);
});

test("stripeApi throws the Stripe error message on non-2xx", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: "Invalid API Key" } }) });
  await assert.rejects(() => stripeApi("GET", "invoices", { key: "bad", fetchImpl }), /Stripe 401: Invalid API Key/);
});

test("stripeApi requires a key (fail closed)", async () => {
  await assert.rejects(() => stripeApi("GET", "invoices", { key: "" }), /Missing STRIPE_API_KEY/);
});
