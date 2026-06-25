#!/usr/bin/env node
/**
 * rrd-audit.mjs — append-only per-client decision log for the Revenue Recovery
 * Desk guardrails layer. Every gate decision (from auditEntry() in
 * rrd-guardrails.mjs, or any object) is appended as one NDJSON line. The drift
 * monitor tails these logs and rolls them up with auditStats().
 *
 * Storage: ~/.openclaw/rrd-audit/<profile>.ndjson  (chmod 600; append-only).
 * Override the dir with RRD_AUDIT_DIR (used by tests so real data is untouched).
 * Zero npm deps, Node 18+, ESM.
 *
 *   import { audit, readAudit, auditStats } from "./rrd-audit.mjs";
 *   audit("rr-acme", auditEntry({ profile, decision, action }));
 *   readAudit("rr-acme", { limit: 50 });
 *   auditStats("rr-acme", { sinceMs: 3600_000 });
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { assertSafeProfile } from "./rrd-profile-safety.mjs";

function auditDir() {
  return process.env.RRD_AUDIT_DIR || path.join(os.homedir(), ".openclaw", "rrd-audit");
}
function fileFor(profile) {
  return path.join(auditDir(), `${assertSafeProfile(profile || "rr-default")}.ndjson`);
}

/**
 * Append one entry as an NDJSON line. Stamps `at` (ISO) if the entry lacks one.
 * Accepts the object from auditEntry() or any plain object. Returns the entry
 * (with `at` filled in).
 */
export function audit(profile, entry) {
  const e = (entry && typeof entry === "object") ? { ...entry } : { value: entry };
  if (!e.at) e.at = new Date().toISOString();
  const dir = auditDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = fileFor(profile);
  fs.appendFileSync(file, JSON.stringify(e) + "\n", { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  return e;
}

// read + parse every NDJSON line, skipping blanks/corrupt lines (oldest first)
function parseAll(profile) {
  let txt;
  try { txt = fs.readFileSync(fileFor(profile), "utf8"); } catch { return []; }
  const out = [];
  for (const line of txt.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip malformed line */ }
  }
  return out;
}

/**
 * Return parsed entries, newest last (file order). Options:
 *   since — ISO string; keep only entries with .at >= since.
 *   limit — keep only the last N entries (after the since filter).
 */
export function readAudit(profile, { limit, since } = {}) {
  let rows = parseAll(profile);
  if (since) {
    const cut = new Date(since).getTime();
    if (Number.isFinite(cut)) rows = rows.filter((r) => r && r.at && new Date(r.at).getTime() >= cut);
  }
  if (limit != null && limit >= 0 && rows.length > limit) rows = rows.slice(rows.length - limit);
  return rows;
}

/**
 * Rollup over recent entries for the drift monitor, based on the auditEntry
 * shape (at, allowed, requiresHuman, violations[] of codes):
 *   { total, blocked, requiresHuman, byViolation:{CODE:count} }
 * Options: sinceMs — only count entries newer than now - sinceMs.
 */
export function auditStats(profile, { sinceMs } = {}) {
  let rows = parseAll(profile);
  if (sinceMs != null && sinceMs >= 0) {
    const cut = Date.now() - sinceMs;
    rows = rows.filter((r) => r && r.at && new Date(r.at).getTime() >= cut);
  }
  const stats = { total: 0, blocked: 0, requiresHuman: 0, byViolation: {} };
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    stats.total++;
    if (r.allowed === false) stats.blocked++;
    if (r.requiresHuman) stats.requiresHuman++;
    for (const code of (Array.isArray(r.violations) ? r.violations : [])) {
      stats.byViolation[code] = (stats.byViolation[code] || 0) + 1;
    }
  }
  return stats;
}

/* ---------- optional CLI ---------- */
async function main() {
  const [, , method, profile, rawArg] = process.argv;
  if (!method || !profile) {
    console.error("usage: node rrd-audit.mjs <write|read|stats> <profile> [json]");
    process.exit(1);
  }
  let arg;
  if (rawArg != null && rawArg !== "") { try { arg = JSON.parse(rawArg); } catch { arg = rawArg; } }
  let out;
  if (method === "write") out = audit(profile, arg || {});
  else if (method === "read") out = readAudit(profile, arg || {});
  else if (method === "stats") out = auditStats(profile, arg || {});
  else { console.error("unknown method: " + method); process.exit(1); }
  console.log(JSON.stringify(out, null, 2));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
