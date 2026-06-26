#!/usr/bin/env node
import { runCronSkeleton, main } from './_runner.mjs';
import { recoveryActionKey } from '../src/lib/recovery/action-key.mjs';

function rejectDirectSend(opts) {
  const forbidden = ['directSender', 'sendEmail', 'sendSms', 'sendLetter', 'providerClient'];
  for (const key of forbidden) {
    if (opts && opts[key]) throw new Error(`send-dispatcher refuses direct provider sends (${key}); use rrd-recover gate/send boundary`);
  }
}

export async function dispatchViaRecover({ profile, action, recoverExecute, dryRun = true }) {
  if (!profile) throw new Error('profile required');
  if (!action || typeof action !== 'object') throw new Error('action required');
  if (!recoverExecute) return { skipped: true, reason: 'missing-recover-boundary', note: 'wire to rrd-recover.execute; never provider APIs' };
  return recoverExecute(profile, action, { send: dryRun ? false : true });
}

export async function runSendDispatcher(opts = {}) {
  rejectDirectSend(opts);
  return runCronSkeleton({
    jobName: 'send-dispatcher',
    opts,
    handler: async ({ dryRun }) => {
      const actions = Array.isArray(opts.actions) ? opts.actions : [];
      const results = [];
      for (const action of actions) {
        const key = action.actionKey || recoveryActionKey({
          profile: opts.profile,
          invoiceId: action.invoiceId,
          customerId: action.customerId || action.to?.email || action.to?.phone,
          channel: action.channel,
          rung: action.rung,
          amount: action.amount,
          currency: action.currency,
        });
        results.push({ actionKey: key, result: await dispatchViaRecover({ profile: opts.profile, action: { ...action, actionKey: key }, recoverExecute: opts.recoverExecute, dryRun }) });
      }
      return { dryRun, dispatched: results.length, results, boundary: 'rrd-recover gate/send only' };
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main('send-dispatcher', runSendDispatcher);
