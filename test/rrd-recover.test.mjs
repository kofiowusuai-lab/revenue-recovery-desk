/**
 * Tests for the gated recovery executor (rrd-recover.mjs).
 * Proves the executor is a real choke point: nothing is dispatched unless the
 * gate, caps, and allowlist all pass. All deps injected — no network, no disk.
 * Run: node --test test/rrd-recover.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execute, channelKind, resolvePostGridCredential } from "../rrd-recover.mjs";
import { buildPolicy } from "../rrd-guardrails.mjs";

const POLICY = buildPolicy({
  company: "Acme", consent: true,
  outreach: { channels: ["Email", "SMS", "Letter"], businessHours: "9-17" },
  guardrails: { autoSendChannels: ["Email"], batchSize: 25, doNotContact: "vip@acme.com", maxDiscount: "10%" },
  recoveryProcess: {}
});
const ALLOWLIST = ["read_payments", "read_crm", "draft_message", "queue_for_approval", "send_via_executor", "generate_payment_link"];
const CAPS = { sendsToday: 200, lettersToday: 50, spendTodayUsd: 500, desktopMinutesToday: 240 };

function harness(over = {}) {
  const calls = { adapters: [], usage: [], audit: [] };
  const deps = {
    policy: POLICY, allowlist: ALLOWLIST, caps: CAPS,
    capCheck: () => ({ allowed: true, violations: [] }),
    usageBump: (p, d) => { calls.usage.push(d); },
    auditWrite: (p, e) => { calls.audit.push(e); },
    adapters: {
      email: async (a) => { calls.adapters.push(["email", a]); return { id: "em_1", status: "sent" }; },
      sms: async (a) => { calls.adapters.push(["sms", a]); return { id: "sms_1" }; },
      letter: async (a) => { calls.adapters.push(["letter", a]); return { id: "letter_1", status: "ready" }; }
    },
    ...over
  };
  return { deps, calls };
}

test("channelKind maps names", () => {
  assert.equal(channelKind("Email"), "email");
  assert.equal(channelKind("Letter"), "letter");
  assert.equal(channelKind("WhatsApp"), "unknown");
});

test("clean auto-channel send dispatches + records usage + audits", async () => {
  const { deps, calls } = harness();
  const r = await execute("rr-acme", { channel: "Email", to: { email: "ok@cust.com" }, atHour: 10, batchIndex: 0 }, { send: true, deps });
  assert.equal(r.sent, true, JSON.stringify(r.decision));
  assert.equal(calls.adapters.length, 1);
  assert.equal(calls.adapters[0][0], "email");
  assert.equal(calls.usage[0].sends, 1);
  assert.ok(calls.audit.length >= 1);
});

test("do-not-contact is blocked and never dispatches", async () => {
  const { deps, calls } = harness();
  const r = await execute("rr-acme", { channel: "Email", to: { email: "vip@acme.com" }, atHour: 10 }, { send: true, deps });
  assert.equal(r.sent, false);
  assert.equal(calls.adapters.length, 0);
  assert.ok(r.decision.violations.some((v) => v.code === "DO_NOT_CONTACT"));
});

test("approval-gated channel without approval is blocked", async () => {
  const { deps, calls } = harness();
  const r = await execute("rr-acme", { channel: "SMS", to: { email: "ok@cust.com" }, atHour: 10 }, { send: true, deps });
  assert.equal(r.sent, false);
  assert.equal(calls.adapters.length, 0);
  assert.ok(r.decision.violations.some((v) => v.code === "APPROVAL_REQUIRED"));
});

test("approved gated channel dispatches", async () => {
  const { deps, calls } = harness();
  const r = await execute("rr-acme", { channel: "SMS", to: { email: "ok@cust.com" }, approved: true, atHour: 10 }, { send: true, deps });
  assert.equal(r.sent, true, JSON.stringify(r.decision));
  assert.equal(calls.adapters[0][0], "sms");
});

test("letter requires approval by default (not in autoSend) and is blocked without it", async () => {
  const { deps, calls } = harness();
  const r = await execute("rr-acme", { channel: "Letter", to: { name: "Cust" }, atHour: 10 }, { send: true, deps });
  assert.equal(r.sent, false);
  assert.equal(calls.adapters.length, 0);
});

test("approved letter dispatches to the letter adapter", async () => {
  const { deps, calls } = harness();
  const r = await execute("rr-acme", { channel: "Letter", to: { name: "Cust" }, approved: true, atHour: 10, certified: true }, { send: true, deps });
  assert.equal(r.sent, true, JSON.stringify(r.decision));
  assert.equal(calls.adapters[0][0], "letter");
  assert.equal(calls.usage[0].letters, 1);
});

test("PostGrid credential resolver prefers client key, then shared fallback, and respects opt-out", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rrd-postgrid-"));
  const profilesDir = path.join(root, "profiles");
  const operatorEnvPath = path.join(root, ".openclaw.env");
  fs.mkdirSync(path.join(profilesDir, "rr-client"), { recursive: true });
  fs.mkdirSync(path.join(profilesDir, "rr-shared"), { recursive: true });
  fs.mkdirSync(path.join(profilesDir, "rr-optout"), { recursive: true });
  fs.writeFileSync(path.join(profilesDir, "rr-client", ".env"), "POSTGRID_API_KEY=client_key\n");
  fs.writeFileSync(path.join(profilesDir, "rr-optout", ".env"), "POSTGRID_LETTERS_OPT_OUT=true\n");
  fs.writeFileSync(operatorEnvPath, "RRD_SHARED_POSTGRID_API_KEY=shared_key\n");

  const client = resolvePostGridCredential("rr-client", { profilesDir, operatorEnvPath, env: {} });
  assert.equal(client.source, "client");
  assert.equal(client.envName, "POSTGRID_API_KEY");
  assert.equal(client.billableToClient, false);

  const shared = resolvePostGridCredential("rr-shared", { profilesDir, operatorEnvPath, env: {} });
  assert.equal(shared.source, "shared");
  assert.equal(shared.envName, "RRD_SHARED_POSTGRID_API_KEY");
  assert.equal(shared.billableToClient, true);
  assert.equal(shared.billTo, "rr-shared");

  assert.throws(() => resolvePostGridCredential("rr-optout", { profilesDir, operatorEnvPath, env: {} }), /opted out/);
});

test("shared PostGrid letter writes a billing usage row for the right company", async () => {
  const calls = { usageRows: [] };
  const { deps } = harness({
    adapters: {
      letter: async () => ({ id: "letter_shared_1", status: "ready", postgridBilling: { source: "shared", envName: "RRD_SHARED_POSTGRID_API_KEY", billTo: "rr-acme", billableToClient: true } })
    },
    postgridUsageWrite: (profile, action, result, billing) => calls.usageRows.push({ profile, action, result, billing })
  });
  const r = await execute("rr-acme", { channel: "Letter", to: { companyName: "Debtor Ltd", country: "GB" }, approved: true, atHour: 10, certified: true, invoiceId: "inv_1", costUsd: 2.5 }, { send: true, deps });
  assert.equal(r.sent, true, JSON.stringify(r.decision));
  assert.equal(calls.usageRows.length, 1);
  assert.equal(calls.usageRows[0].profile, "rr-acme");
  assert.equal(calls.usageRows[0].billing.source, "shared");
  assert.equal(calls.usageRows[0].billing.billTo, "rr-acme");
  assert.equal(calls.usageRows[0].action.rrdCompany, "Acme");
  assert.equal(calls.usageRows[0].result.id, "letter_shared_1");
});

test("tool not on allowlist is blocked (deny-by-default)", async () => {
  const { deps, calls } = harness();
  const r = await execute("rr-acme", { channel: "Email", to: { email: "ok@cust.com" }, approved: true, atHour: 10, tool: "rm_rf" }, { send: true, deps });
  assert.equal(r.sent, false);
  assert.equal(calls.adapters.length, 0);
  assert.ok(r.decision.violations.some((v) => v.code === "TOOL_NOT_ALLOWED"));
});

test("caps exceeded blocks before dispatch", async () => {
  const { deps, calls } = harness({ capCheck: () => ({ allowed: false, violations: [{ code: "CAP_SENDSTODAY", msg: "limit" }] }) });
  const r = await execute("rr-acme", { channel: "Email", to: { email: "ok@cust.com" }, atHour: 10 }, { send: true, deps });
  assert.equal(r.sent, false);
  assert.equal(calls.adapters.length, 0);
  assert.ok(r.decision.violations.some((v) => v.code === "CAP_SENDSTODAY"));
});

test("missing policy fails closed", async () => {
  const { deps } = harness({ policy: null });
  // policy:null in deps means execute falls back to loadPolicy(profile) which won't find this fake profile
  const r = await execute("rr-nonexistent-xyz", { channel: "Email", to: { email: "ok@cust.com" }, atHour: 10 }, { send: true, deps: { ...deps, policy: undefined } });
  assert.equal(r.sent, false);
  assert.ok(r.decision.violations.some((v) => v.code === "NO_POLICY"));
});

test("adapter error is caught and audited, not thrown", async () => {
  const { deps, calls } = harness({ adapters: { email: async () => { throw new Error("provider down"); } } });
  const r = await execute("rr-acme", { channel: "Email", to: { email: "ok@cust.com" }, atHour: 10 }, { send: true, deps });
  assert.equal(r.sent, false);
  assert.ok(r.decision.violations.some((v) => v.code === "ADAPTER_ERROR"));
  assert.ok(calls.audit.length >= 1);
});

test("gate mode never dispatches even when allowed", async () => {
  const { deps, calls } = harness();
  const r = await execute("rr-acme", { channel: "Email", to: { email: "ok@cust.com" }, atHour: 10 }, { send: false, deps });
  assert.equal(calls.adapters.length, 0);
  assert.equal(r.wouldSend, true);
  assert.equal(r.decision.allowed, true);
});
