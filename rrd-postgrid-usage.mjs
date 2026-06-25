#!/usr/bin/env node
/**
 * rrd-postgrid-usage.mjs — non-secret PostGrid pass-through usage reports.
 *
 * Reads ledgers written by rrd-recover.mjs at:
 *   ~/.openclaw/rrd-postgrid-usage/<profile>.ndjson
 *
 * No API keys or message bodies are stored here; rows are attribution/billing metadata only.
 */
import fs from "node:fs";
import path from "node:path";

const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || "/Users/AIAgenterminal";
const DEFAULT_DIR = path.join(OPERATOR_HOME, ".openclaw", "rrd-postgrid-usage");

function readRows(dir = DEFAULT_DIR) {
  if (!fs.existsSync(dir)) return [];
  const rows = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".ndjson"))) {
    const profile = file.replace(/\.ndjson$/, "");
    const full = path.join(dir, file);
    for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { rows.push({ profile, ...JSON.parse(line) }); } catch { /* skip corrupt line */ }
    }
  }
  return rows.sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")));
}

function summarize(rows) {
  const byProfile = new Map();
  for (const r of rows) {
    const key = r.profile || "unknown";
    const cur = byProfile.get(key) || { profile: key, company: r.company || null, totalLetters: 0, sharedLetters: 0, clientKeyLetters: 0, passThroughUsd: 0, lastSentAt: null };
    cur.company ||= r.company || null;
    cur.totalLetters += 1;
    if (r.postgridKeySource === "shared") {
      cur.sharedLetters += 1;
      if (r.billableToClient) cur.passThroughUsd += Number(r.costUsd) || 0;
    }
    if (r.postgridKeySource === "client") cur.clientKeyLetters += 1;
    if (!cur.lastSentAt || String(r.ts || "") > String(cur.lastSentAt)) cur.lastSentAt = r.ts || null;
    byProfile.set(key, cur);
  }
  return [...byProfile.values()].sort((a, b) => a.profile.localeCompare(b.profile));
}

function usage() {
  console.error(`rrd-postgrid-usage — PostGrid billing attribution report\n\nUsage:\n  rrd-postgrid-usage summary [--json]\n  rrd-postgrid-usage rows [profile] [--json]\n`);
}

function printSummary(rows, json) {
  const summary = summarize(rows);
  if (json) return console.log(JSON.stringify(summary, null, 2));
  if (!summary.length) return console.log("No PostGrid usage rows found.");
  for (const s of summary) {
    console.log(`${s.profile}${s.company ? ` (${s.company})` : ""}`);
    console.log(`  total letters: ${s.totalLetters}`);
    console.log(`  shared-key letters: ${s.sharedLetters}`);
    console.log(`  client-key letters: ${s.clientKeyLetters}`);
    console.log(`  pass-through cost recorded: $${s.passThroughUsd.toFixed(2)}`);
    console.log(`  last sent: ${s.lastSentAt || "n/a"}`);
  }
}

function printRows(rows, profile, json) {
  const filtered = profile ? rows.filter((r) => r.profile === profile) : rows;
  if (json) return console.log(JSON.stringify(filtered, null, 2));
  if (!filtered.length) return console.log("No PostGrid usage rows found.");
  for (const r of filtered) {
    console.log(`${r.ts || "n/a"} ${r.profile || "unknown"} ${r.postgridKeySource || "unknown"} letter=${r.letterId || "n/a"} status=${r.providerStatus || "n/a"} billable=${!!r.billableToClient} cost=$${(Number(r.costUsd) || 0).toFixed(2)}`);
  }
}

const [, , cmd = "summary", arg1, arg2] = process.argv;
const json = [arg1, arg2].includes("--json");
const rows = readRows();
if (["-h", "--help", "help"].includes(cmd)) { usage(); process.exit(0); }
if (cmd === "summary") printSummary(rows, json);
else if (cmd === "rows") printRows(rows, arg1 && arg1 !== "--json" ? arg1 : null, json);
else { usage(); process.exit(1); }
