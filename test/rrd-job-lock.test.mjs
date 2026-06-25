import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireJobLock, lockPath, withJobLock } from '../rrd-job-lock.mjs';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-lock-test-')); }

test('job lock blocks overlapping acquisition and releases cleanly', () => {
  const dir = tmpDir();
  const a = acquireJobLock('rrd-vault-watch', { dir });
  assert.ok(fs.existsSync(lockPath('rrd-vault-watch', { dir })));
  assert.throws(() => acquireJobLock('rrd-vault-watch', { dir }), /Job lock active/);
  assert.equal(a.release(), true);
  const b = acquireJobLock('rrd-vault-watch', { dir });
  assert.equal(b.release(), true);
});

test('job lock rejects traversal names', () => {
  const dir = tmpDir();
  assert.throws(() => acquireJobLock('../rrd-vault-watch', { dir }), /Unsafe lock name/);
});

test('stale job lock is replaced conservatively by age', () => {
  const dir = tmpDir();
  const file = lockPath('rrd-onboarding-email-watch', { dir });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ token: 'old', startedAt: new Date(Date.now() - 3600_000).toISOString() }));
  const lock = acquireJobLock('rrd-onboarding-email-watch', { dir, staleMs: 1000 });
  assert.notEqual(lock.token, 'old');
  assert.equal(lock.release(), true);
});

test('withJobLock releases after throw', async () => {
  const dir = tmpDir();
  await assert.rejects(withJobLock('rrd-test-job', async () => { throw new Error('boom'); }, { dir }), /boom/);
  const lock = acquireJobLock('rrd-test-job', { dir });
  assert.equal(lock.release(), true);
});
