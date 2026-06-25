/**
 * Tests for the integration classification in rrd-hermes.mjs:
 * the vault collects ONLY pure API-key providers; native OAuth platforms
 * (Salesforce, Zoho, Google, etc.) are surfaced separately for an OAuth connect flow;
 * HubSpot is surfaced as native OAuth while Composio HubSpot is deferred.
 * Run: node --test test/rrd-hermes-integrations.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envKeysFor, oauthConnectionsFor, composioConnectionsFor, composioEnvKeysFor, buildHermesPack, usesLetters } from "../rrd-hermes.mjs";

const rec = (over = {}) => ({
  company: "Acme", paymentPlatforms: [], crm: null, outreach: {}, ...over,
});

test("Stripe-only client → one API key, no OAuth connections", () => {
  const r = rec({ paymentPlatforms: ["Stripe"] });
  assert.deepEqual(envKeysFor(r), ["STRIPE_API_KEY"]);
  assert.deepEqual(oauthConnectionsFor(r), []);
});

test("HubSpot CRM is native OAuth → no vault key and no Composio dependency", () => {
  const r = rec({ crm: "HubSpot" });
  assert.deepEqual(envKeysFor(r), []);
  assert.deepEqual(oauthConnectionsFor(r), ["HubSpot"]);
  assert.deepEqual(composioConnectionsFor(r), []);
  assert.deepEqual(composioEnvKeysFor(r), []);
});

test("Salesforce is OAuth → no SALESFORCE_* keys in the vault", () => {
  const r = rec({ crm: "Salesforce" });
  assert.ok(!envKeysFor(r).some((k) => k.startsWith("SALESFORCE")));
  assert.deepEqual(oauthConnectionsFor(r), ["Salesforce"]);
});

test("Zoho CRM is OAuth", () => {
  const r = rec({ crm: "Zoho CRM" });
  assert.deepEqual(envKeysFor(r), []);
  assert.deepEqual(oauthConnectionsFor(r), ["Zoho CRM"]);
});

test("Google Workspace email is OAuth → no pasted Gmail/Google key", () => {
  const r = rec({ outreach: { emailProvider: "Google Workspace / Gmail" } });
  assert.deepEqual(envKeysFor(r), []);
  assert.deepEqual(oauthConnectionsFor(r), ["Google Workspace"]);
});

test("Microsoft 365 / Outlook email is OAuth → no pasted Microsoft key", () => {
  const r = rec({ outreach: { emailProvider: "Microsoft 365 / Outlook" } });
  assert.deepEqual(envKeysFor(r), []);
  assert.deepEqual(oauthConnectionsFor(r), ["Microsoft 365 / Outlook"]);
});

test("Xero accounting is OAuth → no pasted Xero key, listed as an OAuth connection", () => {
  const r = rec({ paymentStack: { accounting: "Xero" } });
  assert.deepEqual(envKeysFor(r), []);
  assert.deepEqual(oauthConnectionsFor(r), ["Xero"]);
});

test("QuickBooks Online accounting is OAuth", () => {
  const r = rec({ paymentStack: { accounting: "QuickBooks Online" } });
  assert.deepEqual(envKeysFor(r), []);
  assert.deepEqual(oauthConnectionsFor(r), ["QuickBooks Online"]);
});

test("Sage accounting is OAuth", () => {
  const r = rec({ paymentStack: { accounting: "Sage" } });
  assert.deepEqual(envKeysFor(r), []);
  assert.deepEqual(oauthConnectionsFor(r), ["Sage"]);
});

test("FreshBooks and Wave invoicing are OAuth accounting connectors", () => {
  assert.deepEqual(envKeysFor(rec({ paymentStack: { accounting: "FreshBooks" } })), []);
  assert.deepEqual(oauthConnectionsFor(rec({ paymentStack: { accounting: "FreshBooks" } })), ["FreshBooks"]);
  assert.deepEqual(envKeysFor(rec({ paymentStack: { accounting: "Wave" } })), []);
  assert.deepEqual(oauthConnectionsFor(rec({ paymentStack: { accounting: "Wave" } })), ["Wave"]);
});

test("Zoho Books and FreeAgent are OAuth accounting connectors", () => {
  assert.deepEqual(envKeysFor(rec({ paymentStack: { accounting: "Zoho Books" } })), []);
  assert.deepEqual(oauthConnectionsFor(rec({ paymentStack: { accounting: "Zoho Books" } })), ["Zoho Books"]);
  assert.deepEqual(envKeysFor(rec({ paymentStack: { accounting: "FreeAgent" } })), []);
  assert.deepEqual(oauthConnectionsFor(rec({ paymentStack: { accounting: "FreeAgent" } })), ["FreeAgent"]);
});

test("native API-capable payment/accounting/CRM options use the secure vault while Shopify stays OAuth/Composio", () => {
  const r = rec({
    paymentPlatforms: ["Whop", "Shopify", "Maxio", "Paystack", "Razorpay", "Lemon Squeezy", "MoonClerk"],
    paymentStack: { accounting: "Moneybird" },
    crm: "Attio",
  });
  assert.deepEqual(envKeysFor(r), [
    "WHOP_API_KEY",
    "MAXIO_SUBDOMAIN", "MAXIO_API_KEY",
    "PAYSTACK_SECRET_KEY",
    "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET",
    "LEMONSQUEEZY_API_KEY", "LEMONSQUEEZY_STORE_ID",
    "MOONCLERK_API_KEY",
    "MONEYBIRD_ACCESS_TOKEN", "MONEYBIRD_ADMINISTRATION_ID",
    "ATTIO_API_KEY"
  ]);
  assert.deepEqual(oauthConnectionsFor(r), []);
  assert.deepEqual(composioConnectionsFor(r), ["Shopify"]);
  assert.deepEqual(composioEnvKeysFor(r), ["COMPOSIO_SHOPIFY_CONNECTED_ACCOUNT_ID"]);
});

test("additional native API accounting/CRM options are wired to vault keys", () => {
  assert.deepEqual(envKeysFor(rec({ paymentStack: { accounting: "Clientary" } })), ["CLIENTARY_API_KEY"]);
  assert.deepEqual(envKeysFor(rec({ paymentStack: { accounting: "Sevdesk" } })), ["SEVDESK_API_TOKEN"]);
  assert.deepEqual(envKeysFor(rec({ paymentStack: { accounting: "Lexoffice" } })), ["LEXOFFICE_API_KEY"]);
  assert.deepEqual(envKeysFor(rec({ paymentStack: { accounting: "Quaderno" } })), ["QUADERNO_API_KEY", "QUADERNO_PRIVATE_KEY"]);
  assert.deepEqual(envKeysFor(rec({ paymentStack: { accounting: "Elorus" } })), ["ELORUS_API_KEY"]);
  assert.deepEqual(envKeysFor(rec({ paymentStack: { accounting: "Coupa" } })), ["COUPA_BASE_URL", "COUPA_CLIENT_ID", "COUPA_CLIENT_SECRET"]);
  assert.deepEqual(envKeysFor(rec({ paymentStack: { accounting: "Odoo" } })), ["ODOO_BASE_URL", "ODOO_DATABASE", "ODOO_USERNAME", "ODOO_API_KEY"]);
  assert.deepEqual(envKeysFor(rec({ crm: "Capsule CRM" })), ["CAPSULE_ACCESS_TOKEN"]);
  assert.deepEqual(envKeysFor(rec({ crm: "Kommo" })), ["KOMMO_BASE_URL", "KOMMO_ACCESS_TOKEN"]);
  assert.deepEqual(envKeysFor(rec({ crm: "Salesflare" })), ["SALESFLARE_API_KEY"]);
  assert.deepEqual(envKeysFor(rec({ crm: "Salesmate" })), ["SALESMATE_DOMAIN", "SALESMATE_ACCESS_KEY", "SALESMATE_SESSION_TOKEN"]);
  assert.deepEqual(envKeysFor(rec({ crm: "noCRM.io" })), ["NOCRM_SUBDOMAIN", "NOCRM_API_KEY"]);
  assert.deepEqual(envKeysFor(rec({ crm: "ActiveCampaign" })), ["ACTIVECAMPAIGN_API_URL", "ACTIVECAMPAIGN_API_KEY"]);
  assert.deepEqual(envKeysFor(rec({ crm: "Odoo" })), ["ODOO_BASE_URL", "ODOO_DATABASE", "ODOO_USERNAME", "ODOO_API_KEY"]);
  assert.deepEqual(envKeysFor(rec({ crm: "RepairShopr" })), ["REPAIRSHOPR_SUBDOMAIN", "REPAIRSHOPR_API_TOKEN"]);
});

test("remaining Composio-only connector stays separated from vault and native OAuth", () => {
  const r = rec({ paymentStack: { accounting: "Chaser" }, crm: "AccuLynx" });
  assert.deepEqual(envKeysFor(r), []);
  assert.deepEqual(oauthConnectionsFor(r), []);
  assert.deepEqual(composioConnectionsFor(r), ["Chaser", "AccuLynx"]);
  assert.deepEqual(composioEnvKeysFor(r), ["COMPOSIO_CHASER_CONNECTED_ACCOUNT_ID", "COMPOSIO_ACCULYNX_CONNECTED_ACCOUNT_ID"]);
});

test("Dynamics 365 and ServiceM8 are Composio-managed connected accounts", () => {
  const dynamics = rec({ crm: "Dynamics 365" });
  assert.deepEqual(envKeysFor(dynamics), []);
  assert.deepEqual(oauthConnectionsFor(dynamics), []);
  assert.deepEqual(composioConnectionsFor(dynamics), ["Dynamics 365"]);
  assert.deepEqual(composioEnvKeysFor(dynamics), ["COMPOSIO_DYNAMICS365_CONNECTED_ACCOUNT_ID"]);

  const serviceM8 = rec({ crm: "ServiceM8" });
  assert.deepEqual(envKeysFor(serviceM8), []);
  assert.deepEqual(oauthConnectionsFor(serviceM8), []);
  assert.deepEqual(composioConnectionsFor(serviceM8), ["ServiceM8"]);
  assert.deepEqual(composioEnvKeysFor(serviceM8), ["COMPOSIO_SERVICEM8_CONNECTED_ACCOUNT_ID"]);
});

test("buildHermesPack manifest exposes Composio connections separately", () => {
  const m = buildHermesPack(rec({ paymentStack: { accounting: "Chaser" }, crm: "AccuLynx" })).manifest;
  assert.deepEqual(m.composioConnectionsNeeded, ["Chaser", "AccuLynx"]);
  assert.deepEqual(m.composioEnvKeysNeeded, ["COMPOSIO_CHASER_CONNECTED_ACCOUNT_ID", "COMPOSIO_ACCULYNX_CONNECTED_ACCOUNT_ID"]);
});

test("Bill.com accounting uses the secure vault token path", () => {
  const r = rec({ paymentStack: { accounting: "Bill.com" } });
  assert.deepEqual(envKeysFor(r), ["BILLCOM_API_KEY"]);
  assert.deepEqual(oauthConnectionsFor(r), []);
});

test("PayPal, Square, Braintree, GoCardless, and Bill.com payment platforms use vault keys", () => {
  const keys = envKeysFor(rec({ paymentPlatforms: ["PayPal", "Square", "Braintree", "GoCardless", "Bill.com"] }));
  assert.deepEqual(keys, [
    "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET",
    "SQUARE_ACCESS_TOKEN",
    "BRAINTREE_MERCHANT_ID", "BRAINTREE_PRIVATE_KEY",
    "GOCARDLESS_ACCESS_TOKEN",
    "BILLCOM_API_KEY"
  ]);
});

test("Pipedrive, monday.com, and GoHighLevel are OAuth; Close stays API-key (token-based)", () => {
  assert.deepEqual(envKeysFor(rec({ crm: "Pipedrive" })), []);
  assert.deepEqual(oauthConnectionsFor(rec({ crm: "Pipedrive" })), ["Pipedrive"]);
  assert.deepEqual(envKeysFor(rec({ crm: "monday.com" })), []);
  assert.deepEqual(oauthConnectionsFor(rec({ crm: "monday.com" })), ["monday.com"]);
  assert.deepEqual(envKeysFor(rec({ crm: "GoHighLevel" })), []);
  assert.deepEqual(oauthConnectionsFor(rec({ crm: "GoHighLevel" })), ["GoHighLevel"]);
  assert.deepEqual(envKeysFor(rec({ crm: "Close" })), ["CLOSE_API_KEY"]);
});

test("mixed stack splits cleanly: API keys vs OAuth", () => {
  const r = rec({
    paymentPlatforms: ["Stripe", "Square", "PayPal"],
    crm: "Salesforce",
    outreach: { emailProvider: "SendGrid", smsProvider: "Twilio" },
  });
  const keys = envKeysFor(r);
  // API-key providers present
  assert.ok(keys.includes("STRIPE_API_KEY"));
  assert.ok(keys.includes("SQUARE_ACCESS_TOKEN"));
  assert.ok(keys.includes("PAYPAL_CLIENT_ID") && keys.includes("PAYPAL_CLIENT_SECRET"));
  assert.ok(keys.includes("SENDGRID_API_KEY"));
  assert.ok(keys.includes("TWILIO_ACCOUNT_SID") && keys.includes("TWILIO_AUTH_TOKEN"));
  // OAuth platform NOT in the vault keys
  assert.ok(!keys.some((k) => k.startsWith("SALESFORCE")));
  assert.deepEqual(oauthConnectionsFor(r), ["Salesforce"]);
});

test("NetSuite accounting uses secure vault token credentials, not OAuth", () => {
  const r = rec({ paymentStack: { accounting: "NetSuite" } });
  assert.deepEqual(envKeysFor(r), [
    "NETSUITE_ACCOUNT_ID",
    "NETSUITE_CONSUMER_KEY",
    "NETSUITE_CONSUMER_SECRET",
    "NETSUITE_TOKEN_ID",
    "NETSUITE_TOKEN_SECRET",
    "NETSUITE_RESTLET_URL",
    "NETSUITE_SUITEQL_ENABLED"
  ]);
  assert.deepEqual(oauthConnectionsFor(r), []);
});

test("spreadsheets accounting asks for spreadsheet access details in the vault", () => {
  const r = rec({ paymentStack: { accounting: "Spreadsheets" } });
  assert.deepEqual(envKeysFor(r), ["SPREADSHEET_SOURCE_URL", "SPREADSHEET_ACCESS_INSTRUCTIONS", "SPREADSHEET_REFRESH_CADENCE"]);
  assert.deepEqual(oauthConnectionsFor(r), []);
});

test("custom/own CRM with API access asks for generic custom CRM API details in the vault", () => {
  const r = rec({ crm: "Own crm", crmData: { apiAccess: "Yes" } });
  assert.deepEqual(envKeysFor(r), ["CUSTOM_CRM_API_BASE_URL", "CUSTOM_CRM_API_KEY", "CUSTOM_CRM_API_DOCS_URL"]);
  assert.deepEqual(oauthConnectionsFor(r), []);
});

test("custom/own CRM without API access does not ask for fake API secrets", () => {
  const r = rec({ crm: "Own crm", crmData: { apiAccess: "No" } });
  assert.deepEqual(envKeysFor(r), []);
  assert.deepEqual(oauthConnectionsFor(r), []);
});

test("buildHermesPack manifest exposes API-key, OAuth, and Composio needs separately", () => {
  const r = rec({ paymentPlatforms: ["Stripe"], crm: "HubSpot" });
  const m = buildHermesPack(r).manifest;
  assert.deepEqual(m.envKeysNeeded, ["STRIPE_API_KEY"]);
  assert.deepEqual(m.oauthConnectionsNeeded, ["HubSpot"]);
  assert.deepEqual(m.composioConnectionsNeeded, []);
  assert.deepEqual(m.composioEnvKeysNeeded, []);
});

test("email channel does not imply physical letters/PostGrid", () => {
  assert.equal(usesLetters(rec({ outreach: { channels: ["Email"] } })), false);
  assert.equal(usesLetters(rec({ outreach: { channels: ["Letter"] } })), true);
  assert.deepEqual(envKeysFor(rec({ paymentPlatforms: ["Stripe"], outreach: { channels: ["Email"] } })), ["STRIPE_API_KEY"]);
});

test("no duplicate keys when the same provider implies multiple keys", () => {
  const r = rec({ paymentPlatforms: ["PayPal", "PayPal"] });
  assert.deepEqual(envKeysFor(r), ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]);
});
