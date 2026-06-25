/**
 * Interop test: the EXACT WebCrypto code the client browser runs (vault-crypto.js)
 * must produce envelopes that the Node side (rrd-vault-core.openEnvelope) decrypts.
 * If the browser format and the server format ever drift, this fails.
 * Run: node --test test/rrd-vault-interop.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import { generateRsaKeypair, openEnvelope } from "../rrd-vault-core.mjs";
import { seal } from "../revenue-recovery-web/vault-crypto.js";

test("browser seal() output is decrypted by the Node openEnvelope()", async () => {
  const { publicKeyPem, privateKeyPem } = generateRsaKeypair();
  const secret = "sk_live_browser_sealed_value_123";
  const env = await seal(publicKeyPem, secret);
  assert.equal(env.v, 1);
  assert.equal(openEnvelope(privateKeyPem, env), secret);
});

test("browser seal() handles a long token (>200 bytes) end to end", async () => {
  const { publicKeyPem, privateKeyPem } = generateRsaKeypair();
  const big = "refresh_" + "Z".repeat(600);
  const env = await seal(publicKeyPem, big);
  assert.equal(openEnvelope(privateKeyPem, env), big);
});

test("browser seal() handles unicode", async () => {
  const { publicKeyPem, privateKeyPem } = generateRsaKeypair();
  const s = "clé-secrète-😀-ключ";
  const env = await seal(publicKeyPem, s);
  assert.equal(openEnvelope(privateKeyPem, env), s);
});

test("browser seal() exposes no plaintext in the payload", async () => {
  const { publicKeyPem } = generateRsaKeypair();
  const env = await seal(publicKeyPem, "PLAINTEXT_MARKER");
  assert.ok(!JSON.stringify(env).includes("PLAINTEXT_MARKER"));
});
