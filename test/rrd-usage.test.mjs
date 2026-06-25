import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// isolate storage to a throwaway temp dir before importing the module
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "rrd-usage-test-"));
process.env.RRD_USAGE_DIR = TMP;

const { loadUsage, bumpUsage, checkCaps } = await import("../rrd-usage.mjs");

function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

beforeEach(() => {
  // clean the temp dir between tests so each starts from zero
  for (const f of fs.readdirSync(TMP)) fs.rmSync(path.join(TMP, f), { force: true });
});

after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

test("loadUsage returns a fresh zeroed object for today when nothing stored", () => {
  const u = loadUsage("rr-fresh");
  assert.equal(u.date, todayStr());
  assert.deepEqual({ sends: u.sends, letters: u.letters, spendUsd: u.spendUsd, desktopMinutes: u.desktopMinutes }, { sends: 0, letters: 0, spendUsd: 0, desktopMinutes: 0 });
});

test("bumpUsage increments fields and persists", () => {
  const a = bumpUsage("rr-acme", { sends: 1, spendUsd: 12.5 });
  assert.equal(a.sends, 1);
  assert.equal(a.spendUsd, 12.5);
  assert.equal(a.letters, 0);
  const b = bumpUsage("rr-acme", { sends: 2, letters: 1, desktopMinutes: 5 });
  assert.equal(b.sends, 3);
  assert.equal(b.letters, 1);
  assert.equal(b.desktopMinutes, 5);
  assert.equal(b.spendUsd, 12.5);
  // survives a fresh load (was persisted)
  const reloaded = loadUsage("rr-acme");
  assert.equal(reloaded.sends, 3);
  assert.equal(reloaded.spendUsd, 12.5);
});

test("bumpUsage writes the file chmod 600", () => {
  bumpUsage("rr-perm", { sends: 1 });
  const mode = fs.statSync(path.join(TMP, "rr-perm.json")).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("loadUsage resets when the stored date differs from today", () => {
  // hand-write a record dated in the past with non-zero counters
  const stale = { date: "2000-01-01", sends: 99, letters: 7, spendUsd: 500, desktopMinutes: 300 };
  fs.writeFileSync(path.join(TMP, "rr-stale.json"), JSON.stringify(stale), { mode: 0o600 });
  const u = loadUsage("rr-stale");
  assert.equal(u.date, todayStr());
  assert.equal(u.sends, 0);
  assert.equal(u.letters, 0);
  assert.equal(u.spendUsd, 0);
  assert.equal(u.desktopMinutes, 0);
});

test("bumpUsage after a stale day starts from zero (daily reset persists)", () => {
  const stale = { date: "2000-01-01", sends: 99, letters: 7, spendUsd: 500, desktopMinutes: 300 };
  fs.writeFileSync(path.join(TMP, "rr-roll.json"), JSON.stringify(stale), { mode: 0o600 });
  const u = bumpUsage("rr-roll", { sends: 1 });
  assert.equal(u.date, todayStr());
  assert.equal(u.sends, 1); // not 100
});

test("checkCaps allows under the limit", () => {
  bumpUsage("rr-under", { sends: 3, spendUsd: 10 });
  const r = checkCaps("rr-under", { sendsToday: 50, spendTodayUsd: 100 });
  assert.equal(r.allowed, true);
  assert.deepEqual(r.violations, []);
});

test("checkCaps blocks at the limit (>=)", () => {
  bumpUsage("rr-at", { sends: 50 });
  const r = checkCaps("rr-at", { sendsToday: 50 });
  assert.equal(r.allowed, false);
  assert.ok(r.violations.some((v) => v.code === "CAP_SENDSTODAY"));
});

test("checkCaps blocks over the limit on multiple fields", () => {
  bumpUsage("rr-over", { sends: 60, letters: 5, spendUsd: 200, desktopMinutes: 480 });
  const r = checkCaps("rr-over", { sendsToday: 50, lettersToday: 5, spendTodayUsd: 100, desktopMinutesToday: 240 });
  assert.equal(r.allowed, false);
  const codes = r.violations.map((v) => v.code).sort();
  assert.deepEqual(codes, ["CAP_DESKTOPMINUTESTODAY", "CAP_LETTERSTODAY", "CAP_SENDSTODAY", "CAP_SPENDTODAYUSD"]);
});

test("checkCaps with no caps allows everything", () => {
  bumpUsage("rr-nocap", { sends: 9999 });
  const r = checkCaps("rr-nocap", {});
  assert.equal(r.allowed, true);
});
