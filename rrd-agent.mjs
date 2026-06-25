#!/usr/bin/env node
/**
 * rrd-agent.mjs — out-of-process agent client for the Revenue Recovery Desk.
 *
 * Talks straight to your Supabase project's REST API with a service-role key.
 * No browser, zero npm deps (Node 18+ global fetch). Shares mapping + Hermes
 * pack logic with the dashboard via ./rrd-hermes.mjs.
 *
 *   export SUPABASE_URL="https://YOUR-REF.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="service-role-secret"   # Settings → API
 *
 *   node rrd-agent.mjs stats
 *   node rrd-agent.mjs list
 *   node rrd-agent.mjs query '{"where":{"integrationReady":true},"sort":"-outstanding"}'
 *   node rrd-agent.mjs search '"stripe"'
 *   node rrd-agent.mjs aggregate '{"groupBy":"industry","op":"sumOutstanding"}'
 *   node rrd-agent.mjs get '"<uuid>"'
 *   node rrd-agent.mjs pack '"<uuid>"'           # emit the Hermes profile pack as JSON
 *   node rrd-agent.mjs export json > book.json
 *   node rrd-agent.mjs add '{"company":"Imported Co","industry":"Logistics"}'
 *   node rrd-agent.mjs remove '"<uuid>"'
 *   node rrd-agent.mjs help
 *
 * Service-role key bypasses RLS — keep it server-side only, never in a browser.
 */

import { rowToRecord, recordToRow, buildHermesPack, rowToOffboarded, retentionStatus, RETENTION_YEARS, slug } from "./rrd-hermes.mjs";
import { assertSafeProfile } from "./rrd-profile-safety.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "";
const TABLE = "submissions";
const ARCHIVE = "offboarded_clients";
const BUCKET = "onboarding-docs";

const METHODS = new Set(["stats", "list", "get", "query", "search", "count", "aggregate", "pack", "add", "upsert", "remove", "clear", "export", "import", "help", "schema", "offboard", "offboarded", "getOffboarded", "retention", "purge", "purgeCredentials", "activeProfiles"]);
const PRIORITY_ORDER = { "Critical": 0, "High": 1, "Medium": 2, "Just exploring": 3 };

function usage() {
  console.error(`rrd-agent — query the Revenue Recovery Desk via Supabase

Usage:  node rrd-agent.mjs <method> [jsonArg]

Methods: ${[...METHODS].join(", ")}

Setup:
  export SUPABASE_URL="https://YOUR-REF.supabase.co"
  export SUPABASE_SERVICE_ROLE_KEY="service-role-secret"

Examples:
  node rrd-agent.mjs stats
  node rrd-agent.mjs query '{"where":{"integrationReady":true}}'
  node rrd-agent.mjs pack '"<uuid>"' > pack.json`);
}
function need() { if (!URL_BASE || !KEY) throw new Error("Missing config. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Supabase → Project Settings → API)."); }

async function rest(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
async function fetchAll() {
  const rows = await rest(`${TABLE}?select=*&order=created_at.desc`);
  return (rows || []).map(rowToRecord);
}

/* ---------- offboarding / retention helpers ---------- */
async function rpc(fn, body) {
  return rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(body || {}) });
}
async function fetchOffboarded(filter = "") {
  const rows = await rest(`${ARCHIVE}?select=*${filter}&order=offboarded_at.desc`);
  return (rows || []).map(rowToOffboarded);
}
// delete uploaded docs for an archive row from private Storage (paths from the snapshot)
async function deleteStorageDocs(paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return 0;
  const res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: list })
  });
  if (!res.ok) throw new Error(`Storage delete ${res.status}: ${await res.text()}`);
  return list.length;
}
function docPathsOf(snapshot) { return ((snapshot && snapshot.documents) || []).map((d) => d && d.path).filter(Boolean); }

// Best-effort teardown of a client's Orgo cloud desktop on offboard (never blocks the DB offboard).
function destroyOrgo(profileName) {
  const wrapper = path.join(os.homedir(), "rrd-orgo");
  try {
    const out = execFileSync(wrapper, ["destroy", profileName], { encoding: "utf8" });
    try { return JSON.parse(out); } catch { return { destroyed: true }; }
  } catch (e) {
    return { destroyed: false, error: (e && e.stdout ? String(e.stdout).trim().split("\n").slice(-1)[0] : (e && e.message) || String(e)) };
  }
}

function sameFileIdentity(a, b) {
  return !!a && !!b && a.dev === b.dev && a.ino === b.ino;
}

function overwriteAndUnlink(file, opts = {}) {
  const root = opts.root ? path.resolve(opts.root) : null;
  if (root && !assertNoSymlinkComponents(root, path.dirname(file), "credential file parent")) {
    return { file, existed: false, removed: false };
  }
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (e) { if (e?.code === "ENOENT") return { file, existed: false, removed: false }; throw e; }
  if (stat.isSymbolicLink()) {
    if (root && !assertNoSymlinkComponents(root, path.dirname(file), "credential file parent")) {
      return { file, existed: true, removed: false, error: "credential parent changed before unlink" };
    }
    fs.unlinkSync(file);
    return { file, existed: true, removed: true, skippedOverwrite: "symlink" };
  }
  if (!stat.isFile()) return { file, existed: true, removed: false, skipped: "not_a_file" };
  try {
    const flags = fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW || 0);
    const fd = fs.openSync(file, flags);
    try {
      const opened = fs.fstatSync(fd);
      if (!sameFileIdentity(opened, stat)) throw Object.assign(new Error("credential file changed before overwrite"), { code: "CREDENTIAL_RACE" });
      const size = Math.max(1, opened.size || 1);
      fs.writeSync(fd, Buffer.alloc(size, 0), 0, size, 0);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    if (["ELOOP", "EMLINK"].includes(e?.code)) {
      if (root && !assertNoSymlinkComponents(root, path.dirname(file), "credential file parent")) {
        return { file, existed: true, removed: false, error: "credential parent changed before unlink" };
      }
      try { fs.unlinkSync(file); } catch (unlinkErr) { if (unlinkErr?.code !== "ENOENT") throw unlinkErr; }
      return { file, existed: true, removed: true, skippedOverwrite: "symlink" };
    }
    return { file, existed: true, removed: false, error: e?.message || String(e) };
  }
  if (root && !assertNoSymlinkComponents(root, path.dirname(file), "credential file parent")) {
    return { file, existed: true, removed: false, error: "credential parent changed before unlink" };
  }
  const after = fs.lstatSync(file);
  if (!sameFileIdentity(after, stat)) return { file, existed: true, removed: false, error: "credential file changed before unlink" };
  fs.unlinkSync(file);
  return { file, existed: true, removed: true };
}

function assertNoSymlinkComponents(root, target, label) {
  const absRoot = path.resolve(root);
  const absTarget = path.resolve(target);
  if (absTarget !== absRoot && !absTarget.startsWith(absRoot + path.sep)) throw new Error(`Unsafe ${label}: outside credential root`);
  const rel = path.relative(absRoot, absTarget);
  let cur = absRoot;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    try {
      const stat = fs.lstatSync(cur);
      if (stat.isSymbolicLink()) throw new Error(`Unsafe ${label}: credential path component is a symlink`);
    } catch (e) {
      if (e?.code === "ENOENT") return false;
      throw e;
    }
  }
  return true;
}

function assertSafeCredentialDir(root, dir, label) {
  if (!assertNoSymlinkComponents(root, dir, label)) return false;
  try {
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink()) throw new Error(`Unsafe ${label}: credential directory is a symlink`);
    if (!stat.isDirectory()) throw new Error(`Unsafe ${label}: credential path is not a directory`);
    return true;
  } catch (e) {
    if (e?.code === "ENOENT") return false;
    throw e;
  }
}

function isEnvCredentialName(name) {
  return name === ".env"
    || name === ".env~"
    || name.startsWith(".env.")
    || name.startsWith(".env-");
}

function isVaultKeyCredentialName(name, profileName) {
  for (const base of [`${profileName}.pem`, `${profileName}.pub.pem`]) {
    if (!name.startsWith(base)) continue;
    if (name === base) return true;
    const suffix = name.slice(base.length);
    if (suffix && [".", "-", "~"].includes(suffix[0])) return true;
  }
  return false;
}

function credentialFilesForProfile(profileName, opts = {}) {
  profileName = assertSafeProfile(profileName);
  const home = opts.home || "/Users/AIAgenterminal";
  const profileDir = path.join(home, ".hermes", "profiles", profileName);
  const vaultKeyDir = path.join(home, ".hermes", "vault", "keys");
  const files = new Set();
  if (assertSafeCredentialDir(home, profileDir, "profile directory")) {
    files.add(path.join(profileDir, ".env"));
    files.add(path.join(profileDir, ".env.bak"));
    for (const name of fs.readdirSync(profileDir)) {
      if (isEnvCredentialName(name)) {
        files.add(path.join(profileDir, name));
      }
    }
  }
  if (assertSafeCredentialDir(home, vaultKeyDir, "vault key directory")) {
    files.add(path.join(vaultKeyDir, `${profileName}.pem`));
    files.add(path.join(vaultKeyDir, `${profileName}.pub.pem`));
    for (const name of fs.readdirSync(vaultKeyDir)) {
      if (isVaultKeyCredentialName(name, profileName)) {
        files.add(path.join(vaultKeyDir, name));
      }
    }
  }
  return [...files].sort();
}

function credentialRemovalFailed(result) {
  return !!result?.error || (result?.existed === true && result?.removed !== true);
}

async function destroyProfileCredentials(profileName) {
  profileName = assertSafeProfile(profileName);
  const removedFiles = [];
  for (const f of credentialFilesForProfile(profileName)) {
    try { removedFiles.push(overwriteAndUnlink(f, { root: "/Users/AIAgenterminal" })); }
    catch (e) { removedFiles.push({ file: f, existed: true, removed: false, error: e.message }); }
  }
  const localFailures = removedFiles.filter(credentialRemovalFailed);
  if (localFailures.length) {
    return { ok: false, profileName, removedFiles, vaultDropsDestroyed: 0, supabaseVaultCleanup: { ok: false, skipped: true, error: "local credential deletion failed" } };
  }

  let vaultDropsDestroyed = 0;
  try {
    const rows = await rest(`vault_drops?profile=eq.${encodeURIComponent(profileName)}&select=id`);
    vaultDropsDestroyed = (rows || []).length;
    if (vaultDropsDestroyed) {
      await rest(`vault_drops?profile=eq.${encodeURIComponent(profileName)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "consumed", consumed_at: new Date().toISOString(), ciphertext: null }),
      });
    }
  } catch (e) {
    // Older deployments may not have vault_drops in the schema; report without blocking offboard.
    return { ok: false, profileName, removedFiles, vaultDropsDestroyed, supabaseVaultCleanup: { ok: false, error: e.message } };
  }
  return { ok: true, profileName, removedFiles, vaultDropsDestroyed, supabaseVaultCleanup: { ok: true } };
}

/* ---------- local query logic (mirrors the in-page harness) ---------- */
function recordText(s) {
  const parts = [s.company, s.contactName, s.email, s.phone, s.industry, s.size, s.website, s.crm, s.catalyst, s.anythingElse, s.primaryContact];
  [s.businessProfile, s.paymentStack, s.crmData, s.recoveryProcess, s.outreach, s.guardrails, s.goals].forEach((o) => { if (o) Object.values(o).forEach((v) => parts.push(Array.isArray(v) ? v.join(" ") : v)); });
  (s.contacts || []).forEach((c) => parts.push(c.name, c.role, c.email));
  (s.paymentPlatforms || []).forEach((p) => parts.push(p));
  return parts.filter(Boolean).join(" ").toLowerCase();
}
function matchWhere(s, w) {
  if (!w || typeof w !== "object") return true;
  const inList = (v, c) => Array.isArray(c) ? c.includes(v) : v === c;
  if (w.id != null && s.id !== w.id) return false;
  if (w.urgency != null && !inList(s.urgency, w.urgency)) return false;
  if (w.priority != null && !inList(s.priority, w.priority)) return false;
  if (w.industry != null && !inList(s.industry, w.industry)) return false;
  if (w.size != null && !inList(s.size, w.size)) return false;
  if (w.crm != null && !inList(s.crm, w.crm)) return false;
  if (w.paymentPlatform != null) { const pw = Array.isArray(w.paymentPlatform) ? w.paymentPlatform : [w.paymentPlatform]; if (!pw.some((p) => (s.paymentPlatforms || []).includes(p))) return false; }
  if (w.hasSop != null && s.hasSop !== w.hasSop) return false;
  if (w.needsSop != null && s.needsSop !== w.needsSop) return false;
  if (w.wantsSopBuilt != null && s.wantsSopBuilt !== w.wantsSopBuilt) return false;
  if (w.fullAutomation != null && s.fullAutomation !== w.fullAutomation) return false;
  if (w.integrationReady != null && s.integrationReady !== w.integrationReady) return false;
  if (w.consent != null && s.consent !== w.consent) return false;
  if (w.minOutstanding != null && s.approxOutstanding < w.minOutstanding) return false;
  if (w.maxOutstanding != null && s.approxOutstanding > w.maxOutstanding) return false;
  if (w.since != null && new Date(s.submittedAt) < new Date(w.since)) return false;
  if (w.until != null && new Date(s.submittedAt) > new Date(w.until)) return false;
  if (w.text != null && !recordText(s).includes(String(w.text).toLowerCase())) return false;
  return true;
}
function sortRecords(arr, sort) {
  if (!sort) return arr;
  const desc = sort[0] === "-", key = desc ? sort.slice(1) : sort;
  const val = (s) => key === "outstanding" ? s.approxOutstanding : key === "submittedAt" ? new Date(s.submittedAt).getTime() : key === "priority" ? (PRIORITY_ORDER[s.priority] ?? 9) : (s[key] != null ? String(s[key]).toLowerCase() : "");
  return arr.slice().sort((a, b) => { const va = val(a), vb = val(b); if (va < vb) return desc ? 1 : -1; if (va > vb) return desc ? -1 : 1; return 0; });
}
function project(s, fields) { if (!fields || !fields.length) return s; const o = {}; fields.forEach((f) => o[f] = s[f]); return o; }

function csvCell(v) { let s = String(v == null ? "" : v); if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'; return s; }
function buildCSV(list) {
  const headers = ["ID", "Submitted", "Company", "Contact", "Email", "Phone", "Industry", "Size", "Priority", "ApproxOutstanding", "PaymentPlatforms", "PaymentAPIAccess", "CRM", "CRMAPIAccess", "IntegrationReady", "HasSOP", "Cadence", "ApprovalModel", "BatchSize", "PrimaryGoal", "PrimaryContact", "Consent", "DocCount"];
  const lines = [headers.map(csvCell).join(",")];
  list.forEach((s) => {
    const rp = s.recoveryProcess || {}, ps = s.paymentStack || {}, cd = s.crmData || {}, g = s.guardrails || {}, go = s.goals || {};
    lines.push([s.id, s.submittedAt, s.company, s.contactName, s.email, s.phone, s.industry, s.size, s.priority, s.approxOutstanding, (s.paymentPlatforms || []).join(" | "), ps.apiAccess, s.crm, cd.apiAccess, s.integrationReady, s.hasSop, rp.cadence, g.approvalModel, g.batchSize, go.primaryGoal, s.primaryContact, s.consent, (s.documents || []).length].map(csvCell).join(","));
  });
  return lines.join("\r\n");
}

const MANIFEST = {
  name: "revenue-recovery-desk", backend: "Supabase REST (service-role)",
  methods: [["stats", "totals, readiness, breakdowns"], ["list(filter?)", "all businesses"], ["get(id)", "one business"], ["query(spec)", "where/search/sort/limit/fields"], ["search(text)", "full-text"], ["count(filter?)", "count matching"], ["aggregate(spec)", "groupBy + count/sumOutstanding/avgOutstanding"], ["pack(id)", "Hermes profile pack (SOUL/MEMORY/USER/manifest)"], ["add(record)", "insert"], ["upsert(record)", "insert or update by id"], ["remove(id)", "delete by id"], ["clear()", "delete all"], ["export(format)", "json | ndjson | csv"], ["offboard(id|spec)", "move a client to the archive, destroy profile credentials/vault ciphertext, tear down computer; snapshots + retains 6 years"], ["purgeCredentials(profile)", "destroy a profile .env, vault private key, and Supabase vault ciphertext without offboarding"], ["offboarded()", "list archived clients with retention status"], ["getOffboarded(id)", "one archived client (full snapshot)"], ["retention()", "retention report: expired + expiring-within-90-days"], ["purge(--dry-run?)", "hard-delete archive rows past their 6-year retention + their storage docs"]],
  whereFields: ["id", "priority", "urgency", "industry", "size", "crm", "paymentPlatform", "hasSop", "needsSop", "wantsSopBuilt", "fullAutomation", "integrationReady", "consent", "minOutstanding", "maxOutstanding", "since", "until", "text"],
  retentionYears: RETENTION_YEARS
};

async function run(method, arg) {
  if (method === "help" || method === "schema") return MANIFEST;
  need();

  if (method === "add" || method === "upsert") {
    const prefer = method === "upsert" ? "resolution=merge-duplicates,return=representation" : "return=representation";
    const onConflict = method === "upsert" ? "&on_conflict=id" : "";
    const res = await rest(`${TABLE}?select=*${onConflict}`, { method: "POST", headers: { Prefer: prefer }, body: JSON.stringify(recordToRow(arg || {})) });
    return Array.isArray(res) ? res.map(rowToRecord) : res;
  }
  if (method === "import") {
    if (!Array.isArray(arg)) throw new Error("import expects a JSON array");
    const res = await rest(`${TABLE}?select=id`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(arg.map(recordToRow)) });
    return { inserted: (res || []).length };
  }
  if (method === "remove") { if (!arg) throw new Error("remove expects an id"); await rest(`${TABLE}?id=eq.${encodeURIComponent(arg)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); return { removed: arg }; }
  if (method === "clear") { await rest(`${TABLE}?id=not.is.null`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); return { cleared: true }; }

  /* ---------- offboarding + retention ---------- */
  if (method === "offboard") {
    // arg: "<id>"  OR  {id, reason, notes, recovered}
    const spec = typeof arg === "string" ? { id: arg } : (arg || {});
    if (!spec.id) throw new Error('offboard expects an id, e.g. offboard \'"<uuid>"\' or \'{"id":"<uuid>","reason":"…","recovered":1200}\'');
    const row = await rpc("offboard_submission", { p_id: spec.id, p_reason: spec.reason || null, p_notes: spec.notes || spec.finalNotes || null, p_recovered: Number(spec.recovered || spec.recoveredTotal) || 0 });
    const rec = Array.isArray(row) ? row[0] : row;
    if (!rec) throw new Error("offboard returned no row — check the id exists in submissions");
    // tear down the client's Orgo cloud desktop (opt out with keepComputer:true)
    const profileName = "rr-" + slug(rec.company || rec.email);
    let orgo = { skipped: true };
    if (!spec.keepComputer) orgo = destroyOrgo(profileName);
    const credentials = spec.keepCredentials ? { ok: true, skipped: true } : await destroyProfileCredentials(profileName);
    if (!credentials.ok) throw new Error(`credential destruction failed for ${profileName}: ${credentials.supabaseVaultCleanup?.error || 'local credential deletion failed'}`);
    return { offboarded: true, ...rowToOffboarded(rec), retention: retentionStatus(rec.retain_until), orgoTeardown: orgo, credentialDestruction: credentials };
  }
  if (method === "purgeCredentials") {
    const profileName = typeof arg === "string" ? arg : (arg && (arg.profile || arg.profileName));
    if (!profileName) throw new Error('purgeCredentials expects a profile name, e.g. purgeCredentials "rr-acme"');
    const result = await destroyProfileCredentials(profileName);
    if (!result.ok) throw new Error(`credential destruction failed for ${profileName}: ${result.supabaseVaultCleanup?.error || 'local credential deletion failed'}`);
    return result;
  }
  if (method === "offboarded") {
    const list = await fetchOffboarded();
    return list.map((o) => ({ ...o, retention: retentionStatus(o.retainUntil) }));
  }
  if (method === "getOffboarded") {
    if (!arg) throw new Error("getOffboarded expects an id");
    const list = await fetchOffboarded(`&id=eq.${encodeURIComponent(arg)}`);
    if (!list.length) return null;
    return { ...list[0], retention: retentionStatus(list[0].retainUntil) };
  }
  if (method === "retention") {
    const list = await fetchOffboarded();
    const withStatus = list.map((o) => ({ id: o.id, company: o.company, offboardedAt: o.offboardedAt, retainUntil: o.retainUntil, ...retentionStatus(o.retainUntil) }));
    const expired = withStatus.filter((o) => o.expired);
    const soon = withStatus.filter((o) => !o.expired && o.daysLeft <= 90);
    return { retentionYears: RETENTION_YEARS, archived: list.length, expired: expired.length, expiringWithin90Days: soon.length, expiredRecords: expired, expiringSoon: soon, all: withStatus };
  }
  if (method === "purge") {
    const dryRun = arg === "--dry-run" || (arg && arg.dryRun);
    const expired = await fetchOffboarded(`&retain_until=lt.${encodeURIComponent(new Date().toISOString())}`);
    if (dryRun) return { dryRun: true, wouldPurge: expired.length, records: expired.map((o) => ({ id: o.id, company: o.company, retainUntil: o.retainUntil, docs: docPathsOf(o.snapshot).length })) };
    let docsDeleted = 0;
    for (const o of expired) { try { docsDeleted += await deleteStorageDocs(docPathsOf(o.snapshot)); } catch (e) { console.error("doc cleanup warning for " + o.id + ": " + (e && e.message || e)); } }
    const deleted = await rpc("purge_expired_offboarded", {});
    const rows = Array.isArray(deleted) ? deleted : (deleted ? [deleted] : []);
    return { purged: rows.length, docsDeleted, records: rows };
  }

  const all = await fetchAll();
  if (method === "activeProfiles") return [...new Set(all.map((s) => "rr-" + slug(s.company || s.email)))];
  if (method === "list") return all.filter((s) => matchWhere(s, arg));
  if (method === "count") return all.filter((s) => matchWhere(s, arg)).length;
  if (method === "get") return all.find((s) => s.id === arg) || null;
  if (method === "pack") { const rec = all.find((s) => s.id === arg); if (!rec) throw new Error("no record with id " + arg); return buildHermesPack(rec); }
  if (method === "search") { const q = String(arg || "").toLowerCase(); return all.filter((s) => recordText(s).includes(q)); }
  if (method === "export") { const fmt = arg || "json"; if (fmt === "csv") return buildCSV(all); if (fmt === "ndjson") return all.map((s) => JSON.stringify(s)).join("\n"); return JSON.stringify(all, null, 2); }
  if (method === "stats") {
    const totalOverdue = all.reduce((a, s) => a + (s.approxOutstanding || 0), 0);
    const tally = (f) => all.reduce((m, s) => { const k = f(s) || "—"; m[k] = (m[k] || 0) + 1; return m; }, {});
    const byPlatform = {}; all.forEach((s) => (s.paymentPlatforms || []).forEach((p) => byPlatform[p] = (byPlatform[p] || 0) + 1));
    return { totalSubmissions: all.length, totalApproxOverdue: totalOverdue, integrationReady: all.filter((s) => s.integrationReady).length, withSop: all.filter((s) => s.hasSop).length, criticalOrHigh: all.filter((s) => s.priority === "Critical" || s.priority === "High").length, byPriority: tally((s) => s.priority), byIndustry: tally((s) => s.industry), byCrm: tally((s) => s.crm), byPaymentPlatform: byPlatform };
  }
  if (method === "aggregate") {
    const spec = arg || {}, gby = spec.groupBy || "priority", op = spec.op || "count";
    const key = (s) => gby === "paymentPlatform" ? ((s.paymentPlatforms || ["—"])[0] || "—") : (s[gby] || "—");
    const groups = {};
    all.forEach((s) => { const k = key(s); (groups[k] ||= { items: 0, overdue: 0 }); groups[k].items++; groups[k].overdue += s.approxOutstanding || 0; });
    return Object.entries(groups).map(([k, x]) => ({ key: k, value: op === "sumOutstanding" ? x.overdue : op === "avgOutstanding" ? x.overdue / x.items : x.items, count: x.items })).sort((a, b) => b.value - a.value);
  }
  if (method === "query") {
    const spec = arg || {};
    let rows = all.filter((s) => matchWhere(s, spec.where));
    if (spec.search) { const q = String(spec.search).toLowerCase(); rows = rows.filter((s) => recordText(s).includes(q)); }
    rows = sortRecords(rows, spec.sort || "-submittedAt");
    const total = rows.length;
    if (spec.offset) rows = rows.slice(spec.offset);
    if (spec.limit != null) rows = rows.slice(0, spec.limit);
    return { count: rows.length, total, records: rows.map((s) => project(s, spec.fields)) };
  }
  throw new Error("Unhandled method: " + method);
}

async function main() {
  const [, , method, rawArg] = process.argv;
  if (!method || method === "-h" || method === "--help") { usage(); process.exit(method ? 0 : 1); }
  if (!METHODS.has(method)) { console.error(`Unknown method: ${method}\n`); usage(); process.exit(1); }
  let arg;
  if (rawArg != null && rawArg !== "") { try { arg = JSON.parse(rawArg); } catch { arg = rawArg; } }
  const result = await run(method, arg);
  if (method === "help" || method === "schema") {
    console.log(`${result.name} — ${result.backend}\n`);
    result.methods.forEach(([sig, desc]) => console.log(`  ${sig.padEnd(20)} ${desc}`));
    console.log(`\nwhere fields: ${result.whereFields.join(", ")}`);
    return;
  }
  if (typeof result === "string") process.stdout.write(result + "\n");
  else console.log(JSON.stringify(result, null, 2));
}
export { credentialFilesForProfile, overwriteAndUnlink, destroyProfileCredentials, run };

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
