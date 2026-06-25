import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rrd-state-corrupt-'));
process.env.RRD_USAGE_DIR = path.join(TMP, 'usage');
process.env.RRD_COLLECTIONS_DIR = path.join(TMP, 'collections');

const usage = await import('../rrd-usage.mjs');
const collections = await import('../rrd-collections-state.mjs');

test('usage state corruption fails closed and quarantines file', () => {
  fs.mkdirSync(process.env.RRD_USAGE_DIR, { recursive: true });
  const file = usage.fileFor('rr-corrupt');
  fs.writeFileSync(file, '{bad json');
  assert.throws(() => usage.loadUsage('rr-corrupt'), /Usage state is corrupt/);
  assert.ok(!fs.existsSync(file));
  assert.ok(fs.readdirSync(process.env.RRD_USAGE_DIR).some(n => n.startsWith('rr-corrupt.json.corrupt.')));
});

test('collections state corruption fails closed and quarantines file', () => {
  fs.mkdirSync(process.env.RRD_COLLECTIONS_DIR, { recursive: true });
  const file = collections.statePath('rr-corrupt');
  fs.writeFileSync(file, '{bad json');
  assert.throws(() => collections.loadState('rr-corrupt'), /Collections state is corrupt/);
  assert.ok(!fs.existsSync(file));
  assert.ok(fs.readdirSync(process.env.RRD_COLLECTIONS_DIR).some(n => n.startsWith('rr-corrupt.json.corrupt.')));
});
