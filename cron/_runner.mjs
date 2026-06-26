import { createJobLocker } from '../src/lib/jobs/lock.mjs';
import { startAgentRun, finishAgentRun } from '../src/lib/jobs/audit.mjs';
import { verifyCronSecret } from '../src/lib/security/cron-secret.mjs';

export function cliOptions(argv = process.argv.slice(2), env = process.env) {
  const opts = { env, argv };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profile') opts.profile = argv[++i];
    else if (a === '--secret') opts.secret = argv[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--live') opts.dryRun = false;
    else if (a === '--approval-to') opts.approvalTo = argv[++i];
  }
  opts.secret ||= env.RRD_CRON_SECRET_PROVIDED;
  opts.profile ||= env.RRD_PROFILE || null;
  opts.dryRun ??= env.RRD_CRON_LIVE !== '1';
  return opts;
}

export async function runCronSkeleton({ jobName, handler, opts = {}, locker = createJobLocker(), requireSecret = true } = {}) {
  if (!jobName) throw new Error('jobName required');
  if (requireSecret) {
    const secret = verifyCronSecret({ provided: opts.secret, env: opts.env || process.env, secretEnvName: opts.secretEnvName || 'RRD_CRON_SECRET' });
    if (!secret.ok) return { ok: false, status: 'blocked', reason: secret.reason, jobName };
  }

  return locker.withLock(jobName, async (lock) => {
    const run = startAgentRun({ jobName, profile: opts.profile || null, meta: { dryRun: opts.dryRun !== false } });
    try {
      const result = await handler({ ...opts, lock, dryRun: opts.dryRun !== false });
      finishAgentRun(run, { status: 'ok', result });
      return { ok: true, status: 'ok', jobName, result };
    } catch (error) {
      finishAgentRun(run, { status: 'error', error });
      return { ok: false, status: 'error', jobName, error: error.message || String(error) };
    }
  });
}

export async function main(jobName, runFn) {
  const result = await runFn(cliOptions());
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
