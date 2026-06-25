const { cors, bad, authAdmin, rest, requireClient } = require('./client-dashboard-common.js');

module.exports = async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return bad(res, 405, 'Method not allowed');
  try {
    const { user, submissionId } = await requireClient(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (body.action !== 'complete-reset') return bad(res, 400, 'Unsupported action.');
    const password = String(body.password || '');
    if (password.length < 12) return bad(res, 400, 'Use at least 12 characters for the new password.');
    await authAdmin(`admin/users/${encodeURIComponent(user.id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        password,
        app_metadata: { ...(user.app_metadata || {}), submission_id: submissionId, role: 'client', must_reset: false },
      }),
    });
    await rest(`client_accounts?user_id=eq.${encodeURIComponent(user.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ must_reset: false, initial_set_at: new Date().toISOString(), last_login_at: new Date().toISOString() }),
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return bad(res, e.status || 401, e && e.message ? e.message : String(e));
  }
};
