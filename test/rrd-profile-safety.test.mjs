import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertSafeProfile, safeStateName } from '../rrd-profile-safety.mjs';
import { keyPaths, profileEnvPath } from '../rrd-vault-fs.mjs';
import { fileFor as usageFileFor } from '../rrd-usage.mjs';
import { statePath } from '../rrd-collections-state.mjs';
import { loadPolicy, resolvePostGridCredential } from '../rrd-recover.mjs';
import { loadManifest as collectLoadManifest, recover } from '../rrd-collect.mjs';
import { appendRecoveryEvents } from '../rrd-client-dashboard-core.mjs';

test('assertSafeProfile accepts only rr-prefixed profile names without traversal', () => {
  assert.equal(assertSafeProfile('rr-acme_01.prod'), 'rr-acme_01.prod');
  for (const bad of ['acme', 'rr-../default', '../rr-acme', 'rr-acme/foo', 'rr-acme\\foo', 'rr-', '']) {
    assert.throws(() => assertSafeProfile(bad), /Unsafe profile/);
  }
});

test('vault filesystem paths reject traversal profiles', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-profile-'));
  assert.throws(() => keyPaths('../recoverydesk', { home }), /Unsafe profile/);
  assert.throws(() => profileEnvPath('rr-../recoverydesk', { home }), /Unsafe profile/);
  const envPath = profileEnvPath('rr-acme', { home });
  assert.equal(envPath, path.join(home, '.hermes', 'profiles', 'rr-acme', '.env'));
});

test('usage and collections paths reject traversal profile names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-state-'));
  assert.throws(() => usageFileFor('rr-../evil', { dir }), /Unsafe profile/);
  assert.throws(() => statePath('../evil', { dir }), /Unsafe profile/);
  assert.equal(statePath('rr-acme', { dir }), path.join(dir, 'rr-acme.json'));
});

test('safeStateName allows non-profile lock/state names but rejects separators', () => {
  assert.equal(safeStateName('retainer-poller'), 'retainer-poller');
  assert.throws(() => safeStateName('../retainer'), /Unsafe state name/);
});

test('recovery executor rejects traversal profiles before profile filesystem reads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-recover-safe-'));
  assert.throws(() => loadPolicy('rr-../evil'), /Unsafe profile/);
  assert.throws(() => resolvePostGridCredential('rr-../evil', { profilesDir: dir, operatorEnvPath: path.join(dir, 'operator.env'), env: {} }), /Unsafe profile/);
});

test('collect and dashboard event paths reject traversal profiles while preserving rr names', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-events-safe-'));
  assert.throws(() => collectLoadManifest('rr-../evil'), /Unsafe profile/);
  await assert.rejects(() => recover('rr-../evil', {
    deps: { manifest: { company: 'Acme' }, listInvoices: async () => [], executeImpl: async () => ({}) }
  }), /Unsafe profile/);
  assert.throws(() => appendRecoveryEvents('rr-../evil', {
    manifest: { submissionId: '22222222-2222-4222-8222-222222222222' },
    results: [{ invoiceId: 'in_1', outcome: 'sent' }]
  }, { dir }), /Unsafe profile/);
  const ok = appendRecoveryEvents('rr-acme.prod_1', {
    manifest: { submissionId: '22222222-2222-4222-8222-222222222222' },
    results: [{ invoiceId: 'in_1', outcome: 'sent' }]
  }, { dir });
  assert.equal(ok.written, 1);
  assert.equal(fs.existsSync(path.join(dir, 'rr-acme.prod_1.ndjson')), true);
});

test('shell wrappers reject traversal profiles before sourcing profile env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-wrapper-safe-'));
  const env = { ...process.env, HERMES_PROFILES_DIR: dir, RRD_OPERATOR_HOME: '/Users/AIAgenterminal' };
  assert.throws(() => execFileSync('/Users/AIAgenterminal/rrd-collect', ['recover', 'rr-../evil'], { env, encoding: 'utf8', stdio: 'pipe' }), /Invalid recovery profile name/);
  assert.throws(() => execFileSync('/Users/AIAgenterminal/rrd-letter', ['--profile', 'rr-../evil', 'send', '{}'], { env, encoding: 'utf8', stdio: 'pipe' }), /Invalid recovery profile name/);
  assert.throws(() => execFileSync('/Users/AIAgenterminal/rrd-recover', ['send', 'rr-../evil', '{}'], { env, encoding: 'utf8', stdio: 'pipe' }), /Invalid recovery profile name/);
});
