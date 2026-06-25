/**
 * Tests for the offboarding + 6-year-retention helpers in rrd-hermes.mjs.
 * Run: node --test test/rrd-offboard.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { rowToOffboarded, retentionStatus, RETENTION_YEARS } from "../rrd-hermes.mjs";

const DAY = 86400000;
const NOW = Date.UTC(2026, 5, 21); // 2026-06-21, fixed for determinism

test("retention window is 6 years", () => {
  assert.equal(RETENTION_YEARS, 6);
});

test("retentionStatus: future date is retained with positive daysLeft", () => {
  const future = new Date(NOW + 30 * DAY).toISOString();
  const s = retentionStatus(future, NOW);
  assert.equal(s.expired, false);
  assert.equal(s.daysLeft, 30);
});

test("retentionStatus: past date is expired with non-positive daysLeft", () => {
  const past = new Date(NOW - 2 * DAY).toISOString();
  const s = retentionStatus(past, NOW);
  assert.equal(s.expired, true);
  assert.ok(s.daysLeft <= 0);
});

test("retentionStatus: a fresh 6-year retention is ~2191+ days out and not expired", () => {
  const sixYears = new Date(Date.UTC(2032, 5, 21)).toISOString();
  const s = retentionStatus(sixYears, NOW);
  assert.equal(s.expired, false);
  assert.ok(s.daysLeft >= 2191, "expected >= 2191 days, got " + s.daysLeft);
});

test("rowToOffboarded maps DB row to a friendly record + rehydrates snapshot", () => {
  const row = {
    id: "11111111-1111-1111-1111-111111111111",
    offboarded_at: "2026-06-21T00:00:00Z",
    offboarded_by: "kofi@traqd.io",
    reason: "Engagement complete — AR recovered",
    final_notes: "clean handover",
    recovered_total: "4200",
    company: "Acme Ltd",
    email: "ar@acme.test",
    industry: "Logistics",
    approx_outstanding: "5000",
    retain_until: "2032-06-21T00:00:00Z",
    purged: false,
    snapshot: {
      id: "11111111-1111-1111-1111-111111111111",
      company: "Acme Ltd",
      email: "ar@acme.test",
      payment_platforms: ["Stripe"],
      crm: "HubSpot",
      approx_outstanding: 5000,
      guardrails: {},
      recovery_process: {},
    },
  };
  const o = rowToOffboarded(row);
  assert.equal(o.company, "Acme Ltd");
  assert.equal(o.recoveredTotal, 4200);          // coerced to number
  assert.equal(o.approxOutstanding, 5000);
  assert.equal(o.reason, "Engagement complete — AR recovered");
  assert.equal(o.purged, false);
  // snapshot rehydrated through rowToRecord
  assert.ok(o.record, "expected a rehydrated record");
  assert.equal(o.record.id, row.id);
  assert.equal(o.record.crm, "HubSpot");
  assert.deepEqual(o.record.paymentPlatforms, ["Stripe"]);
});

test("rowToOffboarded tolerates a missing/empty snapshot", () => {
  const o = rowToOffboarded({ id: "x", company: "NoSnap", recovered_total: 0, retain_until: "2030-01-01T00:00:00Z" });
  assert.equal(o.record, null);
  assert.equal(o.recoveredTotal, 0);
  assert.deepEqual(o.snapshot, {});
});
