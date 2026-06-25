/**
 * Tests for the recovery orchestrator (rrd-collect.mjs).
 * Orchestration is tested with an injected executor; one end-to-end test wires the
 * REAL gate + drafter + a canned email adapter to prove invoice -> draft -> gate ->
 * send works as a whole. No network, no disk. Run: node --test test/rrd-collect.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { recover, buildAction, resolveStripeKey, normalizeHubSpotDeal, listOverdueHubSpotDealsViaComposio } from "../rrd-collect.mjs";
import { execute } from "../rrd-recover.mjs";
import { buildPolicy } from "../rrd-guardrails.mjs";

const invWith = (over = {}) => ({
  id: "in_1", number: "INV-1", currency: "USD", amount: 1200, daysOverdue: 21,
  customerEmail: "jane@cust.com", customerName: "Jane", hostedInvoiceUrl: "https://pay/in_1", ...over
});

test("maps invoices to drafted, gated actions and tallies outcomes", async () => {
  const seen = [];
  const out = await recover("rr-acme", {
    atHour: 10,
    deps: {
      manifest: { company: "Acme" },
      listInvoices: async () => [invWith(), invWith({ id: "in_2", customerEmail: null, amount: 300 })],
      executeImpl: async (p, a) => { seen.push(a); return { sent: true, decision: { allowed: true, violations: [] } }; }
    }
  });
  assert.equal(out.company, "Acme");
  assert.equal(out.found, 2);
  assert.equal(out.skipped, 1);
  assert.equal(out.summary.byOutcome.sent, 1);
  assert.equal(out.summary.byOutcome.skipped, 1);
  assert.equal(out.summary.targetedUsd, 1200);            // skipped invoice not counted
  assert.equal(seen.length, 1);                            // only the one with an email
  assert.equal(seen[0].channel, "Email");
  assert.equal(seen[0].tool, "send_via_executor");
  assert.match(seen[0].html, /pay\/in_1/);
});

test("recover appends normalized dashboard event rows when event emission is enabled", async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-recover-events-'));
  const out = await recover("rr-acme", {
    atHour: 10,
    emitEvents: true,
    eventQueueDir: dir,
    now: Date.parse('2026-06-23T12:00:00Z'),
    deps: {
      manifest: { company: "Acme", submissionId: "44444444-4444-4444-8444-444444444444" },
      listInvoices: async () => [invWith()],
      executeImpl: async () => ({ wouldSend: true, decision: { allowed: true, violations: [] } })
    }
  });
  assert.equal(out.summary.byOutcome.would_send, 1);
  const row = JSON.parse(fs.readFileSync(path.join(dir, 'rr-acme.ndjson'), 'utf8').trim());
  assert.equal(row.submission_id, '44444444-4444-4444-8444-444444444444');
  assert.equal(row.event_type, 'gate_decision');
  assert.equal(row.outcome, 'would_send');
});

test("dry run passes send=false to the executor", async () => {
  let sawSend = null;
  await recover("rr-acme", {
    send: false, atHour: 10,
    deps: {
      manifest: { company: "Acme" },
      listInvoices: async () => [invWith()],
      executeImpl: async (p, a, o) => { sawSend = o.send; return { wouldSend: true, decision: { allowed: true, violations: [] } }; }
    }
  });
  assert.equal(sawSend, false);
});

test("blocked invoices are surfaced with their reasons", async () => {
  const out = await recover("rr-acme", {
    atHour: 10,
    deps: {
      manifest: { company: "Acme" },
      listInvoices: async () => [invWith()],
      executeImpl: async () => ({ sent: false, decision: { allowed: false, requiresHuman: true, violations: [{ code: "DO_NOT_CONTACT", msg: "x" }] } })
    }
  });
  assert.equal(out.summary.byOutcome.blocked, 1);
  assert.equal(out.summary.blockedReasons.DO_NOT_CONTACT, 1);
  assert.equal(out.results[0].requiresHuman, true);
});

test("forwards filter options to the invoice lister", async () => {
  let opts = null;
  await recover("rr-acme", {
    minAmountUsd: 100, minDaysOverdue: 7, limit: 25, atHour: 10,
    deps: { manifest: {}, listInvoices: async (o) => { opts = o; return []; }, executeImpl: async () => ({}) }
  });
  assert.equal(opts.minAmountUsd, 100);
  assert.equal(opts.minDaysOverdue, 7);
  assert.equal(opts.limit, 25);
});

test("end to end: invoice -> draft -> REAL gate -> canned email adapter sends", async () => {
  const POLICY = buildPolicy({
    company: "Acme", consent: true,
    outreach: { channels: ["Email"], businessHours: "9-17" },
    guardrails: { autoSendChannels: ["Email"] }, recoveryProcess: {}
  });
  const ALLOWLIST = ["read_payments", "draft_message", "send_via_executor", "generate_payment_link"];
  const adapterCalls = [];
  const usage = [];
  const executeImpl = (p, a, o) => execute(p, a, {
    ...o,
    deps: {
      policy: POLICY, allowlist: ALLOWLIST,
      capCheck: () => ({ allowed: true, violations: [] }),
      usageBump: (pp, d) => usage.push(d),
      auditWrite: () => {},
      adapters: { email: async (act) => { adapterCalls.push(act); return { id: "em_1", status: "sent" }; } }
    }
  });

  const out = await recover("rr-acme", {
    send: true, atHour: 10,
    deps: { manifest: { company: "Acme" }, listInvoices: async () => [invWith()], executeImpl }
  });

  assert.equal(out.summary.byOutcome.sent, 1, JSON.stringify(out.results[0]));
  assert.equal(adapterCalls.length, 1);
  assert.equal(adapterCalls[0].subject, out.results[0].subject);
  assert.match(adapterCalls[0].html, /Pay invoice securely/);
  assert.equal(adapterCalls[0].to.email, "jane@cust.com");
  assert.equal(usage[0].sends, 1);
});

test("end to end: non-auto channel without approval is blocked by the real gate", async () => {
  // Email NOT in autoSendChannels => approval required => blocked on an autonomous run
  const POLICY = buildPolicy({
    company: "Acme", consent: true,
    outreach: { channels: ["Email"], businessHours: "9-17" },
    guardrails: { autoSendChannels: [] }, recoveryProcess: {}
  });
  const executeImpl = (p, a, o) => execute(p, a, {
    ...o,
    deps: {
      policy: POLICY, allowlist: ["send_via_executor"],
      capCheck: () => ({ allowed: true, violations: [] }),
      usageBump: () => {}, auditWrite: () => {},
      adapters: { email: async () => ({ id: "should-not-send" }) }
    }
  });
  const out = await recover("rr-acme", {
    send: true, atHour: 10,
    deps: { manifest: { company: "Acme" }, listInvoices: async () => [invWith()], executeImpl }
  });
  assert.equal(out.summary.byOutcome.sent, undefined);
  assert.ok(out.summary.blockedReasons.APPROVAL_REQUIRED >= 1);
});

test("buildAction carries the pay link, amount, and the gated tool", () => {
  const a = buildAction(invWith(), { subject: "S", text: "T", html: "H", paymentUrl: "https://pay/in_1", rung: "firm" }, { atHour: 9, from: "ar@acme.com" });
  assert.equal(a.channel, "Email");
  assert.equal(a.to.email, "jane@cust.com");
  assert.equal(a.from, "ar@acme.com");
  assert.equal(a.paymentUrl, "https://pay/in_1");
  assert.equal(a.amountUsd, 1200);
  assert.equal(a.tool, "send_via_executor");
  assert.equal(a.atHour, 9);
});

test("resolveStripeKey prefers an explicitly injected key, then process.env (the VM path)", async () => {
  assert.equal(await resolveStripeKey("rr-nonexistent-xyz", { stripeKey: "sk_injected" }), "sk_injected");
  const prev = process.env.STRIPE_API_KEY;
  process.env.STRIPE_API_KEY = "***";
  try { assert.equal(await resolveStripeKey("rr-nonexistent-xyz"), "***"); }
  finally { if (prev === undefined) delete process.env.STRIPE_API_KEY; else process.env.STRIPE_API_KEY = prev; }
});

test("normalizeHubSpotDeal turns a past-dated deal into an invoice-like recovery candidate", () => {
  const inv = normalizeHubSpotDeal({
    id: "331954429662",
    properties: { dealname: "RRD Test overdue invoice", amount: "3000", closedate: "2026-05-11T20:53:41.163Z" }
  }, { now: Date.parse("2026-06-21T12:00:00Z"), testEmail: "mredowusu@outlook.com" });
  assert.equal(inv.id, "331954429662");
  assert.equal(inv.number, "RRD Test overdue invoice");
  assert.equal(inv.amount, 3000);
  assert.equal(inv.customerEmail, "mredowusu@outlook.com");
  assert.equal(inv.daysOverdue, 40);
});

test("HubSpot source maps deals to drafted gated actions", async () => {
  const seen = [];
  const out = await recover("rr-acme", {
    source: "hubspot", atHour: 10, testEmail: "mredowusu@outlook.com",
    deps: {
      manifest: { company: "Acme" },
      listHubSpotDeals: async () => [{ id: "d1", properties: { dealname: "Overdue deal", amount: "3000", closedate: "2026-05-11T00:00:00Z" } }],
      executeImpl: async (p, a) => { seen.push(a); return { wouldSend: true, decision: { allowed: true, violations: [] } }; }
    }
  });
  assert.equal(out.found, 1);
  assert.equal(out.summary.byOutcome.would_send, 1);
  assert.equal(out.summary.targetedUsd, 3000);
  assert.equal(seen[0].to.email, "mredowusu@outlook.com");
  assert.equal(seen[0].invoiceId, "d1");
});


test("HubSpot Composio adapter executes HubSpot search through connected account id", () => {
  let captured = null;
  const fakeExec = (cmd, args, opts) => {
    captured = { cmd, args, input: JSON.parse(opts.input), envHasKey: opts.env.COMPOSIO_API_KEY === "ck_test" };
    return JSON.stringify({ data: { results: [{ id: "d2", properties: { dealname: "Composio deal", amount: "5000", closedate: "2026-05-01T00:00:00Z" } }] } });
  };
  const out = listOverdueHubSpotDealsViaComposio({
    apiKey: "ck_test", connectedAccountId: "ca_hubspot", now: Date.parse("2026-06-01T00:00:00Z"), testEmail: "ops@example.com", execFile: fakeExec
  });
  assert.equal(captured.cmd, "python3");
  assert.equal(captured.input.tool, "HUBSPOT_SEARCH_DEALS");
  assert.equal(captured.input.connected_account_id, "ca_hubspot");
  assert.equal(captured.envHasKey, true);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "d2");
  assert.equal(out[0].customerEmail, "ops@example.com");
});

test("HubSpot source defaults to native OAuth token even if Composio id is present", async () => {
  let nativeFetchCalled = false;
  const out = await recover("rr-acme", {
    source: "hubspot", atHour: 10, testEmail: "ops@example.com",
    deps: {
      manifest: { company: "Acme" },
      hubspotToken: "hs_test",
      composioApiKey: "ck_test",
      composioConnectedAccountId: "ca_hubspot",
      fetch: async () => {
        nativeFetchCalled = true;
        return { ok: true, json: async () => ({ results: [{ id: "d3", properties: { dealname: "Native OAuth overdue", amount: "7000", closedate: "2026-05-01T00:00:00Z" } }] }) };
      },
      execFile: () => { throw new Error("Composio should not be used by default for HubSpot"); },
      executeImpl: async () => ({ wouldSend: true, decision: { allowed: true, violations: [] } })
    }
  });
  assert.equal(nativeFetchCalled, true);
  assert.equal(out.found, 1);
  assert.equal(out.summary.targetedUsd, 7000);
});
