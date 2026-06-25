const crypto = require('crypto');

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const AGENTMAIL_BASE = process.env.AGENTMAIL_API_BASE || 'https://api.agentmail.to/v0';
const AGENTMAIL_KEY = process.env.AGENTMAIL_API_KEY || '';
const INBOX_ID = process.env.RRD_SUPPORT_INBOX_ID || 'flowaudit-support@agentmail.to';
const WEB_BASE = (process.env.RRD_WEB_BASE || 'https://revenue-recovery-web-ivory.vercel.app').replace(/\/+$/, '');

function cleanOrigin(value) {
  try {
    const u = new URL(String(value || '').trim());
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}
function allowedCorsOrigins(env = process.env) {
  const defaults = [
    'https://revenue-recovery-web-ivory.vercel.app',
    'https://revenue-recovery-web.vercel.app',
    'https://flowaudit.co.uk',
    'https://www.flowaudit.co.uk',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
  ];
  const configured = [
    env.RRD_WEB_BASE,
    env.RRD_CLIENT_DASHBOARD_BASE_URL,
    env.RRD_DASHBOARD_BASE_URL,
    env.VERCEL_URL ? `https://${env.VERCEL_URL}` : '',
    ...(String(env.RRD_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)),
  ];
  return [...new Set([...defaults, ...configured].map(cleanOrigin).filter(Boolean))];
}
function cors(res, reqOrMethods = null, methods = 'POST, OPTIONS') {
  let req = reqOrMethods;
  if (typeof reqOrMethods === 'string') {
    methods = reqOrMethods;
    req = null;
  }
  const origin = cleanOrigin(req?.headers?.origin || req?.headers?.Origin || res?.req?.headers?.origin || res?.req?.headers?.Origin);
  const allowed = allowedCorsOrigins();
  const allowOrigin = origin && allowed.includes(origin) ? origin : cleanOrigin(WEB_BASE);
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}
function bad(res, status, error) { return res.status(status).json({ ok: false, error }); }
function serviceHeaders(extra = {}) { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...extra }; }
function anonHeaders(token, extra = {}) { return { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra }; }
async function rest(path, init = {}) {
  if (!URL_BASE || !SERVICE_KEY) throw new Error('Server is missing Supabase service configuration.');
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: serviceHeaders(init.headers) });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(data?.message || data?.error || text || `Supabase ${r.status}`);
  return data;
}
async function authAdmin(path, init = {}) {
  if (!URL_BASE || !SERVICE_KEY) throw new Error('Server is missing Supabase service configuration.');
  const r = await fetch(`${URL_BASE}/auth/v1/${path}`, { ...init, headers: serviceHeaders(init.headers) });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(data?.msg || data?.message || data?.error || text || `Auth ${r.status}`);
  return data;
}
async function verifyUserFromBearer(req) {
  const m = String(req.headers.authorization || req.headers.Authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) throw new Error('Missing bearer token.');
  const token = m[1];
  const r = await fetch(`${URL_BASE}/auth/v1/user`, { headers: anonHeaders(token) });
  const text = await r.text();
  let user; try { user = text ? JSON.parse(text) : null; } catch { user = null; }
  if (!r.ok || !user?.id) throw new Error('Invalid session.');
  return { token, user };
}
async function requireStaff(req) {
  const { user } = await verifyUserFromBearer(req);
  const email = String(user.email || '').toLowerCase();
  const rows = await rest(`staff?email=eq.${encodeURIComponent(email)}&select=email`);
  if (!rows?.length) { const e = new Error('Staff access required.'); e.status = 403; throw e; }
  return user;
}
async function requireClient(req) {
  const { user } = await verifyUserFromBearer(req);
  const sid = user.app_metadata?.submission_id || user.user_metadata?.submission_id;
  if (!sid) throw new Error('This account is not linked to a client dashboard.');
  const rows = await rest(`client_accounts?user_id=eq.${encodeURIComponent(user.id)}&select=*`);
  if (!rows?.length || String(rows[0].submission_id) !== String(sid)) throw new Error('Client account mapping is missing.');
  return { user, account: rows[0], submissionId: sid };
}
function initialClientPassword(len = 25) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  let out = '';
  while (out.length < len) for (const b of crypto.randomBytes(Math.max(len, 32))) { if (b < limit) out += alphabet[b % alphabet.length]; if (out.length >= len) break; }
  return out;
}
function cleanString(v, max = 500) { return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim()); }
function arr(x) { return Array.isArray(x) ? x : []; }
function compactObject(o) { return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')); }
function mergeClientSettings(row = {}, body = {}, submissionId = row.id) {
  const patch = {}, reasons = new Set();
  if (body.businessInfo && typeof body.businessInfo === 'object') {
    const b = body.businessInfo;
    if (Object.prototype.hasOwnProperty.call(b, 'company')) patch.company = cleanString(b.company, 180);
    if (Object.prototype.hasOwnProperty.call(b, 'industry')) patch.industry = cleanString(b.industry, 120);
    if (Object.prototype.hasOwnProperty.call(b, 'size')) patch.size = cleanString(b.size, 120);
    if (Object.prototype.hasOwnProperty.call(b, 'website')) patch.website = cleanString(b.website, 240);
    if (Object.prototype.hasOwnProperty.call(b, 'primaryContact')) patch.primary_contact = cleanString(b.primaryContact, 180);
    if (Object.prototype.hasOwnProperty.call(b, 'phone')) patch.phone = cleanString(b.phone, 80);
    if (Object.prototype.hasOwnProperty.call(b, 'address')) {
      patch.business_profile = { ...(row.business_profile || {}), address: cleanString(b.address, 300) };
    }
    reasons.add('business_info_changed');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'contacts')) {
    patch.contacts = arr(body.contacts).slice(0, 25).map(c => {
      const email = cleanString(c.email, 254).toLowerCase();
      if (email && !validEmail(email)) throw new Error(`Invalid contact email: ${email}`);
      return compactObject({ name: cleanString(c.name, 120), role: cleanString(c.role || c.title, 120), email, phone: cleanString(c.phone, 80), tags: arr(c.tags).map(t => cleanString(t, 40)).filter(Boolean).slice(0, 10) });
    });
    reasons.add('contacts_changed');
  }
  let guardrails = { ...(row.guardrails || {}) };
  let guardChanged = false;
  if (body.approvalRouting) {
    guardrails.approvalRouting = compactObject({ approvers: arr(body.approvalRouting.approvers).map(a => cleanString(a, 254).toLowerCase()).filter(Boolean), preferredChannel: cleanString(body.approvalRouting.preferredChannel || body.approvalRouting.channel, 60), slaHours: body.approvalRouting.slaHours == null ? undefined : Math.max(1, Math.min(168, Number(body.approvalRouting.slaHours) || 24)) });
    reasons.add('approval_changed'); guardChanged = true;
  }
  if (body.outreachMode) {
    const mode = cleanString(body.outreachMode, 20).toLowerCase();
    if (!['auto', 'draft'].includes(mode)) throw new Error('Invalid outreach mode.');
    guardrails.autoSendChannels = mode === 'auto' ? ['Email', 'SMS'] : [];
    guardrails.approvalModel = mode === 'auto' ? 'auto_email_sms_letter_signer_gated' : 'draft_requires_approval';
    reasons.add('policy_changed'); guardChanged = true;
  }
  if (body.guardrails?.autoSendChannels) {
    const channels = arr(body.guardrails.autoSendChannels).map(c => cleanString(c, 20));
    if (channels.some(c => /^letter$/i.test(c))) throw new Error('Letter cannot be auto-sent; physical letters always require signer approval.');
    guardrails.autoSendChannels = [...new Set(channels.filter(c => /^(email|sms)$/i.test(c)).map(c => /^sms$/i.test(c) ? 'SMS' : 'Email'))];
    reasons.add('policy_changed'); guardChanged = true;
  }
  if (guardChanged) patch.guardrails = guardrails;
  if (body.letters) {
    const letter = { ...((row.recovery_process || {}).letter || {}) };
    if (body.letters.mailClass) letter.mailClass = cleanString(body.letters.mailClass, 40).toLowerCase();
    if (body.letters.returnAddress) letter.returnAddress = body.letters.returnAddress;
    if (body.letters.certifiedOnDemand != null) letter.certifiedOnDemand = !!body.letters.certifiedOnDemand;
    if (body.letters.templatePath) {
      const p = cleanString(body.letters.templatePath, 500);
      if (!p.startsWith(`${submissionId}/`)) throw new Error('Letter template path must stay inside this client folder.');
      letter.templatePath = p;
    }
    patch.recovery_process = { ...(row.recovery_process || {}), letter };
    reasons.add('letter_changed');
  }
  return { patch, reasons: [...reasons] };
}
async function sendEmail(to, subject, text) {
  if (!AGENTMAIL_KEY) throw new Error('Missing AGENTMAIL_API_KEY.');
  const r = await fetch(`${AGENTMAIL_BASE.replace(/\/+$/, '')}/inboxes/${encodeURIComponent(INBOX_ID)}/messages/send`, { method: 'POST', headers: { Authorization: `Bearer ${AGENTMAIL_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ to, subject, text }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.message || body.error || `AgentMail ${r.status}`);
  return body;
}
module.exports = { cors, allowedCorsOrigins, bad, rest, authAdmin, verifyUserFromBearer, requireStaff, requireClient, initialClientPassword, mergeClientSettings, sendEmail, WEB_BASE };
