import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadWithProfiles(dir) {
  process.env.HERMES_PROFILES_DIR = dir;
  return import(`../rrd-ready.mjs?profiles=${Date.now()}-${Math.random()}`);
}

function writeProfile(root, profile, { env = "", manifestOverrides = {}, llmAuth = true } = {}) {
  const dir = path.join(root, profile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SOUL.md"), "# Acme\n");
  fs.writeFileSync(path.join(dir, "config.yaml"), "model:\n  provider: openai-codex\n  default: gpt-5.1-codex-max\n");
  if (llmAuth) fs.writeFileSync(path.join(dir, "llm-runtime.json"), JSON.stringify({ accountEmail: "rr-acme-agent@flowaudit.co.uk", provider: "openai-codex", authStore: "auth.json", status: "pending_oauth" }));
  if (llmAuth) fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ providers: { "openai-codex": { tokens: { access_token: "redacted-test-access", refresh_token: "redacted-test-refresh" } } } }));
  fs.writeFileSync(path.join(dir, "policy.json"), JSON.stringify({
    consent: true,
    allowedChannels: ["Email"],
    autoSendChannels: [],
    approvalModel: "approve every message",
    batchSize: null,
    doNotContact: [],
    discountCap: { type: "none", value: 0 },
    sendingHours: null,
  }));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    company: "Acme",
    readiness: { consent: true, integrationReady: true, hasSop: true },
    sop: { hasSop: true, status: "client SOP" },
    envKeysNeeded: ["STRIPE_API_KEY"],
    oauthConnectionsNeeded: ["HubSpot"],
    toolAllowlist: ["send_via_executor"],
    ...manifestOverrides,
  }));
  fs.writeFileSync(path.join(dir, ".env"), env);
}

const okFetch = async (url) => ({ ok: true, status: 200, text: async () => url.includes("hubapi") ? '{"hub_id":123}' : '{}' });

test("rrd-ready passes when threshold, secrets, provider probes, and guardrails pass", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rrd-ready-"));
  writeProfile(root, "rr-acme", { env: "STRIPE_API_KEY=sk_test_x\nHUBSPOT_ACCESS_TOKEN=hs_x\nHUBSPOT_REFRESH_TOKEN=hr_x\nHUBSPOT_TOKEN_EXPIRES_AT=2099-01-01T00:00:00Z\n" });
  const { checkReady } = await loadWithProfiles(root);
  const r = await checkReady("rr-acme", { skipOrgo: true, fetchImpl: okFetch });
  assert.equal(r.ok, true);
  assert.deepEqual(r.hardFailures, []);
});

test("rrd-ready fails closed on missing required integration secrets", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rrd-ready-"));
  writeProfile(root, "rr-acme", { env: "" });
  const { checkReady } = await loadWithProfiles(root);
  const r = await checkReady("rr-acme", { skipOrgo: true, fetchImpl: okFetch });
  assert.equal(r.ok, false);
  assert.ok(r.hardFailures.includes("env:STRIPE_API_KEY"));
  assert.ok(r.hardFailures.includes("env:HUBSPOT_ACCESS_TOKEN"));
});

test("rrd-ready fails closed until client agent ChatGPT OAuth is profile-local", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rrd-ready-"));
  writeProfile(root, "rr-acme", { env: "STRIPE_API_KEY=sk_test_x\nHUBSPOT_ACCESS_TOKEN=hs_x\nHUBSPOT_REFRESH_TOKEN=hr_x\nHUBSPOT_TOKEN_EXPIRES_AT=2099-01-01T00:00:00Z\n", llmAuth: false });
  const { checkReady } = await loadWithProfiles(root);
  const r = await checkReady("rr-acme", { skipOrgo: true, fetchImpl: okFetch });
  assert.equal(r.ok, false);
  assert.ok(r.hardFailures.includes("llm:chatgpt-oauth"));
});

test("rrd-ready requires Composio connected account ids to use ca_ prefix", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rrd-ready-"));
  writeProfile(root, "rr-acme", {
    env: "STRIPE_API_KEY=sk_test_x\nCOMPOSIO_DYNAMICS365_CONNECTED_ACCOUNT_ID=ac_wrong\n",
    manifestOverrides: {
      oauthConnectionsNeeded: [],
      composioConnectionsNeeded: ["Dynamics 365"],
      composioEnvKeysNeeded: ["COMPOSIO_DYNAMICS365_CONNECTED_ACCOUNT_ID"],
    },
  });
  const { checkReady } = await loadWithProfiles(root);
  const r = await checkReady("rr-acme", { skipOrgo: true, fetchImpl: okFetch });
  assert.equal(r.ok, false);
  const c = r.checks.find((check) => check.name === "composio:COMPOSIO_DYNAMICS365_CONNECTED_ACCOUNT_ID");
  assert.equal(c.ok, false);
});

test("rrd-ready provider probes refuse untrusted dynamic provider hosts before sending tokens", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rrd-ready-"));
  writeProfile(root, "rr-acme", {
    env: [
      "STRIPE_API_KEY=sk_test_x",
      "SALESFORCE_ACCESS_TOKEN=salesforce-secret-token",
      "SALESFORCE_REFRESH_TOKEN=salesforce-refresh",
      "SALESFORCE_INSTANCE_URL=https://evil.example.com",
      "",
    ].join("\n"),
    manifestOverrides: { oauthConnectionsNeeded: ["Salesforce"] },
  });
  const requested = [];
  const fetchImpl = async (url) => { requested.push(String(url)); return { ok: true, status: 200, text: async () => '{}' }; };
  const { checkReady } = await loadWithProfiles(root);
  const r = await checkReady("rr-acme", { skipOrgo: true, fetchImpl });
  assert.equal(r.ok, false);
  assert.ok(r.hardFailures.includes("provider:Salesforce"));
  assert.equal(requested.some((url) => url.includes("evil.example.com")), false);
});

test("rrd-ready provider probes do not place OAuth access tokens in URLs", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rrd-ready-"));
  writeProfile(root, "rr-acme", {
    env: [
      "STRIPE_API_KEY=sk_test_x",
      "HUBSPOT_ACCESS_TOKEN=hubspot-secret-token",
      "HUBSPOT_REFRESH_TOKEN=hubspot-refresh",
      "HUBSPOT_TOKEN_EXPIRES_AT=2099-01-01T00:00:00Z",
      "GOOGLE_ACCESS_TOKEN=google-secret-token",
      "GOOGLE_REFRESH_TOKEN=google-refresh",
      "GOOGLE_TOKEN_EXPIRES_AT=2099-01-01T00:00:00Z",
      "",
    ].join("\n"),
    manifestOverrides: { oauthConnectionsNeeded: ["HubSpot", "Google Workspace"] },
  });
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    return { ok: true, status: 200, text: async () => "{}" };
  };
  const { checkReady } = await loadWithProfiles(root);
  await checkReady("rr-acme", { skipOrgo: true, fetchImpl });
  assert.equal(seen.some((url) => url.includes("hubspot-secret-token")), false, seen.join("\n"));
  assert.equal(seen.some((url) => url.includes("google-secret-token")), false, seen.join("\n"));
});
