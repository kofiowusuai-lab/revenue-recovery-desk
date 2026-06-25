#!/usr/bin/env node
/**
 * rrd-collect.mjs — the one-command recovery loop for a per-client agent.
 *
 * Closes the gap the rest of the system left open: it actually FINDS the money and
 * runs it through the gate. End to end for a Stripe-billed client:
 *
 *     overdue invoices (rrd-stripe)  ->  draft in the client's voice (rrd-draft)
 *       ->  gate + caps + audit (rrd-recover)  ->  send via the email adapter
 *       ->  the customer pays through the invoice's hosted Stripe link
 *
 * Nothing is sent unless you pass --send AND the guardrail gate allows it; the
 * default run is a dry preview (gate only, dispatches nothing). The Stripe key is
 * read from the client's own profile .env, never global. No npm deps.
 *
 *   rrd-collect recover rr-acme                 # dry run: find + draft + gate, send nothing
 *   rrd-collect recover rr-acme --send          # actually send the allowed ones
 *   rrd-collect recover rr-acme --min 100 --min-days 7 --limit 50 --send
 *   rrd-collect recover rr-acme --json
 *
 * The heavy deps (Stripe, the executor) are injectable so the loop tests offline.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { listOverdueInvoices, paymentUrlFor } from "./rrd-stripe.mjs";
import { draftMessage, rungFor } from "./rrd-draft.mjs";
import { execute } from "./rrd-recover.mjs";
import { readEnvValue, profileEnvPath } from "./rrd-vault-fs.mjs";
import { loadState, saveState, cadenceDays, shouldDraftInvoice, markSeen, markDrafted, closeUnseen, recordRun } from "./rrd-collections-state.mjs";
import { appendRecoveryEvents } from "./rrd-client-dashboard-core.mjs";
import { assertSafeProfile } from "./rrd-profile-safety.mjs";

const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || "/Users/AIAgenterminal";
const PROFILES_DIR = process.env.HERMES_PROFILES_DIR || path.join(OPERATOR_HOME, ".hermes", "profiles");

export function loadManifest(profile) {
  profile = assertSafeProfile(profile);
  try { return JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, profile, "manifest.json"), "utf8")); }
  catch { return null; }
}

/**
 * The client's OWN Stripe key, never logged. Precedence:
 *   1. an explicitly injected key (tests),
 *   2. process.env.STRIPE_API_KEY — this is the path on the client's Orgo VM
 *      (secrets injected to tmpfs per cycle) AND on the Mac via the wrapper, and
 *   3. the profile .env on disk (Mac fallback when run without the wrapper).
 * The vault-fs read is a lazy, optional import so the VM brain doesn't need the
 * vault chain pushed — if it's absent, step 2 already covers the VM.
 */
export async function resolveStripeKey(profile, deps = {}) {
  profile = assertSafeProfile(profile);
  if (deps.stripeKey) return deps.stripeKey;
  if (process.env.STRIPE_API_KEY) return process.env.STRIPE_API_KEY;
  try {
    const v = readEnvValue(profileEnvPath(profile, { home: OPERATOR_HOME }), "STRIPE_API_KEY");
    if (v) return v;
  } catch { /* vault-fs not present (e.g. on the VM) — process.env already checked */ }
  return "";
}

export function resolveHubSpotToken(profile, deps = {}) {
  profile = assertSafeProfile(profile);
  if (deps.hubspotToken) return deps.hubspotToken;
  if (process.env.HUBSPOT_ACCESS_TOKEN) return process.env.HUBSPOT_ACCESS_TOKEN;
  try { return readEnvValue(profileEnvPath(profile, { home: OPERATOR_HOME }), "HUBSPOT_ACCESS_TOKEN") || ""; }
  catch { return ""; }
}

export function resolveComposioApiKey(deps = {}) {
  if (deps.composioApiKey) return deps.composioApiKey;
  if (process.env.COMPOSIO_API_KEY) return process.env.COMPOSIO_API_KEY;
  try { return readEnvValue(path.join(OPERATOR_HOME, ".openclaw", ".env"), "COMPOSIO_API_KEY") || ""; }
  catch { return ""; }
}

export function resolveComposioConnectedAccountId(profile, provider, deps = {}) {
  profile = assertSafeProfile(profile);
  const envKey = `COMPOSIO_${String(provider || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_CONNECTED_ACCOUNT_ID`;
  if (deps.composioConnectedAccountId) return deps.composioConnectedAccountId;
  if (process.env[envKey]) return process.env[envKey];
  try { return readEnvValue(profileEnvPath(profile, { home: OPERATOR_HOME }), envKey) || ""; }
  catch { return ""; }
}

export function normalizeHubSpotDeal(deal = {}, { now = Date.now(), testEmail = null } = {}) {
  const p = deal.properties || {};
  const closed = p.closedate ? new Date(p.closedate) : null;
  const daysOverdue = closed && Number.isFinite(closed.getTime()) ? Math.max(0, Math.floor((Number(now) - closed.getTime()) / 86400000)) : 0;
  return {
    id: deal.id,
    number: p.dealname || deal.id,
    currency: p.deal_currency_code || p.hs_currency || "USD",
    amount: Number(p.amount || 0),
    daysOverdue,
    dueDate: p.closedate ? String(p.closedate).slice(0, 10) : null,
    customerEmail: testEmail || p.customer_email || null,
    customerName: testEmail ? "Internal Test Recipient" : (p.customer_name || p.dealname || "there"),
    hostedInvoiceUrl: p.payment_url || null,
    source: "hubspot"
  };
}

export async function listOverdueHubSpotDeals({ token, now = Date.now(), minAmountUsd = 0, minDaysOverdue = 1, limit = 100, dealId = null, testEmail = null, fetchImpl = fetch } = {}) {
  if (!token) throw new Error("Missing HUBSPOT_ACCESS_TOKEN");
  const props = "dealname,amount,closedate,dealstage,pipeline,deal_currency_code";
  let rows = [];
  if (dealId) {
    const res = await fetchImpl(`https://api.hubapi.com/crm/v3/objects/deals/${encodeURIComponent(dealId)}?properties=${props}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    if (!res.ok) throw new Error(`HubSpot ${res.status}: ${body.message || body.error || "request failed"}`);
    rows = [body];
  } else {
    const res = await fetchImpl("https://api.hubapi.com/crm/v3/objects/deals/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ limit: Math.min(Number(limit) || 100, 100), properties: props.split(",") })
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`HubSpot ${res.status}: ${body.message || body.error || "request failed"}`);
    rows = body.results || [];
  }
  return rows
    .map((d) => normalizeHubSpotDeal(d, { now, testEmail }))
    .filter((inv) => inv.amount >= minAmountUsd && inv.daysOverdue >= minDaysOverdue)
    .slice(0, limit);
}

function normalizeComposioToolResponse(out) {
  const data = out && typeof out === "object" ? (out.data ?? out.result ?? out.response ?? out) : out;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data?.results)) return data.data.results;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export function listOverdueHubSpotDealsViaComposio({ apiKey, connectedAccountId, now = Date.now(), minAmountUsd = 0, minDaysOverdue = 1, limit = 100, dealId = null, testEmail = null, execFile = execFileSync } = {}) {
  if (!apiKey) throw new Error("Missing COMPOSIO_API_KEY");
  if (!connectedAccountId) throw new Error("Missing COMPOSIO_HUBSPOT_CONNECTED_ACCOUNT_ID");
  const props = ["dealname", "amount", "closedate", "dealstage", "pipeline", "deal_currency_code", "customer_email", "customer_name", "payment_url"];
  const tool = dealId ? "HUBSPOT_GET_DEAL" : "HUBSPOT_SEARCH_DEALS";
  const args = dealId
    ? { dealId: String(dealId), archived: false, properties: props }
    : { limit: Math.min(Number(limit) || 100, 100), properties: props, sorts: [{ propertyName: "closedate", direction: "ASCENDING" }] };
  const py = String.raw`
import json, os, sys
from composio import Composio
payload=json.loads(sys.stdin.read() or '{}')
c=Composio(api_key=os.environ['COMPOSIO_API_KEY'])
res=c.tools.execute(
    payload['tool'],
    payload['arguments'],
    connected_account_id=payload['connected_account_id'],
    dangerously_skip_version_check=True,
)
if hasattr(res, 'model_dump'):
    res=res.model_dump()
print(json.dumps(res, default=str))
`;
  const raw = execFile("python3", ["-c", py], {
    input: JSON.stringify({ tool, arguments: args, connected_account_id: connectedAccountId }),
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, COMPOSIO_API_KEY: apiKey },
    maxBuffer: 1024 * 1024,
  });
  const parsed = JSON.parse(raw || "{}");
  const rows = dealId ? [parsed?.data || parsed?.result || parsed] : normalizeComposioToolResponse(parsed);
  return rows
    .map((d) => normalizeHubSpotDeal(d, { now, testEmail }))
    .filter((inv) => inv.amount >= minAmountUsd && inv.daysOverdue >= minDaysOverdue)
    .slice(0, limit);
}

/** Map a normalized invoice + draft into the action the executor gates. */
export function buildAction(inv, draft, { atHour, from, approved } = {}) {
  return {
    channel: "Email",
    to: { email: inv.customerEmail, name: inv.customerName },
    from,
    subject: draft.subject,
    text: draft.text,
    html: draft.html,
    paymentUrl: draft.paymentUrl || paymentUrlFor(inv),
    invoiceId: inv.id,
    amountUsd: inv.amount,
    rung: draft.rung,
    tool: "send_via_executor",
    atHour,
    ...(approved != null ? { approved } : {}),
    costUsd: 0
  };
}

/**
 * recover — run the loop for one profile.
 *   opts: { send, limit, minAmountUsd, minDaysOverdue, now, atHour, from, voice, deps }
 *   deps: { stripeKey, listInvoices, executeImpl }  (all optional; injected for tests)
 *   returns { profile, company, send, found, skipped, results[], summary }
 */
export async function recover(profile, opts = {}) {
  if (!profile) throw new Error("recover needs a profile (e.g. rr-acme)");
  profile = assertSafeProfile(profile);
  const deps = opts.deps || {};
  const now = opts.now || Date.now();
  const atHour = opts.atHour != null ? opts.atHour : new Date(now).getHours();
  const send = !!opts.send;
  const manifest = deps.manifest || loadManifest(profile) || {};
  const company = opts.company || manifest.company || profile.replace(/^rr-/, "");
  const voice = opts.voice || {};
  const from = opts.from || voice.fromEmail || null;
  const runExecute = deps.executeImpl || ((p, a, o) => execute(p, a, o));
  const source = opts.source || "stripe";
  const trackCollections = !!opts.trackCollections;
  const followUpDays = opts.followUpDays || cadenceDays(manifest, process.env);
  const state = trackCollections ? (opts.collectionState || loadState(profile, { nowMs: now })) : null;
  const seenKeys = new Set();

  let invoices;
  if (source === "hubspot") {
    const listHubSpotDeals = deps.listHubSpotDeals || ((o) => listOverdueHubSpotDeals(o));
    const rawHubSpot = await listHubSpotDeals({
      token: resolveHubSpotToken(profile, deps),
      now,
      minAmountUsd: opts.minAmountUsd || 0,
      minDaysOverdue: opts.minDaysOverdue != null ? opts.minDaysOverdue : 1,
      limit: opts.limit || 100,
      dealId: opts.dealId || null,
      testEmail: opts.testEmail || null,
      ...(deps.fetch ? { fetchImpl: deps.fetch } : {})
    });
    invoices = rawHubSpot.map((d) => d && d.properties ? normalizeHubSpotDeal(d, { now, testEmail: opts.testEmail || null }) : d)
      .filter((inv) => inv && Number(inv.amount) >= (opts.minAmountUsd || 0) && Number(inv.daysOverdue) >= (opts.minDaysOverdue != null ? opts.minDaysOverdue : 1));
  } else {
    const listInvoices = deps.listInvoices || ((o) => listOverdueInvoices(o));
    invoices = await listInvoices({
      key: await resolveStripeKey(profile, deps),
      now,
      minAmountUsd: opts.minAmountUsd || 0,
      minDaysOverdue: opts.minDaysOverdue != null ? opts.minDaysOverdue : 1,
      limit: opts.limit || 100
    });
  }

  const results = [];
  for (const inv of invoices) {
    if (state) seenKeys.add(markSeen(state, inv, { source, nowMs: now }));
    if (!inv.customerEmail) {
      results.push({ invoiceId: inv.id, amountUsd: inv.amount, outcome: "skipped", reason: "no email on the invoice — needs a letter or a CRM contact lookup" });
      continue;
    }
    const rung = rungFor(inv.daysOverdue);
    if (state) {
      const decision = shouldDraftInvoice(state, inv, { source, rung, nowMs: now, followUpDays });
      if (!decision.draft) {
        results.push({
          invoiceId: inv.id, number: inv.number, customer: inv.customerName, email: inv.customerEmail,
          amountUsd: inv.amount, currency: inv.currency, daysOverdue: inv.daysOverdue, rung,
          outcome: "already_tracked", reason: decision.reason
        });
        continue;
      }
    }
    const draft = draftMessage({ invoice: inv, company, voice, rung });
    const action = buildAction(inv, draft, { atHour, from, approved: opts.approved });
    const exec = await runExecute(profile, action, { send });
    const outcome = exec.sent ? "sent" : (exec.wouldSend ? "would_send" : "blocked");
    if (state) markDrafted(state, inv, { source, rung, outcome, subject: draft.subject, nowMs: now, followUpDays });
    results.push({
      invoiceId: inv.id, number: inv.number, customer: inv.customerName, email: inv.customerEmail,
      amountUsd: inv.amount, currency: inv.currency, daysOverdue: inv.daysOverdue, rung,
      subject: draft.subject, paymentUrl: action.paymentUrl,
      outcome,
      violations: (exec.decision && exec.decision.violations) || [],
      requiresHuman: !!(exec.decision && exec.decision.requiresHuman),
      result: exec.result || null
    });
  }

  if (state) {
    const closed = closeUnseen(state, seenKeys, { nowMs: now });
    for (const key of closed) results.push({ invoiceId: key, outcome: "closed", reason: "no longer present in overdue feed — marked paid/resolved" });
  }

  const summary = results.reduce((s, r) => {
    s.byOutcome[r.outcome] = (s.byOutcome[r.outcome] || 0) + 1;
    if (r.outcome === "sent" || r.outcome === "would_send") s.targetedUsd += Number(r.amountUsd) || 0;
    if (r.outcome === "blocked") (r.violations || []).forEach((v) => { s.blockedReasons[v.code] = (s.blockedReasons[v.code] || 0) + 1; });
    return s;
  }, { byOutcome: {}, blockedReasons: {}, targetedUsd: 0 });
  summary.targetedUsd = Math.round(summary.targetedUsd * 100) / 100;
  if (state) {
    recordRun(state, summary, { nowMs: now });
    saveState(profile, state);
  }
  const shouldEmitEvents = opts.emitEvents || process.env.RRD_EVENTS_EMIT === "1" || !!process.env.RRD_EVENTS_DIR;
  if (shouldEmitEvents) {
    try {
      appendRecoveryEvents(profile, { manifest, results, occurredAt: new Date(now).toISOString(), meta: { source, send } }, opts.eventQueueDir ? { dir: opts.eventQueueDir } : {});
    } catch (e) {
      if (opts.strictEventEmit || process.env.RRD_EVENTS_STRICT === "1") throw e;
      console.error("warning: recovery event queue append failed: " + (e && e.message || e));
    }
  }

  return {
    profile, company, send,
    found: invoices.length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    results, summary
  };
}

/* ---------------- CLI ---------------- */
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--send") o.send = true;
    else if (a === "--dry-run") o.send = false;
    else if (a === "--json") o.json = true;
    else if (a === "--limit") o.limit = parseInt(argv[++i], 10);
    else if (a === "--min") o.minAmountUsd = parseFloat(argv[++i]);
    else if (a === "--min-days") o.minDaysOverdue = parseInt(argv[++i], 10);
    else if (a === "--from") o.from = argv[++i];
    else if (a === "--source") o.source = argv[++i];
    else if (a === "--deal-id") o.dealId = argv[++i];
    else if (a === "--test-email") o.testEmail = argv[++i];
    else if (a === "--approved") o.approved = true;
    else if (a === "--track-collections") o.trackCollections = true;
    else if (a === "--follow-up-days") o.followUpDays = parseInt(argv[++i], 10);
    else o._.push(a);
  }
  return o;
}

function report(out) {
  const L = [];
  L.push(`\nRevenue recovery — ${out.company}  (${out.profile})`);
  L.push(`Mode: ${out.send ? "SEND (live)" : "dry run (gate only, nothing sent)"}`);
  L.push(`Overdue invoices found: ${out.found}${out.skipped ? `  (${out.skipped} skipped, no email)` : ""}`);
  const o = out.summary.byOutcome;
  const order = ["sent", "would_send", "blocked", "skipped"];
  L.push("Outcomes: " + (order.filter((k) => o[k]).map((k) => `${k}=${o[k]}`).join("  ") || "none"));
  L.push(`Amount targeted: $${out.summary.targetedUsd.toLocaleString("en-US")}`);
  if (Object.keys(out.summary.blockedReasons).length) {
    L.push("Blocked by: " + Object.entries(out.summary.blockedReasons).map(([c, n]) => `${c}(${n})`).join(", "));
  }
  L.push("");
  for (const r of out.results) {
    if (r.outcome === "skipped") { L.push(`  - [skip ] ${r.invoiceId}  $${r.amountUsd}  ${r.reason}`); continue; }
    const tag = { sent: "SENT ", would_send: "ready", blocked: "BLOCK" }[r.outcome] || r.outcome;
    const why = r.outcome === "blocked" ? "  <- " + (r.violations.map((v) => v.code).join(",") || "blocked") : "";
    L.push(`  - [${tag}] ${r.number || r.invoiceId}  $${r.amountUsd} ${r.currency}  ${r.daysOverdue}d  ${r.rung}  -> ${r.email}${why}`);
  }
  return L.join("\n");
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (cmd !== "recover") {
    console.error(`rrd-collect — one-command Stripe recovery loop

Usage:  rrd-collect recover <profile> [--send] [--limit N] [--min USD] [--min-days N] [--from email] [--track-collections] [--follow-up-days N] [--json]

Default is a DRY RUN: it finds overdue invoices, drafts the dunning message, and runs
the guardrail gate, but sends nothing. Add --send to dispatch the allowed messages.`);
    process.exit(1);
  }
  const o = parseArgs(rest);
  const profile = o._[0];
  if (!profile) { console.error("recover needs a profile (e.g. rr-acme)"); process.exit(1); }
  const out = await recover(profile, o);
  if (o.json) console.log(JSON.stringify(out, null, 2));
  else console.log(report(out));
  const failed = out.summary.byOutcome.blocked || 0;
  process.exit(failed && !out.summary.byOutcome.sent && !out.summary.byOutcome.would_send ? 2 : 0);
}

const invokedDirectly = process.argv[1] && (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1]));
if (invokedDirectly) {
  main().catch((e) => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
}
