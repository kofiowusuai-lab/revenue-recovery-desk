#!/usr/bin/env node
import { runCronSkeleton, main } from './_runner.mjs';
import { automationRuntimeFrom } from '../src/lib/jobs/automation-runtime.mjs';
import { dispatchApprovedScheduledActions } from '../src/lib/recovery/pipeline.mjs';
import { recoveryActionKey } from '../src/lib/recovery/action-key.mjs';

function rejectDirectSend(opts) {
  const forbidden = ['directSender', 'sendEmail', 'sendSms', 'sendLetter', 'providerClient', 'providerSend', 'send', 'directSend'];
  for (const key of forbidden) {
    if (opts && opts[key]) throw new Error(`send-dispatcher refuses direct provider sends (${key}); use rrd-recover gate/send boundary`);
  }
}

export async function dispatchViaRecover({ profile, action, recoverExecute, dryRun = true }) {
  if (!profile) throw new Error('profile required');
  if (!action || typeof action !== 'object') throw new Error('action required');
  if (typeof recoverExecute !== 'function') throw new Error('recoverExecute boundary is required; direct provider hooks are rejected');
  return recoverExecute(profile, Object.freeze({ ...action }), { send: dryRun ? false : true, dryRun });
}

export async function runSendDispatcher(opts = {}) {
  rejectDirectSend(opts);
  return runCronSkeleton({
    jobName: 'send-dispatcher',
    opts,
    handler: async ({ dryRun, now }) => {
      const runtime = automationRuntimeFrom(opts);
      const repo = runtime.loadState();
      const recoverExecute = opts.recoverExecute || runtime.recoverExecute;

      // Backwards-compatible explicit action dispatch path used by the existing
      // job foundation tests and manual dry-runs. It still goes only through the
      // rrd-recover boundary and never through provider clients.
      if (Array.isArray(opts.actions) && opts.actions.length) {
        const results = [];
        for (const action of opts.actions) {
          const actionKey = action.actionKey || recoveryActionKey({
            profile: opts.profile,
            invoiceId: action.invoiceId,
            customerId: action.customerId || action.to?.email || action.to?.phone,
            channel: action.channel,
            rung: action.rung,
            amount: action.amount,
            currency: action.currency,
          });
          results.push({
            actionKey,
            result: await dispatchViaRecover({ profile: opts.profile, action: { ...action, actionKey }, recoverExecute, dryRun }),
          });
        }
        return { dryRun, dispatched: results.length, blocked: 0, results, boundary: 'rrd-recover gate/send only' };
      }

      const recoverBoundary = typeof recoverExecute === 'function'
        ? (action, context) => recoverExecute(action, { ...context, dryRun, send: dryRun === false })
        : recoverExecute;
      const result = await dispatchApprovedScheduledActions(repo, { now, recoverExecute: recoverBoundary, dryRun });
      return {
        dryRun,
        dispatched: result.sent.length,
        blocked: result.blocked.length,
        results: result.sent,
        result,
        boundary: 'rrd-recover gate/send only',
      };
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main('send-dispatcher', runSendDispatcher);
