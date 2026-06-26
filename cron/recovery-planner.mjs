#!/usr/bin/env node
import { runCronSkeleton, main } from './_runner.mjs';
import { automationRuntimeFrom } from '../src/lib/jobs/automation-runtime.mjs';
import { createApprovalBatch, ensureRecoveryThread, planNextRecoveryAction } from '../src/lib/recovery/pipeline.mjs';

export async function runRecoveryPlanner(opts = {}) {
  return runCronSkeleton({
    jobName: 'recovery-planner',
    opts,
    handler: async ({ dryRun, now }) => {
      const runtime = automationRuntimeFrom(opts);
      const repo = runtime.loadState();
      const before = new Set(repo.actions.map((action) => action.id));
      const planned = [];
      for (const invoice of repo.invoices) {
        if (Number(invoice.amountDue || 0) <= 0 || ['paid', 'do_not_contact', 'disputed', 'escalated', 'written_off'].includes(invoice.status)) continue;
        ensureRecoveryThread(repo, invoice, { now });
        const action = planNextRecoveryAction(repo, { invoiceId: invoice.id, now, policy: opts.policy });
        if (action && !before.has(action.id)) planned.push(action);
      }
      const batch = planned.length ? createApprovalBatch(repo, { now, reviewerId: opts.reviewerId || null }) : null;
      return { dryRun, planned: planned.length, approvalsQueued: batch?.actionIds?.length || 0, batch, actions: planned };
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main('recovery-planner', runRecoveryPlanner);
