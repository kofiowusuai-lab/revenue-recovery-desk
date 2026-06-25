/**
 * Tests for rrd-vault-core.mjs — the dependency-free crypto + .env + state logic
 * behind the Hermes Secrets Vault. Run: node --test test/rrd-vault-core.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  sha256hex,
  newToken,
  generateRsaKeypair,
  sealEnvelope,
  openEnvelope,
  fillEnvContent,
  effectiveStatus,
  canDeposit,
  canClaim,
  depositUrl,
} from "../rrd-vault-core.mjs";

// ── tokens ────────────────────────────────────────────────────────────────
test("sha256hex is deterministic and 64 hex chars", () => {
  const a = sha256hex("hello");
  const b = sha256hex("hello");
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(sha256hex("hello"), sha256hex("world"));
});

test("newToken returns a 64-hex token and its matching sha256 hash", () => {
  const { token, tokenHash } = newToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(tokenHash, sha256hex(token));
});

test("newToken is unguessable — two calls differ", () => {
  assert.notEqual(newToken().token, newToken().token);
});

// ── keypair + sealed-envelope crypto ────────────────────────────────────────
test("generateRsaKeypair returns PEM public and private keys", () => {
  const { publicKeyPem, privateKeyPem } = generateRsaKeypair();
  assert.match(publicKeyPem, /-----BEGIN PUBLIC KEY-----/);
  assert.match(privateKeyPem, /-----BEGIN PRIVATE KEY-----/);
});

test("sealEnvelope → openEnvelope round-trips the plaintext", () => {
  const { publicKeyPem, privateKeyPem } = generateRsaKeypair();
  const secret = "sk_live_51AbCdEf_example_stripe_key";
  const env = sealEnvelope(publicKeyPem, secret);
  assert.equal(openEnvelope(privateKeyPem, env), secret);
});

test("sealed envelope is non-deterministic (fresh AES key + IV each call)", () => {
  const { publicKeyPem } = generateRsaKeypair();
  const a = sealEnvelope(publicKeyPem, "same-secret");
  const b = sealEnvelope(publicKeyPem, "same-secret");
  assert.notDeepEqual(a, b);
});

test("sealed envelope handles secrets larger than an RSA block (>200 bytes)", () => {
  const { publicKeyPem, privateKeyPem } = generateRsaKeypair();
  const big = "tok_" + "x".repeat(500); // would overflow raw RSA-OAEP
  const env = sealEnvelope(publicKeyPem, big);
  assert.equal(openEnvelope(privateKeyPem, env), big);
});

test("openEnvelope with the wrong private key throws", () => {
  const a = generateRsaKeypair();
  const b = generateRsaKeypair();
  const env = sealEnvelope(a.publicKeyPem, "secret");
  assert.throws(() => openEnvelope(b.privateKeyPem, env));
});

test("envelope payload exposes no plaintext", () => {
  const { publicKeyPem } = generateRsaKeypair();
  const env = sealEnvelope(publicKeyPem, "TOPSECRET_VALUE");
  assert.ok(!JSON.stringify(env).includes("TOPSECRET_VALUE"));
});

// ── .env placeholder filling ────────────────────────────────────────────────
test("fillEnvContent fills an empty placeholder line", () => {
  const src = "# header\nSTRIPE_API_KEY=\nHUBSPOT_ACCESS_TOKEN=\n";
  const r = fillEnvContent(src, { STRIPE_API_KEY: "sk_live_abc" });
  assert.match(r.content, /^STRIPE_API_KEY=sk_live_abc$/m);
  assert.match(r.content, /^HUBSPOT_ACCESS_TOKEN=$/m); // untouched
  assert.deepEqual(r.filled, ["STRIPE_API_KEY"]);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.added, []);
});

test("fillEnvContent never overwrites an already-populated key", () => {
  const src = "STRIPE_API_KEY=already_set\n";
  const r = fillEnvContent(src, { STRIPE_API_KEY: "new_value" });
  assert.match(r.content, /^STRIPE_API_KEY=already_set$/m);
  assert.ok(!r.content.includes("new_value"));
  assert.deepEqual(r.skipped, ["STRIPE_API_KEY"]);
  assert.deepEqual(r.filled, []);
});

test("fillEnvContent appends a key that has no placeholder", () => {
  const src = "STRIPE_API_KEY=\n";
  const r = fillEnvContent(src, { TWILIO_AUTH_TOKEN: "abc123" });
  assert.match(r.content, /^TWILIO_AUTH_TOKEN=abc123$/m);
  assert.deepEqual(r.added, ["TWILIO_AUTH_TOKEN"]);
});

test("fillEnvContent preserves comments, blanks, and unrelated keys", () => {
  const src = "# comment\n\nOTHER=keepme\nSTRIPE_API_KEY=\n";
  const r = fillEnvContent(src, { STRIPE_API_KEY: "v" });
  assert.match(r.content, /^# comment$/m);
  assert.match(r.content, /^OTHER=keepme$/m);
  assert.match(r.content, /^\s*$/m);
});

test("fillEnvContent quotes values containing whitespace or special chars", () => {
  const src = "WEIRD_KEY=\n";
  const r = fillEnvContent(src, { WEIRD_KEY: "has spaces #and hash" });
  assert.match(r.content, /^WEIRD_KEY="has spaces #and hash"$/m);
});

test("fillEnvContent escapes embedded quotes and backslashes when quoting", () => {
  const src = "Q=\n";
  const r = fillEnvContent(src, { Q: 'a"b\\c d' });
  assert.match(r.content, /^Q="a\\"b\\\\c d"$/m);
});

test("fillEnvContent is idempotent — second run is a no-op skip", () => {
  const src = "STRIPE_API_KEY=\n";
  const once = fillEnvContent(src, { STRIPE_API_KEY: "v" });
  const twice = fillEnvContent(once.content, { STRIPE_API_KEY: "v" });
  assert.equal(twice.content, once.content);
  assert.deepEqual(twice.skipped, ["STRIPE_API_KEY"]);
});

// ── drop state machine ──────────────────────────────────────────────────────
const HOUR = 3600 * 1000;
const t0 = new Date("2026-06-20T00:00:00Z").getTime();

test("effectiveStatus returns 'expired' for a pending drop past its expiry", () => {
  const drop = { status: "pending", expires_at: new Date(t0).toISOString() };
  assert.equal(effectiveStatus(drop, t0 + HOUR), "expired");
});

test("effectiveStatus leaves a fresh pending drop as 'pending'", () => {
  const drop = { status: "pending", expires_at: new Date(t0 + 48 * HOUR).toISOString() };
  assert.equal(effectiveStatus(drop, t0 + HOUR), "pending");
});

test("effectiveStatus never resurrects a consumed drop", () => {
  const drop = { status: "consumed", expires_at: new Date(t0).toISOString() };
  assert.equal(effectiveStatus(drop, t0 + HOUR), "consumed");
});

test("canDeposit only for a pending, unexpired drop", () => {
  assert.equal(canDeposit({ status: "pending", expires_at: new Date(t0 + HOUR).toISOString() }, t0), true);
  assert.equal(canDeposit({ status: "pending", expires_at: new Date(t0).toISOString() }, t0 + HOUR), false);
  assert.equal(canDeposit({ status: "deposited", expires_at: new Date(t0 + HOUR).toISOString() }, t0), false);
  assert.equal(canDeposit({ status: "consumed", expires_at: new Date(t0 + HOUR).toISOString() }, t0), false);
});

test("canClaim only for a deposited drop with ciphertext", () => {
  assert.equal(canClaim({ status: "deposited", ciphertext: { K: {} } }), true);
  assert.equal(canClaim({ status: "deposited", ciphertext: null }), false);
  assert.equal(canClaim({ status: "pending", ciphertext: { K: {} } }), false);
  assert.equal(canClaim({ status: "consumed", ciphertext: { K: {} } }), false);
});

// ── url ─────────────────────────────────────────────────────────────────────
test("depositUrl builds a clean vault link", () => {
  assert.equal(
    depositUrl("https://revenue-recovery-web.vercel.app", "abc123"),
    "https://revenue-recovery-web.vercel.app/vault?token=abc123"
  );
  // trailing slash on base is normalized
  assert.equal(
    depositUrl("https://x.app/", "tok"),
    "https://x.app/vault?token=tok"
  );
});
