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
      const batch = pending.length ? createApprovalBatch(repo, { now, reviewerId: opts.reviewerId || null }) : null;
      return { dryRun, remindersQueued: batch?.actionIds?.length || 0, batch };
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main('approval-reminder', runApprovalReminder);
