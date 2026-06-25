const { verifyClientActionToken } = require('./client-action-token.js');

function supabaseCfg() {
  return {
    url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '',
  };
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Cache-Control', 'no-store');
}

function bad(res, status, message) {
  return res.status(status).json({ ok: false, error: message });
}

function cleanString(v, max = 4000) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').toLowerCase());
}

function getPath(obj, path) {
  return path.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), obj);
}

function requireFields(payload, fields) {
  const missing = fields.filter(({ path }) => !cleanString(getPath(payload, path), 6000));
  if (missing.length) {
    throw new Error(`Please complete every required field before submitting. Missing: ${missing.map((f) => f.label).join(', ')}`);
  }
}

async function rest(path, init = {}) {
  const { url, key } = supabaseCfg();
  if (!url || !key) throw new Error('Server is missing Supabase configuration.');
  const r = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(init.headers || {}) },
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(data?.message || data?.error || text || `Supabase ${r.status}`);
  return data;
}

async function sourceSubmission(id) {
  const rows = await rest(`submissions?id=eq.${encodeURIComponent(id)}&select=id,company,email&limit=1`);
  if (!rows || !rows.length) throw new Error('Invalid or expired signed link. Please ask support for a fresh link.');
  return rows[0];
}

function sameEmail(a, b) { return cleanString(a, 320).toLowerCase() === cleanString(b, 320).toLowerCase(); }
function sameCompany(a, b) { return cleanString(a, 240).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === cleanString(b, 240).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

async function lockedFields(payload, type) {
  const token = cleanString(payload.token || payload.clientActionToken, 5000);
  if (!token) throw new Error('This form requires a signed client action link. Please ask support for a fresh link.');
  const claims = verifyClientActionToken(token, { action: type });
  const source = await sourceSubmission(claims.sid);
  if (!sameEmail(source.email, claims.email)) throw new Error('This signed link does not match the client record email. Please ask support for a fresh link.');
  if (claims.company && !sameCompany(source.company, claims.company)) throw new Error('This signed link does not match the client record company. Please ask support for a fresh link.');
  return { sourceSubmissionId: String(source.id || claims.sid), company: cleanString(source.company || claims.company, 240), email: cleanString(source.email || claims.email, 320).toLowerCase(), token };
}

function specialRow({ catalyst, industry, contactName, primaryContact, urgency, priority, payload, extra = {} }) {
  return {
    company: payload.lockedCompany,
    contact_name: contactName,
    email: payload.lockedBillingEmail,
    industry,
    business_profile: payload,
    recovery_process: extra.recovery_process || {},
    outreach: extra.outreach || {},
    guardrails: extra.guardrails || {},
    contacts: [{ email: payload.lockedBillingEmail, role: primaryContact }],
    primary_contact: primaryContact,
    catalyst,
    urgency,
    anything_else: extra.anything_else || `${industry} submitted via web`,
    consent: true,
    payment_platforms: [],
    has_sop: !!extra.has_sop,
    integration_ready: false,
    approx_outstanding: 0,
    priority,
  };
}

async function insertSubmission(row) {
  return rest('submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return bad(res, 405, 'Method not allowed');
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const type = cleanString(body.type || body.requestType, 80);
    const rawPayload = body.payload && typeof body.payload === 'object' ? body.payload : body;
    const lock = await lockedFields(rawPayload, type);
    const payload = { ...rawPayload, lockedCompany: lock.company, lockedBillingEmail: lock.email, sourceSubmissionId: lock.sourceSubmissionId, token: lock.token };

    let row;
    if (type === 'sop_review') {
      const status = cleanString(payload.status, 80);
      if (!['accepted', 'changes_requested'].includes(status)) throw new Error('Invalid SOP review status.');
      if (status === 'changes_requested' && !cleanString(payload.changeRequest, 6000)) throw new Error('Please tell us what you would like changed.');
      row = specialRow({
        catalyst: 'SOP_REVIEW_WEB', industry: 'SOP Review', contactName: 'SOP reviewer', primaryContact: 'SOP reviewer', urgency: 'SOP Review', priority: 'SOP Review', payload,
        extra: { recovery_process: { sopReview: payload }, has_sop: status === 'accepted', anything_else: `SOP review ${status}` },
      });
    } else if (type === 'readiness_details') {
      row = specialRow({
        catalyst: 'READINESS_DETAILS_WEB', industry: 'Readiness', contactName: 'Readiness contact', primaryContact: 'Readiness contact', urgency: 'Readiness', priority: 'Readiness', payload,
        extra: { recovery_process: { readiness: payload }, outreach: payload.outreach || {}, guardrails: { ...(payload.guardrails || {}), approvalRouting: payload.approvalRouting || {} }, anything_else: 'Readiness details submitted via /readiness' },
      });
    } else if (type === 'mapping_details') {
      requireFields(payload, [
        { path: 'sourceOfTruth', label: 'Source of truth for overdue balances' },
        { path: 'mappingContact', label: 'Who can answer mapping questions' },
        { path: 'systems.crm', label: 'CRM/customer system' },
        { path: 'systems.accounting', label: 'Accounting/invoice system' },
        { path: 'systems.payment', label: 'Payment system' },
        { path: 'systems.reportName', label: 'Preferred reporting/export name' },
        { path: 'fields.invoiceLocation', label: 'Where open/overdue invoices live' },
        { path: 'fields.invoiceFields', label: 'Required invoice fields' },
        { path: 'fields.contactFields', label: 'Customer/contact fields' },
        { path: 'fields.safetyFields', label: 'Stop / dispute / do-not-contact flags' },
        { path: 'fields.writeback', label: 'Where recovery activity should be written back' },
        { path: 'fields.refresh', label: 'Refresh cadence and owner' },
        { path: 'notes', label: 'Anything unusual about the data' },
      ]);
      row = specialRow({
        catalyst: 'MAPPING_DETAILS_WEB', industry: 'Integration Mapping', contactName: 'Mapping contact', primaryContact: 'Mapping contact', urgency: 'Mapping', priority: 'Mapping', payload,
        extra: { recovery_process: { mapping: payload }, outreach: { mappingContact: payload.mappingContact || '' }, guardrails: { sourceOfTruth: payload.sourceOfTruth || '' }, anything_else: 'Integration/data mapping submitted via /mapping' },
      });
    } else if (type === 'offboarding') {
      if (!cleanString(payload.primaryContactName || payload.contactName, 400)) throw new Error('Primary contact name is required.');
      if (!cleanString(payload.desiredCancellationDate, 80)) throw new Error('Desired cancellation date is required.');
      if (!payload.authorization) throw new Error('Authorization is required.');
      row = specialRow({
        catalyst: 'OFFBOARDING_REQUEST_WEB', industry: 'Offboarding', contactName: cleanString(payload.primaryContactName || payload.contactName, 240), primaryContact: 'Offboarding requester', urgency: 'Offboarding', priority: 'Offboarding', payload,
        extra: { recovery_process: { offboarding: payload }, anything_else: `Offboarding requested via /offboard web form. Reason: ${cleanString(payload.reason || 'not provided', 1000)}` },
      });
      row.contacts = [{ name: cleanString(payload.primaryContactName || payload.contactName, 240), email: payload.lockedBillingEmail, role: 'Offboarding requester' }];
      row.primary_contact = cleanString(payload.primaryContactName || payload.contactName, 240);
    } else {
      throw new Error('Unsupported form type.');
    }

    const insertedRaw = await insertSubmission(row);
    const inserted = Array.isArray(insertedRaw) ? insertedRaw[0] : insertedRaw;
    return res.status(200).json({ ok: true, id: inserted?.id || null });
  } catch (e) {
    return bad(res, 400, e && e.message ? e.message : String(e));
  }
};
