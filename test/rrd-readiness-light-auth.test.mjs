import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function baseClient() {
  return {
    id: "sub-1",
    company: "Acme Co",
    submittedAt: "2026-06-01T00:00:00Z",
    consent: true,
    primaryContact: "Jane",
    contacts: [{ name: "Jane", email: "j@acme.co" }],
    paymentStack: { apiAccess: "Yes", platforms: [] },
    crmData: { apiAccess: "Yes", crm: "" },
    recoveryProcess: {},
    documents: [],
    outreach: {
      timezone: "GMT",
      businessHours: "9-5",
      fromName: "Acme AR",
      emailProvider: "SendGrid",
      channels: ["Email"],
      letters: { returnAddress: { line1: "1 High St", name: "Acme AR" } },
    },
    guardrails: { doNotContact: "none", maxDiscount: 10, escalationTriggers: "dispute", approvalRouting: { approvers: "jane", preferredChannel: "email" } },
    approvalRouting: { approvers: "jane", preferredChannel: "email" },
  };
}

function find(result, sub) {
  for (const g of result.groups) for (const it of g.items) if (it.label.includes(sub)) return it;
  return null;
}

test("light readiness uses safe Codex auth parser instead of auth.json string matching", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rrd-readiness-light-"));
  process.env.HERMES_PROFILES_DIR = root;
  const profile = "rr-acme-co";
  const dir = path.join(root, profile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SOUL.md"), "# Acme\n");
  fs.writeFileSync(path.join(dir, "config.yaml"), "model:\n  provider: openai-codex\n");
  fs.writeFileSync(path.join(dir, "llm-runtime.json"), JSON.stringify({ accountEmail: "rr-acme-agent@flowaudit.co.uk", provider: "openai-codex", authStore: "auth.json", status: "pending_oauth" }));
  fs.writeFileSync(path.join(dir, "auth.json"), '{"credential_pool":{"openai\\u002dcodex":[{"tokens":{"access_token":"synthetic-access-token"}}]}}');
  const { buildChecklist } = await import(`../rrd-readiness-checklist.mjs?profiles=${Date.now()}-${Math.random()}`);
  const result = buildChecklist({
    client: baseClient(),
    pack: { profileName: profile, manifest: { envKeysNeeded: [], oauthConnectionsNeeded: [], composioConnectionsNeeded: [], composioEnvKeysNeeded: [] } },
    entry: {},
    profileEnv: {},
  });
  assert.equal(find(result, "ChatGPT agent OAuth").status, "done");
});
