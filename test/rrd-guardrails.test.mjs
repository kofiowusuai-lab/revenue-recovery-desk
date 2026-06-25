/**
 * Tests for the deterministic guardrail enforcement in rrd-guardrails.mjs.
 * These prove the CODE layer blocks off-policy sends regardless of the model.
 * Run: node --test test/rrd-guardrails.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPolicy, evaluateSend, enforceCaps, actionAllowed, auditEntry,
  parseDiscount, parseHours, parseList, matchesDoNotContact
} from "../rrd-guardrails.mjs";

const baseRec = (over = {}) => ({
  company: "Acme", consent: true,
  outreach: { channels: ["Email", "SMS"], businessHours: "9-17", timezone: "America/New_York" },
  guardrails: { autoSendChannels: ["Email"], approvalModel: "approve every message", batchSize: 25, doNotContact: "vip@acme.com, litigation.com", maxDiscount: "10%" },
  recoveryProcess: {}, ...over
});

test("parseDiscount handles none / pct / amount + fail-closed", () => {
  assert.deepEqual(parseDiscount("no discount"), { type: "none", value: 0 });
  assert.deepEqual(parseDiscount("10%"), { type: "pct", value: 10 });
  assert.deepEqual(parseDiscount("$50"), { type: "amount", value: 50 });
  assert.deepEqual(parseDiscount("whatever"), { type: "none", value: 0 }); // fail-closed
});

test("parseHours parses common formats", () => {
  assert.deepEqual(parseHours("9-17"), { start: 9, end: 17 });
  assert.deepEqual(parseHours("9am-5pm"), { start: 9, end: 17 });
  assert.equal(parseHours("whenever"), null);
});

test("parseList normalizes and drops none/na", () => {
  assert.deepEqual(parseList("A, B@x.com; none\nC"), ["a", "b@x.com", "c"]);
  assert.deepEqual(parseList("n/a"), []);
});

test("clean send on an auto-send channel is allowed", () => {
  const p = buildPolicy(baseRec());
  const r = evaluateSend({ channel: "Email", to: { email: "ok@customer.com" }, atHour: 10, batchIndex: 0 }, p);
  assert.equal(r.allowed, true, JSON.stringify(r.violations));
});

test("approval-gated channel without approval is blocked", () => {
  const p = buildPolicy(baseRec());
  const r = evaluateSend({ channel: "SMS", to: { email: "ok@customer.com" }, atHour: 10 }, p);
  assert.equal(r.allowed, false);
  assert.ok(r.violations.some((v) => v.code === "APPROVAL_REQUIRED"));
});

test("approval-gated channel WITH approval passes", () => {
  const p = buildPolicy(baseRec());
  const r = evaluateSend({ channel: "SMS", to: { email: "ok@customer.com" }, approved: true, atHour: 10 }, p);
  assert.equal(r.allowed, true, JSON.stringify(r.violations));
});

test("do-not-contact match is blocked and needs a human", () => {
  const p = buildPolicy(baseRec());
  const r = evaluateSend({ channel: "Email", to: { email: "vip@acme.com" }, atHour: 10 }, p);
  assert.ok(r.violations.some((v) => v.code === "DO_NOT_CONTACT"));
  assert.equal(r.requiresHuman, true);
});

test("do-not-contact matches by domain too", () => {
  assert.equal(matchesDoNotContact({ email: "x@litigation.com" }, ["litigation.com"]), true);
  assert.equal(matchesDoNotContact({ email: "x@safe.com" }, ["litigation.com"]), false);
});

test("discount over cap is blocked and needs a human", () => {
  const p = buildPolicy(baseRec());
  const r = evaluateSend({ channel: "Email", to: { email: "ok@customer.com" }, discount: { type: "pct", value: 25 }, atHour: 10 }, p);
  assert.ok(r.violations.some((v) => v.code === "DISCOUNT_OVER_CAP"));
  assert.equal(r.requiresHuman, true);
});

test("discount within cap is fine", () => {
  const p = buildPolicy(baseRec());
  const r = evaluateSend({ channel: "Email", to: { email: "ok@customer.com" }, discount: { type: "pct", value: 5 }, atHour: 10 }, p);
  assert.equal(r.allowed, true, JSON.stringify(r.violations));
});

test("outside sending hours is blocked", () => {
  const p = buildPolicy(baseRec());
  const r = evaluateSend({ channel: "Email", to: { email: "ok@customer.com" }, atHour: 22 }, p);
  assert.ok(r.violations.some((v) => v.code === "OUTSIDE_HOURS"));
});

test("customer reply forces stop-and-escalate", () => {
  const p = buildPolicy(baseRec());
  const r = evaluateSend({ channel: "Email", to: { email: "ok@customer.com" }, atHour: 10, threadFlags: { customerReplied: true } }, p);
  assert.ok(r.violations.some((v) => v.code === "STOP_AND_ESCALATE"));
  assert.equal(r.requiresHuman, true);
});

test("no consent blocks everything", () => {
  const p = buildPolicy(baseRec({ consent: false }));
  const r = evaluateSend({ channel: "Email", to: { email: "ok@customer.com" }, approved: true, atHour: 10 }, p);
  assert.ok(r.violations.some((v) => v.code === "NO_CONSENT"));
});

test("channel not authorized is blocked", () => {
  const p = buildPolicy(baseRec());
  const r = evaluateSend({ channel: "WhatsApp", to: { email: "ok@customer.com" }, approved: true, atHour: 10 }, p);
  assert.ok(r.violations.some((v) => v.code === "CHANNEL_NOT_ALLOWED"));
});

test("batch cap enforced", () => {
  const p = buildPolicy(baseRec());
  const r = evaluateSend({ channel: "Email", to: { email: "ok@customer.com" }, atHour: 10, batchIndex: 25 }, p);
  assert.ok(r.violations.some((v) => v.code === "BATCH_EXCEEDED"));
});

test("enforceCaps blocks at the limit", () => {
  assert.equal(enforceCaps({ sendsToday: 100 }, { sendsToday: 100 }).allowed, false);
  assert.equal(enforceCaps({ sendsToday: 99 }, { sendsToday: 100 }).allowed, true);
});

test("tool allowlist is fail-closed", () => {
  assert.equal(actionAllowed("send_email", ["send_email", "read_crm"]), true);
  assert.equal(actionAllowed("rm_rf", ["send_email"]), false);
  assert.equal(actionAllowed("send_email", []), false); // no allowlist => nothing allowed
});

test("auditEntry captures the decision compactly", () => {
  const p = buildPolicy(baseRec());
  const action = { channel: "Email", to: { email: "vip@acme.com", name: "VIP" } };
  const decision = evaluateSend(action, p);
  const e = auditEntry({ profile: "rr-acme", kind: "send", action, decision, at: "2026-06-21T00:00:00Z" });
  assert.equal(e.profile, "rr-acme");
  assert.equal(e.allowed, false);
  assert.ok(e.violations.includes("DO_NOT_CONTACT"));
  assert.equal(e.to.email, "vip@acme.com");
});
