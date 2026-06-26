const { cors, bad, rest, requireClient } = require('./client-dashboard-common.js');

function bodyOf(req) {
  if (!req?.body) return {};
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return req.body;
}

function clean(value, max = 2000) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);
}

function id(value, label) {
  const out = clean(value, 120);
  if (!/^[A-Za-z0-9_:\-.]+$/.test(out)) throw new Error(`Invalid ${label}.`);
  return out;
}

function eq(a, b) {
  return String(a ?? '') === String(b ?? '');
}

function rowClientId(row = {}) {
  return row.client_id ?? row.clientId ?? row.submission_id ?? row.submissionId ?? null;
}

function ensureOwner(row, clientId, submissionId) {
  const owner = rowClientId(row);
  if (!owner) return;
  if (!eq(owner, clientId) && !eq(owner, submissionId)) {
    const e = new Error('Approval does not belong to this client.');
    e.status = 403;
    throw e;
  }
}

async function readClientRecord(submissionId) {
  const rows = await rest(`submissions?id=eq.${encodeURIComponent(submissionId)}&select=id,client_id`);
  if (!rows?.length) throw new Error('Client record not found.');
  return rows[0];
}

async function readApproval(approvalId) {
  const rows = await rest(`approval_requests?id=eq.${encodeURIComponent(approvalId)}&select=*`);
  if (!rows?.length) throw new Error('Approval is no longer available.');
  return rows[0];
}

async function readAction(actionId) {
  const rows = await rest(`recovery_actions?id=eq.${encodeURIComponent(actionId)}&select=*`);
  if (!rows?.length) throw new Error('Recovery action is no longer available.');
  return rows[0];
}

async function patchRow(table, rowId, patch) {
  const rows = await rest(`${table}?id=eq.${encodeURIComponent(rowId)}&select=*`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  return rows?.[0] || patch;
}

function actionPatchFor({ mode, body, now, user }) {
  if (mode === 'reject') {
    return {
      status: 'rejected',
      rejected_at: now,
      rejection_reason: clean(body.reason, 1000),
      reviewed_by: user.email || user.id || 'client',
      updated_at: now,
    };
  }
  const patch = {
    status: 'scheduled',
    approved_at: now,
    scheduled_at: now,
    reviewed_by: user.email || user.id || 'client',
    updated_at: now,
  };
  if (Object.prototype.hasOwnProperty.call(body, 'subject')) patch.subject = clean(body.subject, 500);
  if (Object.prototype.hasOwnProperty.call(body, 'draftText')) patch.draft_text = clean(body.draftText, 10000);
  return patch;
}

function approvalPatchFor({ mode, body, now, user }) {
  if (mode === 'reject') {
    return {
      status: 'rejected',
      reviewed_at: now,
      reviewed_by: user.email || user.id || 'client',
      reason: clean(body.reason, 1000),
      updated_at: now,
    };
  }
  return {
    status: 'approved',
    reviewed_at: now,
    reviewed_by: user.email || user.id || 'client',
    edit_applied: mode === 'edit_approve',
    updated_at: now,
  };
}

module.exports = async function handler(req, res) {
  cors(res, req, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return bad(res, 405, 'Method not allowed');
  try {
    const { user, submissionId } = await requireClient(req);
    const body = bodyOf(req);
    const mode = clean(body.action, 40).toLowerCase();
    if (!['approve', 'edit_approve', 'reject'].includes(mode)) throw new Error('Invalid approval action.');
    const approvalId = id(body.approvalId, 'approval id');
    const client = await readClientRecord(submissionId);
    const clientId = client.client_id || client.id || submissionId;
    const approval = await readApproval(approvalId);
    ensureOwner(approval, clientId, submissionId);
    if (approval.status && approval.status !== 'pending') throw new Error('Approval is no longer pending.');
    const actionId = id(approval.action_id || approval.actionId || body.actionId, 'action id');
    const recoveryAction = await readAction(actionId);
    ensureOwner(recoveryAction, clientId, submissionId);
    if (recoveryAction.status && !['queued_for_approval', 'drafted', 'approved'].includes(recoveryAction.status)) throw new Error('Recovery action is not approvable.');
    const now = new Date().toISOString();
    const patchedAction = await patchRow('recovery_actions', actionId, actionPatchFor({ mode, body, now, user }));
    const patchedApproval = await patchRow('approval_requests', approvalId, approvalPatchFor({ mode, body, now, user }));
    return res.status(200).json({
      ok: true,
      action: mode,
      approvalId,
      actionId,
      status: mode === 'reject' ? 'rejected' : 'approved',
      actionStatus: patchedAction.status || null,
      approvalStatus: patchedApproval.status || null,
      sendQueued: mode !== 'reject',
      sent: false,
      gate: 'rrd-recover gate/send',
    });
  } catch (e) {
    return bad(res, e.status || 400, e && e.message ? e.message : String(e));
  }
};

module.exports._internals = { actionPatchFor, approvalPatchFor, clean };
