const COLLECTIONS = Object.freeze([
  'invoices',
  'threads',
  'actions',
  'approvalBatches',
  'replies',
  'payments',
  'reports',
]);

function ensureCollections(repo) {
  if (!repo || typeof repo !== 'object') throw new Error('automation runtime requires a repository-like state object');
  for (const name of COLLECTIONS) {
    if (!Array.isArray(repo[name])) repo[name] = [];
  }
  return repo;
}

async function callProvider(provider, names, fallback = []) {
  for (const name of names) {
    if (typeof provider?.[name] === 'function') return provider[name]();
  }
  return fallback;
}

export function createAutomationRuntime({ state = {}, repo = state, provider = {}, recoverExecute = null, reportSend = null } = {}) {
  const runtime = {
    repo: ensureCollections(repo),
    provider,
    recoverExecute,
    reportSend,
    loadState() {
      return this.repo;
    },
    setState(nextState) {
      this.repo = ensureCollections(nextState);
      return this.repo;
    },
    async listInvoices() {
      return callProvider(this.provider, ['listInvoices', 'fetchInvoices', 'invoices']);
    },
    async listPayments() {
      return callProvider(this.provider, ['listPayments', 'fetchPayments', 'payments']);
    },
    async listReplies() {
      return callProvider(this.provider, ['listReplies', 'fetchReplies', 'replies']);
    },
  };
  return runtime;
}

export function automationRuntimeFrom(opts = {}) {
  if (opts.runtime) return opts.runtime;
  return createAutomationRuntime({
    state: opts.state || opts.repo || {},
    provider: opts.provider || {},
    recoverExecute: opts.recoverExecute || null,
    reportSend: opts.reportSend || null,
  });
}

export function loadAutomationState(opts = {}) {
  return automationRuntimeFrom(opts).loadState();
}
