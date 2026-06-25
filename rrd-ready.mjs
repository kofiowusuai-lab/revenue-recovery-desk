#!/usr/bin/env node
/**
 * rrd-ready.mjs — minimum go-live threshold + safe smoke tests for a client agent.
 *
 * No secrets are printed. Checks:
 *  - profile brain exists (SOUL/policy/manifest)
 *  - onboarding minimums (consent, integration-ready flag, SOP path defined)
 *  - required API-key/OAuth env names are present and non-empty
 *  - provider read probes can authenticate (where supported)
 *  - guardrail executor blocks unsafe direct sends and can gate a safe approved draft
 *  - Orgo/brain status is ready, or reports waiting_for_paid_orgo when the plan is free
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getProvider, providerId, envKeysForProvider } from "./rrd-oauth.mjs";
import { execute } from "./rrd-recover.mjs";
import { assertSafeProfile } from "./rrd-profile-safety.mjs";
import { codexAuthStatus } from "./rrd-agent-llm.mjs";

const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || "/Users/AIAgenterminal";
const PROFILES_DIR = process.env.HERMES_PROFILES_DIR || path.join(OPERATOR_HOME, ".hermes", "profiles");
const TIMEOUT_MS = Number(process.env.RRD_READY_TIMEOUT_MS || 12000);

function readEnvFile(file) {
  const kv = {};
  if (!fs.existsSync(file)) return kv;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v) kv[k] = v;
  }
  return kv;
}
function exists(file) { return fs.existsSync(file); }
function item(name, ok, detail = "", extra = {}) { return { name, ok: !!ok, detail, ...extra }; }
function controller() {
  const c = new AbortController();
  setTimeout(() => c.abort(), TIMEOUT_MS).unref?.();
  return c;
}
async function fetchJson(url, init = {}, fetchImpl = fetch) {
  const c = controller();
  const res = await fetchImpl(url, { ...init, signal: c.signal });
  const text = await res.text().catch(() => "");
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { ok: res.ok, status: res.status, body, text };
}
function redactedStatus(res) { return res.ok ? `HTTP ${res.status}` : `HTTP ${res.status}`; }
function safeProviderBaseUrl(raw, { fallback = null, allowedHostPattern, label }) {
  const value = String(raw || fallback || "").trim().replace(/\/+$/, "");
  if (!value) return { ok: false, detail: `missing ${label}` };
  let url;
  try { url = new URL(value); }
  catch { return { ok: false, detail: `invalid ${label}` }; }
  if (url.protocol !== "https:") return { ok: false, detail: `${label} must use https` };
  if (url.username || url.password) return { ok: false, detail: `${label} must not include credentials` };
  if (!allowedHostPattern.test(url.hostname)) return { ok: false, detail: `${label} host is not allowlisted` };
  return { ok: true, base: url.origin };
}

async function probeProvider(provider, env, fetchImpl = fetch) {
  const p = providerId(provider) ? getProvider(provider) : null;
  const id = p?.id || String(provider || "").toLowerCase();
  const access = p?.envKeys?.access ? env[p.envKeys.access] : null;
  try {
    if (id === "stripe") {
      const r = await fetchJson("https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${env.STRIPE_API_KEY || ""}` } }, fetchImpl);
      return item("provider:Stripe", r.ok, redactedStatus(r));
    }
    if (id === "hubspot") {
      const r = await fetchJson("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", { headers: { Authorization: `Bearer ${access || ""}` } }, fetchImpl);
      return item("provider:HubSpot", r.ok, redactedStatus(r));
    }
    if (id === "google") {
      const r = await fetchJson("https://www.googleapis.com/drive/v3/about?fields=user", { headers: { Authorization: `Bearer ${access || ""}` } }, fetchImpl);
      return item("provider:Google Workspace", r.ok, redactedStatus(r));
    }
    if (id === "microsoft") {
      const r = await fetchJson("https://graph.microsoft.com/v1.0/me", { headers: { Authorization: `Bearer ${access}` } }, fetchImpl);
      return item("provider:Microsoft 365 / Outlook", r.ok, redactedStatus(r));
    }
    if (id === "xero") {
      const r = await fetchJson("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${access}` } }, fetchImpl);
      return item("provider:Xero", r.ok, redactedStatus(r));
    }
    if (id === "quickbooks") {
      if (!env.QUICKBOOKS_REALM_ID) return item("provider:QuickBooks Online", false, "missing QUICKBOOKS_REALM_ID");
      const r = await fetchJson(`https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(env.QUICKBOOKS_REALM_ID)}/companyinfo/${encodeURIComponent(env.QUICKBOOKS_REALM_ID)}?minorversion=75`, { headers: { Authorization: `Bearer ${access}`, Accept: "application/json" } }, fetchImpl);
      return item("provider:QuickBooks Online", r.ok, redactedStatus(r));
    }
    if (id === "salesforce") {
      const host = safeProviderBaseUrl(env.SALESFORCE_INSTANCE_URL, { label: "SALESFORCE_INSTANCE_URL", allowedHostPattern: /(^|\.)salesforce\.com$|(^|\.)force\.com$|(^|\.)salesforce\.mil$/i });
      if (!host.ok) return item("provider:Salesforce", false, host.detail);
      const r = await fetchJson(`${host.base}/services/data/v60.0/limits`, { headers: { Authorization: `Bearer ${access}` } }, fetchImpl);
      return item("provider:Salesforce", r.ok, redactedStatus(r));
    }
    if (id === "zoho") {
      const host = safeProviderBaseUrl(env.ZOHO_API_DOMAIN, { fallback: "https://www.zohoapis.com", label: "ZOHO_API_DOMAIN", allowedHostPattern: /(^|\.)zohoapis\.(com|eu|in|com\.au|jp|ca|sa)$/i });
      if (!host.ok) return item("provider:Zoho CRM", false, host.detail);
      const r = await fetchJson(`${host.base}/crm/v2/users?type=CurrentUser`, { headers: { Authorization: `Zoho-oauthtoken ${access}` } }, fetchImpl);
      return item("provider:Zoho CRM", r.ok, redactedStatus(r));
    }
    if (id === "pipedrive") {
      const host = safeProviderBaseUrl(env.PIPEDRIVE_API_DOMAIN, { fallback: "https://api.pipedrive.com", label: "PIPEDRIVE_API_DOMAIN", allowedHostPattern: /(^|\.)pipedrive\.com$/i });
      if (!host.ok) return item("provider:Pipedrive", false, host.detail);
      const r = await fetchJson(`${host.base}/v1/users/me`, { headers: { Authorization: `Bearer ${access}` } }, fetchImpl);
      return item("provider:Pipedrive", r.ok, redactedStatus(r));
    }
    if (id === "monday") {
      const r = await fetchJson("https://api.monday.com/v2", { method: "POST", headers: { Authorization: access, "Content-Type": "application/json" }, body: JSON.stringify({ query: "query { me { id name } }" }) }, fetchImpl);
      return item("provider:monday.com", r.ok && !r.body?.errors, redactedStatus(r));
    }
    if (id === "gohighlevel") {
      const r = await fetchJson("https://services.leadconnectorhq.com/locations/", { headers: { Authorization: `Bearer ${access}`, Version: "2021-07-28" } }, fetchImpl);
      return item("provider:GoHighLevel", r.ok, redactedStatus(r));
    }
    if (env.SENDGRID_API_KEY) {
      const r = await fetchJson("https://api.sendgrid.com/v3/user/profile", { headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}` } }, fetchImpl);
      return item("provider:SendGrid", r.ok, redactedStatus(r));
    }
  } catch (e) {
    return item(`provider:${p?.name || provider}`, false, e.name === "AbortError" ? "timeout" : String(e.message || e));
  }
  return item(`provider:${p?.name || provider}`, true, "no network probe defined; env presence checked");
}

function providerChecksFromManifest(manifest, env) {
  const checks = [];
  for (const k of manifest.envKeysNeeded || []) {
    checks.push(item(`env:${k}`, !!env[k], env[k] ? "set" : "missing"));
  }
  for (const name of manifest.oauthConnectionsNeeded || []) {
    const id = providerId(name);
    if (!id) {
      checks.push(item(`oauth:${name}`, false, "unknown provider mapping"));
      continue;
    }
    for (const k of envKeysForProvider(id)) checks.push(item(`env:${k}`, !!env[k], env[k] ? "set" : "missing"));
  }
  for (const k of manifest.composioEnvKeysNeeded || []) {
    const valid = /^ca_[A-Za-z0-9_-]+$/.test(String(env[k] || ""));
    checks.push(item(`composio:${k}`, valid, valid ? "connected account id set" : (env[k] ? "invalid connected account id; expected ca_*" : "missing connected account id")));
  }
  return checks;
}

function orgoStatus(profile) {
  try {
    const plan = JSON.parse(execFileSync(path.join(OPERATOR_HOME, "rrd-orgo"), ["plan"], { encoding: "utf8", timeout: 15000 }));
    if (!plan.paid) return item("orgo", false, `waiting_for_paid_orgo: ${plan.ownerTier || "free"}`, { waitingForOrgo: true });
    const st = JSON.parse(execFileSync(path.join(OPERATOR_HOME, "rrd-brain"), ["status", profile], { encoding: "utf8", timeout: 20000 }));
    const ok = !!(st.orgo && (st.orgo.projectId || st.orgo.project || st.orgo.computerId || st.orgo.state));
    return item("orgo", ok, ok ? "project/status reachable" : "paid plan but no project status", { paid: true });
  } catch (e) {
    return item("orgo", false, "status check failed: " + ((e.stdout && String(e.stdout).trim()) || e.message || e));
  }
}

function llmRuntimeCheck(profile, manifest = {}) {
  const runtime = manifest.llmRuntime || {};
  if (runtime.required === false) return item("llm:chatgpt-oauth", true, "not required by manifest");
  if (runtime.provider && runtime.provider !== "openai-codex") return item("llm:chatgpt-oauth", false, `unsupported runtime provider ${runtime.provider}`);
  const st = codexAuthStatus(profile);
  if (!st.profileExists) return item("llm:chatgpt-oauth", false, "profile missing");
  if (!st.configProviderPinned) return item("llm:chatgpt-oauth", false, "config.yaml not pinned to openai-codex");
  if (!st.accountAssigned) return item("llm:chatgpt-oauth", false, "assign FlowAudit-managed ChatGPT account email; run rrd-agent-llm assign " + profile + " --account-email <email>");
  if (!st.authPresent) return item("llm:chatgpt-oauth", false, `account assigned (${st.accountEmail}); profile-local OAuth still needed; run rrd-agent-llm auth ${profile}`);
  return item("llm:chatgpt-oauth", true, `connected via ${st.authSource || "profile auth store"}${st.accountEmail ? ` for ${st.accountEmail}` : ""}`);
}

async function guardrailChecks(profile) {
  const safe = { channel: "Email", to: { email: "smoke@example.invalid" }, subject: "Smoke test", text: "Smoke test only", approved: true, atHour: 10, tool: "send_via_executor", costUsd: 0 };
  const unsafe = { ...safe, approved: false };
  const deps = {
    usageBump: () => {},
    auditWrite: () => {},
    capCheck: () => ({ allowed: true, violations: [] }),
    adapters: { email: async () => ({ ok: true, smoke: true }) },
  };
  const a = await execute(profile, safe, { send: false, deps });
  const b = await execute(profile, unsafe, { send: false, deps });
  return [
    item("guardrail:approved-draft", !!a.wouldSend, a.wouldSend ? "would send; no dispatch" : `blocked: ${(a.decision?.violations || []).map(v => v.code).join(",")}`),
    item("guardrail:unapproved-block", !b.decision?.allowed, !b.decision?.allowed ? "blocked as expected" : "unexpectedly allowed unapproved send"),
  ];
}

export async function checkReady(profile, opts = {}) {
  profile = assertSafeProfile(profile);
  const pdir = path.join(PROFILES_DIR, profile);
  const manifestPath = path.join(pdir, "manifest.json");
  const manifest = exists(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};
  const env = readEnvFile(path.join(pdir, ".env"));
  const checks = [];
  checks.push(item("profile:directory", exists(pdir), exists(pdir) ? pdir : "missing"));
  checks.push(item("profile:SOUL", exists(path.join(pdir, "SOUL.md")), exists(path.join(pdir, "SOUL.md")) ? "present" : "missing"));
  checks.push(item("profile:policy", exists(path.join(pdir, "policy.json")), exists(path.join(pdir, "policy.json")) ? "present" : "missing"));
  checks.push(item("profile:manifest", exists(manifestPath), exists(manifestPath) ? "present" : "missing"));
  if (exists(manifestPath)) {
    checks.push(item("threshold:consent", !!manifest.readiness?.consent, manifest.readiness?.consent ? "yes" : "missing/false"));
    checks.push(item("threshold:integration-ready", !!manifest.readiness?.integrationReady, manifest.readiness?.integrationReady ? "yes" : "missing/false"));
    const sopDefined = !!(manifest.sop?.status);
    checks.push(item("threshold:sop-path", sopDefined, sopDefined ? manifest.sop.status : "missing"));
    checks.push(...providerChecksFromManifest(manifest, env));
    const providerNames = new Set();
    for (const name of manifest.oauthConnectionsNeeded || []) providerNames.add(name);
    if ((manifest.envKeysNeeded || []).includes("STRIPE_API_KEY")) providerNames.add("stripe");
    for (const name of providerNames) checks.push(await probeProvider(name, env, opts.fetchImpl || fetch));
  }
  checks.push(llmRuntimeCheck(profile, manifest));
  checks.push(...await guardrailChecks(profile));
  if (!opts.skipOrgo) checks.push(orgoStatus(profile));
  const hardFailures = checks.filter(c => !c.ok && !(opts.allowNoOrgo && c.waitingForOrgo));
  return { ok: hardFailures.length === 0, profile, company: manifest.company || null, checkedAt: new Date().toISOString(), checks, hardFailures: hardFailures.map(c => c.name), readyButWaitingForOrgo: hardFailures.length === 0 && checks.some(c => c.waitingForOrgo) };
}

function summarize(r) {
  const lines = [];
  lines.push(`Minimum-ready smoke test — ${r.company || r.profile} (${r.profile})`);
  lines.push(`Status: ${r.ok ? "READY" : (r.readyButWaitingForOrgo ? "READY_EXCEPT_ORGO" : "BLOCKED")}`);
  for (const c of r.checks) lines.push(`  ${c.ok ? "✓" : (c.waitingForOrgo ? "◌" : "✗")} ${c.name}: ${c.detail || ""}`.trimEnd());
  if (r.hardFailures.length) lines.push(`Hard blockers: ${r.hardFailures.join(", ")}`);
  return lines.join("\n");
}

function parse(argv) {
  const o = { _: [], json: false, allowNoOrgo: false, skipOrgo: false };
  for (const a of argv) {
    if (a === "--json") o.json = true;
    else if (a === "--allow-no-orgo") o.allowNoOrgo = true;
    else if (a === "--skip-orgo") o.skipOrgo = true;
    else o._.push(a);
  }
  return o;
}

async function main() {
  const o = parse(process.argv.slice(2));
  const [cmd, profile] = o._;
  if (!["check", "smoke", "gate"].includes(cmd) || !profile) {
    console.error("Usage: rrd-ready check <profile> [--json] [--allow-no-orgo|--skip-orgo]");
    process.exit(1);
  }
  const r = await checkReady(profile, o);
  console.log(o.json ? JSON.stringify(r, null, 2) : summarize(r));
  process.exit(r.ok || r.readyButWaitingForOrgo ? 0 : 2);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
