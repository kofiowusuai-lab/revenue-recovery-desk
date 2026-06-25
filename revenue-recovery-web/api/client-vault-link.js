const { cors, bad, rest, requireClient, WEB_BASE } = require('./client-dashboard-common.js');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const OAUTH_PROVIDERS = {
  'quickbooks online': 'quickbooks',
  quickbooks: 'quickbooks',
  intuit: 'quickbooks',
  xero: 'xero',
  sage: 'sage',
  freshbooks: 'freshbooks',
  wave: 'wave',
  'zoho books': 'zohobooks',
  zohobooks: 'zohobooks',
  freeagent: 'freeagent',
  hubspot: 'hubspot',
  salesforce: 'salesforce',
  'zoho crm': 'zoho',
  zoho: 'zoho',
  pipedrive: 'pipedrive',
  'monday.com': 'monday',
  monday: 'monday',
  gohighlevel: 'gohighlevel',
  highlevel: 'gohighlevel',
  google: 'google',
  gmail: 'google',
  'google workspace': 'google',
  microsoft: 'microsoft',
  'microsoft 365': 'microsoft',
  'office 365': 'microsoft',
  outlook: 'microsoft',
};
const PAYMENT_API_KEY_PROVIDERS = new Set(['Stripe', 'Square', 'PayPal', 'Braintree', 'Authorize.net', 'GoCardless', 'Bill.com', 'Whop', 'Maxio', 'Paystack', 'Razorpay', 'Lemon Squeezy', 'MoonClerk']);
const ACCOUNTING_API_KEY_PROVIDERS = new Set(['Bill.com', 'Clientary', 'Moneybird', 'Sevdesk', 'Lexoffice', 'Quaderno', 'Elorus', 'Coupa', 'Odoo', 'NetSuite', 'Spreadsheets']);
const CRM_API_KEY_PROVIDERS = new Set(['Close', 'Capsule CRM', 'Attio', 'Kommo', 'Nutshell', 'Salesflare', 'Salesmate', 'noCRM.io', 'ActiveCampaign', 'Odoo', 'RepairShopr']);
const EMAIL_API_KEY_PROVIDERS = ['SendGrid', 'Postmark', 'Mailgun'];
const SMS_API_KEY_PROVIDERS = ['Twilio'];
// OAuth providers a logged-in client may connect themselves from the dashboard,
// even if not pre-declared in their manifest. The client authorizes their OWN
// account on the provider's consent screen (read-only), so self-serve is safe.
const SELF_SERVE_OAUTH = new Set(['google']);

// Static, public OAuth config for serverless minting. Mirrors the google entry in
// rrd-oauth.mjs (scopes are read-only least privilege). client_id is not a secret.
const OAUTH_MINT = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/drive.metadata.readonly'],
    scopeSep: ' ',
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    envKeys: ['GOOGLE_ACCESS_TOKEN', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_TOKEN_EXPIRES_AT'],
  },
};
function sha256hex(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function buildAuthorizeUrl(cfg, { clientId, redirectUri, state }) {
  const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state, ...cfg.extraAuthParams });
  if (cfg.scopes && cfg.scopes.length) params.set('scope', cfg.scopes.join(cfg.scopeSep));
  return cfg.authorizeUrl + '?' + params.toString();
}

// Serverless OAuth drop mint (no Mac binary). Zero-knowledge preserved: it uses the
// submission's published PUBLIC key (the private key never leaves the Mac), builds
// the provider authorize URL, and inserts a one-time vault_drops row via service role.
// Returns the oauth-start URL the client is redirected to.
async function mintOauthDrop({ provider, submissionId, submission, env, restImpl, webBase, hours = 72, nowMs = Date.now() }) {
  const cfg = OAUTH_MINT[provider];
  if (!cfg) { const e = new Error(`No serverless connect config for "${provider}".`); e.status = 400; throw e; }
  const clientId = env[cfg.clientIdEnv];
  if (!clientId) { const e = new Error('Google OAuth is not configured on the server yet. Please contact support.'); e.status = 503; throw e; }
  const keyRows = await restImpl(`vault_public_keys?submission_id=eq.${encodeURIComponent(submissionId)}&select=profile,public_key`);
  const keyRow = Array.isArray(keyRows) ? keyRows[0] : keyRows;
  if (!keyRow || !keyRow.public_key) { const e = new Error('This account is not provisioned for Google connection yet. Please contact support.'); e.status = 409; throw e; }
  const token = crypto.randomBytes(32).toString('hex');
  const base = String(webBase).replace(/\/+$/, '');
  const authorizeUrl = buildAuthorizeUrl(cfg, { clientId, redirectUri: `${base}/oauth-callback`, state: token });
  const drop = {
    profile: keyRow.profile,
    submission_id: submissionId,
    company: (submission && submission.company) || null,
    env_keys: cfg.envKeys,
    public_key: keyRow.public_key,
    token_hash: sha256hex(token),
    status: 'pending',
    expires_at: new Date(nowMs + hours * 3600 * 1000).toISOString(),
    kind: 'oauth',
    provider,
    authorize_url: authorizeUrl,
  };
  await restImpl('vault_drops', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(drop) });
  return { url: `${base}/oauth-start?token=${encodeURIComponent(token)}`, provider };
}

function arr(v) { return Array.isArray(v) ? v : []; }
function normalizeProvider(v) {
  const key = String(v || '').trim().toLowerCase();
  return OAUTH_PROVIDERS[key] || key.replace(/[^a-z0-9]+/g, '');
}
function usesLetters(row = {}) {
  const out = row.outreach || {};
  const rp = row.recovery_process || {};
  const channels = arr(out.channels).length ? arr(out.channels) : arr(rp.channels);
  return channels.some((c) => /\b(letter|postal|post|physical mail|paper mail)\b/i.test(String(c)));
}
function declaredIntegrationAccess(row = {}, account = {}) {
  const manifest = account.manifest || account.profile_manifest || row.manifest || {};
  const oauth = new Set(arr(manifest.oauthConnectionsNeeded).map(normalizeProvider));
  const apiKeyProviders = new Set();
  const ps = row.payment_stack || {};
  const crmData = row.crm_data || {};
  const out = row.outreach || {};
  for (const p of arr(row.payment_platforms).concat(arr(ps.platforms))) if (PAYMENT_API_KEY_PROVIDERS.has(p)) apiKeyProviders.add(p);
  if (PAYMENT_API_KEY_PROVIDERS.has(ps.accounting) || ACCOUNTING_API_KEY_PROVIDERS.has(ps.accounting)) apiKeyProviders.add(ps.accounting);
  if (CRM_API_KEY_PROVIDERS.has(row.crm) || (String(crmData.apiAccess || '').toLowerCase() === 'yes' && /own|custom|internal|proprietary|bespoke/i.test(String(row.crm || crmData.crm || '')))) apiKeyProviders.add(row.crm || 'Custom CRM');
  for (const name of EMAIL_API_KEY_PROVIDERS) if (String(out.emailProvider || '').includes(name)) apiKeyProviders.add(name);
  for (const name of SMS_API_KEY_PROVIDERS) if (String(out.smsProvider || '').toLowerCase().includes(name.toLowerCase())) apiKeyProviders.add(name);
  if (/spreadsheet/i.test(String(ps.accounting || ''))) apiKeyProviders.add('Spreadsheets');
  if (usesLetters(row)) apiKeyProviders.add('PostGrid');

  for (const p of [ps.accounting, row.crm, crmData.crm, out.emailProvider, out.smsProvider].filter(Boolean)) {
    const id = normalizeProvider(p);
    if (id && Object.values(OAUTH_PROVIDERS).includes(id)) oauth.add(id);
  }
  for (const name of arr(manifest.oauthConnectionsNeeded)) oauth.add(normalizeProvider(name));
  const hasApiKeySecrets = apiKeyProviders.size > 0 || arr(manifest.envKeysNeeded).length > 0;
  return { oauth, hasApiKeySecrets };
}
async function loadClientSubmission(submissionId) {
  const rows = await rest(`submissions?id=eq.${encodeURIComponent(submissionId)}&select=*`);
  if (!rows || !rows.length) {
    const e = new Error('Client submission record is missing.');
    e.status = 404;
    throw e;
  }
  return rows[0];
}

module.exports = async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return bad(res, 405, 'Method not allowed');
  try {
    const { submissionId, account } = await requireClient(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const requestedProvider = String(body.provider || '').trim();
    const provider = normalizeProvider(requestedProvider);
    const mode = String(body.mode || (provider ? 'connect' : 'new')).toLowerCase();
    const submission = await loadClientSubmission(submissionId);
    const access = declaredIntegrationAccess(submission, account);
    let args;
    if (mode === 'connect' || requestedProvider) {
      if (!provider || (!access.oauth.has(provider) && !SELF_SERVE_OAUTH.has(provider))) {
        const e = new Error(`Provider "${requestedProvider || provider || '(none)'}" is not declared for this client.`);
        e.status = 403;
        throw e;
      }
      // Self-serve OAuth providers (e.g. Google) mint serverlessly — no Mac binary.
      if (SELF_SERVE_OAUTH.has(provider)) {
        const minted = await mintOauthDrop({ provider, submissionId, submission, env: process.env, restImpl: rest, webBase: WEB_BASE });
        await rest('recovery_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ submission_id: submissionId, profile: '', dedupe_key: `vault-link-${submissionId}-${Date.now()}`, event_type: 'setting_changed', occurred_at: new Date().toISOString(), outcome: 'vault_link_created', meta: { provider } }) }).catch(() => {});
        return res.status(200).json({ ok: true, url: minted.url, provider });
      }
      args = ['connect', submissionId, provider];
    } else {
      if (!access.hasApiKeySecrets) {
        const e = new Error('No API-key integrations are declared for this client.');
        e.status = 403;
        throw e;
      }
      args = ['new', submissionId];
    }
    const out = execFileSync('/Users/AIAgenterminal/rrd-vault', args, { encoding: 'utf8', timeout: 120000, env: { ...process.env, RRD_WEB_BASE: WEB_BASE } });
    const match = out.match(/https?:\/\/\S+/);
    if (!match) throw new Error('Vault link command did not return a URL.');
    await rest('recovery_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ submission_id: submissionId, profile: '', dedupe_key: `vault-link-${submissionId}-${Date.now()}`, event_type: 'setting_changed', occurred_at: new Date().toISOString(), outcome: 'vault_link_created', meta: { provider: provider || 'apikey' } }) }).catch(() => {});
    return res.status(200).json({ ok: true, url: match[0], provider: provider || null });
  } catch (e) {
    return bad(res, e.status || 500, e && e.message ? e.message : String(e));
  }
};

module.exports._private = { normalizeProvider, declaredIntegrationAccess, SELF_SERVE_OAUTH, mintOauthDrop, buildAuthorizeUrl, sha256hex, OAUTH_MINT };
