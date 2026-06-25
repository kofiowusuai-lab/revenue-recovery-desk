import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// isolate storage to a throwaway temp dir before importing the module
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "rrd-audit-test-"));
process.env.RRD_AUDIT_DIR = TMP;

const { audit, readAudit, auditStats } = await import("../rrd-audit.mjs");

beforeEach(() => {
  for (const f of fs.readdirSync(TMP)) fs.rmSync(path.join(TMP, f), { force: true });
});
after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

test("audit() appends and readAudit() round-trips (newest last)", () => {
  audit("rr-acme", { at: "2026-06-21T01:00:00.000Z", kind: "send", allowed: true, violations: [] });
  audit("rr-acme", { at: "2026-06-21T02:00:00.000Z", kind: "send", allowed: false, violations: ["DO_NOT_CONTACT"] });
  const rows = readAudit("rr-acme");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].at, "2026-06-21T01:00:00.000Z");
  assert.equal(rows[1].at, "2026-06-21T02:00:00.000Z"); // newest last
  assert.equal(rows[1].allowed, false);
});

test("audit() stamps `at` when missing", () => {
  const before = Date.now();
  const e = audit("rr-stamp", { kind: "send", allowed: true });
  assert.ok(e.at, "entry got an at");
  const t = new Date(e.at).getTime();
  assert.ok(t >= before - 1000 && t <= Date.now() + 1000);
  const rows = readAudit("rr-stamp");
  assert.equal(rows[0].at, e.at);
});

test("audit() preserves an existing `at`", () => {
  const e = audit("rr-keep", { at: "2020-01-01T00:00:00.000Z", allowed: true });
  assert.equal(e.at, "2020-01-01T00:00:00.000Z");
});

test("audit file is chmod 600", () => {
  audit("rr-perm", { allowed: true });
  const mode = fs.statSync(path.join(TMP, "rr-perm.ndjson")).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("readAudit limit keeps the last N", () => {
  for (let i = 1; i <= 5; i++) audit("rr-lim", { at: `2026-06-21T0${i}:00:00.000Z`, allowed: true });
  const rows = readAudit("rr-lim", { limit: 2 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].at, "2026-06-21T04:00:00.000Z");
  assert.equal(rows[1].at, "2026-06-21T05:00:00.000Z");
});

test("readAudit since filters by .at", () => {
  audit("rr-since", { at: "2026-06-20T00:00:00.000Z", allowed: true });
  audit("rr-since", { at: "2026-06-21T00:00:00.000Z", allowed: true });
  audit("rr-since", { at: "2026-06-22T00:00:00.000Z", allowed: true });
  const rows = readAudit("rr-since", { since: "2026-06-21T00:00:00.000Z" });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].at, "2026-06-21T00:00:00.000Z");
});

test("readAudit on a missing profile returns []", () => {
  assert.deepEqual(readAudit("rr-nope"), []);
});

test("readAudit skips malformed lines", () => {
  const file = path.join(TMP, "rr-corrupt.ndjson");
  fs.writeFileSync(file, '{"at":"2026-06-21T01:00:00.000Z","allowed":true}\nNOT JSON\n{"at":"2026-06-21T02:00:00.000Z","allowed":false,"violations":["NO_CONSENT"]}\n');
  const rows = readAudit("rr-corrupt");
  assert.equal(rows.length, 2);
});

test("auditStats counts total, blocked, requiresHuman, byViolation", () => {
  audit("rr-stats", { at: "2026-06-21T01:00:00.000Z", allowed: true, requiresHuman: false, violations: [] });
  audit("rr-stats", { at: "2026-06-21T02:00:00.000Z", allowed: false, requiresHuman: true, violations: ["DO_NOT_CONTACT"] });
  audit("rr-stats", { at: "2026-06-21T03:00:00.000Z", allowed: false, requiresHuman: false, violations: ["OUTSIDE_HOURS", "BATCH_EXCEEDED"] });
  audit("rr-stats", { at: "2026-06-21T04:00:00.000Z", allowed: false, requiresHuman: true, violations: ["DO_NOT_CONTACT", "NO_CONSENT"] });
  const s = auditStats("rr-stats");
  assert.equal(s.total, 4);
  assert.equal(s.blocked, 3);
  assert.equal(s.requiresHuman, 2);
  assert.deepEqual(s.byViolation, {
    DO_NOT_CONTACT: 2,
    OUTSIDE_HOURS: 1,
    BATCH_EXCEEDED: 1,
    NO_CONSENT: 1
  });
});

test("auditStats sinceMs only counts recent entries", () => {
  const now = Date.now();
  audit("rr-recent", { at: new Date(now - 7200_000).toISOString(), allowed: false, violations: ["NO_CONSENT"] }); // 2h ago
  audit("rr-recent", { at: new Date(now - 600_000).toISOString(), allowed: false, violations: ["OUTSIDE_HOURS"] }); // 10m ago
  const s = auditStats("rr-recent", { sinceMs: 3600_000 }); // last hour
  assert.equal(s.total, 1);
  assert.equal(s.blocked, 1);
  assert.deepEqual(s.byViolation, { OUTSIDE_HOURS: 1 });
});

test("auditStats on a missing profile returns zeros", () => {
  const s = auditStats("rr-empty");
  assert.deepEqual(s, { total: 0, blocked: 0, requiresHuman: 0, byViolation: {} });
});
