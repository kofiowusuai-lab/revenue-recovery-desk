#!/usr/bin/env node
/**
 * rrd-welcome-pack.mjs — client-facing post-onboarding comms for RRD.
 *
 * IMPORTANT DISTINCTION:
 * - `welcome` is the operational welcome pack: how to work with us, reporting,
 *   support, approvals, and cancellation/offboarding. It intentionally does NOT
 *   include PostGrid/Twilio/Stripe/etc. API-key setup steps.
 * - `access` is the separate secure integration-access email that accompanies a
 *   one-time vault / OAuth connect link. That email is where stack-specific setup
 *   instructions belong. Never ask a client to email secrets.
 *
 * Usage:
 *   rrd-welcome-pack welcome <submission-id> [--dry-run] [--to email]
 *   rrd-welcome-pack access <submission-id> --vault-url <url> [--oauth-url <Provider=url>] [--dry-run] [--to email]
 *   rrd-welcome-pack sop <submission-id> [--dry-run] [--to email]
 *   rrd-welcome-pack readiness <submission-id> [--dry-run] [--to email]
 *
 * Live send uses AgentMail internally, while client-facing copy uses support@flowaudit.co.uk, and reports only
 * provider acceptance/message ids, not guaranteed human delivery.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildHermesPack } from './rrd-hermes.mjs';
import { signedClientActionUrl } from './rrd-client-action-token.mjs';
import { initialClientPassword } from './rrd-client-dashboard-core.mjs';

const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || '/Users/AIAgenterminal';
const PROFILE_ENV = `${OPERATOR_HOME}/.hermes/profiles/recoverydesk/.env`;
const LOCAL_ENV = `${OPERATOR_HOME}/.env.local`;
const OPENCLAW_ENV = `${OPERATOR_HOME}/.openclaw/.env`;
const INBOX_ID = process.env.RRD_SUPPORT_INBOX_ID || 'flowaudit-support@agentmail.to';
const PUBLIC_SUPPORT_EMAIL = process.env.RRD_PUBLIC_SUPPORT_EMAIL || 'support@flowaudit.co.uk';
const API_BASE = process.env.AGENTMAIL_API_BASE || 'https://api.agentmail.to/v0';
const OFFBOARD_BASE = process.env.RRD_OFFBOARD_BASE || `${(process.env.RRD_WEB_BASE || 'https://flowaudit.co.uk/revenue-recovery').replace(/\/+$/, '')}/offboard`;
const WEB_BASE = (process.env.RRD_WEB_BASE || 'https://flowaudit.co.uk/revenue-recovery').replace(/\/+$/, '');
const BOOKING_URL = process.env.RRD_BOOKING_URL || 'https://calendly.com/flowaudit-info/30min';

function loadDotenv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotenv(LOCAL_ENV);
loadDotenv(OPENCLAW_ENV);
loadDotenv(PROFILE_ENV);

function parseArgs(argv) {
  const opts = { _: [], dryRun: false, oauthUrls: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--to') opts.to = argv[++i];
    else if (a === '--vault-url') opts.vaultUrl = argv[++i];
    else if (a === '--oauth-url') opts.oauthUrls.push(argv[++i]);
    else if (a === '-h' || a === '--help') opts.help = true;
    else opts._.push(a);
  }
  return opts;
}

function usage() {
  console.error(`rrd-welcome-pack\n\nUsage:\n  rrd-welcome-pack welcome <submission-id> [--dry-run] [--to email]\n  rrd-welcome-pack access <submission-id> --vault-url <url> [--oauth-url <Provider=url>] [--dry-run] [--to email]\n  rrd-welcome-pack sop <submission-id> [--dry-run] [--to email]\n  rrd-welcome-pack readiness <submission-id> [--dry-run] [--to email]\n  rrd-welcome-pack mapping <submission-id> [--dry-run] [--to email]\n`);
}

function harness(command, jsonArg) {
  const args = [command];
  if (jsonArg !== undefined) args.push(JSON.stringify(jsonArg));
  const out = execFileSync('/Users/AIAgenterminal/rrd-harness', args, { encoding: 'utf8', timeout: 120000 });
  return JSON.parse(out);
}

function primaryFirstName(client) {
  const raw = client.contactName || client.primaryContact || '';
  const first = String(raw).trim().split(/\s+/)[0];
  return first || 'there';
}

function clientChannels(client) {
  const out = client.outreach || {}, rp = client.recoveryProcess || {};
  const channels = (out.channels && out.channels.length) ? out.channels : (rp.channels || []);
  return channels.length ? channels.join(', ') : 'email-first recovery outreach, with any extra channels confirmed before use';
}

function approvalText(client) {
  const g = client.guardrails || {};
  const auto = client.autoSendChannels || [];
  if (auto.length) return `You have pre-authorized ${auto.join(', ')} for automatic sending inside the agreed safety rules. Anything outside those channels still goes through approval.`;
  return `We will not contact your customers without human approval. Your approval model is: ${g.approvalModel || 'approve every message'}.`;
}

function reportingText(client) {
  const goals = client.goals || {};
  const primary = goals.primaryGoal || 'recover overdue invoices';
  const kpis = goals.kpis || 'amount recovered, invoices contacted, replies/disputes, promised payments, payments received, and blockers';
  return `Your reporting will focus on: ${primary}. We will summarize ${kpis}.`;
}

function buildWelcome(client, dashboardCredentials = null) {
  const pack = buildHermesPack(client);
  const company = client.company || 'your company';
  const contact = primaryFirstName(client);
  const subject = `Welcome to Revenue Recovery Desk — ${company}`;
  const dashboardBlock = dashboardCredentials ? `\nClient dashboard\n- Dashboard: ${WEB_BASE}/client\n- Login email: ${dashboardCredentials.email}\n- Temporary password: ${dashboardCredentials.password}\n- You must set a new password on first sign-in.\n- This account is for ${company}. Do not forward the password; ask us to reset it if needed.\n` : `\nClient dashboard\n- Your FlowAudit client dashboard will be available here: ${WEB_BASE}/client\n- If your login has not arrived yet, reply to this email and we will reset it.\n`;
  const text = `Hi ${contact},\n\nWelcome to Revenue Recovery Desk — your onboarding is complete and your dedicated recovery workspace is ready.${dashboardBlock}\nWhat we will do\n- Monitor the agreed invoice/payment and CRM sources for overdue accounts.\n- Prepare recovery outreach in your approved tone and process.\n- Work through the channels agreed during onboarding: ${clientChannels(client)}.\n- Escalate disputes, stop requests, sensitive replies, or anything outside the agreed guardrails back to your team.\n\nApprovals and safety\n- ${approvalText(client)}\n- We follow your do-not-contact rules, business hours, discount limits, and compliance constraints.\n- We stop and escalate immediately when a customer disputes, asks us to stop, or needs a human decision.\n\nReporting\n- ${reportingText(client)}\n- You will receive concise operator updates showing what happened, what was recovered or promised, what is blocked, and what we need from you next.\n- This is meant to make the work visible: you should always be able to see that the system is actively moving invoices forward.\n\nGo-live tracker\n- You can track setup progress here: ${signedGoLiveUrl(client)}\n- The tracker shows what has been completed, what we still need from your team, who we have listed as the primary/key contacts, and when the recovery workspace is ready to go live.\n\nPostal Portal\n- Your secure FlowAudit Postal Portal is here: ${signedPostalPortalUrl(client)}\n- Any pending physical letters appear there for final review, signer name/team entry, signature upload, approval, or rejection.\n- No physical letter is sent without portal sign-off. The portal is the final authorization layer before any approved letter can be queued for postage.\n\nIntegration access\n- If we need API keys or account authorizations, those are handled in a separate secure integration-access email based on the tech stack you gave us during onboarding.\n- Do not email us API keys, passwords, card details, or private credentials. Use only the one-time secure link we send for integrations.\n\nHow to contact us\n- Support and account help: ${PUBLIC_SUPPORT_EMAIL}\n- Reply to any report/update email if you want us to pause, change guardrails, review a draft, or investigate an account.\n\nHow to cancel\n- You can request cancellation any time by emailing ${PUBLIC_SUPPORT_EMAIL} from the business email on file.\n- For security, cancellation/offboarding requests must come from and match the active business/billing email on file.\n- After a verified request, we calculate any final amount owed up to the requested cancellation date, complete offboarding, shut down active integrations, destroy live credentials, and send confirmation.\n\nAccount snapshot\n- Company: ${company}\n- Account setup ID: ${pack.profileName}\n- Primary contact: ${client.primaryContact || client.contactName || 'not specified'}\n- Approximate overdue at onboarding: ${client.approxOutstanding ? '$' + Math.round(client.approxOutstanding).toLocaleString('en-US') : 'not specified'}\n\nThanks,\nRevenue Recovery Desk\n`;
  return { subject, text };
}

const PROVIDER_HELP = {
  STRIPE_API_KEY: ['Stripe', 'Create a Restricted Secret Key — not a publishable key. Stripe Dashboard → Developers → API keys → Create restricted key. Minimum launch permissions: Customers read, Invoices read, PaymentIntents read, Charges read. Add Payment Links/Checkout/Invoices write only if you want us to create payment links or finalize/send invoices.'],
  SQUARE_ACCESS_TOKEN: ['Square', 'Use a production access token for the correct Square application/location. Prefer a scoped token where available; required scopes are invoice/payment/customer read, plus invoice/payment write only if you approve creating payment requests.'],
  PAYPAL_CLIENT_ID: ['PayPal', 'Use the REST API app Client ID for the live PayPal app/account used for invoicing. This is paired with the client secret below.'],
  PAYPAL_CLIENT_SECRET: ['PayPal', 'Use the matching REST API app Secret for the same live PayPal app. Do not send a sandbox secret unless this is a sandbox test.'],
  TWILIO_ACCOUNT_SID: ['Twilio', 'Use the Account SID or Subaccount SID for the Twilio account that owns the approved SMS number/messaging service.'],
  TWILIO_AUTH_TOKEN: ['Twilio', 'Use the matching Auth Token, or preferably a scoped Twilio API Key/Secret if your setup supports it. Do not send a phone-number SID alone.'],
  POSTGRID_API_KEY: ['PostGrid', 'Use a Live API key from your own PostGrid account for real letters, or a test key only for sandbox testing. Do not send account passwords. If you do not want physical letters sent, use the opt-out option on the secure access form instead of providing a key. If Letters remain enabled, you do not provide your own PostGrid key, and you later approve/authorize physical letters, postage, print, processing, certified-mail, and related costs we incur will be passed through and billed at month-end in addition to your maintenance/retainer fee.'],
  SENDGRID_API_KEY: ['SendGrid', 'Create a restricted API key with Mail Send permission only, plus suppressions/templates read only if needed. Do not send account login credentials.'],
  POSTMARK_SERVER_TOKEN: ['Postmark', 'Use the Server API token for the specific Postmark server/message stream used for recovery mail. Do not send account-owner tokens unless required.'],
  MAILGUN_API_KEY: ['Mailgun', 'Use a sending API key for the exact Mailgun domain/subdomain used for recovery email. Include the domain separately if requested; do not send your login password.']
};

function parseOauthUrls(items) {
  return items.map((item) => {
    const idx = String(item).indexOf('=');
    if (idx < 1) return { provider: 'OAuth connection', url: item };
    return { provider: item.slice(0, idx), url: item.slice(idx + 1) };
  });
}

const CRM_MAPPING_PLATFORMS = ['salesforce', 'hubspot', 'zoho', 'pipedrive', 'monday', 'gohighlevel', 'highlevel', 'close', 'airtable'];
const ACCOUNTING_MAPPING_PLATFORMS = ['xero', 'quickbooks', 'intuit', 'sage', 'freshbooks', 'freeagent', 'netsuite'];
const PAYMENT_MAPPING_PLATFORMS = ['stripe', 'square', 'paypal', 'adyen', 'braintree', 'shopify'];

function selectedIntegrationText(client, oauthNeeded) {
  return [
    client?.crm,
    client?.crmData?.crm,
    client?.paymentStack?.accounting,
    ...(client?.paymentStack?.platforms || []),
    ...(client?.paymentPlatforms || []),
    ...(oauthNeeded || []),
  ].filter(Boolean).join(' ').toLowerCase();
}
function hasAny(haystack, needles) { return needles.some((n) => haystack.includes(n)); }

function mappingSection(client, oauthNeeded) {
  const haystack = selectedIntegrationText(client, oauthNeeded);
  const needsCrm = hasAny(haystack, CRM_MAPPING_PLATFORMS);
  const needsAccounting = hasAny(haystack, ACCOUNTING_MAPPING_PLATFORMS);
  const needsPayments = hasAny(haystack, PAYMENT_MAPPING_PLATFORMS);
  if (!needsCrm && !needsAccounting && !needsPayments) return '';
  const sections = [];
  sections.push(`\nField mapping / data-location check\nAfter you connect the systems above, please reply with any known field names, screenshots, reports, or a short Loom showing where recovery-critical data lives. Plain English is fine if you do not know API names. If you are not sure, no problem — we will run read-only discovery and send a proposed map for approval before any recovery activity starts.`);
  if (needsAccounting) sections.push(`\nAccounting / invoice mapping\nPlease tell us, if known:\n- Where open/overdue invoices live\n- Invoice number / reference field\n- Customer/account field\n- Amount due, amount paid, balance remaining\n- Currency\n- Invoice date and due date\n- Invoice status / paid status\n- Payment terms\n- Payment link or hosted invoice URL\n- Credit notes, partial payments, write-offs, or payment-plan markers\n- Tax/VAT fields if they affect balances`);
  if (needsPayments) sections.push(`\nPayment platform mapping\nPlease tell us, if known:\n- Where charges, invoices, subscriptions/retainers, payment links, disputes, and failed payments are viewed\n- Customer identifier used to match payments back to CRM/accounting\n- Payment status/refund/dispute fields\n- Default payment-link flow we should use when a client approves outreach\n- Any products/prices/retainer labels that must not be changed`);
  if (needsCrm) sections.push(`\nCRM / customer mapping\nPlease tell us, if known:\n- Where customers/accounts, contacts, deals/opportunities/jobs, and account owners live\n- Email, phone, mailing address, and preferred contact fields\n- Owner / account manager / escalation owner field\n- Do-not-contact, dispute, payment-plan, VIP/strategic-account, legal/collections, and vulnerability/sensitive-account flags\n- Last contacted / next follow-up / recovery notes fields\n- Where we should write back activity: task, note, call log, email log, deal update, case/ticket, or custom object\n- For Salesforce specifically: whether receivables live in Opportunities, Accounts, Contacts, Cases, or custom objects such as Invoice__c / Payment__c / AR__c`);
  sections.push(`\nIf your team already has a report/export called “aged receivables”, “open invoices”, “collections queue”, or similar, you can send the report name or a screenshot. Do not send passwords, API keys, private tokens, card details, or customer-sensitive exports by email.`);
  return sections.join('\n') + '\n';
}

function lockedUrl(path, client, action = path.replace(/-/g, '_')) {
  return signedClientActionUrl(path, client, action, { base: WEB_BASE });
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}
function signedPortalToken(client, ttlDays = 60) {
  const secret = process.env.RRD_GO_LIVE_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
  if (!secret) throw new Error('Missing RRD_GO_LIVE_TOKEN_SECRET or SUPABASE_SERVICE_ROLE_KEY for portal link signing.');
  const payload = b64url(JSON.stringify({
    sid: client.id || '',
    email: String(client.email || '').toLowerCase(),
    company: client.company || '',
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * ttlDays,
  }));
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function signedGoLiveUrl(client) {
  return `${WEB_BASE}/go-live?token=${encodeURIComponent(signedPortalToken(client, 60))}`;
}
function signedPostalPortalUrl(client) {
  return `${WEB_BASE}/postal-portal?token=${encodeURIComponent(signedPortalToken(client, 90))}`;
}

function needsSopReview(client) {
  const rp = client.recoveryProcess || {};
  const hasSop = client.hasSop || /^yes$/i.test(String(rp.hasSop || ''));
  return !hasSop && !!(client.wantsSopBuilt || rp.wantSopBuilt);
}

function buildSopReview(client) {
  const company = client.company || 'your company';
  const url = lockedUrl('sop-review', client, 'sop_review');
  const subject = `Please review your recovery SOP — ${company}`;
  const text = `Hi ${primaryFirstName(client)},\n\nBecause you told us you do not have a formal recovery process and would like FlowAudit to build one, we prepared our default Revenue Recovery SOP for your review.\n\nPlease review it here:\n${url}\n\nOn that page you can:\n- Accept the SOP, so we can use it as your approved recovery process; or\n- Request changes, so we can tailor the cadence, tone, escalation points, and guardrails before anything goes live.\n\nNothing goes live until the SOP and critical operating details are confirmed.\n\nIf you prefer to discuss changes live, you can book here:\n${BOOKING_URL}\n\nThanks,\nRevenue Recovery Desk\n`;
  return { subject, text };
}

function missingInfoItems(client) {
  const out = client.outreach || {}, g = client.guardrails || {}, ar = client.approvalRouting || g.approvalRouting || {}, rp = client.recoveryProcess || {}, ps = client.paymentStack || {}, cd = client.crmData || {};
  const missing = [];
  if (!ar.approvers) missing.push('Who should approve recovery drafts / exceptions');
  if (!ar.preferredChannel) missing.push('Preferred approval channel');
  if (!out.timezone) missing.push('Business timezone');
  if (!out.businessHours) missing.push('Approved customer-contact business hours');
  if (!out.fromName) missing.push('Recovery email From name');
  if (!out.sendingDomain && !out.emailProvider) missing.push('Recovery sending email/domain setup');
  const channels = (out.channels?.length ? out.channels : rp.channels || []);
  if (channels.some((c) => /sms/i.test(String(c))) && (!out.smsProvider || !out.smsNumber)) missing.push('SMS provider and sending number');
  if (channels.some((c) => /letter|mail|post/i.test(String(c)))) {
    const ra = out.letters?.returnAddress || out.returnAddress || {};
    if (!ra.line1 && !ra.name) missing.push('Letter return address');
  }
  if (!g.doNotContact) missing.push('Do-not-contact and exclusion rules');
  if (!g.maxDiscount && !rp.settlementRules) missing.push('Settlement / discount / payment-plan rules');
  if (!rp.escalation && !g.escalationTriggers) missing.push('Escalation triggers');
  if (/spreadsheet/i.test(String(ps.accounting || ''))) missing.push('Spreadsheet tabs, column mapping, and refresh cadence');
  if (/own|custom|internal|proprietary|bespoke/i.test(String(client.crm || cd.crm || ''))) missing.push('Custom CRM API/report mapping');
  return missing;
}

function buildReadiness(client) {
  const company = client.company || 'your company';
  const url = lockedUrl('readiness', client, 'readiness_details');
  const items = missingInfoItems(client);
  const subject = `A few setup details needed before recovery can go live — ${company}`;
  const text = `Hi ${primaryFirstName(client)},\n\nWe reviewed your onboarding and there are a few operating details we need before recovery can safely go live.\n\nPlease complete the readiness form here:\n${url}\n\nCurrent missing/needs-confirmation items:\n${items.length ? items.map((x) => `- ${x}`).join('\n') : '- Final confirmation of operating details'}\n\nThis is separate from the secure integration/vault link. Please do not send API keys, passwords, card details, or private credentials by email.\n\nThanks,\nRevenue Recovery Desk\n`;
  return { subject, text };
}

function needsMapping(client, oauthNeeded = []) {
  const haystack = selectedIntegrationText(client, oauthNeeded);
  return /spreadsheet|custom|internal|proprietary|bespoke|api|salesforce|hubspot|zoho|pipedrive|monday|gohighlevel|highlevel|xero|quickbooks|intuit|sage|freshbooks|netsuite|stripe|square|paypal|adyen|braintree|shopify/i.test(haystack);
}

function buildMapping(client) {
  const pack = buildHermesPack(client);
  const company = client.company || 'your company';
  const url = lockedUrl('mapping', client, 'mapping_details');
  const oauthNeeded = pack.manifest.oauthConnectionsNeeded || [];
  const textHint = selectedIntegrationText(client, oauthNeeded) || 'your connected systems';
  const subject = `Data mapping needed before go-live — ${company}`;
  const text = `Hi ${primaryFirstName(client)},\n\nBefore recovery goes live, we need to confirm where the recovery-critical data lives in ${textHint}. This keeps outreach tied to a real source of truth and prevents us from contacting the wrong customer or using stale balances.\n\nPlease complete the mapping form here:\n${url}\n\nThe form asks for plain-English locations: reports, object/table names, field names, stop/dispute flags, and where activity should be written back. Do not enter API keys, passwords, private tokens, card details, or customer exports. Use the separate secure integration/vault link for secrets.\n\nAfter this, we prepare a proposed mapping for review before anything goes live.\n\nThanks,\nRevenue Recovery Desk\n`;
  return { subject, text };
}

function buildAccess(client, opts) {
  const pack = buildHermesPack(client);
  const keys = pack.manifest.envKeysNeeded || [];
  const oauthNeeded = pack.manifest.oauthConnectionsNeeded || [];
  const composioNeeded = pack.manifest.composioConnectionsNeeded || [];
  const oauthUrls = parseOauthUrls(opts.oauthUrls || []);
  const company = client.company || 'your company';
  const subject = `Secure integration access needed — ${company}`;
  const keyLines = keys.length ? keys.map((k) => {
    const help = PROVIDER_HELP[k];
    return `- ${k}${help ? ` (${help[0]}): ${help[1]}` : ': Create this in the relevant provider admin/developer dashboard.'}`;
  }).join('\n') : '- No API-key deposits are currently required from your onboarding stack.';
  const oauthLines = oauthNeeded.length ? oauthNeeded.map((p) => {
    const match = oauthUrls.find((o) => o.provider.toLowerCase() === p.toLowerCase());
    return `- ${p}: use the secure Connect link${match ? `: ${match.url}` : ' we send separately'}. You authorize on the provider website; do not paste passwords or secrets.`;
  }).join('\n') : '- No native OAuth connect links are currently required from your onboarding stack.';
  const composioLines = composioNeeded.length ? composioNeeded.map((p) => `- ${p}: we will send a secure Composio-managed authorization link if this system is needed for go-live. You authorize/login there; do not email passwords or API keys.`).join('\n') : '- No Composio-managed authorizations are currently required from your onboarding stack.';
  const postgridNotice = keys.includes('POSTGRID_API_KEY') ? `\nPhysical letters / PostGrid billing choice\nBecause Letters were enabled during onboarding, the secure form asks for your PostGrid API key so letters can be sent from your own PostGrid account. You may also opt out of physical letters on that form instead of providing a key. The same letter section also lets you upload an existing recovery letter/letterhead plus logos or brand assets so we can mimic your logo placement, text style, fonts, spacing, and layout for approved recovery letters. If you do not provide your own PostGrid key, do not opt out, and later approve/authorize us to send physical letters, you agree that any postage, print, processing, certified-mail, and related letter costs we incur may be passed through and billed at month-end in addition to your maintenance/retainer fee. Current per-piece estimate: $1.219 per letter + 20p per page, plus any certified-mail or provider pass-through extras.\n` : '';
  const text = `Hi ${primaryFirstName(client)},\n\nThis is the separate secure integration-access request for ${company}. This is intentionally separate from your welcome pack.\n\nPlease do not send API keys, passwords, or card details by email. Use only the secure one-time link below.\n\nSecure API-key link\n${opts.vaultUrl || '(operator will paste the one-time vault link here)'}\n\nThis link expires and burns after one completed deposit.\n\nAPI-key items requested from your onboarding stack\n${keyLines}\n\nOAuth/account authorization items\n${oauthLines}\n\nComposio-managed authorization items\n${composioLines}\n${mappingSection(client, [...oauthNeeded, ...composioNeeded])}\nRecovery email sending setup\nFor best inbox placement, recovery messages should come from your company’s email identity, not a shared Revenue Recovery Desk address. Please confirm:\n- Preferred From name customers should see, e.g. Acme Accounts Team\n- Preferred sender address or sending subdomain, e.g. accounts@recover.yourdomain.com or billing@ar.yourdomain.com\n- Who on your team can add DNS records if needed\n- Reply handling preference: replies go to your team, Revenue Recovery Desk, or both\n\nRecommended setup:\n- Sender: accounts@recover.yourdomain.com\n- DNS: SPF, DKIM, DMARC, and return-path records supplied by the email provider\n\nIf you already use a billing/accounts mailbox customers recognize, reply with that address and who manages it. Do not send mailbox passwords or private credentials by email.\n${postgridNotice}\nIf you are unsure which account/admin owns a system, reply with the owner name/email only — not the credentials.\n\nThanks,\nRevenue Recovery Desk\n`;
  return { subject, text };
}

function apiKey() {
  const key = process.env.AGENTMAIL_API_KEY;
  if (!key) throw new Error('AGENTMAIL_API_KEY not configured');
  return key;
}

async function agentmail(method, endpoint, body = undefined) {
  const url = new URL(`${API_BASE}/${endpoint.replace(/^\//, '')}`);
  const opts = { method, headers: { Authorization: `Bearer ${apiKey()}` } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`AgentMail API error ${res.status}: ${data?.message || data?.error?.message || text}`);
  return data;
}

async function supabaseRest(path, init = {}) {
  const urlBase = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
  if (!urlBase || !key) throw new Error('Missing Supabase service config for client dashboard account.');
  const res = await fetch(`${urlBase}/rest/v1/${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(body?.message || body?.error || text || `Supabase ${res.status}`);
  return body;
}
async function supabaseAuthAdmin(path, init = {}) {
  const urlBase = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
  if (!urlBase || !key) throw new Error('Missing Supabase service config for client dashboard account.');
  const res = await fetch(`${urlBase}/auth/v1/${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(body?.msg || body?.message || body?.error || text || `Supabase Auth ${res.status}`);
  return body;
}
export async function ensureClientDashboardAccount(client, { createdBy = 'welcome-pack' } = {}) {
  const email = String(client.email || '').trim().toLowerCase();
  if (!email) throw new Error('Client email is required to create a dashboard account.');
  const password = initialClientPassword();
  let user;
  const existing = await supabaseRest(`client_accounts?submission_id=eq.${encodeURIComponent(client.id)}&select=*`);
  if (existing?.length) {
    user = { id: existing[0].user_id };
    await supabaseAuthAdmin(`admin/users/${encodeURIComponent(user.id)}`, { method: 'PUT', body: JSON.stringify({ password, email_confirm: true, app_metadata: { submission_id: client.id, role: 'client', must_reset: true } }) });
  } else {
    user = await supabaseAuthAdmin('admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { submission_id: client.id, role: 'client', must_reset: true } }) });
  }
  await supabaseRest('client_accounts?on_conflict=submission_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ user_id: user.id, submission_id: client.id, email, company: client.company || '', must_reset: true, created_by: createdBy }) });
  return { email, password, userId: user.id };
}

async function sendEmail(to, subject, text) {
  // AgentMail send endpoint mirrors the support/offboarding scripts.
  return agentmail('POST', `/inboxes/${encodeURIComponent(INBOX_ID)}/messages/send`, { to, subject, text });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { usage(); return; }
  const cmd = opts._[0];
  const id = opts._[1];
  if (!cmd || !id || !['welcome', 'access', 'sop', 'readiness', 'mapping'].includes(cmd)) { usage(); process.exitCode = 2; return; }

  const client = harness('get', id);
  if (!client?.id) throw new Error(`No active client found for ${id}`);
  let dashboardCredentials = null;
  if (cmd === 'welcome' && !opts.dryRun) dashboardCredentials = await ensureClientDashboardAccount(client);
  const msg = cmd === 'welcome'
    ? buildWelcome(client, dashboardCredentials)
    : cmd === 'access'
      ? buildAccess(client, opts)
      : cmd === 'sop'
        ? buildSopReview(client)
        : cmd === 'readiness'
          ? buildReadiness(client, opts)
          : buildMapping(client);
  const to = opts.to || client.email;
  if (!to) throw new Error('No recipient email on client; pass --to email');

  if (opts.dryRun) {
    console.log(JSON.stringify({ ok: true, dryRun: true, command: cmd, to, subject: msg.subject, text: msg.text }, null, 2));
    return;
  }

  const sent = await sendEmail(to, msg.subject, msg.text);
  console.log(JSON.stringify({ ok: true, command: cmd, to, subject: msg.subject, agentmailAccepted: true, messageId: sent.message_id || sent.id || null }, null, 2));
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
