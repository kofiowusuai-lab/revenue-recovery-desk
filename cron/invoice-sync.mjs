#!/usr/bin/env node
import { runCronSkeleton, main } from './_runner.mjs';

export async function runInvoiceSync(opts = {}) {
  return runCronSkeleton({ jobName: 'invoice-sync', opts, handler: async ({ dryRun }) => ({ dryRun, synced: 0, note: 'skeleton: sync invoice snapshots idempotently; no outreach dispatch' }) });
}

if (import.meta.url === `file://${process.argv[1]}`) main('invoice-sync', runInvoiceSync);
