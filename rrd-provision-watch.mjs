#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { withJobLock } from './rrd-job-lock.mjs';

const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || '/Users/AIAgenterminal';
const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
function headers(extra = {}) { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...extra }; }
async function rest(path, init = {}) {
  if (!URL_BASE || !SERVICE_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: headers(init.headers) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}
function redacted(s) { return String(s || '').replace(/(Bearer|Basic|sk_|pk_|key=)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]').slice(0, 1000); }
function sha1(s) { return crypto.createHash('sha1').update(String(s)).digest('hex'); }
async function emitDone(job) {
  const now = new Date().toISOString();
  const profile = job.profile || '';
  await rest('recovery_events', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify({ submission_id: job.submission_id, profile, dedupe_key: sha1(`${job.id}|reprovisioned|${now}`), event_type: 'reprovisioned', occurred_at: now, outcome: 'done', meta: { job_id: job.id, reason: job.reason } }) }).catch(()=>{});
  await rest('notifications', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify({ submission_id: job.submission_id, kind: 'setting_applied', title: 'Dashboard settings applied', body: 'Your FlowAudit recovery agent has been updated with the latest settings.' }) }).catch(()=>{});
}
export async function runProvisionJobs({ limit = 5 } = {}) {
  const jobs = await rest(`provision_jobs?status=in.(queued,error)&attempts=lt.5&order=created_at.asc&limit=${limit}&select=*`);
  let done = 0;
  for (const job of jobs || []) {
    await rest(`provision_jobs?id=eq.${job.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'running', picked_at: new Date().toISOString(), attempts: Number(job.attempts || 0) + 1, error: null }) });
    try {
      execFileSync('node', ['hermes-provision.mjs', '--force', String(job.submission_id)], { cwd: OPERATOR_HOME, encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
      await rest(`provision_jobs?id=eq.${job.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'done', finished_at: new Date().toISOString(), error: null }) });
      await emitDone(job);
      done++;
    } catch (e) {
      await rest(`provision_jobs?id=eq.${job.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'error', error: redacted(e.stderr || e.message || e) }) });
    }
  }
  return { checked: jobs?.length || 0, done };
}
if (import.meta.url === `file://${process.argv[1]}`) withJobLock('rrd-provision-watch', async () => { const r = await runProvisionJobs(); if (r.checked) console.log(`provision jobs checked=${r.checked} done=${r.done}`); }).catch(e => { console.error(e.stack || e.message); process.exit(1); });
