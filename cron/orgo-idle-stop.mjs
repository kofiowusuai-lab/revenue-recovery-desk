#!/usr/bin/env node
import { runCronSkeleton, main } from './_runner.mjs';

export async function runOrgoIdleStop(opts = {}) {
  return runCronSkeleton({ jobName: 'orgo-idle-stop', opts, handler: async ({ dryRun }) => ({ dryRun, stopped: 0, note: 'skeleton: stop idle Orgo desktops only after explicit idle checks' }) });
}

if (import.meta.url === `file://${process.argv[1]}`) main('orgo-idle-stop', runOrgoIdleStop);
