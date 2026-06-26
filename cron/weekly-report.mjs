#!/usr/bin/env node
import { runCronSkeleton, main } from './_runner.mjs';

export async function runWeeklyReport(opts = {}) {
  return runCronSkeleton({ jobName: 'weekly-report', opts, handler: async ({ dryRun }) => ({ dryRun, reportsPrepared: 0, note: 'skeleton: prepare report records; dispatch must remain behind approved notification boundary' }) });
}

if (import.meta.url === `file://${process.argv[1]}`) main('weekly-report', runWeeklyReport);
