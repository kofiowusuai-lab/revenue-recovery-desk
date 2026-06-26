#!/usr/bin/env node
import { runCronSkeleton, main } from './_runner.mjs';
import { automationRuntimeFrom } from '../src/lib/jobs/automation-runtime.mjs';
import { createApprovalBatch } from '../src/lib/recovery/pipeline.mjs';

export async function runApprovalReminder(opts = {}) {
  return runCronSkeleton({
    jobName: 'approval-reminder',
    opts,
    handler: async ({ dryRun, now }) => {
      const runtime = automationRuntimeFrom(opts);
      const repo = runtime.loadState();
      const pending = repo.actions.filter((action) => action.status === 'queued_for_approval' && !action.approvalBatchId);
      const approvalTo = opts.approvalTo || opts.env?.RRD_APPROVAL_TO_EMAIL || opts.reviewerId || 'Kofi@traqd.io';
      const batch = pending.length ? createApprovalBatch(repo, { now, reviewerId: approvalTo }) : null;
      return {
        dryRun,
        approvalTo,
        remindersQueued: batch?.actionIds?.length || 0,
        batch: batch ? { id: batch.id, reviewerId: batch.reviewerId, actionIds: batch.actionIds, status: batch.status } : null,
      };
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main('approval-reminder', runApprovalReminder);
