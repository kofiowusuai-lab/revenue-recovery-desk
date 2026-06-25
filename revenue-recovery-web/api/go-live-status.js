const crypto = require('crypto');

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const TOKEN_SECRET = process.env.RRD_GO_LIVE_TOKEN_SECRET || SERVICE_KEY;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}
function bad(res, status, error) { return res.status(status).json({ ok: false, error }); }
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function signPayload(payload) { return b64url(crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest()); }
function verifyToken(token) {
  if (!TOKEN_SECRET) throw new Error('Server is missing token configuration.');
  const [payloadB64, sig] = String(token || '').split('.');
  if (!payloadB64 || !sig) throw new Error('Invalid or expired link.');
  const expected = signPayload(payloadB64);
  if (Buffer.byteLength(sig) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('Invalid or expired link.');
  let payload;
  try { payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')); }
  catch { throw new Error('Invalid or expired link.'); }
  if (payload.exp && Date.now() > Number(payload.exp) * 1000) throw new Error('This readiness link has expired. Please ask support for a fresh link.');
  if (!payload.sid || !payload.email) throw new Error('Invalid readiness link.');
  return payload;
}
async function rest(path) {
  if (!URL_BASE || !SERVICE_KEY) throw new Error('Server is missing Supabase configuration.');
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(data?.message || data?.error || text || `Supabase ${r.status}`);
  return data;
}
function rowToClient(r) {
  return {
    id: r.id, submittedAt: r.created_at, company: r.company, email: r.email, contactName: r.contact_name,
    paymentPlatforms: r.payment_platforms || [], paymentStack: r.payment_stack || {}, crm: r.crm,
    crmData: r.crm_data || {}, recoveryProcess: r.recovery_process || {}, outreach: r.outreach || {},
    guardrails: r.guardrails || {}, contacts: r.contacts || [], primaryContact: r.primary_contact,
    consent: !!r.consent, hasSop: !!r.has_sop, integrationReady: !!r.integration_ready,
    wantsSopBuilt: !!((r.recovery_process || {}).wantSopBuilt), catalyst: r.catalyst || '',
    approxOutstanding: Number(r.approx_outstanding) || 0,
  };
}
const INTEGRATIONS = {
  payment: {
    'Stripe': { auth: 'apikey', keys: ['STRIPE_API_KEY'] }, 'Square': { auth: 'apikey', keys: ['SQUARE_ACCESS_TOKEN'] },
    'PayPal': { auth: 'apikey', keys: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'] }, 'Braintree': { auth: 'apikey', keys: ['BRAINTREE_MERCHANT_ID', 'BRAINTREE_PRIVATE_KEY'] },
    'Authorize.net': { auth: 'apikey', keys: ['AUTHNET_API_LOGIN_ID', 'AUTHNET_TRANSACTION_KEY'] }, 'GoCardless': { auth: 'apikey', keys: ['GOCARDLESS_ACCESS_TOKEN'] },
    'Bill.com': { auth: 'apikey', keys: ['BILLCOM_API_KEY'] }
  },
  accounting: { 'QuickBooks Online': { auth: 'oauth', name: 'QuickBooks Online', providerId: 'quickbooks' }, 'Xero': { auth: 'oauth', name: 'Xero', providerId: 'xero' }, 'Sage': { auth: 'oauth', name: 'Sage', providerId: 'sage' }, 'FreshBooks': { auth: 'oauth', name: 'FreshBooks', providerId: 'freshbooks' }, 'Wave': { auth: 'oauth', name: 'Wave', providerId: 'wave' }, 'Zoho Books': { auth: 'oauth', name: 'Zoho Books', providerId: 'zohobooks' }, 'FreeAgent': { auth: 'oauth', name: 'FreeAgent', providerId: 'freeagent' }, 'Bill.com': { auth: 'apikey', keys: ['BILLCOM_API_KEY'] }, 'NetSuite': { auth: 'apikey', keys: ['NETSUITE_ACCOUNT_ID', 'NETSUITE_CONSUMER_KEY', 'NETSUITE_CONSUMER_SECRET', 'NETSUITE_TOKEN_ID', 'NETSUITE_TOKEN_SECRET', 'NETSUITE_RESTLET_URL', 'NETSUITE_SUITEQL_ENABLED'] } },
  crm: { 'HubSpot': { auth: 'oauth', name: 'HubSpot', providerId: 'hubspot' }, 'Salesforce': { auth: 'oauth', name: 'Salesforce', providerId: 'salesforce' }, 'Zoho CRM': { auth: 'oauth', name: 'Zoho CRM', providerId: 'zoho' }, 'Pipedrive': { auth: 'oauth', name: 'Pipedrive', providerId: 'pipedrive' }, 'Close': { auth: 'apikey', keys: ['CLOSE_API_KEY'] }, 'GoHighLevel': { auth: 'oauth', name: 'GoHighLevel', providerId: 'gohighlevel' }, 'Dynamics 365': { auth: 'composio', name: 'Dynamics 365', providerId: 'dynamics365' }, 'ServiceM8': { auth: 'composio', name: 'ServiceM8', providerId: 'servicem8' } },
  email: { 'Google Workspace': { auth: 'oauth', name: 'Google Workspace' }, 'Gmail': { auth: 'oauth', name: 'Google Workspace' }, 'Microsoft 365': { auth: 'oauth', name: 'Microsoft 365 / Outlook' }, 'Office 365': { auth: 'oauth', name: 'Microsoft 365 / Outlook' }, 'Outlook': { auth: 'oauth', name: 'Microsoft 365 / Outlook' }, 'SendGrid': { auth: 'apikey', keys: ['SENDGRID_API_KEY'] }, 'Postmark': { auth: 'apikey', keys: ['POSTMARK_SERVER_TOKEN'] }, 'Mailgun': { auth: 'apikey', keys: ['MAILGUN_API_KEY'] } },
  sms: { 'Twilio': { auth: 'apikey', keys: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] } },
  mail: { 'PostGrid': { auth: 'apikey', keys: ['POSTGRID_API_KEY'] } }
};
function usesLetters(c) { const out=c.outreach||{}, rp=c.recoveryProcess||{}; const channels=(out.channels&&out.channels.length)?out.channels:(rp.channels||[]); return channels.some(x=>/\b(letter|postal|post|physical mail|paper mail)\b/i.test(String(x))); }
function selected(c) {
  const ps=c.paymentStack||{}, out=c.outreach||{}, hits=[];
  for (const p of (c.paymentPlatforms || ps.platforms || [])) if (INTEGRATIONS.payment[p]) hits.push({ provider:p, ...INTEGRATIONS.payment[p] });
  if (ps.accounting && INTEGRATIONS.accounting[ps.accounting]) hits.push({ provider:ps.accounting, ...INTEGRATIONS.accounting[ps.accounting] });
  if (c.crm && INTEGRATIONS.crm[c.crm]) hits.push({ provider:c.crm, ...INTEGRATIONS.crm[c.crm] });
  for (const name of Object.keys(INTEGRATIONS.email)) if (String(out.emailProvider||'').includes(name)) hits.push({ provider:name, ...INTEGRATIONS.email[name] });
  for (const name of Object.keys(INTEGRATIONS.sms)) if (String(out.smsProvider||'').toLowerCase().includes(name.toLowerCase())) hits.push({ provider:name, ...INTEGRATIONS.sms[name] });
  if (usesLetters(c)) hits.push({ provider:'PostGrid', ...INTEGRATIONS.mail.PostGrid });
  return hits;
}
function envKeyProviders(c) { const out=[]; const seen=new Set(); for(const h of selected(c).filter(x=>x.auth==='apikey')) { if(seen.has(h.provider)) continue; seen.add(h.provider); out.push({ provider:h.provider, keys:h.keys||[] }); } return out; }
function oauthProviders(c) { const out=[]; const seen=new Set(); for(const h of selected(c).filter(x=>x.auth==='oauth')) { const name=h.name||h.provider, id=h.providerId||h.provider; if(!seen.has(id)) { seen.add(id); out.push({ name, id }); } } return out; }
function composioProviders(c) { const out=[]; const seen=new Set(); for(const h of selected(c).filter(x=>x.auth==='composio')) { const name=h.name||h.provider, id=h.providerId||h.provider; if(!seen.has(id)) { seen.add(id); out.push({ name, id }); } } return out; }
function item(label, status, detail='', action='') { return { label, status, detail, action }; }
function specialSubmitted(forms, catalyst) { return forms.some(f => String(f.catalyst||'').toUpperCase() === catalyst); }
function hasMissingReadiness(c) {
  const out=c.outreach||{}, g=c.guardrails||{}, ar=c.approvalRouting||g.approvalRouting||{}, rp=c.recoveryProcess||{};
  return !ar.approvers || !ar.preferredChannel || !out.timezone || !out.businessHours || !out.fromName || (!out.sendingDomain && !out.emailProvider) || !g.doNotContact || (!g.maxDiscount && !rp.settlementRules) || (!rp.escalation && !g.escalationTriggers);
}
function needsMapping(c) { const ps=c.paymentStack||{}, cd=c.crmData||{}; const s=[c.crm,cd.crm,ps.accounting,...(ps.platforms||[]),...(c.paymentPlatforms||[])].filter(Boolean).join(' ').toLowerCase(); return /spreadsheet|custom|internal|proprietary|bespoke|api|salesforce|hubspot|zoho|pipedrive|monday|gohighlevel|highlevel|xero|quickbooks|intuit|sage|freshbooks|netsuite|stripe|square|paypal|adyen|braintree|shopify/.test(s); }
function dropStatus(drops, pred) {
  const list = drops.filter(pred);
  if (list.some(d => d.status === 'consumed')) return 'done';
  if (list.some(d => d.status === 'deposited')) return 'doing';
  if (list.some(d => d.status === 'pending')) return 'waiting';
  return 'pending';
}
function readableStatus(st) { return st === 'done' ? 'secure access received' : st === 'doing' ? 'secure details received — under review' : st === 'waiting' ? 'secure link sent — awaiting client' : 'secure access needed'; }
function buildStatus({ client, forms, drops }) {
  const clientItems = [];
  clientItems.push(item('Onboarding form submitted', 'done', `${client.company} · ${client.submittedAt ? new Date(client.submittedAt).toISOString().slice(0,10) : ''}`));
  clientItems.push(item('Consent to recovery', client.consent ? 'done' : 'blocked', client.consent ? '' : 'consent is required before work can begin'));
  const platforms = (client.paymentStack.platforms || client.paymentPlatforms || []).join(', ') || 'not listed yet';
  clientItems.push(item('Payment platform API access', /^yes$/i.test(String(client.paymentStack.apiAccess||'')) ? 'done' : 'pending', platforms));
  const crmName = client.crmData.crm || client.crm || 'None';
  clientItems.push(item('CRM API access', (!crmName || /^none$/i.test(crmName) || /^yes$/i.test(String(client.crmData.apiAccess||''))) ? 'done' : 'pending', crmName));
  const contactsOk = !!client.primaryContact || (client.contacts || []).length > 0;
  clientItems.push(item('Primary contact + key contacts', contactsOk ? 'done' : 'pending', contactsOk ? `${(client.contacts||[]).length || 1} contact(s)` : 'please confirm primary contact'));
  for (const p of envKeyProviders(client)) {
    const st = dropStatus(drops, d => d.kind !== 'oauth' && (d.env_keys||[]).some(k => p.keys.includes(k)));
    clientItems.push(item(`Connect ${p.provider} (secure key)`, st, readableStatus(st)));
  }
  for (const p of oauthProviders(client)) {
    const st = dropStatus(drops, d => d.kind === 'oauth' && String(d.provider||'').toLowerCase() === String(p.id||'').toLowerCase());
    clientItems.push(item(`Authorize ${p.name}`, st, st === 'done' ? 'authorization received' : st === 'doing' ? 'authorization received — under review' : st === 'waiting' ? 'authorization link sent — awaiting client' : 'authorization needed'));
  }
  for (const p of composioProviders(client)) {
    const st = dropStatus(drops, d => d.kind === 'composio' && String(d.provider||'').toLowerCase() === String(p.id||'').toLowerCase());
    clientItems.push(item(`Authorize ${p.name} (Composio)`, st, st === 'done' ? 'connected account received' : st === 'doing' ? 'connection received — under review' : st === 'waiting' ? 'Composio authorization started — awaiting client' : 'Composio authorization needed'));
  }
  const sopDone = client.hasSop || specialSubmitted(forms, 'SOP_REVIEW_WEB');
  clientItems.push(item(client.hasSop ? 'SOP on file' : 'Confirm recovery SOP', sopDone ? 'done' : 'pending', client.hasSop ? 'client SOP provided' : 'SOP review needed'));
  if (needsMapping(client)) clientItems.push(item('Confirm data mapping', specialSubmitted(forms, 'MAPPING_DETAILS_WEB') ? 'done' : 'pending', specialSubmitted(forms, 'MAPPING_DETAILS_WEB') ? 'mapping details received' : 'mapping details needed'));
  if (hasMissingReadiness(client)) clientItems.push(item('Provide go-live readiness details', specialSubmitted(forms, 'READINESS_DETAILS_WEB') ? 'done' : 'pending', specialSubmitted(forms, 'READINESS_DETAILS_WEB') ? 'readiness details received' : 'operating details needed'));
  const hardClient = clientItems.filter(x => !['done'].includes(x.status));
  const systemItems = [
    item('Agent provisioned', 'done', 'dedicated recovery workspace prepared'),
    item('Runtime ready (sandbox / cloud infrastructure)', hardClient.length ? 'doing' : 'done', hardClient.length ? 'preparing while client items are completed' : 'ready for final go-live checks'),
  ];
  const total = clientItems.concat(systemItems).filter(x => x.status !== 'waiting').length;
  const done = clientItems.concat(systemItems).filter(x => x.status === 'done').length;
  return {
    title: `${client.company} — Go-Live Readiness`,
    status: hardClient.length ? 'IN PROGRESS' : 'READY TO SERVE',
    counts: { done, total },
    company: client.company,
    submittedAt: client.submittedAt,
    primaryContact: client.primaryContact || client.contactName || '',
    contacts: client.contacts || [],
    groups: [{ group: 'Client to-do', items: clientItems }, { group: 'System readiness', items: systemItems }],
  };
}
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return bad(res, 405, 'Method not allowed');
  try {
    const payload = verifyToken(req.query.token || '');
    const rows = await rest(`submissions?id=eq.${encodeURIComponent(payload.sid)}&select=*`);
    if (!rows || !rows.length) return bad(res, 404, 'Readiness record not found.');
    const client = rowToClient(rows[0]);
    if (String(client.email||'').toLowerCase() !== String(payload.email||'').toLowerCase()) return bad(res, 403, 'This readiness link does not match the client record.');
    const companyFilter = encodeURIComponent(client.company || '');
    const emailFilter = encodeURIComponent(client.email || '');
    const forms = await rest(`submissions?company=eq.${companyFilter}&email=eq.${emailFilter}&select=id,catalyst,business_profile,created_at`);
    let drops = [];
    try { drops = await rest(`vault_drops?submission_id=eq.${encodeURIComponent(client.id)}&select=id,status,kind,provider,env_keys,created_at`); } catch { drops = []; }
    return res.status(200).json({ ok: true, ...buildStatus({ client, forms: forms || [], drops: drops || [] }) });
  } catch (e) {
    return bad(res, 401, e && e.message ? e.message : String(e));
  }
};
