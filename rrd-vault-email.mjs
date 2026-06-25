#!/usr/bin/env node
/**
 * rrd-vault-email.mjs — create a fresh one-time vault drop for a client and
 * email them the deposit link via Resend.
 *
 *   node rrd-vault-email.mjs [recipient] [--profile wussworldwide] [--hours 48]
 *
 * Loads SUPABASE creds from ~/.env.local and RESEND_API_KEY from the
 * wussworldwide Next.js app env (~/wussworldwide/.env.local). Secret VALUES are
 * never printed. Mirrors the original tested flow: drop creation -> Resend email
 * with the permission-aware copy and a CTA to the one-time vault URL.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── load env from both files into process.env BEFORE importing the db module ──
function loadEnvFile(file, keys) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (keys && !keys.includes(k)) continue;
    let v = vRaw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
const HOME = "/Users/AIAgenterminal";
loadEnvFile(path.join(HOME, ".env.local"), ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
loadEnvFile(path.join(HOME, "wussworldwide", ".env.local"), ["RESEND_API_KEY"]);
process.env.RRD_VAULT_HOME = process.env.RRD_VAULT_HOME || HOME;

// ── args ──
const argv = process.argv.slice(2);
const opts = { _: [], profile: "wussworldwide", hours: 48 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--profile") opts.profile = argv[++i];
  else if (a === "--hours") opts.hours = Number(argv[++i]);
  else if (a === "--from") opts.from = argv[++i];
  else opts._.push(a);
}
const recipient = opts._[0] || "info@wussworldwide.io";
const fromAddr = opts.from || "Revenue Recovery Desk <desk@wussworldwide.io>";
const company = "Wuss Worldwide";
const envKeys = ["STRIPE_API_KEY", "HUBSPOT_ACCESS_TOKEN"];
const BASE = process.env.RRD_VAULT_BASE || process.env.RRD_WEB_BASE || "https://flowaudit.co.uk/revenue-recovery";

const RESEND = process.env.RESEND_API_KEY || "";
if (!RESEND) { console.error("Error: RESEND_API_KEY not found in wussworldwide/.env.local"); process.exit(1); }
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Error: SUPABASE creds not found in ~/.env.local"); process.exit(1);
}

const { newToken, depositUrl } = await import("./rrd-vault-core.mjs");
const { loadOrCreateKeypair } = await import("./rrd-vault-fs.mjs");
const { createDrop } = await import("./rrd-vault-db.mjs");

// ── create the drop ──
const kp = loadOrCreateKeypair(opts.profile);
const { token, tokenHash } = newToken();
const expiresAt = new Date(Date.now() + opts.hours * 3600 * 1000).toISOString();
const drop = await createDrop({
  profile: opts.profile,
  submission_id: null,
  company,
  env_keys: envKeys,
  public_key: kp.publicKeyPem,
  token_hash: tokenHash,
  expires_at: expiresAt,
});
const url = depositUrl(BASE, token);

// ── email copy (permission-aware, matching the vault.html amber callout) ──
const subject = "Securely send your API keys";
const keyList = envKeys.join(" and ");
const text = [
  `Hi ${company} team,`,
  ``,
  `To finish setting up your revenue recovery, we need two API keys: ${keyList}.`,
  ``,
  `Use this secure one-time link to send them. Your browser encrypts the keys so only our machine can read them, and the link burns after a single use:`,
  ``,
  `  ${url}`,
  ``,
  `Heads up on permissions: some keys need WRITE access so we can create payment links and payment plans on your behalf. Please grant only the permissions listed on the page, nothing broader.`,
  ``,
  `This link expires in ${opts.hours} hours. If it expires, just reply and we'll send a fresh one.`,
  ``,
  `Revenue Recovery Desk`,
].join("\n");

const html = `<!doctype html><html><body style="margin:0;background:#0b0f14;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e6edf3">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <h1 style="font-size:20px;margin:0 0 16px">Securely send your API keys</h1>
    <p style="font-size:15px;line-height:1.6;color:#c2cbd4">Hi ${company} team,</p>
    <p style="font-size:15px;line-height:1.6;color:#c2cbd4">To finish setting up your revenue recovery, we need two API keys: <strong>${envKeys.join("</strong> and <strong>")}</strong>.</p>
    <p style="font-size:15px;line-height:1.6;color:#c2cbd4">Use the secure one-time link below. Your browser encrypts the keys so only our machine can read them, and the link burns after a single use.</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${url}" style="display:inline-block;background:#2ea043;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:8px">Send my keys securely</a>
    </div>
    <div style="background:#3a2d10;border:1px solid #7a5d12;border-radius:8px;padding:14px 16px;margin:20px 0">
      <p style="margin:0;font-size:13px;line-height:1.55;color:#f0d68a"><strong>About permissions:</strong> some keys need <strong>write access</strong> so we can create payment links and payment plans on your behalf. Please grant only the permissions listed on the page, nothing broader.</p>
    </div>
    <p style="font-size:13px;line-height:1.6;color:#8b949e">This link expires in ${opts.hours} hours. If it expires, just reply and we'll send a fresh one.</p>
    <p style="font-size:13px;line-height:1.6;color:#8b949e">Revenue Recovery Desk</p>
  </div>
</body></html>`;

// ── send via Resend ──
const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
  body: JSON.stringify({ from: fromAddr, to: [recipient], subject, html, text }),
});
const bodyText = await res.text();
if (!res.ok) {
  console.error(`Resend ${res.status}: ${bodyText}`);
  console.error(`(Drop ${drop.id} was created; you can resend or approve it.)`);
  process.exit(1);
}
let messageId = "";
try { messageId = JSON.parse(bodyText).id || ""; } catch {}

console.log(`\nEmail sent ✅`);
console.log(`  to:        ${recipient}`);
console.log(`  from:      ${fromAddr}`);
console.log(`  subject:   ${subject}`);
console.log(`  resend id: ${messageId}`);
console.log(`\nFresh vault drop created:`);
console.log(`  drop id:   ${drop.id}`);
console.log(`  profile:   ${opts.profile}  (${company})`);
console.log(`  keys:      ${envKeys.join(", ")}`);
console.log(`  expires:   ${expiresAt} (${opts.hours}h)`);
console.log(`\nAfter the client deposits, approve with:\n  rrd-vault approve ${drop.id}\n`);
