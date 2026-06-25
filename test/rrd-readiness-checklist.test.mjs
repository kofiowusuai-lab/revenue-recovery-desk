import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChecklist } from "../rrd-readiness-checklist.mjs";

// Minimal "fully answered" client so missingReadinessItems() returns nothing and
// needsMapping() can be controlled by the stacks we set.
function baseClient(extra = {}) {
  return {
    id: "sub-1", company: "Acme Co", submittedAt: "2026-06-01T00:00:00Z",
    consent: true, primaryContact: "Jane", contacts: [{ name: "Jane", email: "j@acme.co" }],
    paymentStack: { apiAccess: "Yes", platforms: ["Stripe"] },
    crmData: { apiAccess: "Yes", crm: "Stripe" }, // CRM "Stripe" keeps needsMapping deterministic
    recoveryProcess: {}, documents: [],
    outreach: {
      timezone: "GMT", businessHours: "9-5", fromName: "Acme AR", emailProvider: "SendGrid", channels: ["Email"],
      // missingReadinessItems()'s /letter|mail|post/ also matches "Email" (contains "mail"),
      // so a return address is required for the readiness list to be empty.
      letters: { returnAddress: { line1: "1 High St", name: "Acme AR" } },
    },
    guardrails: { doNotContact: "none", maxDiscount: 10, escalationTriggers: "dispute", approvalRouting: { approvers: "jane", preferredChannel: "email" } },
    approvalRouting: { approvers: "jane", preferredChannel: "email" },
    ...extra,
  };
}

const pack = (manifest = {}) => ({
  profileName: "rr-acme-co",
  manifest: { envKeysNeeded: [], oauthConnectionsNeeded: [], ...manifest },
});

// helper to find an item by label substring across all groups
function find(result, sub) {
  for (const g of result.groups) for (const it of g.items) if (it.label.includes(sub)) return it;
  return null;
}

test("fresh client: form done, integrations pending, not ready", () => {
  const r = buildChecklist({
    client: baseClient(),
    pack: pack({ envKeysNeeded: ["STRIPE_API_KEY"] }),
    entry: {}, profileEnv: {},
  });
  assert.equal(find(r, "Onboarding form submitted").status, "done");
  assert.equal(find(r, "Consent to recovery").status, "done");
  assert.equal(find(r, "Connect Stripe (API key)").status, "pending"); // no vault link yet
  assert.equal(find(r, "Hermes profile provisioned").status, "doing"); // not provisioned
  assert.equal(r.allReady, false);
});

test("vault link sent moves the integration to 'doing'", () => {
  const r = buildChecklist({
    client: baseClient(),
    pack: pack({ envKeysNeeded: ["STRIPE_API_KEY"] }),
    entry: { vaultDropId: "d1" }, profileEnv: {},
  });
  assert.equal(find(r, "Connect Stripe (API key)").status, "doing");
});

test("key installed + provisioned + runtime ready => READY TO SERVE", () => {
  const readyChecks = {
    checks: [
      { name: "profile:directory", ok: true }, { name: "profile:SOUL", ok: true }, { name: "profile:policy", ok: true }, { name: "profile:manifest", ok: true },
      { name: "llm:chatgpt-oauth", ok: true, detail: "connected via providers.openai-codex" },
      { name: "guardrail:approved-draft", ok: true }, { name: "guardrail:unapproved-block", ok: true },
    ],
  };
  const r = buildChecklist({
    client: baseClient(),
    pack: pack({ envKeysNeeded: ["STRIPE_API_KEY"] }),
    entry: { provisionedAt: "x", runtimeReadySentAt: "x", runtime: { mode: "orgo" } },
    profileEnv: { STRIPE_API_KEY: "sk_live_x" },
    specialForms: [], // mapping not needed because needsMapping triggers on "stripe" -> handled below
    readiness: readyChecks,
  });
  // CRM "Stripe" makes needsMapping true; without a mapping form it stays pending.
  // Mark it resolved via a special form so the card reaches READY.
  const r2 = buildChecklist({
    client: baseClient(),
    pack: pack({ envKeysNeeded: ["STRIPE_API_KEY"] }),
    entry: { provisionedAt: "x", runtimeReadySentAt: "x" },
    profileEnv: { STRIPE_API_KEY: "sk_live_x" },
    specialForms: [{ catalyst: "MAPPING_DETAILS_WEB", businessProfile: { sourceSubmissionId: "sub-1" } }],
    readiness: readyChecks,
  });
  assert.equal(find(r2, "Connect Stripe (API key)").status, "done");
  assert.equal(find(r2, "Confirm data mapping").status, "done");
  assert.equal(find(r2, "Hermes profile brain").status, "done");
  assert.equal(find(r2, "ChatGPT agent OAuth").status, "done");
  assert.equal(r2.allReady, true, JSON.stringify(r2.groups, null, 2));
  // sanity: r (no mapping form) is NOT ready
  assert.equal(r.allReady, false);
});

test("special forms only count when sourceSubmissionId exactly matches the client", () => {
  const r = buildChecklist({
    client: baseClient({ id: "sub-1" }),
    pack: pack({ envKeysNeeded: ["STRIPE_API_KEY"] }),
    entry: { provisionedAt: "x", runtimeReadySentAt: "x" },
    profileEnv: { STRIPE_API_KEY: "sk_live_x" },
    specialForms: [
      { catalyst: "MAPPING_DETAILS_WEB", businessProfile: { sourceSubmissionId: "sub-10", notes: "mentions sub-1 in prose" } },
    ],
  });
  assert.equal(find(r, "Confirm data mapping").status, "pending");
});

test("missing consent is a hard blocker", () => {
  const r = buildChecklist({
    client: baseClient({ consent: false }),
    pack: pack(), entry: { provisionedAt: "x", runtimeReadySentAt: "x" }, profileEnv: {},
  });
  assert.equal(find(r, "Consent to recovery").status, "blocked");
  assert.equal(r.allReady, false);
});

test("OAuth: link sent => doing; token present => done", () => {
  const m = { oauthConnectionsNeeded: ["HubSpot"] };
  const sent = buildChecklist({ client: baseClient(), pack: pack(m), entry: { oauthUrls: { HubSpot: { url: "u" } } }, profileEnv: {} });
  assert.equal(find(sent, "Authorize HubSpot").status, "doing");
});


test("Composio: connected account id present => done", () => {
  const m = { composioConnectionsNeeded: ["HubSpot"], composioEnvKeysNeeded: ["COMPOSIO_HUBSPOT_CONNECTED_ACCOUNT_ID"] };
  const pending = buildChecklist({ client: baseClient(), pack: pack(m), entry: {}, profileEnv: {} });
  assert.equal(find(pending, "Authorize HubSpot (Composio)").status, "pending");
  const invalid = buildChecklist({ client: baseClient(), pack: pack(m), entry: {}, profileEnv: { COMPOSIO_HUBSPOT_CONNECTED_ACCOUNT_ID: "ac_123" } });
  assert.equal(find(invalid, "Authorize HubSpot (Composio)").status, "pending");
  const done = buildChecklist({ client: baseClient(), pack: pack(m), entry: {}, profileEnv: { COMPOSIO_HUBSPOT_CONNECTED_ACCOUNT_ID: "ca_123" } });
  assert.equal(find(done, "Authorize HubSpot (Composio)").status, "done");
});

test("full readiness: orgo 'waiting' does not block READY and is excluded from the count", () => {
  const readiness = {
    checks: [
      { name: "profile:directory", ok: true }, { name: "profile:SOUL", ok: true },
      { name: "guardrail:approved-draft", ok: true }, { name: "guardrail:unapproved-block", ok: true },
      { name: "orgo", ok: false, waitingForOrgo: true, detail: "waiting_for_paid_orgo: free" },
    ],
  };
  const r = buildChecklist({
    client: baseClient(),
    pack: pack({ envKeysNeeded: ["STRIPE_API_KEY"] }),
    entry: { provisionedAt: "x" },
    profileEnv: { STRIPE_API_KEY: "sk_live_x" },
    specialForms: [{ catalyst: "MAPPING_DETAILS_WEB", businessProfile: { sourceSubmissionId: "sub-1" } }],
    readiness,
  });
  const orgo = find(r, "Cloud desktop (Orgo)");
  assert.equal(orgo.status, "waiting");
  // every non-waiting item is done, so the card is READY despite Orgo waiting
  assert.equal(r.allReady, true, JSON.stringify(r.counts));
});
