#!/usr/bin/env node
import { runCronSkeleton, main } from './_runner.mjs';
import { automationRuntimeFrom } from '../src/lib/jobs/automation-runtime.mjs';
import { reconcilePayment } from '../src/lib/recovery/pipeline.mjs';

export async function runPaymentReconcile(opts = {}) {
  return runCronSkeleton({
    jobName: 'payment-reconcile',
    opts,
    handler: async ({ dryRun, now }) => {
      const runtime = automationRuntimeFrom(opts);
      const repo = runtime.loadState();
      const payments = opts.payments || await runtime.listPayments();
      const results = [];
      for (const payment of payments) results.push(reconcilePayment(repo, payment, { now }));
      return { dryRun, reconciled: results.length, cancelled: results.flatMap((row) => row.cancelled || []).length, results };
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main('payment-reconcile', runPaymentReconcile);
