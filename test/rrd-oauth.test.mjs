/**
 * Tests for rrd-oauth.mjs — the OAuth provider registry + flow logic for the
 * Hermes CRM connect path. Pure logic + injected-fetch network paths; no live
 * provider. Run: node --test test/rrd-oauth.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  OAUTH_PROVIDERS, providerId, getProvider, redirectUri, envKeysForProvider,
  appCreds, buildAuthorizeUrl, exchangeCode, refreshTokens, tokensToEnv,
} from "../rrd-oauth.mjs";
import { sealEnvelope, openEnvelope, generateRsaKeypair, fillEnvContent } from "../rrd-vault-core.mjs";

// ── provider resolution ──────────────────────────────────────────────────────
test("providerId tolerates display names and casing", () => {
  assert.equal(providerId("HubSpot"), "hubspot");
  assert.equal(providerId("Salesforce"), "salesforce");
  assert.equal(providerId("Zoho CRM"), "zoho");
  assert.equal(providerId("Google Workspace"), "google");
  assert.equal(providerId("Gmail"), "google");
  assert.equal(providerId("Xero"), "xero");
  assert.equal(providerId("Sage"), "sage");
  assert.equal(providerId("Sage Accounting"), "sage");
  assert.equal(providerId("Sage Business Cloud"), "sage");
  assert.equal(providerId("Sage Intacct"), "sage");
  assert.equal(providerId("FreshBooks"), "freshbooks");
  assert.equal(providerId("Wave"), "wave");
  assert.equal(providerId("Wave Invoicing"), "wave");
  assert.equal(providerId("Zoho Books"), "zohobooks");
  assert.equal(providerId("FreeAgent"), "freeagent");
  assert.equal(providerId("QuickBooks Online"), "quickbooks");
  assert.equal(providerId("Intuit"), "quickbooks");
  assert.equal(providerId("Microsoft 365"), "microsoft");
  assert.equal(providerId("Outlook"), "microsoft");
  assert.equal(providerId("Azure AD"), "microsoft");
  assert.equal(providerId("Entra"), "microsoft");
  assert.equal(providerId("Pipedrive"), "pipedrive");
  assert.equal(providerId("monday.com"), "monday");
  assert.equal(providerId("Monday CRM"), "monday");
  assert.equal(providerId("zoho"), "zoho");
  assert.equal(providerId(""), null);
});

test("getProvider throws clearly for non-OAuth providers", () => {
  assert.throws(() => getProvider("Close"), /Unknown OAuth provider/);
});

test("redirectUri appends /oauth-callback and trims trailing slashes", () => {
  assert.equal(redirectUri("https://x.app/"), "https://x.app/oauth-callback");
  assert.equal(redirectUri("https://x.app"), "https://x.app/oauth-callback");
});

test("envKeysForProvider lists the profile .env keys we write", () => {
  assert.deepEqual(envKeysForProvider("hubspot"), ["HUBSPOT_ACCESS_TOKEN", "HUBSPOT_REFRESH_TOKEN", "HUBSPOT_TOKEN_EXPIRES_AT"]);
  assert.ok(envKeysForProvider("salesforce").includes("SALESFORCE_INSTANCE_URL"));
  assert.ok(envKeysForProvider("zoho").includes("ZOHO_API_DOMAIN"));
  assert.deepEqual(envKeysForProvider("google"), ["GOOGLE_ACCESS_TOKEN", "GOOGLE_REFRESH_TOKEN", "GOOGLE_TOKEN_EXPIRES_AT"]);
  assert.deepEqual(envKeysForProvider("xero"), ["XERO_ACCESS_TOKEN", "XERO_REFRESH_TOKEN", "XERO_TOKEN_EXPIRES_AT"]);
  assert.deepEqual(envKeysForProvider("sage"), ["SAGE_ACCESS_TOKEN", "SAGE_REFRESH_TOKEN", "SAGE_TOKEN_EXPIRES_AT"]);
  assert.deepEqual(envKeysForProvider("freshbooks"), ["FRESHBOOKS_ACCESS_TOKEN", "FRESHBOOKS_REFRESH_TOKEN", "FRESHBOOKS_TOKEN_EXPIRES_AT"]);
  assert.deepEqual(envKeysForProvider("wave"), ["WAVE_ACCESS_TOKEN", "WAVE_REFRESH_TOKEN", "WAVE_TOKEN_EXPIRES_AT"]);
  assert.deepEqual(envKeysForProvider("zohobooks"), ["ZOHOBOOKS_ACCESS_TOKEN", "ZOHOBOOKS_REFRESH_TOKEN", "ZOHOBOOKS_TOKEN_EXPIRES_AT", "ZOHOBOOKS_API_DOMAIN"]);
  assert.deepEqual(envKeysForProvider("freeagent"), ["FREEAGENT_ACCESS_TOKEN", "FREEAGENT_REFRESH_TOKEN", "FREEAGENT_TOKEN_EXPIRES_AT"]);
  assert.ok(envKeysForProvider("quickbooks").includes("QUICKBOOKS_REALM_ID"));
  assert.deepEqual(envKeysForProvider("microsoft"), ["MICROSOFT_ACCESS_TOKEN", "MICROSOFT_REFRESH_TOKEN", "MICROSOFT_TOKEN_EXPIRES_AT"]);
  assert.ok(envKeysForProvider("pipedrive").includes("PIPEDRIVE_API_DOMAIN"));
  assert.deepEqual(envKeysForProvider("monday"), ["MONDAY_ACCESS_TOKEN"]);
});

// ── app credentials ──────────────────────────────────────────────────────────
test("appCreds reads provider env vars and throws when missing", () => {
  const env = { HUBSPOT_OAUTH_CLIENT_ID: "cid", HUBSPOT_OAUTH_CLIENT_SECRET: "sec" };
  assert.deepEqual(appCreds("hubspot", env), { clientId: "cid", clientSecret: "sec" });
  assert.throws(() => appCreds("salesforce", env), /Missing Salesforce app credentials/);
});

test("appCreds reads the Google OAuth vars installed on the operator Mac", () => {
  const env = { GOOGLE_OAUTH_CLIENT_ID: "gid", GOOGLE_OAUTH_CLIENT_SECRET: "gsec" };
  assert.deepEqual(appCreds("google", env), { clientId: "gid", clientSecret: "gsec" });
});

// ── authorize URL ────────────────────────────────────────────────────────────
test("buildAuthorizeUrl: HubSpot uses space-separated scopes and core params", () => {
  const u = new URL(buildAuthorizeUrl("hubspot", { clientId: "cid", redirectUri: "https://x.app/oauth-callback", state: "tok" }));
  assert.equal(u.origin + u.pathname, "https://app.hubspot.com/oauth/authorize");
  assert.equal(u.searchParams.get("client_id"), "cid");
  assert.equal(u.searchParams.get("redirect_uri"), "https://x.app/oauth-callback");
  assert.equal(u.searchParams.get("state"), "tok");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("scope"), "oauth crm.objects.contacts.read crm.objects.companies.read crm.objects.deals.read");
});

test("buildAuthorizeUrl: Salesforce forces prompt=consent", () => {
  const u = new URL(buildAuthorizeUrl("salesforce", { clientId: "c", redirectUri: "https://x.app/oauth-callback", state: "s" }));
  assert.equal(u.origin + u.pathname, "https://login.salesforce.com/services/oauth2/authorize");
  assert.equal(u.searchParams.get("prompt"), "consent");
  assert.equal(u.searchParams.get("scope"), "api refresh_token");
});

test("buildAuthorizeUrl: Zoho uses comma scopes + offline access for a refresh token", () => {
  const u = new URL(buildAuthorizeUrl("zoho", { clientId: "c", redirectUri: "https://x.app/oauth-callback", state: "s" }));
  assert.equal(u.origin + u.pathname, "https://accounts.zoho.com/oauth/v2/auth");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("prompt"), "consent");
  assert.equal(u.searchParams.get("scope"), "ZohoCRM.modules.contacts.READ,ZohoCRM.modules.deals.READ,ZohoCRM.users.READ");
});

test("buildAuthorizeUrl: Google requests offline consent and read-only Workspace scopes", () => {
  const u = new URL(buildAuthorizeUrl("google", { clientId: "g", redirectUri: "https://x.app/oauth-callback", state: "s" }));
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("prompt"), "consent");
  assert.equal(u.searchParams.get("include_granted_scopes"), "true");
  assert.ok(u.searchParams.get("scope").includes("https://www.googleapis.com/auth/gmail.readonly"));
  assert.ok(u.searchParams.get("scope").includes("https://www.googleapis.com/auth/drive.metadata.readonly"));
});

test("buildAuthorizeUrl: Xero requests organisation scopes plus offline access", () => {
  const u = new URL(buildAuthorizeUrl("xero", { clientId: "x", redirectUri: "https://x.app/oauth-callback", state: "s" }));
  assert.equal(u.origin + u.pathname, "https://login.xero.com/identity/connect/authorize");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("client_id"), "x");
  assert.equal(u.searchParams.get("redirect_uri"), "https://x.app/oauth-callback");
  const scope = u.searchParams.get("scope");
  assert.ok(scope.includes("offline_access"));
  assert.ok(scope.includes("accounting.invoices.read"));
  assert.ok(scope.includes("accounting.contacts.read"));
  assert.ok(!scope.includes("app.connections"));
  assert.ok(!scope.includes("openid"));
  assert.ok(!scope.includes("accounting.transactions"));
  assert.ok(!scope.includes("accounting.transactions.read"));
});

test("buildAuthorizeUrl: Sage requests Sage Accounting API access with offline refresh", () => {
  const u = new URL(buildAuthorizeUrl("sage", { clientId: "sage-cid", redirectUri: "https://x.app/oauth-callback", state: "sage-state" }));
  assert.equal(u.origin + u.pathname, "https://www.sageone.com/oauth2/auth/central");
  assert.equal(u.searchParams.get("client_id"), "sage-cid");
  assert.equal(u.searchParams.get("redirect_uri"), "https://x.app/oauth-callback");
  assert.equal(u.searchParams.get("state"), "sage-state");
  assert.equal(u.searchParams.get("scope"), "full_access");
  assert.equal(u.searchParams.get("filter"), "apiv3.1");
});

test("buildAuthorizeUrl: FreshBooks requests invoice/client read scopes", () => {
  const u = new URL(buildAuthorizeUrl("freshbooks", { clientId: "fb", redirectUri: "https://x.app/oauth-callback", state: "s" }));
  assert.equal(u.origin + u.pathname, "https://auth.freshbooks.com/oauth/authorize/");
  assert.equal(u.searchParams.get("client_id"), "fb");
  assert.equal(u.searchParams.get("redirect_uri"), "https://x.app/oauth-callback");
  const scope = u.searchParams.get("scope");
  assert.ok(scope.includes("user:profile:read"));
  assert.ok(scope.includes("user:clients:read"));
  assert.ok(scope.includes("user:invoices:read"));
});

test("buildAuthorizeUrl: Wave requests business/customer/invoice read scopes", () => {
  const u = new URL(buildAuthorizeUrl("wave", { clientId: "wv", redirectUri: "https://x.app/oauth-callback", state: "s" }));
  assert.equal(u.origin + u.pathname, "https://api.waveapps.com/oauth2/authorize/");
  const scope = u.searchParams.get("scope");
  assert.ok(scope.includes("business:read"));
  assert.ok(scope.includes("customer:read"));
  assert.ok(scope.includes("invoice:read"));
});

test("buildAuthorizeUrl: Zoho Books requests invoice/contact read scopes and offline access", () => {
  const u = new URL(buildAuthorizeUrl("zohobooks", { clientId: "zb", redirectUri: "https://x.app/oauth-callback", state: "s" }));
  assert.equal(u.origin + u.pathname, "https://accounts.zoho.com/oauth/v2/auth");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("prompt"), "consent");
  assert.equal(u.searchParams.get("scope"), "ZohoBooks.invoices.READ,ZohoBooks.contacts.READ,ZohoBooks.settings.READ");
});

test("buildAuthorizeUrl: FreeAgent uses approve_app without broad scopes", () => {
  const u = new URL(buildAuthorizeUrl("freeagent", { clientId: "fa", redirectUri: "https://x.app/oauth-callback", state: "s" }));
  assert.equal(u.origin + u.pathname, "https://api.freeagent.com/v2/approve_app");
  assert.equal(u.searchParams.get("client_id"), "fa");
  assert.equal(u.searchParams.get("redirect_uri"), "https://x.app/oauth-callback");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("scope"), null);
});

test("buildAuthorizeUrl: QuickBooks requests Intuit accounting scope", () => {
  const u = new URL(buildAuthorizeUrl("quickbooks", { clientId: "q", redirectUri: "https://x.app/oauth-callback", state: "s" }));
  assert.equal(u.origin + u.pathname, "https://appcenter.intuit.com/connect/oauth2");
  assert.equal(u.searchParams.get("scope"), "com.intuit.quickbooks.accounting");
  assert.equal(u.searchParams.get("response_type"), "code");
});

test("buildAuthorizeUrl: Microsoft requests Graph read scopes and offline consent", () => {
  const u = new URL(buildAuthorizeUrl("microsoft", { clientId: "ms", redirectUri: "https://x.app/oauth-callback", state: "s" }));
  assert.equal(u.origin + u.pathname, "https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("client_id"), "ms");
  assert.equal(u.searchParams.get("redirect_uri"), "https://x.app/oauth-callback");
  assert.equal(u.searchParams.get("prompt"), "consent");
  const scope = u.searchParams.get("scope");
  assert.ok(scope.includes("offline_access"));
  assert.ok(scope.includes("User.Read"));
  assert.ok(scope.includes("Mail.Read"));
  assert.ok(scope.includes("Files.Read"));
  assert.ok(!scope.includes("Mail.ReadWrite"));
  assert.ok(!scope.includes("Files.ReadWrite"));
});

test("buildAuthorizeUrl: Pipedrive omits scope because app settings control permissions", () => {
  const u = new URL(buildAuthorizeUrl("pipedrive", { clientId: "p", redirectUri: "https://x.app/oauth-callback", state: "s" }));
  assert.equal(u.origin + u.pathname, "https://oauth.pipedrive.com/oauth/authorize");
  assert.equal(u.searchParams.get("scope"), null);
});

test("buildAuthorizeUrl: monday.com requests read-only recovery scopes", () => {
  const u = new URL(buildAuthorizeUrl("monday", { clientId: "m", redirectUri: "https://x.app/oauth-callback", state: "s" }));
  assert.equal(u.origin + u.pathname, "https://auth.monday.com/oauth2/authorize");
  assert.equal(u.searchParams.get("client_id"), "m");
  assert.equal(u.searchParams.get("redirect_uri"), "https://x.app/oauth-callback");
  assert.equal(u.searchParams.get("state"), "s");
  const scope = u.searchParams.get("scope");
  assert.ok(scope.includes("me:read"));
  assert.ok(scope.includes("boards:read"));
  assert.ok(scope.includes("users:read"));
  assert.ok(scope.includes("updates:read"));
  assert.ok(!scope.includes("boards:write"));
  assert.ok(!scope.includes("updates:write"));
});

// ── token exchange (injected fetch) ──────────────────────────────────────────
function fakeFetch(captured, response) {
  return async (url, init) => {
    captured.url = url;
    captured.body = init.body;
    captured.method = init.method;
    return { ok: response.ok !== false, status: response.status || 200, text: async () => JSON.stringify(response.body) };
  };
}

test("exchangeCode posts a form-encoded authorization_code grant", async () => {
  const cap = {};
  const tok = await exchangeCode("hubspot",
    { code: "abc", redirectUri: "https://x.app/oauth-callback", clientId: "cid", clientSecret: "sec" },
    fakeFetch(cap, { body: { access_token: "AT", refresh_token: "RT", expires_in: 1800 } }));
  assert.equal(cap.url, "https://api.hubapi.com/oauth/v1/token");
  assert.equal(cap.method, "POST");
  const form = new URLSearchParams(cap.body);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("code"), "abc");
  assert.equal(form.get("client_secret"), "sec");
  assert.equal(form.get("redirect_uri"), "https://x.app/oauth-callback");
  assert.equal(tok.access_token, "AT");
});

test("exchangeCode for Zoho targets the region accounts server when provided", async () => {
  const cap = {};
  await exchangeCode("zoho",
    { code: "abc", redirectUri: "https://x.app/oauth-callback", clientId: "c", clientSecret: "s", extra: { accountsServer: "https://accounts.zoho.eu" } },
    fakeFetch(cap, { body: { access_token: "AT" } }));
  assert.equal(cap.url, "https://accounts.zoho.eu/oauth/v2/token");
});

test("exchangeCode for Google targets Google's token endpoint", async () => {
  const cap = {};
  await exchangeCode("google",
    { code: "abc", redirectUri: "https://x.app/oauth-callback", clientId: "g", clientSecret: "s" },
    fakeFetch(cap, { body: { access_token: "AT", refresh_token: "RT", expires_in: 3600 } }));
  assert.equal(cap.url, "https://oauth2.googleapis.com/token");
});

test("exchangeCode for Xero targets Xero identity token endpoint", async () => {
  const cap = {};
  await exchangeCode("xero",
    { code: "abc", redirectUri: "https://x.app/oauth-callback", clientId: "x", clientSecret: "s" },
    fakeFetch(cap, { body: { access_token: "AT", refresh_token: "RT", expires_in: 1800 } }));
  assert.equal(cap.url, "https://identity.xero.com/connect/token");
});

test("exchangeCode for Sage targets Sage Accounting token endpoint", async () => {
  const cap = {};
  await exchangeCode("sage",
    { code: "abc", redirectUri: "https://x.app/oauth-callback", clientId: "sage", clientSecret: "s" },
    fakeFetch(cap, { body: { access_token: "AT", refresh_token: "RT", expires_in: 1800 } }));
  assert.equal(cap.url, "https://oauth.accounting.sage.com/token");
});

test("exchangeCode for FreshBooks targets FreshBooks token endpoint with JSON body", async () => {
  const cap = {};
  await exchangeCode("freshbooks",
    { code: "abc", redirectUri: "https://x.app/oauth-callback", clientId: "fb", clientSecret: "s" },
    async (url, init) => {
      cap.url = url;
      cap.headers = init.headers;
      cap.body = init.body;
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "AT", refresh_token: "RT", expires_in: 1800 }) };
    });
  assert.equal(cap.url, "https://api.freshbooks.com/auth/oauth/token");
  assert.match(cap.headers["Content-Type"], /application\/json/);
  assert.equal(JSON.parse(cap.body).grant_type, "authorization_code");
});

test("exchangeCode for Wave targets Wave token endpoint", async () => {
  const cap = {};
  await exchangeCode("wave",
    { code: "abc", redirectUri: "https://x.app/oauth-callback", clientId: "wv", clientSecret: "s" },
    fakeFetch(cap, { body: { access_token: "AT", refresh_token: "RT", expires_in: 1800 } }));
  assert.equal(cap.url, "https://api.waveapps.com/oauth2/token/");
});

test("exchangeCode for Zoho Books targets the region accounts server when provided", async () => {
  const cap = {};
  await exchangeCode("zohobooks",
    { code: "abc", redirectUri: "https://x.app/oauth-callback", clientId: "zb", clientSecret: "s", extra: { accountsServer: "https://accounts.zoho.eu" } },
    fakeFetch(cap, { body: { access_token: "AT", refresh_token: "RT", expires_in: 1800, api_domain: "https://www.zohoapis.eu" } }));
  assert.equal(cap.url, "https://accounts.zoho.eu/oauth/v2/token");
});

test("exchangeCode for FreeAgent uses token endpoint with encoded Basic auth", async () => {
  const cap = {};
  await exchangeCode("freeagent",
    { code: "abc", redirectUri: "https://x.app/oauth-callback", clientId: "fa id", clientSecret: "s:e/c" },
    async (url, init) => {
      cap.url = url;
      cap.headers = init.headers;
      cap.body = init.body;
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "AT", refresh_token: "RT", expires_in: 3600 }) };
    });
  assert.equal(cap.url, "https://api.freeagent.com/v2/token_endpoint");
  const expected = Buffer.from(`${encodeURIComponent("fa id")}:${encodeURIComponent("s:e/c")}`).toString("base64");
  assert.equal(cap.headers.Authorization, `Basic ${expected}`);
  const form = new URLSearchParams(cap.body);
  assert.equal(form.get("client_id"), null);
  assert.equal(form.get("client_secret"), null);
});

test("exchangeCode for QuickBooks uses Intuit token endpoint with Basic auth", async () => {
  const cap = {};
  await exchangeCode("quickbooks",
    { code: "abc", redirectUri: "https://x.app/oauth-callback", clientId: "q", clientSecret: "s" },
    async (url, init) => {
      cap.url = url;
      cap.headers = init.headers;
      cap.body = init.body;
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "AT", refresh_token: "RT", expires_in: 3600 }) };
    });
  assert.equal(cap.url, "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
  assert.match(cap.headers.Authorization, /^Basic /);
  const form = new URLSearchParams(cap.body);
  assert.equal(form.get("client_id"), null);
  assert.equal(form.get("client_secret"), null);
});

test("exchangeCode for Microsoft targets the common tenant v2 token endpoint", async () => {
  const cap = {};
  await exchangeCode("microsoft",
    { code: "abc", redirectUri: "https://x.app/oauth-callback", clientId: "ms", clientSecret: "s" },
    fakeFetch(cap, { body: { access_token: "AT", refresh_token: "RT", expires_in: 3600 } }));
  assert.equal(cap.url, "https://login.microsoftonline.com/common/oauth2/v2.0/token");
});

test("exchangeCode for Pipedrive targets Pipedrive token endpoint", async () => {
  const cap = {};
  await exchangeCode("pipedrive",
    { code: "abc", redirectUri: "https://x.app/oauth-callback", clientId: "p", clientSecret: "s" },
    fakeFetch(cap, { body: { access_token: "AT", refresh_token: "RT", expires_in: 3600, api_domain: "https://example.pipedrive.com" } }));
  assert.equal(cap.url, "https://oauth.pipedrive.com/oauth/token");
});

test("exchangeCode for monday.com targets monday OAuth token endpoint", async () => {
  const cap = {};
  await exchangeCode("monday",
    { code: "abc", redirectUri: "https://x.app/oauth-callback", clientId: "m", clientSecret: "s" },
    fakeFetch(cap, { body: { access_token: "AT", token_type: "Bearer", scope: "boards:read users:read" } }));
  assert.equal(cap.url, "https://auth.monday.com/oauth2/token");
});

test("exchangeCode defaults Zoho to the global DC when no region is given", async () => {
  const cap = {};
  await exchangeCode("zoho",
    { code: "abc", redirectUri: "https://x.app/oauth-callback", clientId: "c", clientSecret: "s" },
    fakeFetch(cap, { body: { access_token: "AT" } }));
  assert.equal(cap.url, "https://accounts.zoho.com/oauth/v2/token");
});

test("exchangeCode surfaces a provider error body", async () => {
  const cap = {};
  await assert.rejects(
    () => exchangeCode("hubspot",
      { code: "bad", redirectUri: "r", clientId: "c", clientSecret: "s" },
      fakeFetch(cap, { ok: false, status: 400, body: { error: "invalid_grant", error_description: "expired" } })),
    /expired/);
});

test("refreshTokens posts a refresh_token grant", async () => {
  const cap = {};
  const tok = await refreshTokens("salesforce",
    { refreshToken: "RT", clientId: "c", clientSecret: "s" },
    fakeFetch(cap, { body: { access_token: "AT2", instance_url: "https://na1.salesforce.com" } }));
  const form = new URLSearchParams(cap.body);
  assert.equal(form.get("grant_type"), "refresh_token");
  assert.equal(form.get("refresh_token"), "RT");
  assert.equal(tok.access_token, "AT2");
});

test("refreshTokens for Zoho Books converts stored api_domain back to accounts host", async () => {
  const cap = {};
  await refreshTokens("zohobooks",
    { refreshToken: "RT", clientId: "zb", clientSecret: "s", extra: { apiDomain: "https://www.zohoapis.eu" } },
    fakeFetch(cap, { body: { access_token: "AT2" } }));
  assert.equal(cap.url, "https://accounts.zoho.eu/oauth/v2/token");
});

// ── token normalization ──────────────────────────────────────────────────────
test("tokensToEnv maps fields and computes an absolute expiry", () => {
  const env = tokensToEnv("hubspot", { access_token: "AT", refresh_token: "RT", expires_in: 1800 }, 1_000_000);
  assert.equal(env.HUBSPOT_ACCESS_TOKEN, "AT");
  assert.equal(env.HUBSPOT_REFRESH_TOKEN, "RT");
  assert.equal(env.HUBSPOT_TOKEN_EXPIRES_AT, new Date(1_000_000 + 1800 * 1000).toISOString());
});

test("tokensToEnv maps Google access, refresh, and expiry keys", () => {
  const env = tokensToEnv("google", { access_token: "AT", refresh_token: "RT", expires_in: 3600 }, 1_000_000);
  assert.equal(env.GOOGLE_ACCESS_TOKEN, "AT");
  assert.equal(env.GOOGLE_REFRESH_TOKEN, "RT");
  assert.equal(env.GOOGLE_TOKEN_EXPIRES_AT, new Date(1_000_000 + 3600 * 1000).toISOString());
});

test("tokensToEnv maps Xero access, refresh, and expiry keys", () => {
  const env = tokensToEnv("xero", { access_token: "AT", refresh_token: "RT", expires_in: 1800 }, 1_000_000);
  assert.equal(env.XERO_ACCESS_TOKEN, "AT");
  assert.equal(env.XERO_REFRESH_TOKEN, "RT");
  assert.equal(env.XERO_TOKEN_EXPIRES_AT, new Date(1_000_000 + 1800 * 1000).toISOString());
});

test("tokensToEnv maps Sage access, refresh, and expiry keys", () => {
  const env = tokensToEnv("sage", { access_token: "AT", refresh_token: "RT", expires_in: 1800 }, 1_000_000);
  assert.equal(env.SAGE_ACCESS_TOKEN, "AT");
  assert.equal(env.SAGE_REFRESH_TOKEN, "RT");
  assert.equal(env.SAGE_TOKEN_EXPIRES_AT, new Date(1_000_000 + 1800 * 1000).toISOString());
});

test("tokensToEnv maps FreshBooks and Wave access, refresh, and expiry keys", () => {
  const fb = tokensToEnv("freshbooks", { access_token: "AT", refresh_token: "RT", expires_in: 1800 }, 1_000_000);
  assert.equal(fb.FRESHBOOKS_ACCESS_TOKEN, "AT");
  assert.equal(fb.FRESHBOOKS_REFRESH_TOKEN, "RT");
  assert.equal(fb.FRESHBOOKS_TOKEN_EXPIRES_AT, new Date(1_000_000 + 1800 * 1000).toISOString());
  const wave = tokensToEnv("wave", { access_token: "WAT", refresh_token: "WRT", expires_in: 3600 }, 1_000_000);
  assert.equal(wave.WAVE_ACCESS_TOKEN, "WAT");
  assert.equal(wave.WAVE_REFRESH_TOKEN, "WRT");
  assert.equal(wave.WAVE_TOKEN_EXPIRES_AT, new Date(1_000_000 + 3600 * 1000).toISOString());
});

test("tokensToEnv maps Zoho Books and FreeAgent access, refresh, expiry, and API domain", () => {
  const zb = tokensToEnv("zohobooks", { access_token: "AT", refresh_token: "RT", expires_in: 1800, api_domain: "https://www.zohoapis.eu" }, 1_000_000);
  assert.equal(zb.ZOHOBOOKS_ACCESS_TOKEN, "AT");
  assert.equal(zb.ZOHOBOOKS_REFRESH_TOKEN, "RT");
  assert.equal(zb.ZOHOBOOKS_TOKEN_EXPIRES_AT, new Date(1_000_000 + 1800 * 1000).toISOString());
  assert.equal(zb.ZOHOBOOKS_API_DOMAIN, "https://www.zohoapis.eu");
  const fa = tokensToEnv("freeagent", { access_token: "FAT", refresh_token: "FRT", expires_in: 3600 }, 1_000_000);
  assert.equal(fa.FREEAGENT_ACCESS_TOKEN, "FAT");
  assert.equal(fa.FREEAGENT_REFRESH_TOKEN, "FRT");
  assert.equal(fa.FREEAGENT_TOKEN_EXPIRES_AT, new Date(1_000_000 + 3600 * 1000).toISOString());
});

test("tokensToEnv maps QuickBooks realm id from callback payload", () => {
  const env = tokensToEnv("quickbooks", { access_token: "AT", refresh_token: "RT", expires_in: 3600 }, 1_000_000, { realmId: "12345" });
  assert.equal(env.QUICKBOOKS_ACCESS_TOKEN, "AT");
  assert.equal(env.QUICKBOOKS_REFRESH_TOKEN, "RT");
  assert.equal(env.QUICKBOOKS_REALM_ID, "12345");
});

test("tokensToEnv maps Microsoft access, refresh, and expiry keys", () => {
  const env = tokensToEnv("microsoft", { access_token: "AT", refresh_token: "RT", expires_in: 3600 }, 1_000_000);
  assert.equal(env.MICROSOFT_ACCESS_TOKEN, "AT");
  assert.equal(env.MICROSOFT_REFRESH_TOKEN, "RT");
  assert.equal(env.MICROSOFT_TOKEN_EXPIRES_AT, new Date(1_000_000 + 3600 * 1000).toISOString());
});

test("tokensToEnv keeps Salesforce instance_url and Zoho api_domain", () => {
  assert.equal(tokensToEnv("salesforce", { access_token: "AT", instance_url: "https://na1.salesforce.com" }).SALESFORCE_INSTANCE_URL, "https://na1.salesforce.com");
  assert.equal(tokensToEnv("zoho", { access_token: "AT", api_domain: "https://www.zohoapis.eu" }).ZOHO_API_DOMAIN, "https://www.zohoapis.eu");
});

test("tokensToEnv omits a refresh token when the response has none (refresh path)", () => {
  const env = tokensToEnv("salesforce", { access_token: "AT2" });
  assert.equal(env.SALESFORCE_ACCESS_TOKEN, "AT2");
  assert.ok(!("SALESFORCE_REFRESH_TOKEN" in env));
});

// ── end-to-end: the sealed-code envelope the callback deposits round-trips ────
test("OAuth code payload seals and opens through the vault envelope (claim decrypt step)", () => {
  const kp = generateRsaKeypair();
  const payload = JSON.stringify({ code: "the-auth-code", provider: "hubspot", redirect_uri: "https://x.app/oauth-callback", accountsServer: null });
  const env = sealEnvelope(kp.publicKeyPem, payload);
  assert.deepEqual(JSON.parse(openEnvelope(kp.privateKeyPem, env)), JSON.parse(payload));
});

// ── env writer: OAuth tokens overwrite stale values; API keys never do ────────
test("fillEnvContent overwrites only the whitelisted OAuth keys, never others", () => {
  const seed = "HUBSPOT_ACCESS_TOKEN=old\nSTRIPE_API_KEY=real_live_key\n";
  const r = fillEnvContent(seed, { HUBSPOT_ACCESS_TOKEN: "new", STRIPE_API_KEY: "attacker" }, ["HUBSPOT_ACCESS_TOKEN"]);
  assert.ok(r.replaced.includes("HUBSPOT_ACCESS_TOKEN"));
  assert.ok(r.skipped.includes("STRIPE_API_KEY"));
  assert.match(r.content, /HUBSPOT_ACCESS_TOKEN=new/);
  assert.match(r.content, /STRIPE_API_KEY=real_live_key/);
});
