/**
 * rrd-vault-core.mjs — dependency-free crypto, .env, and state logic for the
 * Hermes Secrets Vault. Pure functions only; no Supabase, no fs, no network.
 *
 * Envelope format (mirrors the browser's WebCrypto in vault.html):
 *   AES-256-GCM encrypts the secret; RSA-OAEP(SHA-256) wraps the AES key.
 *   { v:1, k:<base64 wrapped key>, iv:<base64 12-byte iv>, ct:<base64 ct||tag> }
 * The 16-byte GCM auth tag is appended to the ciphertext (WebCrypto convention),
 * so a browser-sealed envelope and a Node-sealed envelope open identically.
 */
import crypto from "node:crypto";

// ── tokens ──────────────────────────────────────────────────────────────────
export function sha256hex(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}
export function newToken() {
  const token = crypto.randomBytes(32).toString("hex");
  return { token, tokenHash: sha256hex(token) };
}

// ── keypair + sealed-envelope crypto ─────────────────────────────────────────
export function generateRsaKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

const OAEP = { padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" };

export function sealEnvelope(publicKeyPem, plaintext) {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  const body = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ct = Buffer.concat([body, tag]); // WebCrypto appends the tag
  const wrapped = crypto.publicEncrypt({ key: publicKeyPem, ...OAEP }, aesKey);
  return { v: 1, k: wrapped.toString("base64"), iv: iv.toString("base64"), ct: ct.toString("base64") };
}

export function openEnvelope(privateKeyPem, env) {
  if (!env || env.v !== 1) throw new Error("unsupported envelope");
  const aesKey = crypto.privateDecrypt({ key: privateKeyPem, ...OAEP }, Buffer.from(env.k, "base64"));
  const iv = Buffer.from(env.iv, "base64");
  const ctTag = Buffer.from(env.ct, "base64");
  const tag = ctTag.subarray(ctTag.length - 16);
  const body = ctTag.subarray(0, ctTag.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

// ── .env placeholder filling ─────────────────────────────────────────────────
function needsQuote(v) {
  return v === "" || /[\s"#'`$\\]/.test(v);
}
function quote(v) {
  return '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
function fmt(v) {
  return needsQuote(v) ? quote(v) : v;
}

/**
 * Fill empty KEY= placeholders with secret values, never overwriting a populated
 * key. Appends keys that have no placeholder. Returns the new content plus a
 * report of which keys were filled / replaced / skipped / added. Never logs values.
 *
 * `overwrite` is the set of keys ALLOWED to replace an already-populated value.
 * Pasted API keys are never in this set (overwriting a real key would be a
 * footgun). OAuth tokens ARE: a fresh authorization or a refresh supersedes the
 * stored access/refresh token, so re-connecting must replace, not skip.
 */
export function fillEnvContent(envText, secrets, overwrite = []) {
  const lines = String(envText || "").split("\n");
  const ow = new Set(overwrite || []);
  const idx = new Map();
  lines.forEach((ln, i) => {
    const m = ln.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !idx.has(m[1])) idx.set(m[1], { i, value: m[2] });
  });

  const filled = [], replaced = [], skipped = [], added = [];
  for (const [key, value] of Object.entries(secrets || {})) {
    const hit = idx.get(key);
    if (hit) {
      if (hit.value.trim() === "") {
        lines[hit.i] = key + "=" + fmt(value);
        filled.push(key);
      } else if (ow.has(key)) {
        lines[hit.i] = key + "=" + fmt(value);
        replaced.push(key);
      } else {
        skipped.push(key);
      }
    } else {
      // append before any trailing blank line for tidiness
      if (lines.length && lines[lines.length - 1] === "") lines.splice(lines.length - 1, 0, key + "=" + fmt(value));
      else lines.push(key + "=" + fmt(value));
      added.push(key);
    }
  }
  return { content: lines.join("\n"), filled, replaced, skipped, added };
}

// ── drop state machine ───────────────────────────────────────────────────────
export function effectiveStatus(drop, nowMs = Date.now()) {
  if (drop.status === "pending" && drop.expires_at && Date.parse(drop.expires_at) <= nowMs) {
    return "expired";
  }
  return drop.status;
}
export function canDeposit(drop, nowMs = Date.now()) {
  return effectiveStatus(drop, nowMs) === "pending";
}
export function canClaim(drop) {
  return drop.status === "deposited" && !!drop.ciphertext && Object.keys(drop.ciphertext).length > 0;
}

// ── url ──────────────────────────────────────────────────────────────────────
export function depositUrl(base, token) {
  return String(base).replace(/\/+$/, "") + "/vault?token=" + encodeURIComponent(token);
}
