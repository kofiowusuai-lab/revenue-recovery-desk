import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { credentialFilesForProfile, overwriteAndUnlink } from '../rrd-agent.mjs';

test('credentialFilesForProfile includes env backups and vault key variants only for the target profile', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-creds-'));
  const profile = 'rr-acme';
  const profileDir = path.join(home, '.hermes', 'profiles', profile);
  const keyDir = path.join(home, '.hermes', 'vault', 'keys');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(keyDir, { recursive: true });
  for (const f of ['.env', '.env.bak', '.env.bak-20260623', '.env.bak20260623', '.env.backup-old', '.env.old', '.env.orig', '.env.save', '.env~', '.env.local', '.env.production', '.env-previous', 'notes.txt', '.envrc']) {
    fs.writeFileSync(path.join(profileDir, f), 'secret-ish');
  }
  for (const f of ['rr-acme.pem', 'rr-acme.pub.pem', 'rr-acme.pem.bak', 'rr-acme.pub.pem.old', 'rr-acme.pem~', 'rr-acme.pem-bak', 'rr-acme.pub.pem~', 'rr-acme.pub.pem-bak', 'rr-acme.pemevil', 'rr-acme.pub.pemevil', 'rr-other.pem']) {
    fs.writeFileSync(path.join(keyDir, f), 'key-ish');
  }

  const basenames = credentialFilesForProfile(profile, { home }).map((f) => path.basename(f)).sort();
  assert.deepEqual(basenames, [
    '.env',
    '.env.bak',
    '.env.bak-20260623',
    '.env.bak20260623',
    '.env.backup-old',
    '.env.old',
    '.env.orig',
    '.env.production',
    '.env.save',
    '.env-previous',
    '.env~',
    '.env.local',
    'rr-acme.pem',
    'rr-acme.pem.bak',
    'rr-acme.pem-bak',
    'rr-acme.pem~',
    'rr-acme.pub.pem',
    'rr-acme.pub.pem-bak',
    'rr-acme.pub.pem~',
    'rr-acme.pub.pem.old'
  ].sort());
});

test('credentialFilesForProfile rejects path traversal profile names', () => {
  assert.throws(() => credentialFilesForProfile('../rr-acme', { home: os.tmpdir() }), /Unsafe profile/);
  assert.throws(() => credentialFilesForProfile('rr-acme/../../x', { home: os.tmpdir() }), /Unsafe profile/);
});

test('overwriteAndUnlink removes credential files without exposing values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-unlink-'));
  const file = path.join(dir, '.env.bak-1');
  fs.writeFileSync(file, 'VERY_SECRET_VALUE');
  const result = overwriteAndUnlink(file);
  assert.equal(result.existed, true);
  assert.equal(result.removed, true);
  assert.equal(fs.existsSync(file), false);
  assert.equal(JSON.stringify(result).includes('VERY_SECRET_VALUE'), false);
});

test('overwriteAndUnlink unlinks symlink credentials without overwriting the target', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-symlink-'));
  const target = path.join(dir, 'target.txt');
  const link = path.join(dir, '.env.bak-symlink');
  fs.writeFileSync(target, 'DO_NOT_ZERO');
  fs.symlinkSync(target, link);
  const result = overwriteAndUnlink(link);
  assert.equal(result.existed, true);
  assert.equal(result.removed, true);
  assert.equal(result.skippedOverwrite, 'symlink');
  assert.equal(fs.existsSync(link), false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'DO_NOT_ZERO');
});

test('overwriteAndUnlink removes dangling symlink credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-dangling-symlink-'));
  const link = path.join(dir, '.env.bak-dangling');
  fs.symlinkSync(path.join(dir, 'missing-target'), link);
  const result = overwriteAndUnlink(link);
  assert.equal(result.existed, true);
  assert.equal(result.removed, true);
  assert.equal(result.skippedOverwrite, 'symlink');
  assert.equal(fs.existsSync(link), false);
  assert.equal(fs.lstatSync(dir).isDirectory(), true);
});

test('credentialFilesForProfile rejects a symlinked profile directory before listing secrets', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-parent-symlink-'));
  const outside = path.join(home, 'outside-profile');
  const profileParent = path.join(home, '.hermes', 'profiles');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, '.env.bak-evil'), 'DO_NOT_TOUCH');
  fs.mkdirSync(profileParent, { recursive: true });
  fs.symlinkSync(outside, path.join(profileParent, 'rr-acme'));
  assert.throws(() => credentialFilesForProfile('rr-acme', { home }), /credential .*symlink/);
  assert.equal(fs.readFileSync(path.join(outside, '.env.bak-evil'), 'utf8'), 'DO_NOT_TOUCH');
});

test('credentialFilesForProfile rejects symlinks in parent path components', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-ancestor-symlink-'));
  const outside = path.join(home, 'outside-hermes');
  fs.mkdirSync(path.join(outside, 'profiles', 'rr-acme'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'profiles', 'rr-acme', '.env.bak-evil'), 'DO_NOT_TOUCH');
  fs.symlinkSync(outside, path.join(home, '.hermes'));
  assert.throws(() => credentialFilesForProfile('rr-acme', { home }), /credential path component is a symlink/);
  assert.equal(fs.readFileSync(path.join(outside, 'profiles', 'rr-acme', '.env.bak-evil'), 'utf8'), 'DO_NOT_TOUCH');
});

test('overwriteAndUnlink refuses root-scoped deletion through symlinked parent components', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-delete-parent-symlink-'));
  const outside = path.join(home, 'outside-hermes');
  fs.mkdirSync(path.join(outside, 'profiles', 'rr-acme'), { recursive: true });
  const outsideSecret = path.join(outside, 'profiles', 'rr-acme', '.env.bak-evil');
  fs.writeFileSync(outsideSecret, 'DO_NOT_DELETE');
  fs.symlinkSync(outside, path.join(home, '.hermes'));
  assert.throws(
    () => overwriteAndUnlink(path.join(home, '.hermes', 'profiles', 'rr-acme', '.env.bak-evil'), { root: home }),
    /credential path component is a symlink/
  );
  assert.equal(fs.readFileSync(outsideSecret, 'utf8'), 'DO_NOT_DELETE');
});
