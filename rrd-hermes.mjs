/**
 * rrd-hermes.mjs — shared, dependency-free mapping + Hermes profile-pack logic.
 * Imported by rrd-agent.mjs and hermes-provision.mjs. Mirrors buildHermesPack()
 * in recovery-desk.html so the browser and CLI emit identical packs.
 */

export function slug(s) {
  return String(s || "client").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "client";
}
export function fmtMoneyShort(n) { const v = Number(n) || 0; return "$" + Math.round(v).toLocaleString("en-US"); }

export function rowToRecord(r) {
  return {
    id: r.id, submittedAt: r.created_at, company: r.company, contactName: r.contact_name, email: r.email, phone: r.phone,
    industry: r.industry, size: r.size, website: r.website,
    businessProfile: r.business_profile || {}, paymentStack: r.payment_stack || {}, crmData: r.crm_data || {},
    recoveryProcess: r.recovery_process || {}, outreach: r.outreach || {}, guardrails: r.guardrails || {}, goals: r.goals || {},
    documents: r.documents || [], contacts: r.contacts || [], primaryContact: r.primary_contact,
    approvalRouting: (r.guardrails || {}).approvalRouting || {},
    catalyst: r.catalyst, urgency: r.urgency, anythingElse: r.anything_else, consent: r.consent,
    paymentPlatforms: r.payment_platforms || [], crm: r.crm, hasSop: r.has_sop, integrationReady: r.integration_ready,
    approxOutstanding: Number(r.approx_outstanding) || 0, priority: r.priority || r.urgency,
    wantsSopBuilt: !!((r.recovery_process || {}).wantSopBuilt),
    needsSop: !r.has_sop,
    autoSendChannels: (r.guardrails || {}).autoSendChannels || [],
    fullAutomation: (((r.guardrails || {}).autoSendChannels) || []).length > 0
  };
}
export function recordToRow(rec) {
  const ps = rec.paymentStack || {}, cd = rec.crmData || {}, bp = rec.businessProfile || {};
  const guardrails = { ...(rec.guardrails || {}) };
  if (rec.approvalRouting && Object.keys(rec.approvalRouting).length) guardrails.approvalRouting = rec.approvalRouting;
  const row = {
    company: rec.company, contact_name: rec.contactName, email: rec.email || "agent@desk.local", phone: rec.phone,
    industry: rec.industry, size: rec.size, website: rec.website,
    business_profile: bp, payment_stack: ps, crm_data: cd, recovery_process: rec.recoveryProcess || {},
    outreach: rec.outreach || {}, guardrails, goals: rec.goals || {},
    documents: rec.documents || [], contacts: rec.contacts || [], primary_contact: rec.primaryContact,
    catalyst: rec.catalyst || "(added via agent)", urgency: rec.urgency || "Medium", anything_else: rec.anythingElse,
    consent: !!rec.consent,
    payment_platforms: rec.paymentPlatforms || ps.platforms || [], crm: rec.crm || cd.crm,
    has_sop: !!(rec.hasSop || (rec.recoveryProcess && rec.recoveryProcess.hasSop === "Yes")),
    integration_ready: !!(ps.apiAccess === "Yes" && cd.apiAccess === "Yes"),
    approx_outstanding: Number(rec.approxOutstanding || bp.approxOutstanding) || 0, priority: rec.urgency || "Medium"
  };
  if (rec.id) row.id = rec.id;
  return row;
}

/* ---------- Offboarding + retention (shared with the dashboard mirror) ---------- */
// Legal retention window for an offboarded client's record before auto-delete.
export const RETENTION_YEARS = 6;

// Map a public.offboarded_clients row into a friendly record.
export function rowToOffboarded(r) {
  return {
    id: r.id, offboardedAt: r.offboarded_at, offboardedBy: r.offboarded_by,
    reason: r.reason || "", finalNotes: r.final_notes || "", recoveredTotal: Number(r.recovered_total) || 0,
    company: r.company, email: r.email, industry: r.industry,
    approxOutstanding: Number(r.approx_outstanding) || 0,
    snapshot: r.snapshot || {}, retainUntil: r.retain_until, purged: !!r.purged,
    // the original onboarding record, rehydrated from the snapshot for full-detail display
    record: r.snapshot && r.snapshot.id ? rowToRecord(r.snapshot) : null
  };
}

// Days-until-purge status for an archive row. `nowMs` injectable for tests.
export function retentionStatus(retainUntilIso, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  const until = new Date(retainUntilIso).getTime();
  const daysLeft = Math.ceil((until - now) / 86400000);
  return { retainUntil: retainUntilIso, daysLeft, expired: until < now };
}

function clip(text, max) { if (text.length <= max) return text; const cut = text.slice(0, max); const nl = cut.lastIndexOf("\n"); return (nl > max * 0.5 ? cut.slice(0, nl) : cut).trim(); }
function line(label, v) { return v && String(v).trim() ? label + String(v).trim() : ""; }

/**
 * Integration registry — single source of truth for how we authenticate to each
 * provider captured at onboarding.
 *   auth:"apikey" → a static secret the client pastes; collected via the secrets vault.
 *   auth:"oauth"    → a user-authorized connection; handled by a native RRD OAuth
 *                     connect flow, NOT the vault.
 *   auth:"composio" → a Composio-managed connection. The client authorizes/logs in
 *                     through Composio; the resulting connected-account id is
 *                     installed locally by the operator, not pasted by the client.
 * Keep this in sync with the mirror in recovery-desk.html / desk.html.
 */
export const INTEGRATIONS = {
  payment: {
    "Stripe": { auth: "apikey", keys: ["STRIPE_API_KEY"] },
    "Square": { auth: "apikey", keys: ["SQUARE_ACCESS_TOKEN"] },
    "PayPal": { auth: "apikey", keys: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"] },
    "Braintree": { auth: "apikey", keys: ["BRAINTREE_MERCHANT_ID", "BRAINTREE_PRIVATE_KEY"] },
    "Authorize.net": { auth: "apikey", keys: ["AUTHNET_API_LOGIN_ID", "AUTHNET_TRANSACTION_KEY"] },
    "GoCardless": { auth: "apikey", keys: ["GOCARDLESS_ACCESS_TOKEN"] },
    "Bill.com": { auth: "apikey", keys: ["BILLCOM_API_KEY"] },
    "Whop": { auth: "apikey", keys: ["WHOP_API_KEY"] },
    "Shopify": { auth: "composio", provider: "shopify" },
    "Maxio": { auth: "apikey", keys: ["MAXIO_SUBDOMAIN", "MAXIO_API_KEY"] },
    "Paystack": { auth: "apikey", keys: ["PAYSTACK_SECRET_KEY"] },
    "Razorpay": { auth: "apikey", keys: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"] },
    "Lemon Squeezy": { auth: "apikey", keys: ["LEMONSQUEEZY_API_KEY", "LEMONSQUEEZY_STORE_ID"] },
    "MoonClerk": { auth: "apikey", keys: ["MOONCLERK_API_KEY"] }
  },
  accounting: {
    "QuickBooks Online": { auth: "oauth", provider: "quickbooks", oauthName: "QuickBooks Online" },
    "Xero": { auth: "oauth", provider: "xero" },
    "Sage": { auth: "oauth", provider: "sage" },
    "FreshBooks": { auth: "oauth", provider: "freshbooks" },
    "Wave": { auth: "oauth", provider: "wave" },
    "Zoho Books": { auth: "oauth", provider: "zohobooks" },
    "FreeAgent": { auth: "oauth", provider: "freeagent" },
    "Bill.com": { auth: "apikey", keys: ["BILLCOM_API_KEY"] },
    "Zoho Invoice": { auth: "oauth", provider: "zohoinvoice", oauthName: "Zoho Invoice" },
    "Chaser": { auth: "composio", provider: "chaser" },
    "Clientary": { auth: "apikey", keys: ["CLIENTARY_API_KEY"] },
    "Moneybird": { auth: "apikey", keys: ["MONEYBIRD_ACCESS_TOKEN", "MONEYBIRD_ADMINISTRATION_ID"] },
    "Sevdesk": { auth: "apikey", keys: ["SEVDESK_API_TOKEN"] },
    "Lexoffice": { auth: "apikey", keys: ["LEXOFFICE_API_KEY"] },
    "Quaderno": { auth: "apikey", keys: ["QUADERNO_API_KEY", "QUADERNO_PRIVATE_KEY"] },
    "Elorus": { auth: "apikey", keys: ["ELORUS_API_KEY"] },
    "Coupa": { auth: "apikey", keys: ["COUPA_BASE_URL", "COUPA_CLIENT_ID", "COUPA_CLIENT_SECRET"] },
    "Odoo": { auth: "apikey", keys: ["ODOO_BASE_URL", "ODOO_DATABASE", "ODOO_USERNAME", "ODOO_API_KEY"] },
    // NetSuite starts as a controlled enterprise token/vault connector rather
    // than a generic OAuth flow. A human/client admin creates a read-oriented
    // NetSuite integration/token role and deposits these values through the
    // zero-knowledge vault; field mapping is still required before go-live.
    "NetSuite": { auth: "apikey", keys: ["NETSUITE_ACCOUNT_ID", "NETSUITE_CONSUMER_KEY", "NETSUITE_CONSUMER_SECRET", "NETSUITE_TOKEN_ID", "NETSUITE_TOKEN_SECRET", "NETSUITE_RESTLET_URL", "NETSUITE_SUITEQL_ENABLED"] }
  },
  crm: {
    "HubSpot": { auth: "oauth", provider: "hubspot" },
    "Salesforce": { auth: "oauth", provider: "salesforce" },
    "Zoho CRM": { auth: "oauth", provider: "zoho" },
    "Pipedrive": { auth: "oauth", provider: "pipedrive" },
    "monday.com": { auth: "oauth", provider: "monday" },
    "GoHighLevel": { auth: "oauth", provider: "gohighlevel" },
    "Close": { auth: "apikey", keys: ["CLOSE_API_KEY"] },
    "Capsule CRM": { auth: "apikey", keys: ["CAPSULE_ACCESS_TOKEN"] },
    "Attio": { auth: "apikey", keys: ["ATTIO_API_KEY"] },
    "Kommo": { auth: "apikey", keys: ["KOMMO_BASE_URL", "KOMMO_ACCESS_TOKEN"] },
    "Dynamics 365": { auth: "composio", provider: "dynamics365" },
    "ServiceM8": { auth: "composio", provider: "servicem8" },
    "Nutshell": { auth: "apikey", keys: ["NUTSHELL_USER_EMAIL", "NUTSHELL_API_KEY"] },
    "Salesflare": { auth: "apikey", keys: ["SALESFLARE_API_KEY"] },
    "Salesmate": { auth: "apikey", keys: ["SALESMATE_DOMAIN", "SALESMATE_ACCESS_KEY", "SALESMATE_SESSION_TOKEN"] },
    "noCRM.io": { auth: "apikey", keys: ["NOCRM_SUBDOMAIN", "NOCRM_API_KEY"] },
    "ActiveCampaign": { auth: "apikey", keys: ["ACTIVECAMPAIGN_API_URL", "ACTIVECAMPAIGN_API_KEY"] },
    "Odoo": { auth: "apikey", keys: ["ODOO_BASE_URL", "ODOO_DATABASE", "ODOO_USERNAME", "ODOO_API_KEY"] },
    "RepairShopr": { auth: "apikey", keys: ["REPAIRSHOPR_SUBDOMAIN", "REPAIRSHOPR_API_TOKEN"] },
    "AccuLynx": { auth: "composio", provider: "acculynx" },
  },
  // matched by substring against the provider name the client typed
  email: {
    "Google Workspace": { auth: "oauth", provider: "google", oauthName: "Google Workspace" },
    "Gmail": { auth: "oauth", provider: "google", oauthName: "Google Workspace" },
    "Microsoft 365": { auth: "oauth", provider: "microsoft", oauthName: "Microsoft 365 / Outlook" },
    "Office 365": { auth: "oauth", provider: "microsoft", oauthName: "Microsoft 365 / Outlook" },
    "Outlook": { auth: "oauth", provider: "microsoft", oauthName: "Microsoft 365 / Outlook" },
    "SendGrid": { auth: "apikey", keys: ["SENDGRID_API_KEY"] },
    "Postmark": { auth: "apikey", keys: ["POSTMARK_SERVER_TOKEN"] },
    "Mailgun": { auth: "apikey", keys: ["MAILGUN_API_KEY"] }
  },
  sms: {
    "Twilio": { auth: "apikey", keys: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"] }
  },
  // physical mail / letters — added when the client uses a Letter/Mail/Post channel.
  // Client connects their OWN PostGrid account; key collected via the vault.
  mail: {
    "PostGrid": { auth: "apikey", keys: ["POSTGRID_API_KEY"] }
  }
};

// does this client use physical letters as a recovery channel?
export function usesLetters(rec) {
  const out = rec.outreach || {}, rp = rec.recoveryProcess || {};
  const channels = (out.channels && out.channels.length) ? out.channels : (rp.channels || []);
  return channels.some((c) => /\b(letter|postal|post|physical mail|paper mail)\b/i.test(String(c)));
}

const dedupe = (a) => a.filter((v, i, arr) => arr.indexOf(v) === i);

// the providers a client actually uses, resolved against the registry
function selectedIntegrations(rec) {
  const ps = rec.paymentStack || {}, cd = rec.crmData || {}, out = rec.outreach || {};
  const hits = [];
  (rec.paymentPlatforms || ps.platforms || []).forEach((p) => { if (INTEGRATIONS.payment[p]) hits.push({ name: p, ...INTEGRATIONS.payment[p] }); });
  if (ps.accounting && INTEGRATIONS.accounting[ps.accounting]) hits.push({ name: ps.accounting, ...INTEGRATIONS.accounting[ps.accounting] });
  if (usesSpreadsheets(rec)) {
    hits.push({
      name: "Spreadsheets",
      auth: "apikey",
      keys: ["SPREADSHEET_SOURCE_URL", "SPREADSHEET_ACCESS_INSTRUCTIONS", "SPREADSHEET_REFRESH_CADENCE"]
    });
  }
  if (rec.crm && INTEGRATIONS.crm[rec.crm]) hits.push({ name: rec.crm, ...INTEGRATIONS.crm[rec.crm] });
  if (isCustomCrmApi(rec)) {
    hits.push({
      name: rec.crm || "Custom CRM",
      auth: "apikey",
      keys: ["CUSTOM_CRM_API_BASE_URL", "CUSTOM_CRM_API_KEY", "CUSTOM_CRM_API_DOCS_URL"]
    });
  }
  Object.keys(INTEGRATIONS.email).forEach((name) => { if ((out.emailProvider || "").includes(name)) hits.push({ name, ...INTEGRATIONS.email[name] }); });
  Object.keys(INTEGRATIONS.sms).forEach((name) => { if ((out.smsProvider || "").toLowerCase().includes(name.toLowerCase())) hits.push({ name, ...INTEGRATIONS.sms[name] }); });
  if (usesLetters(rec)) Object.keys(INTEGRATIONS.mail).forEach((name) => hits.push({ name, ...INTEGRATIONS.mail[name] }));
  return hits;
}

function usesSpreadsheets(rec) {
  const ps = rec.paymentStack || {};
  return /spreadsheet/i.test(String(ps.accounting || ""));
}

function isCustomCrmApi(rec) {
  const cd = rec.crmData || {};
  const crm = String(rec.crm || cd.crm || "").trim();
  if (!crm) return false;
  if (INTEGRATIONS.crm[crm]) return false;
  const apiAccess = String(cd.apiAccess || "").toLowerCase();
  return apiAccess === "yes" && /own|custom|internal|proprietary|bespoke/i.test(crm);
}

// API-key secrets the client must deposit via the vault (OAuth providers excluded)
export function envKeysFor(rec) {
  return dedupe(selectedIntegrations(rec).filter((h) => h.auth === "apikey").flatMap((h) => h.keys || []));
}

// OAuth platforms that need a connect flow instead of a pasted key
export function oauthConnectionsFor(rec) {
  return dedupe(selectedIntegrations(rec).filter((h) => h.auth === "oauth").map((h) => h.oauthName || h.name));
}

// Composio connected-account env names are written by the operator/helper after
// the client authorizes in Composio. They are not requested through the vault.
export function composioEnvKey(provider) {
  return `COMPOSIO_${String(provider || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_CONNECTED_ACCOUNT_ID`;
}

export function composioConnectionsFor(rec) {
  return dedupe(selectedIntegrations(rec).filter((h) => h.auth === "composio").map((h) => h.name));
}

export function composioEnvKeysFor(rec) {
  return dedupe(selectedIntegrations(rec).filter((h) => h.auth === "composio").map((h) => composioEnvKey(h.provider || h.name)));
}

export function buildHermesPack(rec) {
  const bp = rec.businessProfile || {}, ps = rec.paymentStack || {}, cd = rec.crmData || {}, rp = rec.recoveryProcess || {}, out = rec.outreach || {}, g = rec.guardrails || {}, go = rec.goals || {};
  const ar = rec.approvalRouting || g.approvalRouting || {};
  const co = rec.company || "the client";
  const profileName = "rr-" + slug(rec.company || rec.email);

  const S = [];
  S.push(`# ${co} — Revenue Recovery Desk\n`);
  S.push(`You are the dedicated revenue-recovery agent for **${co}**${rec.industry ? ", a " + rec.industry + " business" : ""}. Your mission: recover ${co}'s overdue invoices by contacting their customers on their behalf, following ${co}'s own process and voice, and getting invoices paid.\n`);
  const autoChannels = (g.autoSendChannels || []).filter(Boolean);
  const allChannels = (out.channels && out.channels.length) ? out.channels : (rp.channels || []);
  const gatedChannels = allChannels.filter((c) => !autoChannels.includes(c));

  // Sending mode — approval can be waived PER CHANNEL; safety rails never are.
  if (autoChannels.length) {
    S.push(`## HARD RULE — SENDING MODE (partial automation, authorized by ${co})`);
    S.push(`${co} has pre-authorized these channels to send AUTOMATICALLY, with no per-message human approval: **${autoChannels.join(", ")}**. On those, you draft and send yourself in batches${g.batchSize ? " of " + g.batchSize : ""}, within the Safety Rails below.`);
    S.push(`Every other channel${gatedChannels.length ? " (" + gatedChannels.join(", ") + ")" : ""} still needs human approval first — approval model: ${g.approvalModel || "approve every message"}. Queue those drafts and get ${rec.primaryContact || "the primary contact"}'s sign-off before sending.\n`);
  } else {
    S.push("## HARD RULE — APPROVAL BEFORE ANY SEND (NON-NEGOTIABLE)");
    S.push(`You never contact a customer without explicit human approval. Approval model: ${g.approvalModel || "approve every message"}. Work in batches${g.batchSize ? " of " + g.batchSize : ""}. Queue drafts, get ${rec.primaryContact || "the primary contact"}'s approval, then send.\n`);
  }
  S.push("## Approval routing");
  S.push(`- Approvers: ${ar.approvers || rec.primaryContact || "primary contact"}.`);
  S.push(`- Preferred approval channel: ${ar.preferredChannel || "match the client's existing workflow (email/Slack/Teams/CRM/shared inbox)"}.`);
  if (ar.sla) S.push(`- Expected approval turnaround: ${ar.sla}.`);
  if (ar.notes) S.push(`- Workflow notes: ${ar.notes}.`);
  S.push("- After approval is recorded, use only the gated executor send path. Never bypass approval routing or send directly via a provider.\n");

  S.push("## Safety Rails");
  S.push("## HARD RULE — SAFETY RAILS THAT NEVER BEND (even on automated channels)");
  S.push(`- Never contact anyone on the do-not-contact list: ${g.doNotContact || "(none given — if unsure, ask a human before contacting)"}.`);
  S.push(`- Always follow these compliance constraints: ${g.compliance || "courteous collections only; no threats; honor all applicable laws and any required legal language"}.`);
  S.push(`- The moment a customer disputes, replies, asks to stop, or sounds distressed: STOP that thread immediately and escalate to a human${rec.primaryContact ? " (" + rec.primaryContact + ")" : ""}.${g.escalationTriggers ? " Also escalate when: " + g.escalationTriggers + "." : ""}`);
  S.push(`- Only send during ${((out.businessHours || "") + (out.timezone ? " " + out.timezone : "")).trim() || "normal local business hours"}.`);
  S.push(`- Never offer more than ${g.maxDiscount || "no discount"} without escalating.\n`);

  // SOP — theirs if they have one, a starter we author if they asked, else a flag.
  const haveProcess = rec.hasSop === true || rp.processDescription || rp.cadence || (rp.channels || []).length || rp.escalation;
  if (haveProcess) {
    S.push(`## How ${co} recovers money (their SOP — follow it)`);
    [line("Cadence: ", rp.cadence), line("Channels: ", (rp.channels || []).join(", ")), line("Process: ", rp.processDescription), line("Escalation ladder: ", rp.escalation), line("Settlement rules: ", rp.settlementRules)].filter(Boolean).forEach((l) => S.push("- " + l));
    S.push("");
  } else if (rec.wantsSopBuilt) {
    S.push(`## FlowAudit Default Recovery SOP (tailored for ${co} — confirm before go-live)`);
    S.push(`${co} had no documented process and asked FlowAudit to build one. Use this baseline unless the client approves changes:`);
    S.push("- Stage 0 pre-flight: verify invoice/customer identity, amount due, due date, recent replies/disputes/payments, do-not-contact flags, and payment route before drafting.");
    S.push("- Stage 1 friendly reminder: 1–3 days overdue; helpful, low-friction reminder with amount, invoice reference, due date, and secure payment link when available.");
    S.push("- Stage 2 follow-up: about 7 days overdue; request payment or a confirmed payment date/plan.");
    S.push("- Stage 3 firm notice: about 14 days overdue; professional but clearer that the balance needs attention.");
    S.push("- Stage 4 pre-escalation: about 21–30 days overdue; firm/direct, requires human approval unless pre-authorized.");
    S.push("- Stage 5 final notice/formal demand: about 45–60+ days overdue; always approval-gated, factual, and non-threatening.");
    S.push(`- Stage 6 handback: about 90+ days overdue, dispute, hardship, refusal, or high-risk signal → stop automation and hand ${co} the audit pack for a collections/legal/write-off decision.`);
    S.push("- Channels: " + (allChannels.length ? allChannels.join(", ") : "Email first; phone/manual escalation for older balances when approved") + ".");
    S.push("- Settlement: payment plans only if client-authorized; no discounts beyond the stored cap; never add fees/legal consequences unless explicitly authorized.");
    S.push("- Payment link: include the connected payment-platform hosted invoice/payment URL when available and approved; do not invent a link.");
    S.push("");
  } else {
    S.push("## FlowAudit Default Recovery SOP (no client SOP on file)");
    S.push(`${co} has no documented process. Use FlowAudit's default courteous B2B recovery SOP: pre-flight checks, friendly reminder around day 1–3, follow-up around day 7, firm notice around day 14, pre-escalation around day 21–30, final notice around day 45–60, and handback around day 90 or on any dispute/hardship/stop signal. Flag to the team that the SOP should be confirmed with the client before go-live.`);
    S.push("");
  }

  S.push("## Voice");
  S.push([line("Tone: ", rp.tone), line("Always say: ", rp.alwaysPhrases), line("Never say: ", rp.neverPhrases)].filter(Boolean).join(". ") || "Professional, firm but polite.");
  S.push([line("Sign as: ", out.fromName), line("Send from: ", out.sendingDomain), line("Send during: ", (out.businessHours || "") + (out.timezone ? " " + out.timezone : "")), line("Languages: ", out.languages)].filter(Boolean).join(". "));
  if (out.signature) S.push("Signature:\n" + out.signature);
  S.push("");
  S.push("## The recovery loop");
  S.push(`1. Detect unpaid invoices in ${(rec.paymentPlatforms || []).join("/") || ps.accounting || "the payment/accounting system"}.`);
  S.push(`2. Pull the customer's contact from ${rec.crm || "the CRM"}.`);
  S.push("3. Draft outreach in the voice and SOP above.");
  if (autoChannels.length) {
    S.push(`4. On ${autoChannels.join(" / ")}: send automatically (within the Safety Rails).${gatedChannels.length ? " On " + gatedChannels.join(" / ") + ": queue for " + (rec.primaryContact || "approval") + " first." : ""}`);
  } else {
    S.push(`4. Queue a batch and get approval from ${rec.primaryContact || "the primary contact"}.`);
  }
  S.push("5. If the customer agrees to pay, send a payment link.");
  S.push(`6. Log every outcome and report to ${rec.primaryContact || "the primary contact"} weekly.`);

  if (usesLetters(rec)) {
    S.push("\n## Letters (physical mail) — HARD RULES");
    S.push(`- ${co} uses physical letters in recovery. Mail goes through ${co}'s OWN PostGrid account (their POSTGRID_API_KEY in your profile .env). Never use another client's mail account.`);
    S.push("- Letters are ALWAYS approval-gated by default — they cost money and cannot be unsent. Queue the drafted letter for human approval before mailing, even if email/SMS are auto-send.");
    S.push("- Before mailing, VERIFY the customer's postal address (from the CRM); never mail to an unverified or do-not-contact address.");
    S.push("- The formal-demand rung (around day 60) goes CERTIFIED / return-receipt for legal-grade proof of service.");
    S.push("- You never print or post a letter directly. You draft it in the voice/SOP above and submit it through the recovery executor, which enforces the approval gate, the do-not-contact list, and the spend cap.");
  }
  const soul = S.join("\n");

  const M = [];
  M.push(`§ ${co} is a ${rec.industry || "business"}${rec.size ? " (" + rec.size + ")" : ""}.`);
  if (bp.businessModel) M.push("§ Model: " + bp.businessModel);
  M.push(`§ Invoices ${bp.customerType || "customers"}; ~${bp.customerCount || "?"} active; typical invoice ${bp.typicalInvoiceSize || "?"}; ~${bp.monthlyVolumeCount || "?"}/mo${bp.monthlyVolumeAmount ? ", " + fmtMoneyShort(bp.monthlyVolumeAmount) + "/mo" : ""}; terms ${bp.paymentTerms || "?"}${bp.currencies ? "; " + bp.currencies : ""}.`);
  M.push("§ Approx overdue at onboarding: " + fmtMoneyShort(rec.approxOutstanding) + ".");
  M.push(`§ Payments: ${(rec.paymentPlatforms || []).join(", ") || "?"}; accounting ${ps.accounting || "?"}; payment links ${ps.canGeneratePaymentLinks || "?"}; API access ${ps.apiAccess || "?"}${ps.accessOwner ? " (owner " + ps.accessOwner + ")" : ""}${ps.connectionMethod ? " via " + ps.connectionMethod : ""}.`);
  M.push(`§ CRM: ${rec.crm || "?"}${cd.dataLocation ? " (" + cd.dataLocation + ")" : ""}; ~${cd.recordCount || "?"} records; quality ${cd.dataQuality || "?"}; API access ${cd.apiAccess || "?"}${cd.accessOwner ? " (owner " + cd.accessOwner + ")" : ""}.`);
  if (rp.whoRunsIt || rp.whatWorks) M.push(`§ Current collections: ${rp.whoRunsIt || "?"}${rp.timeSpent ? ", " + rp.timeSpent + "/wk" : ""}${rp.whatWorks ? "; what works: " + rp.whatWorks : ""}.`);
  M.push(`§ Goal: ${go.primaryGoal || "recover AR"}${go.recoveryTarget ? "; target " + go.recoveryTarget : ""}${go.kpis ? "; KPIs " + go.kpis : ""}.`);
  if ((go.otherAutomations || []).length) M.push("§ Cross-sell interest: " + go.otherAutomations.join(", ") + ".");
  M.push(`§ SOP: ${rec.hasSop ? "on file, follow theirs" : (rec.wantsSopBuilt ? "none — FlowAudit Default Recovery SOP drafted/tailored for them to confirm" : "none — FlowAudit Default Recovery SOP applies until confirmed")}.`);
  M.push(`§ Sending: ${((rec.autoSendChannels || []).length) ? "auto-send (no approval) on " + rec.autoSendChannels.join(", ") + "; approval still required on all other channels" : "human approval required on every channel"}. Safety rails (do-not-contact, compliance, stop-on-reply, hours, discount cap) always apply.`);
  if (ar.approvers || ar.preferredChannel || ar.notes) M.push(`§ Approval routing: approvers=${ar.approvers || rec.primaryContact || "primary contact"}; channel=${ar.preferredChannel || "client workflow"}${ar.sla ? "; SLA=" + ar.sla : ""}${ar.notes ? "; notes=" + ar.notes : ""}.`);
  const memory = clip(M.join("\n"), 2200);

  const U = [];
  U.push("§ Primary contact & approver: " + (rec.primaryContact || "?") + ".");
  U.push("§ Onboarding contact: " + [rec.contactName, rec.email, rec.phone].filter(Boolean).join(" · ") + ".");
  if (out.timezone || out.businessHours || out.languages) U.push(`§ Timezone ${out.timezone || "?"}; hours ${out.businessHours || "?"}; languages ${out.languages || "?"}.`);
  if (rp.tone) U.push("§ Preferred tone: " + rp.tone + ".");
  U.push(`§ Approval model: ${g.approvalModel || "approve every message"}${g.batchSize ? "; batch size " + g.batchSize : ""}${((rec.autoSendChannels || []).length) ? "; auto-send authorized on " + rec.autoSendChannels.join(", ") : ""}.`);
  if (ar.approvers || ar.preferredChannel) U.push(`§ Draft approval route: ${ar.approvers || rec.primaryContact || "primary contact"} via ${ar.preferredChannel || "client workflow"}.`);
  const user = clip(U.join("\n"), 1375);

  const manifest = {
    profile: profileName, company: co, industry: rec.industry || null,
    integrations: {
      payment: { platforms: rec.paymentPlatforms || [], accounting: ps.accounting || null, apiAccess: ps.apiAccess || null, connectionMethod: ps.connectionMethod || null, accessOwner: ps.accessOwner || null, canGeneratePaymentLinks: ps.canGeneratePaymentLinks || null },
      crm: { name: rec.crm || null, apiAccess: cd.apiAccess || null, accessOwner: cd.accessOwner || null, dataLocation: cd.dataLocation || null },
      outreach: { channels: out.channels || [], emailProvider: out.emailProvider || null, sendingDomain: out.sendingDomain || null, smsProvider: out.smsProvider || null }
    },
    envKeysNeeded: envKeysFor(rec),
    oauthConnectionsNeeded: oauthConnectionsFor(rec),
    composioConnectionsNeeded: composioConnectionsFor(rec),
    composioEnvKeysNeeded: composioEnvKeysFor(rec),
    documents: (rec.documents || []).map((d) => ({ name: d.name, path: d.path })),
    automation: { autoSendChannels: rec.autoSendChannels || [], fullyAutomated: ((rec.autoSendChannels || []).length > 0), approvalModel: g.approvalModel || "approve every message", approvalRouting: ar },
    letters: { uses: usesLetters(rec), provider: usesLetters(rec) ? "PostGrid" : null, returnAddress: (out.letters && out.letters.returnAddress) || null, defaultMailingClass: (out.letters && out.letters.defaultMailingClass) || "first_class", certifiedOnDemandRung: !(out.letters && out.letters.certifiedOnDemandRung === false) },
    sop: { hasSop: !!rec.hasSop, wantsSopBuilt: !!rec.wantsSopBuilt, status: rec.hasSop ? "client SOP" : (rec.wantsSopBuilt ? "FlowAudit Default Recovery SOP drafted/tailored" : "FlowAudit Default Recovery SOP fallback") },
    readiness: { integrationReady: !!rec.integrationReady, hasSop: !!rec.hasSop, consent: !!rec.consent },
    llmRuntime: {
      mode: "flowaudit_managed_chatgpt",
      provider: "openai-codex",
      model: "gpt-5.1-codex-max",
      accountOwner: "FlowAudit",
      auth: "profile_local_oauth",
      authProvider: "openai-codex",
      authStore: "auth.json",
      status: "pending_oauth",
      readyCheck: "profile auth.json contains refreshable openai-codex OAuth credentials",
      billing: "funded from client retainer"
    },
    // containment: the ONLY tools this agent may use. Deny-by-default; enforced by the executor (actionAllowed).
    toolAllowlist: ["read_payments", "read_crm", "draft_message", "queue_for_approval", "send_via_executor", "generate_payment_link"]
  };

  return { profileName, soul, memory, user, manifest };
}
