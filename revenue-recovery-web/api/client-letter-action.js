const crypto = require('crypto');
const { cors, bad, rest, requireClient } = require('./client-dashboard-common.js');

function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function sha1(s) { return crypto.createHash('sha1').update(String(s)).digest('hex'); }
function clean(v, max = 500) { return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function eventKey(e = {}) { return [e.invoice_id, e.channel, e.customer_name].join('|'); }
function profileFor(row = {}) { return row.profile || `rr-${String(row.company || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`; }
function encryptionKey() {
  const secret = process.env.RRD_SIGNATURE_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
  if (!secret) throw new Error('Server is missing signature encryption configuration.');
  return crypto.createHash('sha256').update(secret).digest();
}
function encryptSignature(dataUrl) {
  const text = String(dataUrl || '');
  if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(text)) throw new Error('Signature must be a PNG, JPEG, or WEBP image.');
  if (text.length > 1_500_000) throw new Error('Signature image is too large.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64'),
    sha256: sha256(text),
  };
}
async function findLetterEvent(submissionId, letterKey) {
  const rows = await rest(`recovery_events?submission_id=eq.${encodeURIComponent(submissionId)}&requires_human=eq.true&channel=ilike.*Letter*&select=*&order=occurred_at.desc&limit=500`);
  return (rows || []).find((e) => eventKey(e) === letterKey);
}
async function writeEvent({ submissionId, profile, source, type, outcome, meta, requestedBy }) {
  const now = new Date().toISOString();
  const dedupe = sha1(`${submissionId}|${type}|${meta.letterKey}|${requestedBy}|${now}`);
  const body = {
    submission_id: submissionId,
    profile,
    dedupe_key: dedupe,
    event_type: type,
    occurred_at: now,
    invoice_id: source.invoice_id,
    invoice_number: source.invoice_number,
    customer_name: source.customer_name,
    customer_email: source.customer_email,
    amount_usd: source.amount_usd,
    currency: source.currency,
    channel: 'Letter',
    rung: source.rung,
    outcome,
    requires_human: false,
    allowed: false,
    meta: { requestedBy, recordedAt: now, sendGate: 'blocked_until_letter_executor_verifies_signed_approval', ...meta },
  };
  const rows = await rest('recovery_events', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
  return rows && rows[0] ? rows[0] : body;
}
module.exports = async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return bad(res, 405, 'Method not allowed');
  try {
    const { user, submissionId } = await requireClient(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = clean(body.action, 40).toLowerCase();
    if (!['approve', 'request_changes'].includes(action)) throw new Error('Invalid letter action.');
    const letterKey = clean(body.letterKey, 500);
    if (!letterKey) throw new Error('Missing letter key.');
    const submissionRows = await rest(`submissions?id=eq.${encodeURIComponent(submissionId)}&select=id,company`);
    if (!submissionRows?.length) throw new Error('Client record not found.');
    const source = await findLetterEvent(submissionId, letterKey);
    if (!source) throw new Error('Letter is no longer pending approval.');
    const profile = profileFor(submissionRows[0]);
    if (action === 'approve') {
      const signerName = clean(body.signerName, 160);
      const signerTitle = clean(body.signerTitle, 160);
      if (!signerName || !signerTitle) throw new Error('Signer name and title/team are required.');
      const encryptedSignature = encryptSignature(body.signatureData);
      const previewHash = sha256(JSON.stringify({ letterKey, signerName, signerTitle, sourceSubject: source.meta && source.meta.subject, sourceDraft: source.meta && source.meta.draftText, signatureHash: encryptedSignature.sha256 }));
      const event = await writeEvent({
        submissionId,
        profile,
        source,
        type: 'letter_approval',
        outcome: 'approved_signed_preview',
        requestedBy: user.email || user.id || 'client',
        meta: { letterKey, sourceEventId: source.id, signerName, signerTitle, signature: encryptedSignature, signatureHash: encryptedSignature.sha256, previewHash, approvalVersion: 1, sendGate: 'approved_for_executor_review', postgridQueueStatus: 'queued_for_gated_executor' },
      });
      return res.status(200).json({ ok: true, action, eventId: event.id || null, letterKey, previewHash, signatureHash: encryptedSignature.sha256 });
    }
    const reason = clean(body.reason, 1000);
    const event = await writeEvent({
      submissionId,
      profile,
      source,
      type: 'letter_change_requested',
      outcome: 'changes_requested',
      requestedBy: user.email || user.id || 'client',
      meta: { letterKey, sourceEventId: source.id, reason },
    });
    return res.status(200).json({ ok: true, action, eventId: event.id || null, letterKey });
  } catch (e) {
    return bad(res, e.status || 400, e && e.message ? e.message : String(e));
  }
};
