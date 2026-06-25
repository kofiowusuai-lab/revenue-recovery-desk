/**
 * Tests for the deterministic dunning drafter (rrd-draft.mjs). Pure, offline.
 * Run: node --test test/rrd-draft.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { rungFor, draftMessage, RUNGS } from "../rrd-draft.mjs";

test("rungFor escalates with age", () => {
  assert.equal(rungFor(0), "reminder");
  assert.equal(rungFor(3), "reminder");
  assert.equal(rungFor(4), "follow_up");
  assert.equal(rungFor(13), "follow_up");
  assert.equal(rungFor(14), "firm");
  assert.equal(rungFor(29), "firm");
  assert.equal(rungFor(30), "final_notice");
  assert.equal(rungFor(59), "final_notice");
  assert.equal(rungFor(60), "pre_escalation");
  assert.equal(rungFor(400), "pre_escalation");
});

const inv = {
  id: "in_1", number: "INV-99", currency: "USD", amount: 1500,
  daysOverdue: 21, customerName: "Jane Cust", dueDate: "2026-05-31",
  hostedInvoiceUrl: "https://pay.stripe/in_1"
};

test("draftMessage includes the customer, amount, reference, days, and pay link", () => {
  const m = draftMessage({ invoice: inv, company: "Acme" });
  assert.equal(m.rung, "firm");
  assert.match(m.text, /Jane Cust/);
  assert.match(m.text, /INV-99/);
  assert.match(m.text, /\$1,500\.00/);
  assert.match(m.text, /21/);
  assert.match(m.text, /https:\/\/pay\.stripe\/in_1/);
  assert.match(m.html, /Pay invoice securely/);
  assert.match(m.html, /href="https:\/\/pay\.stripe\/in_1"/);
  assert.equal(m.paymentUrl, "https://pay.stripe/in_1");
});

test("subject reflects the rung and company", () => {
  assert.match(draftMessage({ invoice: { ...inv, daysOverdue: 1 }, company: "Acme" }).subject, /reminder/i);
  assert.match(draftMessage({ invoice: { ...inv, daysOverdue: 65 }, company: "Acme" }).subject, /escalation/i);
});

test("client voice (signature + alwaysPhrases) is honored", () => {
  const m = draftMessage({ invoice: inv, company: "Acme", voice: { signature: "Bryan, AR Team\nAcme Inc", alwaysPhrases: "We value your partnership." } });
  assert.match(m.text, /Bryan, AR Team/);
  assert.match(m.text, /We value your partnership\./);
  assert.match(m.html, /Bryan, AR Team<br>Acme Inc/);
});

test("html escapes user-controlled fields", () => {
  const m = draftMessage({ invoice: { ...inv, customerName: 'Jane <script>"x"' }, company: "Acme" });
  assert.match(m.html, /Jane &lt;script&gt;&quot;x&quot;/);
  assert.doesNotMatch(m.html, /<script>/);
});

test("missing pay link omits the button but still drafts", () => {
  const m = draftMessage({ invoice: { ...inv, hostedInvoiceUrl: null }, company: "Acme", paymentUrl: null });
  assert.equal(m.paymentUrl, null);
  assert.doesNotMatch(m.html, /Pay invoice securely/);
  assert.match(m.text, /INV-99/);
});

test("drafter hook can polish but cannot drop the pay link or rung", () => {
  const m = draftMessage({
    invoice: inv, company: "Acme",
    drafter: (msg) => ({ subject: "Polished subject", paymentUrl: null, rung: "nope" })
  });
  assert.equal(m.subject, "Polished subject");
  assert.equal(m.rung, "firm");                       // preserved
  assert.equal(m.paymentUrl, "https://pay.stripe/in_1"); // preserved
});

test("every rung has copy", () => {
  for (const r of RUNGS) {
    const m = draftMessage({ invoice: { ...inv, daysOverdue: r.minDays }, company: "Acme" });
    assert.ok(m.subject && m.text && m.html, "rung " + r.key);
  }
});
