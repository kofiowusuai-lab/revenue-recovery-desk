import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadWithProfiles(dir) {
  process.env.HERMES_PROFILES_DIR = dir;
  return import(`../rrd-agent-llm.mjs?profiles=${Date.now()}-${Math.random()}`);
}

test("rrd-agent-llm writes openai-codex config and reports missing OAuth safely", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rrd-agent-llm-"));
  const dir = path.join(root, "rr-acme");
  fs.mkdirSync(dir, { recursive: true });
  const { writeRuntimeConfig, codexAuthStatus } = await loadWithProfiles(root);
  writeRuntimeConfig("rr-acme");
  const cfg = fs.readFileSync(path.join(dir, "config.yaml"), "utf8");
  assert.match(cfg, /provider:\s*openai-codex/);
  const st = codexAuthStatus("rr-acme");
  assert.equal(st.configProviderPinned, true);
  assert.equal(st.accountAssigned, false);
  assert.equal(st.runtimeStatus, "pending_account");
  assert.equal(st.authPresent, false);
  assert.equal(st.ok, false);
});

test("rrd-agent-llm assigns a FlowAudit-managed account email without storing passwords or tokens", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rrd-agent-llm-"));
  const dir = path.join(root, "rr-acme");
  fs.mkdirSync(dir, { recursive: true });
  const { assignRuntimeAccount, codexAuthStatus } = await loadWithProfiles(root);
  const state = assignRuntimeAccount("rr-acme", { accountEmail: "Acme-Agent@flowaudit.co.uk", accountLabel: "Acme ChatGPT Plus" });
  assert.equal(state.accountEmail, "acme-agent@flowaudit.co.uk");
  const stored = fs.readFileSync(path.join(dir, "llm-runtime.json"), "utf8");
  assert.match(stored, /acme-agent@flowaudit\.co\.uk/);
  assert.doesNotMatch(stored, /secret-access|secret-refresh|sk-|Bearer\s+/i);
  const mode = fs.statSync(path.join(dir, "llm-runtime.json")).mode & 0o777;
  assert.equal(mode, 0o600);
  const st = codexAuthStatus("rr-acme");
  assert.equal(st.accountAssigned, true);
  assert.equal(st.accountEmail, "acme-agent@flowaudit.co.uk");
  assert.equal(st.runtimeStatus, "pending_oauth");
  assert.equal(st.ok, false);
});

test("rrd-agent-llm rejects unsafe model names before writing config", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rrd-agent-llm-"));
  const dir = path.join(root, "rr-acme");
  fs.mkdirSync(dir, { recursive: true });
  const { writeRuntimeConfig, assignRuntimeAccount } = await loadWithProfiles(root);
  assert.throws(() => writeRuntimeConfig("rr-acme", { model: "gpt-5\nrrd:\n  unsafe: true" }), /Unsafe model name/);
  assert.throws(() => assignRuntimeAccount("rr-acme", { accountEmail: "rr-acme-agent@flowaudit.co.uk", model: "gpt-5 # injected" }), /Unsafe model name/);
});

test("rrd-agent-llm detects profile-local openai-codex OAuth without exposing token values", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rrd-agent-llm-"));
  const dir = path.join(root, "rr-acme");
  fs.mkdirSync(dir, { recursive: true });
  const { writeRuntimeConfig, assignRuntimeAccount, codexAuthStatus } = await loadWithProfiles(root);
  writeRuntimeConfig("rr-acme");
  assignRuntimeAccount("rr-acme", { accountEmail: "rr-acme-agent@flowaudit.co.uk" });
  fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({
    providers: {
      "openai-codex": { tokens: { access_token: "secret-access", refresh_token: "secret-refresh" } }
    }
  }));
  const st = codexAuthStatus("rr-acme");
  assert.equal(st.ok, true);
  assert.equal(st.authPresent, true);
  assert.equal(st.authSource, "providers.openai-codex");
  assert.equal(JSON.stringify(st).includes("secret-access"), false);
  assert.equal(JSON.stringify(st).includes("secret-refresh"), false);
});
