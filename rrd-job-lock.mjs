import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { safeStateName } from './rrd-profile-safety.mjs';

const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || '/Users/AIAgenterminal';
const DEFAULT_DIR = process.env.RRD_LOCK_DIR || path.join(OPERATOR_HOME, '.openclaw', 'rrd-locks');
const DEFAULT_STALE_MS = 30 * 60 * 1000;

export function lockPath(name, { dir = DEFAULT_DIR } = {}) {
  return path.join(dir, `${safeStateName(name, 'lock name')}.lock`);
}

function readLock(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function isStale(file, staleMs) {
  const meta = readLock(file);
  const started = Date.parse(meta?.startedAt || '');
  const age = Date.now() - (Number.isFinite(started) ? started : fs.statSync(file).mtimeMs);
  return age > staleMs;
}

export function acquireJobLock(name, opts = {}) {
  const file = lockPath(name, opts);
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const token = crypto.randomUUID();
  const payload = {
    name: safeStateName(name, 'lock name'),
    token,
    pid: process.pid,
    host: os.hostname(),
    startedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  for (;;) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(payload, null, 2));
      fs.closeSync(fd);
      fs.chmodSync(file, 0o600);
      return { ...payload, file, release: () => releaseJobLock(file, token) };
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
      if (!isStale(file, staleMs)) {
        const meta = readLock(file);
        throw new Error(`Job lock active for ${name}${meta?.startedAt ? ` since ${meta.startedAt}` : ''}`);
      }
      try { fs.unlinkSync(file); } catch (unlinkErr) { if (unlinkErr?.code !== 'ENOENT') throw unlinkErr; }
    }
  }
}

export function releaseJobLock(file, token) {
  const meta = readLock(file);
  if (!meta || meta.token !== token) return false;
  fs.unlinkSync(file);
  return true;
}

export async function withJobLock(name, fn, opts = {}) {
  const lock = acquireJobLock(name, opts);
  try {
    return await fn(lock);
  } finally {
    lock.release();
  }
}
