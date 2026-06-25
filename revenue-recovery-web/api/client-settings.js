const crypto = require('crypto');
const { cors, bad, rest, requireClient, mergeClientSettings } = require('./client-dashboard-common.js');

function sha1(s) { return crypto.createHash('sha1').update(String(s)).digest('hex'); }
async function enqueueProvision(submissionId, profile, reasons, requestedBy, payload) {
  const existing = await rest(`provision_jobs?submission_id=eq.${encodeURIComponent(submissionId)}&status=eq.queued&select=id,payload,reason&limit=1`);
  const reason = reasons.join(',') || 'settings_changed';
  if (existing?.length) {
    await rest(`provision_jobs?id=eq.${existing[0].id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ reason, payload }) });
    return existing[0].id;
  }
  const rows = await rest('provision_jobs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ submission_id: submissionId, profile, reason, payload, requested_by: requestedBy }) });
  return rows?.[0]?.id || null;
}

module.exports = async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return bad(res, 405, 'Method not allowed');
  try {
    const { user, submissionId } = await requireClient(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const rows = await rest(`submissions?id=eq.${encodeURIComponent(submissionId)}&select=*`);
    if (!rows?.length) return bad(res, 404, 'Client record not found.');
    const row = rows[0];
    const { patch, reasons } = mergeClientSettings(row, body, submissionId);
    if (!Object.keys(patch).length) return res.status(200).json({ ok: true, changed: false });
    await rest(`submissions?id=eq.${encodeURIComponent(submissionId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    const now = new Date().toISOString();
    const profile = row.profile || `rr-${String(row.company || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    await rest('recovery_events', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ submission_id: submissionId, profile, dedupe_key: sha1(`${submissionId}|setting_changed|${now}|${reasons.join(',')}`), event_type: 'setting_changed', occurred_at: now, outcome: 'updated', meta: { reasons } }) });
    const jobId = reasons.length ? await enqueueProvision(submissionId, profile, reasons, user.email || 'client', { reasons }) : null;
    return res.status(200).json({ ok: true, changed: true, reasons, provisionJobId: jobId });
  } catch (e) {
    return bad(res, e.status || 400, e && e.message ? e.message : String(e));
  }
};
