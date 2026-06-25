#!/usr/bin/env node
/**
 * rrd-readiness-checklist.mjs — turn a client's current state into the grouped
 * go-live readiness checklist rendered by readiness-monitor.py.
 *
 *   buildChecklist({ client, pack, entry, readiness, specialForms, profileEnv })
 *      -> { title, groups:[{group, items:[{label,status,detail}]}], counts, allReady }
 *   loadAndBuild(submissionId) -> assembles all inputs standalone (harness + pack +
 *      watcher state + full checkReady) and returns the same shape.
 *
 * Status vocabulary (matches readiness-monitor.py):
 *   done | doing | pending | waiting | blocked
 *
 * Pure given its inputs; no I/O in buildChecklist. loadAndBuild does the I/O.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildHermesPack, INTEGRATIONS } from "./rrd-hermes.mjs";
import { needsSopReview, missingReadinessItems, needsMapping, isSpecialFormRecord } from "./rrd-readiness-rules.mjs";
import { providerId, envKeysForProvider } from "./rrd-oauth.mjs";
import { assertSafeProfile } from "./rrd-profile-safety.mjs";
import { codexAuthStatus } from "./rrd-agent-llm.mjs";

const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || "/Users/AIAgenterminal";
const PROFILES_DIR = process.env.HERMES_PROFILES_DIR || path.join(OPERATOR_HOME, ".hermes", "profiles");

// env-key -> friendly provider name, and provider -> its required keys, from the
// single-source-of-truth INTEGRATIONS registry (only auth:"apikey" providers).
function apiKeyMaps() {
  const keyToProvider = {}, providerKeys = {};
  for (const category of Object.values(INTEGRATIONS)) {
    for (const [name, spec] of Object.entries(category)) {
      if (spec.auth !== "apikey" || !Array.isArray(spec.keys)) continue;
      providerKeys[name] = spec.keys;
      for (const k of spec.keys) keyToProvider[k] = name;
    }
  }
  return { keyToProvider, providerKeys };
}

function readEnvFile(file) {
  const kv = {};
  try {
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v) kv[k] = v;
    }
  } catch { /* missing profile .env is fine */ }
  return kv;
}

const item = (label, status, detail = "") => ({ label, status, detail });

// Did this client submit a given post-onboarding form (sop_review/readiness/mapping)?
function formSourceSubmissionId(row) {
  const bp = row.businessProfile || {};
  const rp = row.recoveryProcess || {};
  const payloads = [bp, rp.sopReview, rp.readiness, rp.mapping].filter(Boolean);
  for (const payload of payloads) {
    const id = payload.sourceSubmissionId || payload.source_submission_id || payload.submissionId || payload.submission_id;
    if (id) return String(id);
  }
  return "";
}
function submittedForm(specialForms, submissionId, catalyst) {
  const expected = String(submissionId || "");
  return (specialForms || []).some((row) =>
    String(row.catalyst || "").toUpperCase() === catalyst &&
    formSourceSubmissionId(row) === expected);
}

function clientGroup({ client, pack, entry, profileEnv, specialForms }) {
  const id = client.id;
  const ps = client.paymentStack || {}, cd = client.crmData || {};
  const { keyToProvider, providerKeys } = apiKeyMaps();
  const manifest = pack.manifest || {};
  const items = [];

  // 1. Onboarding form
  items.push(item("Onboarding form submitted", "done",
    [client.company, client.submittedAt ? new Date(client.submittedAt).toISOString().slice(0, 10) : null].filter(Boolean).join(" · ")));

  // 2. Consent (a hard gate — never auto-pass)
  items.push(item("Consent to recovery", client.consent ? "done" : "blocked",
    client.consent ? "" : "client must give consent before any outreach"));

  // 3/4. API access on both stacks
  items.push(item("Payment platform API access", /^yes$/i.test(String(ps.apiAccess || "")) ? "done" : "pending",
    (ps.platforms || client.paymentPlatforms || []).join(", ")));
  if (cd.crm || client.crm) {
    items.push(item("CRM API access", /^yes$/i.test(String(cd.apiAccess || "")) ? "done" : "pending",
      String(cd.crm || client.crm || "")));
  }

  // 5. Contacts
  const contacts = client.contacts || [];
  const contactsOk = !!client.primaryContact && contacts.length > 0;
  items.push(item("Primary contact + key contacts", contactsOk ? "done" : "pending",
    contactsOk ? `${contacts.length} contact(s)` : "name a primary contact and at least one key contact"));

  // 6. API-key integrations (vault) — one row per provider
  const envKeys = manifest.envKeysNeeded || [];
  const seenProviders = new Set();
  for (const key of envKeys) {
    const provider = keyToProvider[key] || key;
    if (seenProviders.has(provider)) continue;
    seenProviders.add(provider);
    const keys = providerKeys[provider] || [key];
    const allSet = keys.every((k) => profileEnv[k]);
    let status, detail;
    if (allSet) { status = "done"; detail = "key installed"; }
    else if (entry.vaultUrl || entry.vaultDropId) { status = "doing"; detail = "secure vault link sent — awaiting client"; }
    else { status = "pending"; detail = "needs secure vault link"; }
    items.push(item(`Connect ${provider} (API key)`, status, detail));
  }

  // 7. OAuth integrations — one row per provider
  for (const name of manifest.oauthConnectionsNeeded || []) {
    const pid = providerId(name);
    const keys = pid ? envKeysForProvider(pid) : [];
    const authorized = keys.length > 0 && keys.every((k) => profileEnv[k]);
    let status, detail;
    if (authorized) { status = "done"; detail = "authorized"; }
    else if (entry.oauthUrls && entry.oauthUrls[name]) { status = "doing"; detail = "authorization link sent — awaiting client"; }
    else { status = "pending"; detail = "needs OAuth authorization link"; }
    items.push(item(`Authorize ${name} (OAuth)`, status, detail));
  }

  // 7b. Composio-managed integrations — one row per provider
  const composioNames = manifest.composioConnectionsNeeded || [];
  const composioKeys = manifest.composioEnvKeysNeeded || [];
  for (let i = 0; i < composioNames.length; i++) {
    const name = composioNames[i];
    const key = composioKeys[i];
    const authorized = key && /^ca_[A-Za-z0-9_-]+$/.test(String(profileEnv[key] || ""));
    items.push(item(`Authorize ${name} (Composio)`, authorized ? "done" : "pending", authorized ? "connected account id installed" : "needs Composio authorization / connected account id"));
  }

  // 8. SOP
  if (client.hasSop) {
    items.push(item("SOP on file", (client.documents || []).length ? "done" : "done", "client SOP provided"));
  } else if (needsSopReview(client)) {
    let status, detail;
    if (submittedForm(specialForms, id, "SOP_REVIEW_WEB")) { status = "done"; detail = "client reviewed the default SOP"; }
    else if (entry.sopReviewSentAt) { status = "doing"; detail = "SOP review link sent — awaiting client"; }
    else { status = "pending"; detail = "send the default SOP for review"; }
    items.push(item("Accept recovery SOP", status, detail));
  }

  // 9. Mapping
  if (needsMapping(client, [...(manifest.oauthConnectionsNeeded || []), ...(manifest.composioConnectionsNeeded || [])])) {
    let status, detail;
    if (submittedForm(specialForms, id, "MAPPING_DETAILS_WEB")) { status = "done"; detail = "mapping details received"; }
    else if (entry.mappingSentAt) { status = "doing"; detail = "mapping form sent — awaiting client"; }
    else { status = "pending"; detail = "confirm column / field mapping"; }
    items.push(item("Confirm data mapping", status, detail));
  }

  // 10. Readiness details
  const missing = missingReadinessItems(client);
  if (missing.length) {
    let status, detail = missing.slice(0, 6).join(", ") + (missing.length > 6 ? ", …" : "");
    if (submittedForm(specialForms, id, "READINESS_DETAILS_WEB")) { status = "done"; detail = "readiness details received"; }
    else if (entry.readinessSentAt) { status = "doing"; detail = `awaiting: ${detail}`; }
    else { status = "pending"; detail = `missing: ${detail}`; }
    items.push(item("Provide go-live readiness details", status, detail));
  }

  return { group: "Client to-do", items };
}

// Full system readiness from a checkReady() result (provider probes etc.).
function systemGroupFull(readiness) {
  const items = [];
  const checks = readiness.checks || [];
  const pick = (pred) => checks.filter(pred);
  const allOk = (arr) => arr.length > 0 && arr.every((c) => c.ok);

  const profileChecks = pick((c) => c.name.startsWith("profile:"));
  items.push(item("Hermes profile brain (SOUL/policy/manifest)", allOk(profileChecks) ? "done" : "blocked",
    profileChecks.filter((c) => !c.ok).map((c) => c.name).join(", ")));

  for (const c of pick((c) => c.name.startsWith("provider:"))) {
    items.push(item(c.name.replace(/^provider:/, "Provider reachable — "), c.ok ? "done" : "blocked", c.detail || ""));
  }

  const llm = checks.find((c) => c.name === "llm:chatgpt-oauth");
  if (llm) {
    items.push(item("ChatGPT agent OAuth", llm.ok ? "done" : "blocked", llm.detail || ""));
  }

  const guard = pick((c) => c.name.startsWith("guardrail:"));
  if (guard.length) {
    items.push(item("Guardrail gate (approved pass / unapproved blocked)", allOk(guard) ? "done" : "blocked",
      guard.filter((c) => !c.ok).map((c) => c.detail).join("; ")));
  }

  const orgo = checks.find((c) => c.name === "orgo");
  if (orgo) {
    items.push(item("Cloud desktop (Orgo)", orgo.waitingForOrgo ? "waiting" : (orgo.ok ? "done" : "blocked"), orgo.detail || ""));
  }
  return { group: "System readiness", items };
}

// Light system readiness (no network probes) — used by the 5-min watcher hook.
function systemGroupLight({ entry, profileName }) {
  const safeProfileName = assertSafeProfile(profileName);
  const pdir = path.join(PROFILES_DIR, safeProfileName);
  const provisioned = !!entry.provisionedAt || fs.existsSync(path.join(pdir, "SOUL.md"));
  const items = [
    item("Hermes profile provisioned", provisioned ? "done" : "doing", provisioned ? "" : "provisioning…"),
  ];
  const runtimeReady = !!entry.runtimeReadySentAt || !!entry.sandboxReadySentAt;
  items.push(item("Runtime ready (sandbox / Orgo)", runtimeReady ? "done" : (provisioned ? "doing" : "pending"),
    entry.runtime?.mode ? `mode: ${entry.runtime.mode}` : ""));
  let llmStatus = "pending", llmDetail = "FlowAudit-managed ChatGPT account + profile OAuth required";
  if (provisioned) {
    const configPath = path.join(pdir, "config.yaml");
    const cfgText = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
    const st = codexAuthStatus(safeProfileName);
    const authPresent = st.authPresent;
    const pinned = /provider:\s*openai-codex/.test(cfgText);
    if (authPresent && pinned && st.accountAssigned) { llmStatus = "done"; llmDetail = st.accountEmail ? `profile-local ChatGPT OAuth present for ${st.accountEmail}` : "profile-local ChatGPT OAuth present"; }
    else if (pinned && st.accountAssigned) { llmStatus = "doing"; llmDetail = `account assigned (${st.accountEmail}); OAuth login still needed`; }
    else if (pinned) { llmStatus = "pending"; llmDetail = "assign FlowAudit-managed ChatGPT account email"; }
    else { llmStatus = "pending"; llmDetail = "pin runtime and run rrd-agent-llm assign"; }
  }
  items.push(item("ChatGPT agent OAuth", llmStatus, llmDetail));
  return { group: "System readiness", items };
}

export function buildChecklist({ client, pack, entry = {}, readiness = null, specialForms = [], profileEnv = null }) {
  if (!client) throw new Error("buildChecklist requires { client }");
  pack = pack || buildHermesPack(client);
  const profileName = assertSafeProfile(pack.profileName);
  profileEnv = profileEnv || readEnvFile(path.join(PROFILES_DIR, profileName, ".env"));

  const groups = [
    clientGroup({ client, pack, entry, profileEnv, specialForms }),
    readiness ? systemGroupFull(readiness) : systemGroupLight({ entry, profileName }),
  ];

  let done = 0, total = 0;
  for (const g of groups) for (const it of g.items) {
    if (it.status === "waiting") continue;
    total += 1;
    if (it.status === "done") done += 1;
  }
  return {
    title: `${client.company || profileName} — Go-Live Readiness`,
    profile: profileName,
    client: client.id,
    groups,
    counts: { done, total },
    allReady: total > 0 && done >= total,
  };
}

// ---- standalone assembly (I/O) -------------------------------------------
function harness(method, arg) {
  const args = [method];
  if (arg !== undefined) args.push(typeof arg === "string" ? arg : JSON.stringify(arg));
  const out = execFileSync(path.join(OPERATOR_HOME, "rrd-harness"), args, { encoding: "utf8", timeout: 60000 });
  return out.trim() ? JSON.parse(out) : null;
}

export async function loadAndBuild(submissionId, opts = {}) {
  const client = harness("get", submissionId);
  if (!client) throw new Error("no submission with id " + submissionId);
  const pack = buildHermesPack(client);
  // watcher state entry (best-effort)
  let entry = {};
  try {
    const statePath = process.env.RRD_ONBOARDING_EMAIL_STATE || path.join(OPERATOR_HOME, ".openclaw", "rrd-onboarding-email-watch.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    entry = (state.submissions && state.submissions[submissionId]) || {};
  } catch { /* no state yet */ }
  // post-onboarding special forms referencing this client (best-effort)
  let specialForms = [];
  try { specialForms = (harness("list") || []).filter(isSpecialFormRecord); } catch { /* ignore */ }
  // full system readiness with provider probes, unless the caller opts for light
  let readiness = null;
  if (!opts.light) {
    try {
      const { checkReady } = await import("./rrd-ready.mjs");
      readiness = await checkReady(pack.profileName, { allowNoOrgo: true });
    } catch { /* profile may not exist yet -> light system group */ }
  }
  return buildChecklist({ client, pack, entry, readiness, specialForms });
}

// ---- CLI ------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  const id = argv.find((a) => !a.startsWith("--"));
  const light = argv.includes("--light");
  if (!id) { console.error("Usage: rrd-readiness-checklist <submission-id> [--json] [--light]"); process.exit(1); }
  const result = await loadAndBuild(id, { light });
  if (argv.includes("--json")) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log(`${result.title}   (${result.counts.done}/${result.counts.total})`);
  for (const g of result.groups) {
    console.log(`\n${g.group}`);
    for (const it of g.items) console.log(`  [${it.status}] ${it.label}${it.detail ? " — " + it.detail : ""}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
