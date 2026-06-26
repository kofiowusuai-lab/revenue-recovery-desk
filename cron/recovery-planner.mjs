#!/usr/bin/env node
import { runCronSkeleton, main } from './_runner.mjs';

export async function runRecoveryPlanner(opts = {}) {
  return runCronSkeleton({ jobName: 'recovery-planner', opts, handler: async ({ dryRun }) => ({ dryRun, planned: 0, note: 'skeleton: build recovery decisions/drafts with action keys; never send directly' }) });
}

if (import.meta.url === `file://${process.argv[1]}`) main('recovery-planner', runRecoveryPlanner);
