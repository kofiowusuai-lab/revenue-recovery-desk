#!/usr/bin/env node
import { runCronSkeleton, main } from './_runner.mjs';

export async function runPaymentReconcile(opts = {}) {
  return runCronSkeleton({ jobName: 'payment-reconcile', opts, handler: async ({ dryRun }) => ({ dryRun, reconciled: 0, note: 'skeleton: reconcile payment state idempotently; records only' }) });
}

if (import.meta.url === `file://${process.argv[1]}`) main('payment-reconcile', runPaymentReconcile);
