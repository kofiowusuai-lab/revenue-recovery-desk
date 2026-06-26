import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryJobLockStore, createJobLocker, buildAcquireJobLockSql, buildReleaseJobLockSql } from '../src/lib/jobs/lock.mjs';
import { actionKey, canonicalJson, recoveryActionKey } from '../src/lib/recovery/action-key.mjs';
import { verifyCronSecret, assertCronSecret } from '../src/lib/security/cron-secret.mjs';
import { runSendDispatcher } from '../cron/send-dispatcher.mjs';

test('memory job lock acquires once, blocks overlap, and releases by token only', async () => {
  const store = createMemoryJobLockStore();
  const first = store.acquire('invoice-sync', { token: 'a' });
  assert.equal(first.acquired, true);
  const second = store.acquire('invoice-sync', { token: 'b' });
  assert.equal(second.acquired, false);
  assert.equal(second.reason, 'active');
  assert.equal(store.release('invoice-sync', 'wrong'), false);
  assert.equal(store.release('invoice-sync', 'a'), true);
  assert.equal(store.acquire('invoice-sync', { token: 'c' }).acquired, true);
});

test('memory job lock replaces stale locks', () => {
  let t = 1_000;
  const store = createMemoryJobLockStore({ clock: { now: () => t } });
  assert.equal(store.acquire('health-watch', { token: 'old', staleMs: 100 }).acquired, true);
  t = 1_200;
  const next = store.acquire('health-watch', { token: 'new', staleMs: 100 });
  assert.equal(next.acquired, true);
  assert.equal(store.get('health-watch').token, 'new');
});

test('job locker withLock releases after successful callback', async () => {
  const locker = createJobLocker();
  const out = await locker.withLock('weekly-report', async (lock) => ({ token: lock.token }));
  assert.ok(out.token);
  const again = await locker.acquire('weekly-report');
  assert.equal(again.acquired, true);
});

test('SQL lock builders expose acquire and compare-and-release operations', () => {
  assert.match(buildAcquireJobLockSql().text, /on conflict/i);
  assert.match(buildAcquireJobLockSql().text, /lock_key/i);
  assert.match(buildAcquireJobLockSql().text, /locked_until < now\(\)/i);
  assert.match(buildAcquireJobLockSql().text, /metadata->>'token' as token/i);
  assert.match(buildReleaseJobLockSql().text, /where lock_key = \$1 and metadata->>'token' = \$2/i);
});

test('action keys are deterministic and canonicalize object key order', () => {
  const a = actionKey({ invoiceId: 'INV-1', nested: { b: 2, a: 1 } });
  const b = actionKey({ nested: { a: 1, b: 2 }, invoiceId: 'INV-1' });
  assert.equal(a, b);
  assert.equal(canonicalJson({ z: undefined, b: 2, a: 1 }), '{"a":1,"b":2}');
});

test('recoveryActionKey changes when idempotency dimensions change', () => {
  const email = recoveryActionKey({ profile: 'rr-acme', invoiceId: '1', channel: 'Email', rung: 1 });
  const sms = recoveryActionKey({ profile: 'rr-acme', invoiceId: '1', channel: 'SMS', rung: 1 });
  assert.notEqual(email, sms);
});

test('cron secret verification fails closed and accepts exact secret', () => {
  assert.deepEqual(verifyCronSecret({ provided: 'x', env: {} }), { ok: false, reason: 'missing-expected-secret' });
  assert.deepEqual(verifyCronSecret({ provided: '', env: { RRD_CRON_SECRET: 'x' } }), { ok: false, reason: 'missing-provided-secret' });
  assert.equal(verifyCronSecret({ provided: 'secret', env: { RRD_CRON_SECRET: 'secret' } }).ok, true);
  assert.equal(verifyCronSecret({ provided: 'Secret', env: { RRD_CRON_SECRET: 'secret' } }).ok, false);
  assert.throws(() => assertCronSecret({ provided: 'bad', env: { RRD_CRON_SECRET: 'good' } }), /Cron secret check failed/);
});

test('send-dispatcher refuses direct provider send hooks', async () => {
  await assert.rejects(
    runSendDispatcher({ secret: 's', env: { RRD_CRON_SECRET: 's' }, directSender: async () => {} }),
    /refuses direct provider sends/
  );
});

test('send-dispatcher uses rrd-recover boundary in dry-run mode', async () => {
  const calls = [];
  const res = await runSendDispatcher({
    profile: 'rr-acme',
    secret: 's',
    env: { RRD_CRON_SECRET: 's' },
    actions: [{ invoiceId: 'INV-1', channel: 'Email', to: { email: 'a@example.com' } }],
    recoverExecute: async (profile, action, opts) => { calls.push({ profile, action, opts }); return { sent: false, wouldSend: true }; },
  });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.send, false);
  assert.ok(calls[0].action.actionKey);
});
