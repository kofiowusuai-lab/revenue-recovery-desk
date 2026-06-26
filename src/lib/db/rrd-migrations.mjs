import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { STATUS_GROUPS } from '../client-state/rrd-status.mjs';

export const REQUIRED_RRD_TABLES = Object.freeze([
  'submissions',
  'clients',
  'client_integrations',
  'invoices',
  'recovery_threads',
  'recovery_actions',
  'approval_requests',
  'customer_replies',
  'payments',
  'reports',
  'agent_runs',
  'job_locks',
  'audit_events',
  'client_settings',
]);

export async function listSqlMigrations(migrationsDir = path.resolve(process.cwd(), 'supabase/migrations')) {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => path.join(migrationsDir, entry.name))
    .sort();
}

export async function readSqlMigrations(migrationsDir) {
  const files = await listSqlMigrations(migrationsDir);
  const migrations = await Promise.all(files.map(async (file) => ({
    file,
    sql: await readFile(file, 'utf8'),
  })));
  return migrations;
}

export function normalizeSql(sql) {
  return String(sql || '')
    .replace(/--.*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function findCreateTable(sql, table) {
  const normalized = normalizeSql(sql);
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${escaped}\\b`);
  return pattern.test(normalized);
}

export function findAllRequiredTables(sql, requiredTables = REQUIRED_RRD_TABLES) {
  return requiredTables.filter((table) => findCreateTable(sql, table));
}

export function findMissingRequiredTables(sql, requiredTables = REQUIRED_RRD_TABLES) {
  const present = new Set(findAllRequiredTables(sql, requiredTables));
  return requiredTables.filter((table) => !present.has(table));
}

export function findMissingStatusValues(sql, statusGroups = STATUS_GROUPS) {
  const normalized = normalizeSql(sql);
  const missing = {};
  for (const [group, values] of Object.entries(statusGroups)) {
    const absent = values.filter((value) => !normalized.includes(`'${value.toLowerCase()}'`));
    if (absent.length) missing[group] = absent;
  }
  return missing;
}

export function validateCanonicalMigrationSql(sql, options = {}) {
  const requiredTables = options.requiredTables || REQUIRED_RRD_TABLES;
  const statusGroups = options.statusGroups || STATUS_GROUPS;
  const missingTables = findMissingRequiredTables(sql, requiredTables);
  const missingStatuses = findMissingStatusValues(sql, statusGroups);
  const errors = [];

  if (missingTables.length) errors.push(`Missing RRD tables: ${missingTables.join(', ')}`);
  for (const [group, values] of Object.entries(missingStatuses)) {
    errors.push(`Missing ${group} values: ${values.join(', ')}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    missingTables,
    missingStatuses,
  };
}

export async function validateCanonicalMigrations(migrationsDir) {
  const migrations = await readSqlMigrations(migrationsDir);
  const combinedSql = migrations.map((migration) => migration.sql).join('\n\n');
  return {
    files: migrations.map((migration) => migration.file),
    ...validateCanonicalMigrationSql(combinedSql),
  };
}
