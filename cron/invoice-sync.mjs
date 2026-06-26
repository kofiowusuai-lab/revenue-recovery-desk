#!/usr/bin/env node
import { runCronSkeleton, main } from './_runner.mjs';
import { automationRuntimeFrom } from '../src/lib/jobs/automation-runtime.mjs';
import { syncProviderInvoices } from '../src/lib/recovery/pipeline.mjs';

export async function runInvoiceSync(opts = {}) {
  return runCronSkeleton({
    jobName: 'invoice-sync',
    opts,
    handler: async ({ dryRun, now }) => {
      const runtime = automationRuntimeFrom(opts);
      const repo = runtime.loadState();
      const providerInvoices = opts.providerInvoices || await runtime.listInvoices();
      const result = await syncProviderInvoices(repo, providerInvoices, { now, policy: opts.policy });
      return {
        dryRun,
        synced: result.invoices.length,
        threadsCreated: result.threads.length,
        actionsQueued: result.actions.length,
        invoiceIds: result.invoices.map((invoice) => invoice.id),
        threadIds: result.threads.map((thread) => thread.id),
        actionIds: result.actions.map((action) => action.id),
      };
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main('invoice-sync', runInvoiceSync);
