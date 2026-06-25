#!/usr/bin/env node
import { withJobLock } from './rrd-job-lock.mjs';
/**
 * rrd-vault-cleanup.mjs — safe cleanup workflow for vault drops and obvious test form noise.
 *
 * Default is dry-run. It never reads/decrypts secrets and never touches profile .env
 * files, OAuth tokens, or vault private keys.
 *
 * Writes only with --execute:
 *   - marks pending drops whose expires_at is in the past as status='expired'
 *   - optionally deletes clearly synthetic/special-form submission rows with --delete-special-forms
 */
const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

function parseArgs(argv) {
  const o = { execute: false, deleteSpecialForms: false, formOlderThanDays: 14, consumedOlderThanDays: 90, json: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') o.execute = true;
    else if (a === '--dry-run') o.execute = false;
    else if (a === '--delete-special-forms') o.deleteSpecialForms = true;
    else if (a === '--form-older-than-days') o.formOlderThanDays = Number(argv[++i]);
    else if (a === '--consumed-older-than-days') o.consumedOlderThanDays = Number(argv[++i]);
    else if (a === '-h' || a === '--help') o.help = true;
  }
  return o;
}
function usage() {
  console.error(`rrd-vault-cleanup [--dry-run] [--execute] [--delete-special-forms] [--form-older-than-days N]\n\nSafe defaults:\n- dry-run unless --execute is passed\n- expires only pending vault drops whose expires_at is past\n- never decrypts, prints, or deletes secret values\n- never touches profile .env files, OAuth tokens, or vault private keys\n- deposited drops are reported for human approval/reissue, not deleted\n`);
}
function need() { if (!URL_BASE || !KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); }
async function rest(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${data?.message || data?.error || text}`);
  return data;
}
function isoDaysAgo(days) { return new Date(Date.now() - days * 86400_000).toISOString(); }
function publicDrop(d) {
  return { id: d.id, profile: d.profile, company: d.company, kind: d.kind || 'api-key', provider: d.provider || null, status: d.status, expires_at: d.expires_at, created_at: d.created_at, env_keys_count: Array.isArray(d.env_keys) ? d.env_keys.length : 0, has_ciphertext: !!d.ciphertext };
}
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { usage(); return; }
  need();
  const now = new Date().toISOString();
  const pendingExpired = await rest(`vault_drops?select=id,profile,company,kind,provider,status,expires_at,created_at,env_keys,ciphertext&status=eq.pending&expires_at=lt.${encodeURIComponent(now)}&order=expires_at.asc`);
  const depositedStale = await rest(`vault_drops?select=id,profile,company,kind,provider,status,expires_at,created_at,env_keys,ciphertext&status=eq.deposited&created_at=lt.${encodeURIComponent(isoDaysAgo(2))}&order=created_at.asc`);
  const consumedOld = await rest(`vault_drops?select=id,profile,company,kind,provider,status,expires_at,created_at,env_keys,ciphertext&status=eq.consumed&created_at=lt.${encodeURIComponent(isoDaysAgo(opts.consumedOlderThanDays))}&order=created_at.asc`);
  const specialCutoff = isoDaysAgo(opts.formOlderThanDays);
  const specialForms = await rest(`submissions?select=id,company,email,catalyst,created_at&catalyst=in.(SOP_REVIEW_WEB,READINESS_DETAILS_WEB,MAPPING_DETAILS_WEB)&created_at=lt.${encodeURIComponent(specialCutoff)}&order=created_at.asc`);

  const actions = [];
  if (opts.execute && pendingExpired.length) {
    const ids = pendingExpired.map(d => d.id);
    await rest(`vault_drops?id=in.(${ids.map(encodeURIComponent).join(',')})`, { method: 'PATCH', body: JSON.stringify({ status: 'expired' }) });
    actions.push({ action: 'marked_pending_drops_expired', count: ids.length, ids });
  }
  if (opts.execute && opts.deleteSpecialForms && specialForms.length) {
    const ids = specialForms.map(r => r.id);
    await rest(`submissions?id=in.(${ids.map(encodeURIComponent).join(',')})`, { method: 'DELETE' });
    actions.push({ action: 'deleted_special_form_rows', count: ids.length, ids });
  }

  console.log(JSON.stringify({
    ok: true,
    mode: opts.execute ? 'execute' : 'dry-run',
    safety: 'No secret values are read/printed; no profile .env, OAuth token, or private-key files are touched. Deposited drops are only reported.',
    pendingExpired: pendingExpired.map(publicDrop),
    depositedStaleNeedsHumanReview: depositedStale.map(publicDrop),
    consumedOldAuditOnly: consumedOld.map(publicDrop),
    specialFormRowsOlderThanCutoff: specialForms,
    actions,
    nextSteps: opts.execute ? [] : ['Run with --execute to mark pending expired drops as expired.', 'Add --delete-special-forms only if you intentionally want old SOP/readiness/mapping response rows removed from the active book.'],
  }, null, 2));
}
withJobLock('rrd-vault-cleanup', main, { staleMs: 30 * 60 * 1000 }).catch((e) => { console.error(e.stack || e.message); process.exit(1); });
