/**
 * rrd-oauth.mjs — dependency-free OAuth provider registry + flow logic for the
 * Hermes OAuth connect path (HubSpot, Salesforce, Zoho CRM, Google Workspace).
 *
 * WHY THIS EXISTS — and how it keeps the vault's zero-knowledge promise.
 * OAuth-based CRMs are never asked to paste a static key. Instead the client
 * authorizes our app and the provider hands back a short-lived authorization
 * `code`. The code→token exchange needs our app's CLIENT SECRET, so it must run
 * where that secret lives: ONLY on this Mac. The flow therefore mirrors the
 * secrets vault exactly —
 *   1. operator mints a one-time connect link (an 'oauth' vault drop);
 *   2. the client authorizes; the provider redirects to our static callback page
 *      with the `code`; the page seals { code, ... } against the drop's RSA
 *      public key (vault-crypto.js) and deposits the envelope — the plaintext
 *      code never reaches our server or DB readable;
 *   3. this Mac claims the drop, decrypts the code locally, exchanges it for
 *      access + refresh tokens against the provider, and writes those tokens
 *      into the client's Hermes profile .env. Our client_secret and the tokens
 *      never leave this machine.
 *
 * This module is PURE provider knowledge + small fetch wrappers. No Supabase, no
 * filesystem. `fetch` is injectable (the last arg) so the network paths unit-test
 * without a live provider. Mirrors the style of rrd-hermes.mjs / rrd-vault-core.mjs.
 */

// ── provider registry — single source of truth for OAuth provider knowledge ──
// scopes are READ-ONLY least privilege for a collections/recovery agent: read
// the customer's contact and what they owe (deals/invoices). No write scopes.
export const OAUTH_PROVIDERS = {
  google: {
    name: "Google Workspace",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
    ],
    scopeSep: " ",
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    // Google only returns a refresh token when offline consent is requested.
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    envKeys: { access: "GOOGLE_ACCESS_TOKEN", refresh: "GOOGLE_REFRESH_TOKEN", expires: "GOOGLE_TOKEN_EXPIRES_AT" },
  },
  xero: {
    name: "Xero",
    authorizeUrl: "https://login.xero.com/identity/connect/authorize",
    tokenUrl: "https://identity.xero.com/connect/token",
    scopes: ["offline_access", "accounting.invoices.read", "accounting.contacts.read"],
    scopeSep: " ",
    clientIdEnv: "XERO_OAUTH_CLIENT_ID",
    clientSecretEnv: "XERO_OAUTH_CLIENT_SECRET",
    // Xero issues a refresh token when offline_access is included in scopes.
    extraAuthParams: {},
    envKeys: { access: "XERO_ACCESS_TOKEN", refresh: "XERO_REFRESH_TOKEN", expires: "XERO_TOKEN_EXPIRES_AT" },
  },
  sage: {
    name: "Sage",
    // Sage Accounting OAuth. The screenshot the operator sent shows Sage's
    // developer console API picker (including Sage Intacct); keep this provider
    // generic at the RRD layer and use field mapping to confirm the exact Sage
    // product/API before operational recovery.
    authorizeUrl: "https://www.sageone.com/oauth2/auth/central",
    tokenUrl: "https://oauth.accounting.sage.com/token",
    // Sage Accounting exposes broad API access rather than granular read-only
    // scopes; keep recovery behavior read-only through RRD policy/guardrails.
    scopes: ["full_access"],
    scopeSep: " ",
    clientIdEnv: "SAGE_OAUTH_CLIENT_ID",
    clientSecretEnv: "SAGE_OAUTH_CLIENT_SECRET",
    extraAuthParams: { filter: "apiv3.1" },
    envKeys: { access: "SAGE_ACCESS_TOKEN", refresh: "SAGE_REFRESH_TOKEN", expires: "SAGE_TOKEN_EXPIRES_AT" },
  },
  freshbooks: {
    name: "FreshBooks",
    authorizeUrl: "https://auth.freshbooks.com/oauth/authorize/",
    tokenUrl: "https://api.freshbooks.com/auth/oauth/token",
    scopes: ["user:profile:read", "user:clients:read", "user:invoices:read"],
    scopeSep: " ",
    clientIdEnv: "FRESHBOOKS_OAUTH_CLIENT_ID",
    clientSecretEnv: "FRESHBOOKS_OAUTH_CLIENT_SECRET",
    extraAuthParams: {},
    tokenBody: "json",
    envKeys: { access: "FRESHBOOKS_ACCESS_TOKEN", refresh: "FRESHBOOKS_REFRESH_TOKEN", expires: "FRESHBOOKS_TOKEN_EXPIRES_AT" },
  },
  wave: {
    name: "Wave",
    authorizeUrl: "https://api.waveapps.com/oauth2/authorize/",
    tokenUrl: "https://api.waveapps.com/oauth2/token/",
    scopes: ["business:read", "customer:read", "invoice:read"],
    scopeSep: " ",
    clientIdEnv: "WAVE_OAUTH_CLIENT_ID",
    clientSecretEnv: "WAVE_OAUTH_CLIENT_SECRET",
    extraAuthParams: {},
    envKeys: { access: "WAVE_ACCESS_TOKEN", refresh: "WAVE_REFRESH_TOKEN", expires: "WAVE_TOKEN_EXPIRES_AT" },
  },
  zohobooks: {
    name: "Zoho Books",
    authorizeUrl: "https://accounts.zoho.com/oauth/v2/auth",
    tokenUrl: "https://accounts.zoho.com/oauth/v2/token",
    scopes: ["ZohoBooks.invoices.READ", "ZohoBooks.contacts.READ", "ZohoBooks.settings.READ"],
    scopeSep: ",",
    clientIdEnv: "ZOHOBOOKS_OAUTH_CLIENT_ID",
    clientSecretEnv: "ZOHOBOOKS_OAUTH_CLIENT_SECRET",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    envKeys: { access: "ZOHOBOOKS_ACCESS_TOKEN", refresh: "ZOHOBOOKS_REFRESH_TOKEN", expires: "ZOHOBOOKS_TOKEN_EXPIRES_AT", apiDomain: "ZOHOBOOKS_API_DOMAIN" },
  },
  freeagent: {
    name: "FreeAgent",
    authorizeUrl: "https://api.freeagent.com/v2/approve_app",
    tokenUrl: "https://api.freeagent.com/v2/token_endpoint",
    scopes: [],
    scopeSep: " ",
    clientIdEnv: "FREEAGENT_OAUTH_CLIENT_ID",
    clientSecretEnv: "FREEAGENT_OAUTH_CLIENT_SECRET",
    extraAuthParams: {},
    tokenAuth: "basic",
    envKeys: { access: "FREEAGENT_ACCESS_TOKEN", refresh: "FREEAGENT_REFRESH_TOKEN", expires: "FREEAGENT_TOKEN_EXPIRES_AT" },
  },
  quickbooks: {
    name: "QuickBooks Online",
    authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    // Intuit exposes QuickBooks Accounting as a product-level OAuth scope rather
    // than granular read-only scopes. Keep the agent read-only at our recovery
    // layer until write actions are explicitly needed and approved.
    scopes: ["com.intuit.quickbooks.accounting"],
    scopeSep: " ",
    clientIdEnv: "INTUIT_OAUTH_CLIENT_ID",
    clientSecretEnv: "INTUIT_OAUTH_CLIENT_SECRET",
    extraAuthParams: {},
    tokenAuth: "basic",
    envKeys: { access: "QUICKBOOKS_ACCESS_TOKEN", refresh: "QUICKBOOKS_REFRESH_TOKEN", expires: "QUICKBOOKS_TOKEN_EXPIRES_AT", realmId: "QUICKBOOKS_REALM_ID" },
  },
  microsoft: {
    name: "Microsoft 365 / Outlook",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    // Microsoft Graph delegated read scopes for Outlook/OneDrive discovery.
    // `offline_access` is required for a refresh token.
    scopes: ["offline_access", "User.Read", "Mail.Read", "Files.Read"],
    scopeSep: " ",
    clientIdEnv: "MICROSOFT_OAUTH_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_OAUTH_CLIENT_SECRET",
    extraAuthParams: { prompt: "consent" },
    envKeys: { access: "MICROSOFT_ACCESS_TOKEN", refresh: "MICROSOFT_REFRESH_TOKEN", expires: "MICROSOFT_TOKEN_EXPIRES_AT" },
  },
  hubspot: {
    name: "HubSpot",
    authorizeUrl: "https://app.hubspot.com/oauth/authorize",
    // HubSpot resolves the token host itself; this is the documented endpoint.
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    scopes: ["oauth", "crm.objects.contacts.read", "crm.objects.companies.read", "crm.objects.deals.read"],
    scopeSep: " ",
    clientIdEnv: "HUBSPOT_OAUTH_CLIENT_ID",
    clientSecretEnv: "HUBSPOT_OAUTH_CLIENT_SECRET",
    // HubSpot always issues a refresh token; no offline flag needed.
    extraAuthParams: {},
    envKeys: { access: "HUBSPOT_ACCESS_TOKEN", refresh: "HUBSPOT_REFRESH_TOKEN", expires: "HUBSPOT_TOKEN_EXPIRES_AT" },
  },
  salesforce: {
    name: "Salesforce",
    authorizeUrl: "https://login.salesforce.com/services/oauth2/authorize",
    tokenUrl: "https://login.salesforce.com/services/oauth2/token",
    // Salesforce object access is governed by the user's profile; `api` grants
    // API access, `refresh_token` enables offline refresh.
    scopes: ["api", "refresh_token"],
    scopeSep: " ",
    clientIdEnv: "SALESFORCE_OAUTH_CLIENT_ID",
    clientSecretEnv: "SALESFORCE_OAUTH_CLIENT_SECRET",
    // prompt=consent forces a refresh token even on re-auth.
    extraAuthParams: { prompt: "consent" },
    // Salesforce returns the org-specific REST host as instance_url — store it.
    envKeys: { access: "SALESFORCE_ACCESS_TOKEN", refresh: "SALESFORCE_REFRESH_TOKEN", instanceUrl: "SALESFORCE_INSTANCE_URL" },
  },
  zoho: {
    name: "Zoho CRM",
    authorizeUrl: "https://accounts.zoho.com/oauth/v2/auth",
    tokenUrl: "https://accounts.zoho.com/oauth/v2/token",
    scopes: ["ZohoCRM.modules.contacts.READ", "ZohoCRM.modules.deals.READ", "ZohoCRM.users.READ"],
    scopeSep: ",",
    clientIdEnv: "ZOHO_OAUTH_CLIENT_ID",
    clientSecretEnv: "ZOHO_OAUTH_CLIENT_SECRET",
    // access_type=offline + prompt=consent are REQUIRED for a Zoho refresh token.
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    // Zoho returns the data-center REST host as api_domain — store it.
    envKeys: { access: "ZOHO_ACCESS_TOKEN", refresh: "ZOHO_REFRESH_TOKEN", apiDomain: "ZOHO_API_DOMAIN", expires: "ZOHO_TOKEN_EXPIRES_AT" },
  },
  pipedrive: {
    name: "Pipedrive",
    authorizeUrl: "https://oauth.pipedrive.com/oauth/authorize",
    tokenUrl: "https://oauth.pipedrive.com/oauth/token",
    // Pipedrive scopes are selected in the app settings UI; keep the authorize
    // URL scope-less so the app's configured read-only permissions apply.
    scopes: [],
    scopeSep: " ",
    clientIdEnv: "PIPEDRIVE_OAUTH_CLIENT_ID",
    clientSecretEnv: "PIPEDRIVE_OAUTH_CLIENT_SECRET",
    extraAuthParams: {},
    envKeys: { access: "PIPEDRIVE_ACCESS_TOKEN", refresh: "PIPEDRIVE_REFRESH_TOKEN", expires: "PIPEDRIVE_TOKEN_EXPIRES_AT", apiDomain: "PIPEDRIVE_API_DOMAIN" },
  },
  monday: {
    name: "monday.com",
    authorizeUrl: "https://auth.monday.com/oauth2/authorize",
    tokenUrl: "https://auth.monday.com/oauth2/token",
    // monday OAuth tokens do not expire and monday does not issue refresh
    // tokens. Keep requested permissions read-only for recovery discovery.
    scopes: ["me:read", "account:read", "workspaces:read", "boards:read", "users:read", "updates:read"],
    scopeSep: " ",
    clientIdEnv: "MONDAY_OAUTH_CLIENT_ID",
    clientSecretEnv: "MONDAY_OAUTH_CLIENT_SECRET",
    extraAuthParams: {},
    envKeys: { access: "MONDAY_ACCESS_TOKEN" },
  },
  gohighlevel: {
    name: "GoHighLevel",
    // chooselocation lets the user pick the sub-account, yielding a Location token.
    authorizeUrl: "https://marketplace.gohighlevel.com/oauth/chooselocation",
    tokenUrl: "https://services.leadconnectorhq.com/oauth/token",
    // Read-only least privilege for recovery: who to contact + what they owe + what's paid.
    scopes: ["contacts.readonly", "opportunities.readonly", "invoices.readonly", "payments/transactions.readonly", "locations.readonly"],
    scopeSep: " ",
    clientIdEnv: "GOHIGHLEVEL_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOHIGHLEVEL_OAUTH_CLIENT_SECRET",
    extraAuthParams: {},
    // HighLevel REQUIRES user_type at token exchange; "Location" scopes the token
    // to one sub-account. Applied at both code-exchange and refresh.
    extraTokenParams: { user_type: "Location" },
    // HighLevel issues refresh tokens and returns locationId in the token response.
    envKeys: { access: "GOHIGHLEVEL_ACCESS_TOKEN", refresh: "GOHIGHLEVEL_REFRESH_TOKEN", expires: "GOHIGHLEVEL_TOKEN_EXPIRES_AT", locationId: "GOHIGHLEVEL_LOCATION_ID" },
  },
};

// Map a CRM display name (as captured at onboarding / in INTEGRATIONS) to a
// provider id. Tolerant of spacing/case ("Zoho CRM" → "zoho").
const NAME_TO_ID = {
  "google": "google",
  "google workspace": "google",
  "gmail": "google",
  "xero": "xero",
  "sage": "sage",
  "sage accounting": "sage",
  "sage business cloud": "sage",
  "sage intacct": "sage",
  "freshbooks": "freshbooks",
  "fresh books": "freshbooks",
  "wave": "wave",
  "wave invoicing": "wave",
  "wave accounting": "wave",
  "zohobooks": "zohobooks",
  "zoho books": "zohobooks",
  "freeagent": "freeagent",
  "free agent": "freeagent",
  "quickbooks": "quickbooks",
  "quickbooks online": "quickbooks",
  "intuit": "quickbooks",
  "microsoft": "microsoft",
  "microsoft 365": "microsoft",
  "office 365": "microsoft",
  "outlook": "microsoft",
  "azure": "microsoft",
  "azure ad": "microsoft",
  "entra": "microsoft",
  "microsoft entra": "microsoft",
  "hubspot": "hubspot",
  "salesforce": "salesforce",
  "zoho": "zoho",
  "zoho crm": "zoho",
  "pipedrive": "pipedrive",
  "monday": "monday",
  "monday.com": "monday",
  "monday crm": "monday",
  "gohighlevel": "gohighlevel",
  "go high level": "gohighlevel",
  "highlevel": "gohighlevel",
  "high level": "gohighlevel",
  "ghl": "gohighlevel",
  "leadconnector": "gohighlevel",
};
export function providerId(nameOrId) {
  const k = String(nameOrId || "").trim().toLowerCase();
  if (OAUTH_PROVIDERS[k]) return k;
  return NAME_TO_ID[k] || null;
}
export function getProvider(nameOrId) {
  const id = providerId(nameOrId);
  if (!id) throw new Error(`Unknown OAuth provider: ${nameOrId}. Known: ${Object.keys(OAUTH_PROVIDERS).join(", ")}.`);
  return { id, ...OAUTH_PROVIDERS[id] };
}

// The redirect URI the provider sends the client back to. MUST be registered
// verbatim in each provider's developer app. cleanUrls serves oauth-callback.html here.
export function redirectUri(base) {
  return String(base).replace(/\/+$/, "") + "/oauth-callback";
}

// The env var names this provider writes into the client's profile .env.
export function envKeysForProvider(nameOrId) {
  return Object.values(getProvider(nameOrId).envKeys);
}

// Our app's client id/secret for a provider, read from the operator environment.
// These are OUR developer-app credentials, not the client's — they live only on
// this Mac (~/.openclaw/.env / .env.local). Throws a clear, actionable error if missing.
export function appCreds(nameOrId, env = process.env) {
  const p = getProvider(nameOrId);
  const clientId = env[p.clientIdEnv];
  const clientSecret = env[p.clientSecretEnv];
  if (!clientId || !clientSecret) {
    throw new Error(
      `Missing ${p.name} app credentials. Set ${p.clientIdEnv} and ${p.clientSecretEnv} ` +
      `in ~/.openclaw/.env (register the app first — see the runbook).`
    );
  }
  return { clientId, clientSecret };
}

// Build the provider authorize URL the client is sent to. state ties the redirect
// back to its vault drop (we use the drop's one-time token as state).
export function buildAuthorizeUrl(nameOrId, { clientId, redirectUri: ru, state }) {
  const p = getProvider(nameOrId);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: ru,
    state: state,
    ...p.extraAuthParams,
  });
  if (p.scopes && p.scopes.length) params.set("scope", p.scopes.join(p.scopeSep));
  return p.authorizeUrl + "?" + params.toString();
}

// ── token endpoints ──────────────────────────────────────────────────────────
async function postForm(url, form, fetchImpl, provider = null) {
  const f = fetchImpl || globalThis.fetch;
  const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  const body = { ...form };
  if (provider && provider.tokenAuth === "basic") {
    const raw = `${encodeURIComponent(body.client_id)}:${encodeURIComponent(body.client_secret)}`;
    const b64 = (typeof Buffer !== "undefined") ? Buffer.from(raw).toString("base64") : btoa(raw);
    headers.Authorization = `Basic ${b64}`;
    delete body.client_id;
    delete body.client_secret;
  }
  let encodedBody;
  if (provider && provider.tokenBody === "json") {
    headers["Content-Type"] = "application/json";
    encodedBody = JSON.stringify(body);
  } else {
    encodedBody = new URLSearchParams(body).toString();
  }
  const res = await f(url, {
    method: "POST",
    headers,
    body: encodedBody,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  if (!res.ok || (parsed && parsed.error)) {
    const msg = (parsed && (parsed.error_description || parsed.error || parsed.message)) || text || res.status;
    throw new Error(`${url} → ${res.status}: ${msg}`);
  }
  return parsed || {};
}

// Zoho's token host is data-center specific; the callback may report it as
// `accounts-server` / `location`. Default to the global DC.
function zohoTokenUrl(accountsServer) {
  if (!accountsServer) return OAUTH_PROVIDERS.zoho.tokenUrl;
  const host = String(accountsServer).replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host}/oauth/v2/token`;
}

function zohoAccountsServerFromApiDomain(apiDomain) {
  if (!apiDomain) return null;
  const host = String(apiDomain).replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const m = host.match(/(?:^|\.)zohoapis(\..+)$/i);
  return m ? `https://accounts.zoho${m[1]}` : null;
}

/**
 * Exchange an authorization code for tokens. `extra` carries provider-specific
 * callback fields (Zoho: { accountsServer }). Returns the raw provider token
 * response (normalized to an object).
 */
export async function exchangeCode(nameOrId, { code, redirectUri: ru, clientId, clientSecret, extra = {} }, fetchImpl) {
  const p = getProvider(nameOrId);
  const url = (p.id === "zoho" || p.id === "zohobooks") ? zohoTokenUrl(extra.accountsServer) : p.tokenUrl;
  return postForm(url, {
    grant_type: "authorization_code",
    code,
    redirect_uri: ru,
    client_id: clientId,
    client_secret: clientSecret,
    ...(p.extraTokenParams || {}),
  }, fetchImpl, p);
}

/**
 * Refresh an access token using a stored refresh token. Returns the raw provider
 * token response. (Salesforce/Zoho keep the same refresh token; HubSpot too.)
 */
export async function refreshTokens(nameOrId, { refreshToken, clientId, clientSecret, extra = {} }, fetchImpl) {
  const p = getProvider(nameOrId);
  const url = (p.id === "zoho" || p.id === "zohobooks") ? zohoTokenUrl(extra.accountsServer || zohoAccountsServerFromApiDomain(extra.apiDomain)) : p.tokenUrl;
  return postForm(url, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    ...(p.extraTokenParams || {}),
  }, fetchImpl, p);
}

/**
 * Normalize a provider token response into the env-var map we write into the
 * client's profile .env. Computes an absolute expiry from expires_in. A refresh
 * response that omits a field (e.g. no new refresh_token) leaves it out so the
 * .env writer keeps the existing value.
 */
export function tokensToEnv(nameOrId, tok, nowMs = Date.now(), extra = {}) {
  const p = getProvider(nameOrId);
  const k = p.envKeys;
  const out = {};
  if (tok.access_token && k.access) out[k.access] = tok.access_token;
  if (tok.refresh_token && k.refresh) out[k.refresh] = tok.refresh_token;
  if (k.instanceUrl && tok.instance_url) out[k.instanceUrl] = tok.instance_url;
  if (k.apiDomain && tok.api_domain) out[k.apiDomain] = tok.api_domain;
  if (k.realmId && extra.realmId) out[k.realmId] = extra.realmId;
  if (k.locationId && tok.locationId) out[k.locationId] = tok.locationId;
  if (k.expires && tok.expires_in) {
    out[k.expires] = new Date(nowMs + Number(tok.expires_in) * 1000).toISOString();
  }
  return out;
}
