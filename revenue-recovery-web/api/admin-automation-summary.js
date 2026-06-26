const { cors, bad, rest, requireStaff } = require('./client-dashboard-common.js');

const SAFE_METHODS = 'GET, POST, OPTIONS';
const LIVE_STATUSES = new Set(['live', 'active', 'launched', 'in_recovery']);
const BLOCKED_INVOICE_STATUSES = new Set(['disputed', 'do_not_contact', 'escalated']);
const FAILING_INTEGRATION_STATUSES = new Set(['failed', 'revoked', 'needed']);
const FAILED_JOB_STATUSES = new Set(['failed', 'error', 'dead']);
const QUEUED_JOB_STATUSES = new Set(['queued', 'pending', 'retrying', 'running']);

function bodyOf(req) {
  if (!req?.body) return {};
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return req.body;
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

function list(value) { return Array.isArray(value) ? value : []; }
function statusOf(row) { return String(row?.status ?? row?.go_live_status ?? row?.health_status ?? '').toLowerCase(); }
function idOf(row) { return row?.id ?? row?.invoice_id ?? row?.invoiceId ?? null; }
function invoiceIdOf(row) { return row?.invoice_id ?? row?.invoiceId ?? row?.id ?? null; }

async function fetchAdminState() {
  const [clients, submissions, invoices, actions, approvals, integrations, jobs] = await Promise.all([
    rest('clients?select=*').catch(() => []),
    rest('submissions?select=*').catch(() => []),
    rest('invoices?select=*').catch(() => []),
    rest('recovery_actions?select=*').catch(() => []),
    rest('approval_requests?select=*').catch(() => []),
    rest('client_integrations?select=*').catch(() => []),
    rest('provision_jobs?select=*').catch(() => []),
  ]);
  return { clients, submissions, invoices, actions, approvals, integrations, jobs };
}

function buildAdminSummary(state = {}, options = {}) {
  const clients = list(state.clients).length ? list(state.clients) : list(state.submissions);
  const submissions = list(state.submissions);
  const invoices = list(state.invoices);
  const actions = list(state.actions ?? state.recovery_actions);
  const approvals = list(state.approvals ?? state.approval_requests);
  const integrations = list(state.integrations ?? state.client_integrations);
  const jobs = list(state.jobs ?? state.provision_jobs);

  const liveClients = clients.filter((client) => LIVE_STATUSES.has(statusOf(client))).length
    || submissions.filter((submission) => LIVE_STATUSES.has(statusOf(submission))).length;
  const blockedInvoices = invoices.filter((invoice) => BLOCKED_INVOICE_STATUSES.has(statusOf(invoice)));
  const blockedActions = actions.filter((action) => ['blocked', 'failed', 'needs_human'].includes(statusOf(action)));
  const pendingApprovals = approvals.filter((approval) => statusOf(approval) === 'pending');
  const failingIntegrations = integrations.filter((integration) => FAILING_INTEGRATION_STATUSES.has(statusOf(integration)));
  const failedJobs = jobs.filter((job) => FAILED_JOB_STATUSES.has(statusOf(job)));
  const queuedJobs = jobs.filter((job) => QUEUED_JOB_STATUSES.has(statusOf(job)));

  return sanitize({
    generatedAt: options.now ?? new Date().toISOString(),
    clients: {
      total: clients.length,
      live: liveClients,
      onboarding: Math.max(0, clients.length - liveClients),
    },
    blockers: {
      count: blockedInvoices.length + blockedActions.length,
      invoices: blockedInvoices.slice(0, 25).map((invoice) => ({ id: idOf(invoice), status: invoice.status, amountCents: invoice.amount_cents ?? invoice.amountCents ?? null, currency: invoice.currency ?? null })),
      actions: blockedActions.slice(0, 25).map((action) => ({ id: idOf(action), invoiceId: invoiceIdOf(action), status: action.status, reason: action.reason ?? action.blocked_reason ?? null })),
    },
    pendingApprovals: {
      count: pendingApprovals.length,
      items: pendingApprovals.slice(0, 25).map((approval) => ({ id: idOf(approval), actionId: approval.action_id ?? approval.actionId ?? null, requestedAt: approval.requested_at ?? approval.requestedAt ?? null })),
    },
    jobHealth: {
      total: jobs.length,
      failed: failedJobs.length,
      queued: queuedJobs.length,
      ok: failedJobs.length === 0,
    },
    integrationHealth: {
      total: integrations.length,
      failing: failingIntegrations.length,
      ok: failingIntegrations.length === 0,
      failingProviders: [...new Set(failingIntegrations.map((integration) => integration.provider ?? integration.kind).filter(Boolean))].sort(),
    },
  });
}

module.exports = async function handler(req, res) {
  cors(res, req, SAFE_METHODS);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST'].includes(req.method)) return bad(res, 405, 'Method not allowed');
  try {
    await requireStaff(req);
    const body = bodyOf(req);
    const state = req.automationState || await fetchAdminState();
    const summary = buildAdminSummary(state, { now: req?.query?.now ?? body.now });
    return res.status(200).json({ ok: true, summary });
  } catch (e) {
    return bad(res, e.status || 401, e && e.message ? e.message : String(e));
  }
};

module.exports._internals = { sanitize, fetchAdminState, buildAdminSummary };
