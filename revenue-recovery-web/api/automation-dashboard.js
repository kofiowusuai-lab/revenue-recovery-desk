const { cors, bad, rest, requireClient } = require('./client-dashboard-common.js');

const SAFE_METHODS = 'GET, POST, OPTIONS';

function bodyOf(req) {
  if (!req?.body) return {};
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return req.body;
}

function optionsOf(req) {
  const body = bodyOf(req);
  return {
    now: req?.query?.now ?? body.now,
    weekStart: req?.query?.weekStart ?? body.weekStart,
    weekEnd: req?.query?.weekEnd ?? body.weekEnd,
    generatedAt: req?.query?.generatedAt ?? body.generatedAt ?? req?.query?.now ?? body.now,
  };
}

function denySecretKey(key) {
  return /secret|token|password|credential|authorization|api[_-]?key|access[_-]?key|refresh[_-]?key|private[_-]?key|body|raw|config|error/i.test(String(key));
}

function secretLookingValue(value) {
  return /sk_(live|test)_[a-z0-9_\-]+|xox[baprs]-|secret[_-]?token|bearer\s+[a-z0-9._\-]+|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(String(value));
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === 'string') return secretLookingValue(value) ? '[redacted]' : value;
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    if (denySecretKey(key)) continue;
    out[key] = sanitize(inner);
  }
  return out;
}

async function fetchClientState(submissionId) {
  const encoded = encodeURIComponent(submissionId);
  const submissions = await rest(`submissions?id=eq.${encoded}&select=*`);
  const submission = submissions?.[0] || {};
  const clientId = submission.client_id || submission.clientId || submissionId;
  const clientFilter = encodeURIComponent(clientId);
  const rows = (table) => rest(`${table}?client_id=eq.${clientFilter}&select=*`)
    .catch(() => rest(`${table}?submission_id=eq.${encoded}&select=*`))
    .catch(() => []);
  const [invoices, payments, actions, approvals, replies, integrations] = await Promise.all([
    rows('invoices'),
    rows('payments'),
    rows('recovery_actions'),
    rows('approval_requests'),
    rows('customer_replies'),
    rows('client_integrations'),
  ]);
  return { submission, invoices, payments, actions, approvals, replies, integrations };
}

async function buildResponse(state, options) {
  const [{ buildDashboardProjection }, { buildWeeklyRecoveryReport }] = await Promise.all([
    import('../../src/lib/client-state/dashboard-view.mjs'),
    import('../../src/lib/reports/weekly-report.mjs'),
  ]);
  const dashboard = buildDashboardProjection(state, options);
  const report = buildWeeklyRecoveryReport(state, {
    weekStart: options.weekStart,
    weekEnd: options.weekEnd,
    generatedAt: options.generatedAt ?? options.now ?? new Date().toISOString(),
  });
  return { dashboard: sanitize(dashboard), report: sanitize(report) };
}

module.exports = async function handler(req, res) {
  cors(res, req, SAFE_METHODS);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST'].includes(req.method)) return bad(res, 405, 'Method not allowed');
  try {
    const { submissionId } = await requireClient(req);
    const state = req.automationState || await fetchClientState(submissionId);
    const payload = await buildResponse(state, optionsOf(req));
    return res.status(200).json({ ok: true, submissionId, ...payload });
  } catch (e) {
    return bad(res, e.status || 401, e && e.message ? e.message : String(e));
  }
};

module.exports._internals = { sanitize, fetchClientState, buildResponse };
