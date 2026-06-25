#!/usr/bin/env node
/**
 * rrd-vault-watch.mjs — handle deposited Revenue Recovery vault drops.
 *
 * Default/safe mode can auto-install deposited drops when every validation guard
 * passes. If anything is off, it fails closed and asks the operator to review.
 * It never prints secret values.
 *
 * State: which drop ids were already announced, in .rrd-vault-watch-state.json.
 * Run via the rrd-vault-watch wrapper (PATH + .env.local).
 */
import { listDeposited, sweepExpired, getDropById } from "./rrd-vault-db.mjs";
import { rowToRecord, buildHermesPack } from "./rrd-hermes.mjs";
import { envKeysForProvider, getProvider } from "./rrd-oauth.mjs";
import { profileEnvPath, readEnvValue } from "./rrd-vault-fs.mjs";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { withJobLock } from "./rrd-job-lock.mjs";
import { loadJsonState, writeJsonState } from "./rrd-state-file.mjs";

const STATE = "/Users/AIAgenterminal/.rrd-vault-watch-state.json";
const SEND = os.homedir() + "/.local/bin/recoverydesk";
const AUTO_APPROVE = /^(1|true|yes)$/i.test(process.env.RRD_VAULT_AUTO_APPROVE || "");

function loadState() { return loadJsonState(STATE, { announced: [] }, 'vault watcher state'); }
function saveState(s) { writeJsonState(STATE, s); }

function sendMsg(text) {
  execFileSync(SEND, ["send", "--to", "telegram", "--quiet", text], { stdio: ["ignore", "ignore", "inherit"] });
}

function cfg() {
  return {
    urlBase: (process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  };
}
function headers(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra };
}
async function rest(path, init = {}) {
  const { urlBase, key } = cfg();
  if (!urlBase || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  const res = await fetch(`${urlBase}/rest/v1/${path}`, { ...init, headers: headers(key, init.headers) });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
async function fetchSubmission(id) {
  const rows = await rest(`submissions?id=eq.${encodeURIComponent(id)}&select=*`);
  return rows?.[0] || null;
}

const PROVIDER_LABELS = { hubspot: "HubSpot", salesforce: "Salesforce", zoho: "Zoho CRM", google: "Google Workspace", microsoft: "Microsoft 365 / Outlook", xero: "Xero", quickbooks: "QuickBooks Online", pipedrive: "Pipedrive", monday: "monday.com", gohighlevel: "GoHighLevel" };

function arr(x) { return Array.isArray(x) ? x : []; }
function setEq(a, b) { const A = new Set(a), B = new Set(b); return A.size === B.size && [...A].every((v) => B.has(v)); }
function subset(a, b) { const B = new Set(b); return a.every((v) => B.has(v)); }
function quoteList(xs) { return arr(xs).join(", ") || "none"; }
function redactedError(e) { return String(e?.message || e).replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]"); }

export async function validateAutoApprove(drop) {
  const reasons = [];
  if (!drop) reasons.push("drop not found");
  if (drop && drop.status !== "deposited") reasons.push(`drop status is ${drop.status}, not deposited`);
  if (!drop?.ciphertext) reasons.push("drop has no ciphertext");
  if (!drop?.submission_id) reasons.push("drop has no submission_id");
  if (!drop?.profile) reasons.push("drop has no profile");
  if (reasons.length) return { ok: false, reasons };

  const row = await fetchSubmission(drop.submission_id);
  if (!row) return { ok: false, reasons: ["submission_id no longer resolves to an onboarding record"] };
  const rec = rowToRecord(row);
  const pack = buildHermesPack(rec);
  const expectedProfile = pack.profileName;
  const expectedCompany = pack.manifest.company;

  if (drop.profile !== expectedProfile) reasons.push(`profile mismatch: drop=${drop.profile}, expected=${expectedProfile}`);
  if ((drop.company || "") !== (expectedCompany || "")) reasons.push(`company mismatch: drop=${drop.company || "(blank)"}, expected=${expectedCompany || "(blank)"}`);

  if (drop.kind === "oauth" || drop.ciphertext?.__oauth__) {
    const providerId = drop.provider;
    if (!providerId) reasons.push("OAuth drop has no provider");
    let provider;
    try { provider = getProvider(providerId); } catch { reasons.push(`unknown OAuth provider: ${providerId}`); }
    const expectedOAuth = arr(pack.manifest.oauthConnectionsNeeded);
    const providerLabel = provider?.name || PROVIDER_LABELS[providerId] || providerId;
    if (providerLabel && !expectedOAuth.includes(providerLabel)) {
      reasons.push(`OAuth provider ${providerLabel} is not expected for this onboarding stack (${quoteList(expectedOAuth)})`);
    }
    const ciphertextKeys = Object.keys(drop.ciphertext || {});
    if (!setEq(ciphertextKeys, ["__oauth__"])) reasons.push(`OAuth ciphertext keys are unexpected: ${quoteList(ciphertextKeys)}`);
    const expectedEnvKeys = providerId ? envKeysForProvider(providerId) : [];
    if (!setEq(arr(drop.env_keys), expectedEnvKeys)) {
      reasons.push(`OAuth env_keys mismatch: drop=${quoteList(drop.env_keys)}, expected=${quoteList(expectedEnvKeys)}`);
    }
    return { ok: reasons.length === 0, reasons, profile: drop.profile, company: expectedCompany, keys: arr(drop.env_keys), kind: "oauth", provider: providerLabel };
  }

  const expectedKeys = arr(pack.manifest.envKeysNeeded);
  const requestedKeys = arr(drop.env_keys);
  const submittedKeys = Object.keys(drop.ciphertext || {});

  if (!requestedKeys.length) reasons.push("API-key drop requested no keys");
  if (!submittedKeys.length) reasons.push("API-key drop submitted no keys");
  if (!subset(requestedKeys, expectedKeys)) reasons.push(`requested keys are not stack-derived: requested=${quoteList(requestedKeys)}, expected=${quoteList(expectedKeys)}`);
  if (!subset(submittedKeys, requestedKeys)) reasons.push(`submitted ciphertext includes keys not requested by this link: submitted=${quoteList(submittedKeys)}, requested=${quoteList(requestedKeys)}`);
  if (!subset(submittedKeys, expectedKeys)) reasons.push(`submitted ciphertext includes keys not expected for onboarding stack: submitted=${quoteList(submittedKeys)}, expected=${quoteList(expectedKeys)}`);

  const envPath = profileEnvPath(drop.profile);
  const blockers = [];
  for (const key of submittedKeys) {
    try { if (readEnvValue(envPath, key)) blockers.push(key); }
    catch { /* missing profile/env is handled by rrd-vault approve; don't expose paths in notification */ }
  }
  if (blockers.length) reasons.push(`existing profile values would be overwritten: ${quoteList(blockers)}`);

  return { ok: reasons.length === 0, reasons, profile: drop.profile, company: expectedCompany, keys: submittedKeys, kind: "apikey" };
}

function runApprove(dropId) {
  return execFileSync("/Users/AIAgenterminal/rrd-vault", ["approve", dropId], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function message(d) {
  if (d.kind === "oauth") {
    const label = PROVIDER_LABELS[d.provider] || d.provider || "their CRM";
    return `🔗 ${d.company || d.profile} just authorized their ${label} connection. `
      + `The authorization is encrypted and only this machine can complete it. `
      + `Reply "approve ${d.id}" and I'll exchange it for tokens straight into their profile and burn the link.`;
  }
  const keys = (d.env_keys || []).join(", ") || "their integration keys";
  return `🔐 ${d.company || d.profile} just dropped their secrets into the vault (${keys}). `
    + `They're encrypted and only this machine can open them. `
    + `Reply "approve ${d.id}" and I'll decrypt them straight into their profile and burn the link.`;
}

function successMessage(d, v) {
  const label = v.kind === "oauth" ? `${v.provider} connection` : `keys: ${quoteList(v.keys)}`;
  return `✅ ${v.company || d.company || d.profile} vault drop auto-installed (${label}). Drop burned. Values were not printed.`;
}
function reviewMessage(d, v) {
  return `⚠️ ${d.company || d.profile} vault drop needs manual review. Drop not burned. Reason: ${v.reasons.join("; ")}. Reply \`approve ${d.id}\` only if you want to override after checking.`;
}

async function handleAutoApprove(d) {
  const full = await getDropById(d.id);
  const validation = await validateAutoApprove(full);
  if (!validation.ok) return { ok: false, message: reviewMessage(d, validation) };
  try {
    const out = runApprove(d.id);
    if (!/drop burned/.test(out)) {
      return { ok: false, message: `⚠️ ${d.company || d.profile} vault auto-install did not burn the drop. Manual review needed. Values were not printed.` };
    }
    return { ok: true, message: successMessage(d, validation) };
  } catch (e) {
    return { ok: false, message: `⚠️ ${d.company || d.profile} vault auto-install failed. Drop not burned if install was incomplete. Reason: ${redactedError(e)}.` };
  }
}

async function main() {
  await sweepExpired().catch(() => {});

  const st = loadState();
  const seen = new Set(st.announced || []);
  const deposited = await listDeposited();

  let announced = 0;
  for (const d of deposited) {
    if (seen.has(d.id)) continue;
    try {
      if (AUTO_APPROVE) {
        const result = await handleAutoApprove(d);
        sendMsg(result.message);
      } else {
        sendMsg(message(d));
      }
      seen.add(d.id);
      announced++;
    } catch (e) {
      console.error("handling failed for " + d.id + ": " + (e && e.message || e));
      break; // retry on next tick
    }
  }
  // keep only ids that are still in the deposited set or were just announced
  const live = new Set(deposited.map((d) => d.id));
  st.announced = [...seen].filter((id) => live.has(id));
  saveState(st);
  if (announced) console.log(`${AUTO_APPROVE ? "handled" : "announced"} ${announced} deposit(s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  withJobLock('rrd-vault-watch', main, { staleMs: 30 * 60 * 1000 }).catch((e) => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
}
