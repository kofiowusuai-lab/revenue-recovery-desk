import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  REQUIRED_RRD_TABLES,
  findMissingRequiredTables,
  findMissingStatusValues,
  listSqlMigrations,
  validateCanonicalMigrationSql,
  validateCanonicalMigrations,
} from '../src/lib/db/rrd-migrations.mjs';
import { STATUS_GROUPS } from '../src/lib/client-state/rrd-status.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const canonicalMigration = path.join(migrationsDir, '202606260001_rrd_canonical_foundation.sql');

test('canonical migration file is discoverable', async () => {
  const files = await listSqlMigrations(migrationsDir);
  assert.ok(files.includes(canonicalMigration));
});

test('canonical migration includes every required RRD table', async () => {
  const sql = await readFile(canonicalMigration, 'utf8');
  assert.deepEqual(findMissingRequiredTables(sql), []);

  for (const table of REQUIRED_RRD_TABLES) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'));
  }
});

test('canonical migration includes every required status/state value', async () => {
  const sql = await readFile(canonicalMigration, 'utf8');
  assert.deepEqual(findMissingStatusValues(sql, STATUS_GROUPS), {});
});

test('canonical migration validates as complete in isolation and through directory scan', async () => {
  const sql = await readFile(canonicalMigration, 'utf8');
  assert.deepEqual(validateCanonicalMigrationSql(sql), {
    ok: true,
    errors: [],
    missingTables: [],
    missingStatuses: {},
  });

  const directoryResult = await validateCanonicalMigrations(migrationsDir);
  assert.equal(directoryResult.ok, true);
  assert.deepEqual(directoryResult.errors, []);
  assert.ok(directoryResult.files.includes(canonicalMigration));
});

test('migration has idempotency, client isolation, jsonb payloads, and RLS foundations', async () => {
  const sql = await readFile(canonicalMigration, 'utf8');
  assert.match(sql, /unique\s*\(client_id,\s*idempotency_key\)/i);
  assert.match(sql, /unique\s*\(job_name,\s*idempotency_key\)/i);
  assert.match(sql, /lock_key text primary key/i);
  assert.match(sql, /client_id uuid/i);
  assert.match(sql, /raw_payload jsonb not null default/i);
  assert.match(sql, /payload jsonb not null default/i);
  assert.match(sql, /alter table public\.submissions enable row level security/i);
  assert.match(sql, /alter table public\.recovery_actions enable row level security/i);
  assert.doesNotMatch(sql, /drop\s+table/i);
});
