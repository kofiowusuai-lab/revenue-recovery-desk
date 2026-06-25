#!/usr/bin/env node
/**
 * rrd-usage.mjs — per-client daily usage store for the Revenue Recovery Desk
 * guardrails layer. Backs enforceCaps() from rrd-guardrails.mjs: the send path
 * bumps counters here, the gate reads them. Counters auto-reset on a new local
 * day so caps mean "today" without a cron.
 *
 * Storage: ~/.openclaw/rrd-usage/<profile>.json  (chmod 600; atomic writes).
 * Override the dir with RRD_USAGE_DIR (used by tests so real data is untouched).
 * Zero npm deps, Node 18+, ESM.
 *
 *   import { loadUsage, bumpUsage, checkCaps } from "./rrd-usage.mjs";
 *   bumpUsage("rr-acme", { sends: 1 });
 *   checkCaps("rr-acme", { sendsToday: 50, spendTodayUsd: 100 });
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { enforceCaps } from "./rrd-guardrails.mjs";
import { assertSafeProfile } from "./rrd-profile-safety.mjs";

const FIELDS = ["sends", "letters", "spendUsd", "desktopMinutes"];

function usageDir(opts = {}) {
  return opts.dir || process.env.RRD_USAGE_DIR || path.join(os.homedir(), ".openclaw", "rrd-usage");
}
export function fileFor(profile, opts = {}) {
  return path.join(usageDir(opts), `${assertSafeProfile(profile || "rr-default")}.json`);
}
// local calendar date "YYYY-MM-DD" (matches the operator's wall clock, not UTC)
function today(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function zeroed(date) {
  return { date, sends: 0, letters: 0, spendUsd: 0, desktopMinutes: 0 };
}

// read the raw stored object, or null if missing/corrupt (fail-soft: treat as fresh)
function readRaw(profile) {
  const file = fileFor(profile);
  try {
    const txt = fs.readFileSync(file, "utf8");
    const obj = JSON.parse(txt);
    return obj && typeof obj === "object" ? obj : null;
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    if (e instanceof SyntaxError) {
      const quarantine = `${file}.corrupt.${Date.now()}`;
      try { fs.renameSync(file, quarantine); } catch { /* best effort */ }
      throw new Error(`Usage state is corrupt for ${profile}; quarantined at ${quarantine}. Recovery is blocked until reviewed.`);
    }
    throw e;
  }
}

function writeAtomic(profile, obj) {
  const dir = usageDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = fileFor(profile);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  return obj;
}

/**
 * Current usage for today. If the stored record is for an earlier day (or there
 * is none), returns a fresh zeroed object for today — this is also exactly what
 * gets persisted on the next bump, so caps reset cleanly at midnight.
 */
export function loadUsage(profile) {
  const day = today();
  const raw = readRaw(profile);
  if (!raw || raw.date !== day) return zeroed(day);
  return {
    date: day,
    sends: Number(raw.sends) || 0,
    letters: Number(raw.letters) || 0,
    spendUsd: Number(raw.spendUsd) || 0,
    desktopMinutes: Number(raw.desktopMinutes) || 0
  };
}

/**
 * Add `delta` ({sends?,letters?,spendUsd?,desktopMinutes?}) to today's usage and
 * persist atomically. Returns the new usage object.
 */
export function bumpUsage(profile, delta) {
  const cur = loadUsage(profile); // resets if stale
  const d = delta || {};
  for (const f of FIELDS) cur[f] = (Number(cur[f]) || 0) + (Number(d[f]) || 0);
  return writeAtomic(profile, cur);
}

/**
 * Evaluate today's usage against caps via enforceCaps(). Maps the stored usage
 * fields onto the cap keys enforceCaps expects:
 *   sends -> sendsToday, letters -> lettersToday,
 *   spendUsd -> spendTodayUsd, desktopMinutes -> desktopMinutesToday
 * Returns enforceCaps's { allowed, violations }.
 */
export function checkCaps(profile, caps) {
  const u = loadUsage(profile);
  return enforceCaps({
    sendsToday: u.sends,
    lettersToday: u.letters,
    spendTodayUsd: u.spendUsd,
    desktopMinutesToday: u.desktopMinutes
  }, caps || {});
}

/* ---------- optional CLI ---------- */
async function main() {
  const [, , method, profile, rawArg] = process.argv;
  if (!method || !profile) {
    console.error("usage: node rrd-usage.mjs <load|bump|check> <profile> [json]");
    process.exit(1);
  }
  let arg;
  if (rawArg != null && rawArg !== "") { try { arg = JSON.parse(rawArg); } catch { arg = rawArg; } }
  let out;
  if (method === "load") out = loadUsage(profile);
  else if (method === "bump") out = bumpUsage(profile, arg || {});
  else if (method === "check") out = checkCaps(profile, arg || {});
  else { console.error("unknown method: " + method); process.exit(1); }
  console.log(JSON.stringify(out, null, 2));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
