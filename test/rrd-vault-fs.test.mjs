/**
 * Tests for rrd-vault-fs.mjs — keypair custody and safe .env writing.
 * Run: node --test test/rrd-vault-fs.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadOrCreateKeypair, profileEnvPath, writeEnvSecrets, readEnvValue } from "../rrd-vault-fs.mjs";
import { sealEnvelope, openEnvelope } from "../rrd-vault-core.mjs";

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rrd-vault-test-"));
}

test("loadOrCreateKeypair creates a 600 private key under the home and is stable", () => {
  const home = tmpHome();
  const a = loadOrCreateKeypair("rr-acme", { home });
  assert.match(a.publicKeyPem, /BEGIN PUBLIC KEY/);
  assert.match(a.privateKeyPem, /BEGIN PRIVATE KEY/);

  const privPath = path.join(home, ".hermes", "vault", "keys", "rr-acme.pem");
  assert.ok(fs.existsSync(privPath));
  assert.equal(fs.statSync(privPath).mode & 0o777, 0o600);

  // second call returns the SAME key (does not regenerate)
  const b = loadOrCreateKeypair("rr-acme", { home });
  assert.equal(a.privateKeyPem, b.privateKeyPem);
});

test("each profile gets its own keypair", () => {
  const home = tmpHome();
  const a = loadOrCreateKeypair("rr-acme", { home });
  const b = loadOrCreateKeypair("rr-globex", { home });
  assert.notEqual(a.privateKeyPem, b.privateKeyPem);
});

test("profileEnvPath points at the Hermes profile .env", () => {
  const home = "/tmp/fakehome";
  assert.equal(profileEnvPath("rr-acme", { home }), "/tmp/fakehome/.hermes/profiles/rr-acme/.env");
});

test("writeEnvSecrets fills placeholders, backs up, and locks the file to 600", () => {
  const home = tmpHome();
  const dir = path.join(home, ".hermes", "profiles", "acme");
  fs.mkdirSync(dir, { recursive: true });
  const envPath = path.join(dir, ".env");
  fs.writeFileSync(envPath, "# secrets\nSTRIPE_API_KEY=\nHUBSPOT_ACCESS_TOKEN=\n");

  const report = writeEnvSecrets(envPath, { STRIPE_API_KEY: "sk_live_xyz" });

  const after = fs.readFileSync(envPath, "utf8");
  assert.match(after, /^STRIPE_API_KEY=sk_live_xyz$/m);
  assert.match(after, /^HUBSPOT_ACCESS_TOKEN=$/m);
  assert.deepEqual(report.filled, ["STRIPE_API_KEY"]);
  assert.equal(fs.statSync(envPath).mode & 0o777, 0o600);
  assert.ok(fs.existsSync(envPath + ".bak"), "a backup was written");
});

test("writeEnvSecrets refuses to overwrite a populated key", () => {
  const home = tmpHome();
  const dir = path.join(home, ".hermes", "profiles", "acme");
  fs.mkdirSync(dir, { recursive: true });
  const envPath = path.join(dir, ".env");
  fs.writeFileSync(envPath, "STRIPE_API_KEY=already_live\n");

  const report = writeEnvSecrets(envPath, { STRIPE_API_KEY: "attacker_value" });
  const after = fs.readFileSync(envPath, "utf8");
  assert.match(after, /^STRIPE_API_KEY=already_live$/m);
  assert.ok(!after.includes("attacker_value"));
  assert.deepEqual(report.skipped, ["STRIPE_API_KEY"]);
});

test("writeEnvSecrets creates the .env if the profile has none yet", () => {
  const home = tmpHome();
  const dir = path.join(home, ".hermes", "profiles", "acme");
  fs.mkdirSync(dir, { recursive: true });
  const envPath = path.join(dir, ".env");

  const report = writeEnvSecrets(envPath, { STRIPE_API_KEY: "sk_new" });
  assert.match(fs.readFileSync(envPath, "utf8"), /^STRIPE_API_KEY=sk_new$/m);
  assert.deepEqual(report.added, ["STRIPE_API_KEY"]);
  assert.equal(fs.statSync(envPath).mode & 0o777, 0o600);
});

test("writeEnvSecrets overwrites a populated key ONLY when it is whitelisted (OAuth tokens)", () => {
  const home = tmpHome();
  const dir = path.join(home, ".hermes", "profiles", "acme");
  fs.mkdirSync(dir, { recursive: true });
  const envPath = path.join(dir, ".env");
  fs.writeFileSync(envPath, "HUBSPOT_ACCESS_TOKEN=stale\nSTRIPE_API_KEY=already_live\n");

  const report = writeEnvSecrets(
    envPath,
    { HUBSPOT_ACCESS_TOKEN: "fresh", STRIPE_API_KEY: "attacker_value" },
    ["HUBSPOT_ACCESS_TOKEN"],
  );
  const after = fs.readFileSync(envPath, "utf8");
  assert.match(after, /^HUBSPOT_ACCESS_TOKEN=fresh$/m);   // OAuth token replaced
  assert.match(after, /^STRIPE_API_KEY=already_live$/m);   // API key untouched
  assert.deepEqual(report.replaced, ["HUBSPOT_ACCESS_TOKEN"]);
  assert.deepEqual(report.skipped, ["STRIPE_API_KEY"]);
});

test("readEnvValue returns a stored value, strips quotes, and is null for empty/absent", () => {
  const home = tmpHome();
  const dir = path.join(home, ".hermes", "profiles", "acme");
  fs.mkdirSync(dir, { recursive: true });
  const envPath = path.join(dir, ".env");
  fs.writeFileSync(envPath, 'ZOHO_REFRESH_TOKEN=1000.abc.def\nZOHO_API_DOMAIN="https://www.zohoapis.eu"\nEMPTY_KEY=\n');

  assert.equal(readEnvValue(envPath, "ZOHO_REFRESH_TOKEN"), "1000.abc.def");
  assert.equal(readEnvValue(envPath, "ZOHO_API_DOMAIN"), "https://www.zohoapis.eu");
  assert.equal(readEnvValue(envPath, "EMPTY_KEY"), null);
  assert.equal(readEnvValue(envPath, "MISSING"), null);
  assert.equal(readEnvValue(path.join(dir, "nope.env"), "ANY"), null);
});

test("a key sealed for a profile is decryptable with that profile's private key", () => {
  const home = tmpHome();
  const kp = loadOrCreateKeypair("rr-acme", { home });
  const env = sealEnvelope(kp.publicKeyPem, "round-trip-secret");
  assert.equal(openEnvelope(kp.privateKeyPem, env), "round-trip-secret");
});
