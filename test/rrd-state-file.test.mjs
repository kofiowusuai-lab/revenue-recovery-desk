import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadJsonState, writeJsonState } from '../rrd-state-file.mjs';

function tmpFile(name='state.json') { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-state-file-test-')), name); }

test('loadJsonState returns fallback only for missing file', () => {
  const file = tmpFile();
  assert.deepEqual(loadJsonState(file, { seen: [] }, 'watcher state'), { seen: [] });
});

test('loadJsonState fails closed and quarantines corrupt JSON', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{bad json');
  assert.throws(() => loadJsonState(file, {}, 'watcher state'), /watcher state is corrupt/);
  assert.equal(fs.existsSync(file), false);
  const quarantined = fs.readdirSync(path.dirname(file)).filter(n => n.startsWith('state.json.corrupt.'));
  assert.equal(quarantined.length, 1);
});

test('writeJsonState creates 600 state files', () => {
  const file = tmpFile('nested/state.json');
  writeJsonState(file, { ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { ok: true });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
