#!/usr/bin/env node
import { runCronSkeleton, main } from './_runner.mjs';

export async function runReplyMonitor(opts = {}) {
  return runCronSkeleton({ jobName: 'reply-monitor', opts, handler: async ({ dryRun }) => ({ dryRun, repliesChecked: 0, note: 'skeleton: ingest replies and create escalation/stop/dispute records; no sends' }) });
}

if (import.meta.url === `file://${process.argv[1]}`) main('reply-monitor', runReplyMonitor);
