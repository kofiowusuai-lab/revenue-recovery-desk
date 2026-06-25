const { cors, bad, rest, authAdmin, requireStaff, initialClientPassword, sendEmail, WEB_BASE } = require('./client-dashboard-common.js');

module.exports = async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return bad(res, 405, 'Method not allowed');
  try {
    const staff = await requireStaff(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const sid = String(body.submission_id || body.submissionId || '').trim();
    if (!sid) return bad(res, 400, 'submission_id is required.');
    const accounts = await rest(`client_accounts?submission_id=eq.${encodeURIComponent(sid)}&select=*`);
    if (!accounts?.length) return bad(res, 404, 'No client account exists for this submission yet.');
    const account = accounts[0];
    const tempPassword = initialClientPassword();
    await authAdmin(`admin/users/${encodeURIComponent(account.user_id)}`, {
      method: 'PUT',
      body: JSON.stringify({ password: tempPassword, app_metadata: { submission_id: sid, role: 'client', must_reset: true } }),
    });
    await rest(`client_accounts?user_id=eq.${encodeURIComponent(account.user_id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ must_reset: true, created_by: staff.email || 'operator' }),
    });
    await sendEmail(account.email, `Temporary FlowAudit dashboard password — ${account.company || 'Revenue Recovery Desk'}`, `Hi,\n\nYour FlowAudit client dashboard password was reset.\n\nDashboard: ${WEB_BASE}/client\nEmail: ${account.email}\nTemporary password: ${tempPassword}\n\nYou will be asked to set a new password on sign-in.\n\nRevenue Recovery Desk\n`);
    return res.status(200).json({ ok: true, email: account.email, mustReset: true, passwordDelivered: true, delivery: 'email', agentmailAccepted: true });
  } catch (e) {
    return bad(res, e.status || 500, e && e.message ? e.message : String(e));
  }
};
