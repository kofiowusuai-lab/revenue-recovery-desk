#!/usr/bin/env node
import { runCronSkeleton, main } from './_runner.mjs';
import { automationRuntimeFrom } from '../src/lib/jobs/automation-runtime.mjs';
import { handleInboundReply } from '../src/lib/recovery/pipeline.mjs';

export async function runReplyMonitor(opts = {}) {
  return runCronSkeleton({
    jobName: 'reply-monitor',
    opts,
    handler: async ({ dryRun, now }) => {
      const runtime = automationRuntimeFrom(opts);
      const repo = runtime.loadState();
      const replies = opts.replies || await runtime.listReplies();
      const records = [];
      for (const reply of replies) records.push(await handleInboundReply(repo, reply, { now, classify: opts.classify }));
      return { dryRun, repliesChecked: replies.length, ingested: records.length, records };
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main('reply-monitor', runReplyMonitor);
