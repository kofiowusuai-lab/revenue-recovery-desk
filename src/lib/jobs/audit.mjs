import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

function baseDir() {
  return process.env.RRD_JOB_AUDIT_DIR || path.join(os.homedir(), '.openclaw', 'rrd-job-audit');
}

function safeName(name, label = 'name') {
  const value = String(name || '').trim();
  if (!/^[A-Za-z0-9_.:-]+$/.test(value) || value.includes('..') || value.includes('/') || value.includes('\\')) {
    throw new Error(`Unsafe ${label}`);
  }
  return value;
}

function appendNdjson(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, JSON.stringify(row) + '\n', { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
  return row;
}

export function agentRunFile({ dir = baseDir(), jobName = 'runs' } = {}) {
  return path.join(dir, `${safeName(jobName, 'job name')}.ndjson`);
}

export function logAuditEvent(event, opts = {}) {
  const row = {
    at: new Date().toISOString(),
    type: 'audit_event',
    ...event,
  };
  const name = event?.jobName || event?.scope || 'events';
  return appendNdjson(agentRunFile({ ...opts, jobName: name }), row);
}

export function startAgentRun({ jobName, profile = null, actionKey = null, meta = {} } = {}, opts = {}) {
  const run = {
    at: new Date().toISOString(),
    type: 'agent_run',
    event: 'start',
    runId: opts.runId || crypto.randomUUID(),
    jobName: safeName(jobName || 'unknown-job', 'job name'),
    profile,
    actionKey,
    meta,
  };
  appendNdjson(agentRunFile({ ...opts, jobName: run.jobName }), run);
  return run;
}

export function finishAgentRun(run, { status = 'ok', error = null, result = null, meta = {} } = {}, opts = {}) {
  const row = {
    at: new Date().toISOString(),
    type: 'agent_run',
    event: 'finish',
    runId: run?.runId,
    jobName: safeName(run?.jobName || opts.jobName || 'unknown-job', 'job name'),
    profile: run?.profile || null,
    actionKey: run?.actionKey || null,
    status,
    error: error ? { message: error.message || String(error), code: error.code || undefined } : null,
    result,
    meta,
  };
  return appendNdjson(agentRunFile({ ...opts, jobName: row.jobName }), row);
}

export async function withAgentRun(info, fn, opts = {}) {
  const run = startAgentRun(info, opts);
  try {
    const result = await fn(run);
    finishAgentRun(run, { status: 'ok', result }, opts);
    return result;
  } catch (error) {
    finishAgentRun(run, { status: 'error', error }, opts);
    throw error;
  }
}

export function readAgentRuns(jobName, opts = {}) {
  const file = agentRunFile({ ...opts, jobName });
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
