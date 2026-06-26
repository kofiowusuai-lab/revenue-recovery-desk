#!/usr/bin/env node
import { runCronSkeleton, main } from './_runner.mjs';
import { automationRuntimeFrom } from '../src/lib/jobs/automation-runtime.mjs';
import { buildWeeklyRecoveryReport } from '../src/lib/reports/weekly-report.mjs';

export async function runWeeklyReport(opts = {}) {
  return runCronSkeleton({
    jobName: 'weekly-report',
    opts,
    handler: async ({ dryRun, now }) => {
      const runtime = automationRuntimeFrom(opts);
      const repo = runtime.loadState();
      const report = buildWeeklyRecoveryReport(repo, {
        weekStart: opts.weekStart,
        weekEnd: opts.weekEnd,
        generatedAt: now || new Date().toISOString(),
      });
      repo.reports.push({ type: 'weekly', status: report.shouldSend ? 'prepared' : 'skipped', report, createdAt: report.generatedAt });
      if (report.shouldSend && dryRun === false && typeof runtime.reportSend === 'function') {
        throw new Error('weekly-report requires an approved notification boundary; direct reportSend hooks are rejected');
      }
      return { dryRun, reportsPrepared: 1, shouldSend: report.shouldSend, sent: false, receipt: null, report };
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main('weekly-report', runWeeklyReport);
