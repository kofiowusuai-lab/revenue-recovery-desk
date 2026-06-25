#!/usr/bin/env node
/**
 * rrd-vault.mjs — operator CLI for the Hermes Secrets Vault.
 *
 *   rrd-vault new <submission-id> [--hours 48] [--base <url>]
 *       Create a one-time deposit link for a client and print the URL to send.
 *       Generates the profile's RSA keypair on first use (private key local-only).
 *
 *   rrd-vault approve <drop-id> [--profile <name>]
 *       Decrypt a deposited drop locally and write the keys into the client's
 *       Hermes profile .env. Burns the drop (consumed + ciphertext deleted).
 *
 *   rrd-vault status
 *       List recent drops and their state.
 *
 * Secret VALUES are never printed or logged. Run via the rrd-vault wrapper
 * (sources .env.local for the Supabase service-role key).
 */
import { rowToRecord, buildHermesPack } from "./rrd-hermes.mjs";
import { newToken, depositUrl, canClaim, openEnvelope } from "./rrd-vault-core.mjs";
import { loadOrCreateKeypair, keyPaths, profileEnvPath, writeEnvSecrets, readEnvValue } from "./rrd-vault-fs.mjs";
import { createDrop, getDropById, listDrops, markConsumed } from "./rrd-vault-db.mjs";
import {
  getProvider, appCreds, redirectUri, buildAuthorizeUrl, envKeysForProvider,
  exchangeCode, refreshTokens, tokensToEnv,
} from "./rrd-oauth.mjs";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const DEFAULT_BASE = process.env.RRD_VAULT_BASE || process.env.RRD_WEB_BASE || "https://flowaudit.co.uk/revenue-recovery";
const IVORY_BASE = "https://revenue-recovery-web-ivory.vercel.app";

function parseArgs(argv) {
  const opts = { _: [], hours: 48, base: DEFAULT_BASE, baseExplicit: false, profile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--hours") opts.hours = Number(argv[++i]);
    else if (a === "--base") { opts.base = argv[++i]; opts.baseExplicit = true; }
    else if (a === "--profile") opts.profile = argv[++i];
    else if (a === "-h" || a === "--help") opts.help = true;
    else opts._.push(a);
  }
  return opts;
}

function usage() {
  console.error(`rrd-vault — Hermes Secrets Vault operator CLI

  rrd-vault new <submission-id> [--hours 48] [--base <url>]
      One-time link to paste API keys (Stripe, Square, Twilio, …).

  rrd-vault connect <submission-id> [provider] [--hours 48] [--base <url>]
      One-time link to OAuth-connect a provider (google | microsoft | hubspot | salesforce | zoho | zohobooks | xero | sage | freshbooks | wave | freeagent | quickbooks | pipedrive | monday | gohighlevel).
      Provider defaults to the submission's CRM if it is an OAuth provider.

  rrd-vault approve <drop-id> [--profile <name>]
      Operator-approved install of a deposited drop into the profile .env, then burn it.
      Handles both API-key drops and OAuth code drops (exchanges the code here).
      Alias: rrd-vault claim <drop-id>.

  rrd-vault refresh <profile> <provider>
      Mint a fresh access token from the stored refresh token.

  rrd-vault status

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RRD_VAULT_BASE
     OAuth app creds (this Mac only): provider-specific *_OAUTH_CLIENT_ID / *_OAUTH_CLIENT_SECRET keys in ~/.openclaw/.env`);
}

async function fetchSubmission(id) {
  const res = await fetch(`${URL_BASE}/rest/v1/submissions?id=eq.${encodeURIComponent(id)}&select=*`, {
    headers: { apikey: SR, Authorization: `Bearer ${SR}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  if (!rows || !rows.length) throw new Error("No submission found with id " + id);
  return rows[0];
}

function missingEnvKeys(profile, keys) {
  return (keys || []).filter((key) => {
    try { return !readEnvValue(profileEnvPath(profile), key); }
    catch { return true; }
  });
}

function runReadySmoke(profile) {
  try {
    const out = execFileSync("/Users/AIAgenterminal/rrd-ready", ["check", profile, "--allow-no-orgo"], { encoding: "utf8", timeout: 60000 });
    console.log("\nMinimum-ready smoke test:\n" + out.trim() + "\n");
  } catch (e) {
    const out = (e && e.stdout) ? String(e.stdout).trim() : "";
    console.log("\nMinimum-ready smoke test: BLOCKED");
    if (out) console.log(out + "\n");
    else console.log("  smoke runner failed: " + ((e && e.message) || String(e)) + "\n");
  }
}

async function cmdNew(opts) {
  const submissionId = opts._[1];
  if (!submissionId) throw new Error("usage: rrd-vault new <submission-id>");

  const row = await fetchSubmission(submissionId);
  const rec = rowToRecord(row);
  const pack = buildHermesPack(rec);
  const profile = pack.profileName;
  const allEnvKeys = pack.manifest.envKeysNeeded || [];
  const envKeys = missingEnvKeys(profile, allEnvKeys);
  const oauth = pack.manifest.oauthConnectionsNeeded || [];
  const composio = pack.manifest.composioConnectionsNeeded || [];
  if (!envKeys.length) {
    console.log(`Heads up: ${pack.manifest.company} currently needs no API-key secrets (everything is OAuth, unset, or already installed).`);
  }

  const kp = loadOrCreateKeypair(profile);
  const { token, tokenHash } = newToken();
  const expiresAt = new Date(Date.now() + opts.hours * 3600 * 1000).toISOString();

  const drop = await createDrop({
    profile,
    submission_id: submissionId,
    company: pack.manifest.company,
    env_keys: envKeys,
    public_key: kp.publicKeyPem,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  const url = depositUrl(opts.base, token);
  console.log(`\nOne-time secrets link for ${pack.manifest.company} (profile ${profile})`);
  console.log(`Keys requested (API-key only): ${envKeys.join(", ") || "(none)"}`);
  if (oauth.length) console.log(`OAuth connections (handled separately, NOT in this link): ${oauth.join(", ")}`);
  if (composio.length) console.log(`Composio-managed connections (handled separately, NOT in this link): ${composio.join(", ")}`);
  console.log(`Expires: ${expiresAt} (${opts.hours}h)`);
  console.log(`Drop id: ${drop.id}`);
  console.log(`\nSend this link to the client (burns after one deposit):\n  ${url}\n`);
}

async function cmdConnect(opts) {
  const submissionId = opts._[1];
  if (!submissionId) throw new Error("usage: rrd-vault connect <submission-id> [provider]");

  const row = await fetchSubmission(submissionId);
  const rec = rowToRecord(row);
  const pack = buildHermesPack(rec);
  const profile = pack.profileName;

  // Resolve provider: explicit arg wins, else the submission's CRM (if OAuth).
  const wanted = opts._[2] || rec.crm;
  let provider;
  try { provider = getProvider(wanted); }
  catch { throw new Error(`No OAuth provider for "${wanted || "(none)"}". This client's CRM/email/accounting provider may be API-key based (use \`rrd-vault new\`) or unset. Pass one of: google, microsoft, hubspot, salesforce, zoho, xero, quickbooks, pipedrive, monday, gohighlevel.`); }

  // Confirm this provider is actually one this client needs (warn, don't block).
  const needed = pack.manifest.oauthConnectionsNeeded || [];
  if (provider.name && !needed.includes(provider.name)) {
    console.log(`Heads up: ${provider.name} is not in ${pack.manifest.company}'s detected OAuth connections (${needed.join(", ") || "none"}). Continuing anyway.`);
  }

  // Our app credentials must exist on this Mac to later exchange the code.
  const { clientId } = appCreds(provider.id);

  const kp = loadOrCreateKeypair(profile);
  const { token, tokenHash } = newToken();
  const expiresAt = new Date(Date.now() + opts.hours * 3600 * 1000).toISOString();
  const linkBase = (!opts.baseExplicit && provider.id === "xero") ? IVORY_BASE : opts.base;
  const ru = redirectUri(linkBase);
  const authorizeUrl = buildAuthorizeUrl(provider.id, { clientId, redirectUri: ru, state: token });

  const drop = await createDrop({
    profile,
    submission_id: submissionId,
    company: pack.manifest.company,
    kind: "oauth",
    provider: provider.id,
    authorize_url: authorizeUrl,
    env_keys: envKeysForProvider(provider.id),   // informational (status display)
    public_key: kp.publicKeyPem,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  const startUrl = String(linkBase).replace(/\/+$/, "") + "/oauth-start?token=" + encodeURIComponent(token);
  console.log(`\nOne-time ${provider.name} connect link for ${pack.manifest.company} (profile ${profile})`);
  console.log(`Scopes (read-only): ${getProvider(provider.id).scopes.join(", ")}`);
  console.log(`Redirect URI (must be registered in the ${provider.name} app): ${ru}`);
  console.log(`Expires: ${expiresAt} (${opts.hours}h)`);
  console.log(`Drop id: ${drop.id}`);
  console.log(`\nSend this link to the client (burns after one connection):\n  ${startUrl}\n`);
}

async function cmdApprove(opts) {
  const dropId = opts._[1];
  if (!dropId) throw new Error("usage: rrd-vault approve <drop-id>");

  const drop = await getDropById(dropId);
  if (!drop) throw new Error("No drop with id " + dropId);
  if (!canClaim(drop)) throw new Error(`Drop ${dropId} is '${drop.status}' with ${drop.ciphertext ? "ciphertext" : "no ciphertext"} — nothing to approve.`);

  const profile = opts.profile || drop.profile;
  const kpPriv = keyPaths(profile).priv;
  if (!fs.existsSync(kpPriv)) throw new Error(`No private key for profile '${profile}' at ${kpPriv}. Was this drop created on this machine?`);
  const privateKeyPem = fs.readFileSync(kpPriv, "utf8");

  // OAuth drop: the ciphertext is a single sealed authorization code, not a map
  // of pasted secrets. Decrypt it, exchange the code for tokens HERE (our client
  // secret never leaves this Mac), and write the tokens into the profile .env.
  if (drop.kind === "oauth" || (drop.ciphertext && drop.ciphertext.__oauth__)) {
    return claimOauth(drop, privateKeyPem, profile);
  }

  const secrets = {};
  for (const [key, env] of Object.entries(drop.ciphertext)) {
    try {
      secrets[key] = openEnvelope(privateKeyPem, env);
    } catch (e) {
      throw new Error(`Failed to decrypt ${key}: ${e.message}`);
    }
  }

  const envPath = profileEnvPath(profile);
  const report = writeEnvSecrets(envPath, secrets);

  // Only burn the drop once every deposited key has actually landed. If any key
  // was skipped because the .env already had a (possibly placeholder) value, the
  // real secret did NOT get written — burning here would delete the ciphertext
  // and lose that key forever. Keep the drop deposited so the operator can clear
  // the blocking value and re-claim. (Burn-on-skip was the bug that silently
  // dropped real client keys behind 4-char placeholders.)
  const allLanded = report.skipped.length === 0;

  // Report key NAMES only — never values.
  console.log(`\nApproved drop ${drop.id} → ${envPath}`);
  if (report.filled.length) console.log(`  filled:  ${report.filled.join(", ")}`);
  if (report.added.length) console.log(`  added:   ${report.added.join(", ")}`);
  if (report.skipped.length) console.log(`  skipped (already set, not overwritten): ${report.skipped.join(", ")}`);

  if (allLanded) {
    await markConsumed(drop.id);
    console.log(`  drop burned (consumed, ciphertext deleted).`);
    console.log(`\nNext: restart the gateway to pick up the new keys:\n  hermes --profile ${profile} gateway run --replace\n`);
    runReadySmoke(profile);
  } else {
    console.log(`\n  ⚠️  Drop NOT burned — kept as 'deposited' so the real keys are not lost.`);
    console.log(`  The skipped key(s) already have a value in the profile .env (often a placeholder),`);
    console.log(`  so the deposited secret was not written. To install the deposited value(s):`);
    console.log(`    1. Clear the blocking key(s) in ${envPath} (set to e.g. STRIPE_API_KEY= with no value)`);
    console.log(`    2. Re-run: rrd-vault approve ${drop.id}`);
    console.log(`  Then restart: hermes --profile ${profile} gateway run --replace\n`);
  }
}

async function claimOauth(drop, privateKeyPem, profile) {
  let payload;
  try {
    payload = JSON.parse(openEnvelope(privateKeyPem, drop.ciphertext.__oauth__));
  } catch (e) {
    throw new Error(`Failed to decrypt the OAuth authorization: ${e.message}`);
  }
  const providerName = payload.provider || drop.provider;
  const provider = getProvider(providerName);
  const { clientId, clientSecret } = appCreds(provider.id);

  let tok;
  try {
    tok = await exchangeCode(provider.id, {
      code: payload.code,
      redirectUri: payload.redirect_uri || redirectUri(DEFAULT_BASE),
      clientId, clientSecret,
      extra: { accountsServer: payload.accountsServer, realmId: payload.realmId },
    });
  } catch (e) {
    throw new Error(`${provider.name} token exchange failed: ${e.message}. The authorization code may have expired (they are short-lived) — send a fresh connect link.`);
  }

  const env = tokensToEnv(provider.id, tok, Date.now(), payload);
  if (!env[provider.envKeys.access]) throw new Error(`${provider.name} returned no access token.`);

  const envPath = profileEnvPath(profile);
  // OAuth tokens supersede any stored values — allow overwrite for this provider's keys.
  const report = writeEnvSecrets(envPath, env, envKeysForProvider(provider.id));

  // Report key NAMES only — never values.
  console.log(`\nConnected ${provider.name} → ${envPath}`);
  const wrote = [...report.filled, ...report.replaced, ...report.added];
  if (wrote.length) console.log(`  wrote:   ${wrote.join(", ")}`);
  if (!tok.refresh_token) console.log(`  note:    provider returned no refresh token (re-consent may be needed; ensure offline access was granted).`);

  await markConsumed(drop.id);
  console.log(`  drop burned (consumed, ciphertext deleted).`);
  console.log(`\nNext: restart the gateway to pick up the connection:\n  hermes --profile ${profile} gateway run --replace\n`);
  runReadySmoke(profile);
}

async function cmdRefresh(opts) {
  const profile = opts._[1];
  const providerArg = opts._[2];
  if (!profile || !providerArg) throw new Error("usage: rrd-vault refresh <profile> <provider>");
  const provider = getProvider(providerArg);
  const { clientId, clientSecret } = appCreds(provider.id);

  const envPath = profileEnvPath(profile);
  const refreshToken = readEnvValue(envPath, provider.envKeys.refresh);
  if (!refreshToken) throw new Error(`No ${provider.envKeys.refresh} in ${envPath}. Connect ${provider.name} first with \`rrd-vault connect\`.`);
  const apiDomain = provider.envKeys.apiDomain ? readEnvValue(envPath, provider.envKeys.apiDomain) : null;

  let tok;
  try {
    tok = await refreshTokens(provider.id, { refreshToken, clientId, clientSecret, extra: { apiDomain } });
  } catch (e) {
    throw new Error(`${provider.name} refresh failed: ${e.message}`);
  }
  const env = tokensToEnv(provider.id, tok);
  if (!env[provider.envKeys.access]) throw new Error(`${provider.name} refresh returned no access token.`);

  const report = writeEnvSecrets(envPath, env, envKeysForProvider(provider.id));
  const wrote = [...report.filled, ...report.replaced, ...report.added];
  console.log(`\nRefreshed ${provider.name} → ${envPath}`);
  if (wrote.length) console.log(`  updated: ${wrote.join(", ")}`);
  console.log(`\nNext: restart the gateway if it caches tokens:\n  hermes --profile ${profile} gateway run --replace\n`);
}

async function cmdStatus() {
  const drops = await listDrops();
  if (!drops.length) { console.log("No vault drops yet."); return; }
  const now = Date.now();
  console.log("\nVault drops (newest first):\n");
  for (const d of drops) {
    const eff = d.status === "pending" && Date.parse(d.expires_at) <= now ? "expired" : d.status;
    const what = d.kind === "oauth" ? `oauth:${d.provider || "?"}` : `keys:${(d.env_keys || []).length}`;
    console.log(`  ${d.id}  ${eff.padEnd(9)}  ${d.profile.padEnd(22)}  ${what.padEnd(14)}  ${d.company || ""}`);
  }
  console.log("");
}

// Publish a submission's RSA PUBLIC key to Supabase so the serverless self-serve
// connect (Vercel) can mint oauth drops itself. The matching PRIVATE key stays on
// this Mac — zero-knowledge is preserved (only the public key, safe to expose, is
// uploaded). Idempotent upsert on submission_id.
async function publishPublicKey(submissionId) {
  const row = await fetchSubmission(submissionId);
  const rec = rowToRecord(row);
  const pack = buildHermesPack(rec);
  const profile = pack.profileName;
  const kp = loadOrCreateKeypair(profile);
  const res = await fetch(`${URL_BASE}/rest/v1/vault_public_keys`, {
    method: "POST",
    headers: {
      apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({ submission_id: submissionId, profile, public_key: kp.publicKeyPem, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`publish-key ${res.status}: ${await res.text()}`);
  return { submissionId, profile };
}

async function cmdPublishKey(opts) {
  if (!URL_BASE || !SR) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  const target = opts._[1];
  if (target && target !== "all") {
    const { profile } = await publishPublicKey(target);
    console.log(`Published public key for submission ${target} (profile ${profile}).`);
    return;
  }
  const res = await fetch(`${URL_BASE}/rest/v1/submissions?select=id`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  let ok = 0;
  for (const s of rows) {
    try { const { profile } = await publishPublicKey(s.id); ok++; console.log(`  ${s.id} -> ${profile}`); }
    catch (e) { console.error(`  ${s.id}: ${(e && e.message) || e}`); }
  }
  console.log(`Published ${ok}/${rows.length} public keys.`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0];
  if (opts.help || !cmd) { usage(); process.exit(cmd ? 0 : 1); }
  if (cmd === "new") return cmdNew(opts);
  if (cmd === "connect") return cmdConnect(opts);
  if (cmd === "approve" || cmd === "claim") return cmdApprove(opts);
  if (cmd === "refresh") return cmdRefresh(opts);
  if (cmd === "status") return cmdStatus(opts);
  if (cmd === "publish-key" || cmd === "publish-keys") return cmdPublishKey(opts);
  usage();
  process.exit(1);
}

main().catch((e) => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
