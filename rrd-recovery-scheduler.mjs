#!/usr/bin/env node
/**
 * rrd-recovery-scheduler — four-hour recovery-cycle runner for live clients.
 *
 * A profile is only included when explicitly enabled with:
 *   rrd-recovery-scheduler enable rr-acme --report-to finance@client.com
 *
 * Each run:
 * - checks the minimum-ready gate;
 * - runs the tracked recovery cycle (no duplicate invoice/rung drafts);
 * - marks disappeared overdue invoices as paid/resolved in the collections ledger;
 * - emails a concise work report to the client's report contact when configured.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { recover } from "./rrd-collect.mjs";
import { sendEmail } from "./rrd-email.mjs";
import { readEnvValue, profileEnvPath } from "./rrd-vault-fs.mjs";
import { withJobLock } from "./rrd-job-lock.mjs";
import { assertSafeProfile } from "./rrd-profile-safety.mjs";

const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || "/Users/AIAgenterminal";
const PROFILES_DIR = process.env.HERMES_PROFILES_DIR || path.join(OPERATOR_HOME, ".hermes", "profiles");
const SCHED_DIR = process.env.RRD_SCHEDULER_DIR || path.join(OPERATOR_HOME, ".openclaw", "rrd-schedules");
const READY = path.join(OPERATOR_HOME, "rrd-ready");
const BRAIN = path.join(OPERATOR_HOME, "rrd-brain");

function usage() {
  console.error(`rrd-recovery-scheduler

Usage:
  rrd-recovery-scheduler enable <profile> --report-to email [--mode local|orgo] [--every-hours 4] [--approved]
  rrd-recovery-scheduler disable <profile>
  rrd-recovery-scheduler list
  rrd-recovery-scheduler run [--all|<profile>] [--dry-run] [--no-report]

Default mode is orgo. Use local only for rr-test/demo profiles.`);
}
function ensureDir(d) { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); }
function configPath(profile) { return path.join(SCHED_DIR, `${assertSafeProfile(profile)}.json`); }
function loadJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function writeJson(file, obj) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(obj, null, 2)); fs.chmodSync(file, 0o600); }
function loadManifest(profile) { profile = assertSafeProfile(profile); return loadJson(path.join(PROFILES_DIR, profile, "manifest.json"), {}); }
function listEnabled() {
  ensureDir(SCHED_DIR);
  return fs.readdirSync(SCHED_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => loadJson(path.join(SCHED_DIR, f)))
    .filter(c => c && c.enabled)
    .map(c => ({ ...c, profile: assertSafeProfile(c.profile) }));
}
function argValue(argv, flag, fallback = null) { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : fallback; }
function readyStatus(profile) {
  profile = assertSafeProfile(profile);
  const p = spawnSync(READY, ["check", profile, "--allow-no-orgo"], { encoding: "utf8", timeout: 120000 });
  const out = (p.stdout || "") + (p.stderr || "");
  const status = /READY_EXCEPT_ORGO|READY|BLOCKED/.exec(out)?.[0] || (p.status === 0 ? "READY" : "BLOCKED");
  return { ok: status === "READY" || status === "READY_EXCEPT_ORGO", status, output: out.slice(0, 1200) };
}
function publicSupportEnv() {
  const env = { ...process.env };
  for (const file of [path.join(OPERATOR_HOME, ".openclaw", ".env"), path.join(OPERATOR_HOME, ".hermes", "profiles", "recoverydesk", ".env")]) {
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(k in env)) env[k] = v;
    }
  }
  env.RRD_SUPPORT_INBOX_ID ||= "support@flowaudit.co.uk";
  return env;
}
function summarize(profile, out, cfg = {}) {
  const company = out.company || loadManifest(profile).company || profile.replace(/^rr-/, "");
  const by = out.summary?.byOutcome || {};
  const lines = [];
  lines.push(`Revenue Recovery Desk update — ${company}`);
  lines.push("");
  lines.push(`Cycle time: ${new Date().toLocaleString()}`);
  lines.push(`Overdue accounts found: ${out.found ?? 0}`);
  lines.push(`New drafts/sends this cycle: ${(by.sent || 0) + (by.would_send || 0) + (by.blocked || 0)}`);
  lines.push(`Already tracked / not due yet: ${by.already_tracked || 0}`);
  lines.push(`Marked paid/resolved: ${by.closed || 0}`);
  lines.push(`Amount targeted this cycle: $${Number(out.summary?.targetedUsd || 0).toLocaleString("en-US")}`);
  if (Object.keys(out.summary?.blockedReasons || {}).length) lines.push(`Items needing review: ${Object.entries(out.summary.blockedReasons).map(([k,v]) => `${k}(${v})`).join(", ")}`);
  lines.push("");
  lines.push("Work log:");
  for (const r of out.results || []) {
    const ref = r.number || r.invoiceId;
    lines.push(`- ${ref}: ${r.outcome}${r.rung ? ` (${r.rung})` : ""}${r.amountUsd ? ` — $${Number(r.amountUsd).toLocaleString("en-US")}` : ""}${r.reason ? ` — ${r.reason}` : ""}`);
  }
  lines.push("");
  lines.push("We will continue checking on the agreed cadence and will stop chasing accounts once they are no longer overdue in the connected source system.");
  return { subject: `Revenue Recovery update — ${company}`, text: lines.join("\n") };
}
async function sendReport(profile, out, cfg) {
  profile = assertSafeProfile(profile);
  const envPath = profileEnvPath(profile, { home: OPERATOR_HOME });
  const to = cfg.reportTo || readEnvValue(envPath, "RRD_REPORT_TO_EMAIL") || readEnvValue(envPath, "CLIENT_REPORT_EMAIL") || readEnvValue(envPath, "PRIMARY_CONTACT_EMAIL");
  if (!to) return { skipped: true, reason: "no report contact configured" };
  const msg = summarize(profile, out, cfg);
  return sendEmail({ to: { email: to }, subject: msg.subject, text: msg.text }, { env: publicSupportEnv() });
}
async function runOne(profile, { dryRun = false, noReport = false } = {}) {
  profile = assertSafeProfile(profile);
  const cfg = loadJson(configPath(profile), {});
  if (!cfg.enabled) return { profile, skipped: true, reason: "not enabled" };
  const ready = readyStatus(profile);
  if (!ready.ok) return { profile, skipped: true, reason: `readiness ${ready.status}`, ready };
  if (dryRun) return { profile, dryRun: true, ready };
  let result;
  if ((cfg.mode || "orgo") === "orgo") {
    const p = spawnSync(BRAIN, ["cycle", profile], { encoding: "utf8", timeout: 1000 * 60 * 60 });
    result = { profile, mode: "orgo", exitCode: p.status, output: (p.stdout || "") + (p.stderr || "") };
  } else {
    Object.assign(process.env, publicSupportEnv());
    result = await recover(profile, { send: true, trackCollections: true, source: cfg.source || process.env.RRD_RECOVERY_SOURCE || "stripe", followUpDays: cfg.followUpDays || 7, approved: !!cfg.approved });
  }
  let report = null;
  if (!noReport && (cfg.mode || "orgo") !== "orgo") report = await sendReport(profile, result, cfg).catch(e => ({ error: e.message }));
  cfg.lastRunAt = new Date().toISOString();
  cfg.lastResult = { mode: cfg.mode || "orgo", report, summary: result.summary || null };
  writeJson(configPath(profile), cfg);
  return { profile, result, report };
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || argv.includes("--help")) { usage(); process.exit(cmd ? 0 : 1); }
  if (cmd === "enable") {
    const profile = assertSafeProfile(argv[1]); if (!profile) throw new Error("enable needs profile");
    const cfg = { enabled: true, profile, mode: argValue(argv, "--mode", "orgo"), everyHours: Number(argValue(argv, "--every-hours", 4)), reportTo: argValue(argv, "--report-to", null), followUpDays: Number(argValue(argv, "--follow-up-days", 7)), source: argValue(argv, "--source", "stripe"), approved: argv.includes("--approved"), updatedAt: new Date().toISOString() };
    writeJson(configPath(profile), cfg); console.log(JSON.stringify(cfg, null, 2)); return;
  }
  if (cmd === "disable") { const profile = assertSafeProfile(argv[1]); const cfg = loadJson(configPath(profile), { profile }); cfg.enabled = false; cfg.updatedAt = new Date().toISOString(); writeJson(configPath(profile), cfg); console.log(JSON.stringify(cfg, null, 2)); return; }
  if (cmd === "list") { console.log(JSON.stringify(listEnabled(), null, 2)); return; }
  if (cmd === "run") {
    const dryRun = argv.includes("--dry-run"); const noReport = argv.includes("--no-report");
    const targets = argv.includes("--all") ? listEnabled().map(c => c.profile) : [argv.find(a => a.startsWith("rr-"))].filter(Boolean).map(assertSafeProfile);
    const results = [];
    for (const profile of targets) results.push(await runOne(profile, { dryRun, noReport }));
    console.log(JSON.stringify({ ok: true, count: results.length, results }, null, 2)); return;
  }
  usage(); process.exit(1);
}
if (import.meta.url === `file://${process.argv[1]}`) withJobLock('rrd-recovery-scheduler', main, { staleMs: 2 * 60 * 60 * 1000 }).catch(e => { console.error(e.stack || e.message); process.exit(1); });
