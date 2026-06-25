#!/usr/bin/env node
/**
 * rrd-onboarding-email-watch.mjs — post-onboarding AgentMail automation.
 *
 * Polls Supabase for new onboarding submissions and, once per submission:
 *   1. provisions the per-client Hermes profile,
 *   2. creates the secure vault / OAuth connect links needed for that stack,
 *   3. sends the operational welcome pack,
 *   4. sends the separate secure integration-access email.
 *
 * It also watches deposited vault drops and sends a once-only client confirmation
 * that the secure integration form was received. It does NOT approve/decrypt
 * secrets; operator approval still happens through `approve <drop-id>`.
 *
 * State lives at ~/.openclaw/rrd-onboarding-email-watch.json so retries do not
 * duplicate live AgentMail sends or mint replacement links unnecessarily.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { rowToRecord, buildHermesPack } from './rrd-hermes.mjs';
import { listDeposited, sweepExpired } from './rrd-vault-db.mjs';
import { isSpecialFormRecord, needsSopReview, missingReadinessItems, needsMapping } from './rrd-readiness-rules.mjs';
import { buildChecklist } from './rrd-readiness-checklist.mjs';
import { loadJsonState, writeJsonState } from './rrd-state-file.mjs';
import { withJobLock } from './rrd-job-lock.mjs';

const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || '/Users/AIAgenterminal';
const STATE_PATH = process.env.RRD_ONBOARDING_EMAIL_STATE || `${OPERATOR_HOME}/.openclaw/rrd-onboarding-email-watch.json`;
const PROFILE_ENV = `${OPERATOR_HOME}/.hermes/profiles/recoverydesk/.env`;
const LOCAL_ENV = `${OPERATOR_HOME}/.env.local`;
const OPENCLAW_ENV = `${OPERATOR_HOME}/.openclaw/.env`;
const RUNTIME_POLICY_PATH = process.env.RRD_RUNTIME_POLICY || `${OPERATOR_HOME}/.openclaw/rrd-runtime-policy.json`;
const API_BASE = process.env.AGENTMAIL_API_BASE || 'https://api.agentmail.to/v0';
const INBOX_ID = process.env.RRD_SUPPORT_INBOX_ID || 'flowaudit-support@agentmail.to';
const BOOKING_URL = process.env.RRD_BOOKING_URL || 'https://calendly.com/flowaudit-info/30min';

function loadDotenv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotenv(LOCAL_ENV);
loadDotenv(OPENCLAW_ENV);
loadDotenv(PROFILE_ENV);

function apiKey() {
  const key = process.env.AGENTMAIL_API_KEY;
  if (!key) throw new Error('AGENTMAIL_API_KEY not configured');
  return key;
}
function supabaseCfg() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
  return { url, key };
}
function loadState() { return loadJsonState(STATE_PATH, { submissions: {}, deposits: {} }, 'onboarding email watcher state'); }
function saveState(state) { writeJsonState(STATE_PATH, state); }
function nowIso() { return new Date().toISOString(); }
function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: OPERATOR_HOME,
    encoding: 'utf8',
    timeout: opts.timeout || 180000,
    env: { ...process.env, RRD_OPERATOR_HOME: OPERATOR_HOME },
  });
}
function parseVaultNewOutput(out) {
  const url = (out.match(/https:\/\/\S+\/vault\?token=[^\s]+/) || [])[0] || null;
  const dropId = (out.match(/Drop id:\s*([0-9a-f-]+)/i) || [])[1] || null;
  const company = (out.match(/One-time secrets link for (.*?) \(profile/i) || [])[1] || null;
  const profile = (out.match(/\(profile ([^)]+)\)/i) || [])[1] || null;
  return { url, dropId, company, profile };
}
function parseConnectOutput(out) {
  const url = (out.match(/https:\/\/\S+\/oauth-start\?token=[^\s]+/) || [])[0] || null;
  const dropId = (out.match(/Drop id:\s*([0-9a-f-]+)/i) || [])[1] || null;
  const label = (out.match(/One-time (.*?) connect link/i) || [])[1] || null;
  return { url, dropId, label };
}
async function supabaseRest(path, init = {}) {
  const { url, key } = supabaseCfg();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}
async function listSubmissions() {
  const rows = await supabaseRest('submissions?select=*&order=created_at.asc&limit=1000');
  return (rows || []).map(rowToRecord);
}
async function getSubmission(id) {
  const rows = await supabaseRest(`submissions?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  return rows && rows[0] ? rowToRecord(rows[0]) : null;
}
async function agentmail(method, endpoint, body = undefined) {
  const url = new URL(`${API_BASE}/${endpoint.replace(/^\//, '')}`);
  const opts = { method, headers: { Authorization: `Bearer ${apiKey()}` } };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`AgentMail API error ${res.status}: ${data?.message || data?.error?.message || text}`);
  return data;
}
function telegramCfg() {
  return {
    token: process.env.RRD_APPROVAL_TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.RRD_APPROVAL_TELEGRAM_CHAT_ID || '',
  };
}
async function telegramRequest(method, body, multipart = false) {
  const { token } = telegramCfg();
  if (!token) throw new Error('RRD_APPROVAL_TELEGRAM_BOT_TOKEN not configured');
  const init = { method: 'POST' };
  if (multipart) init.body = body;
  else { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, init);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { ok: false, description: text.slice(0, 300) }; }
  if (!res.ok || !data.ok) throw new Error(`Telegram ${method} error: ${data.description || text}`);
  return data.result;
}
async function sendRuntimeTelegram(entry, client) {
  const { chatId } = telegramCfg();
  if (!chatId) return { skipped: true, reason: 'RRD_APPROVAL_TELEGRAM_CHAT_ID not configured' };
  const mode = entry.runtime?.mode || 'orgo';
  const sr = entry.sandbox || {};
  const orgo = entry.orgo || {};
  const lines = [
    `RRD runtime ready: ${client.company || entry.company || entry.profile}`,
    `Profile: ${entry.profile}`,
    `Submission: ${entry.id}`,
    `Runtime mode: ${mode}`,
    '',
  ];
  if (mode === 'local-sandbox') {
    lines.push(`Local sandbox: ${sr.root || 'created'}`);
    lines.push(`Fake smoke test: ${sr.fake?.ok ? 'ok' : 'not run'}`);
    lines.push(`Read-only smoke test: ${sr.liveReadonly?.ok ? 'ok' : 'not run'}`);
  } else {
    lines.push('Local sandbox: disabled for real clients');
    lines.push(`Orgo project: ${orgo.projectId || 'provisioned/checked'}`);
    lines.push(`Orgo state: ${orgo.state || 'stopped'}`);
    lines.push('Computer launch: waits for explicit operator approval / paid Orgo availability');
  }
  lines.push('', 'ChatGPT/Codex agent runtime: assign a FlowAudit-managed ChatGPT Plus/Pro account email, then complete profile-local OAuth.');
  lines.push(`Assign account: /Users/AIAgenterminal/rrd-agent-llm assign ${entry.profile} --account-email <client-agent-email>`);
  lines.push(`Connect OAuth: /Users/AIAgenterminal/rrd-agent-llm auth ${entry.profile}`);
  lines.push(`Check status: /Users/AIAgenterminal/rrd-agent-llm status ${entry.profile}`);
  lines.push('Never paste ChatGPT passwords, OAuth tokens, or API keys into Telegram or .env.');
  lines.push('', 'Client status: waiting only on secure access / OAuth approvals where required.');
  lines.push(entry.vaultDropId ? `Credential approval: approve ${entry.vaultDropId}` : 'Credential approval: no API-key vault drop created yet');
  lines.push(Object.entries(entry.oauthUrls || {}).length ? `OAuth drops: ${Object.entries(entry.oauthUrls).map(([p, v]) => `${p}=approve ${v.dropId}`).join(', ')}` : 'OAuth drops: none created yet');
  const msg = await telegramRequest('sendMessage', { chat_id: chatId, text: lines.join('\n') });
  const docs = [];
  if (mode === 'local-sandbox') {
    for (const p of [sr.fake?.summaryFile, sr.liveReadonly?.summaryFile].filter(Boolean)) {
      try {
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('caption', `Sandbox smoke-test summary — ${entry.profile}`);
        form.append('document', new Blob([fs.readFileSync(p)], { type: 'text/markdown' }), p.split('/').at(-1));
        const doc = await telegramRequest('sendDocument', form, true);
        docs.push({ path: p, messageId: doc.message_id });
      } catch (e) {
        docs.push({ path: p, error: e && e.message ? e.message : String(e) });
      }
    }
  }
  return { messageId: msg.message_id, documents: docs };
}
async function sendClientDropAck(client, drop) {
  const to = client.email;
  if (!to) throw new Error(`No client email for deposited drop ${drop.id}`);
  const first = String(client.contactName || client.primaryContact || 'there').trim().split(/\s+/)[0] || 'there';
  const what = drop.kind === 'oauth'
    ? `${drop.provider || 'CRM'} authorization`
    : 'secure integration-key form';
  const subject = `Integration access received — ${client.company || drop.company || 'Revenue Recovery Desk'}`;
  const text = `Hi ${first},\n\nWe received your ${what} securely. Thank you.\n\nFor security, we will never ask you to send API keys, passwords, card details, or private credentials by email. The access you submitted stays encrypted until it is installed on the operator machine.\n\nWhat happens next\n- We verify the connection details.\n- If anything is missing or a provider needs a separate authorization, we will email you with the exact next step.\n- Once the workspace is connected, your Revenue Recovery Desk updates will show what is ready, what is blocked, and what needs approval.\n\nSupport: ${INBOX_ID}\n\nThanks,\nRevenue Recovery Desk\n`;
  const sent = await agentmail('POST', `/inboxes/${encodeURIComponent(INBOX_ID)}/messages/send`, { to, subject, text });
  return { to, subject, messageId: sent.message_id || sent.id || null };
}
// isSpecialFormRecord / needsSopReview / missingReadinessItems / needsMapping now
// live in ./rrd-readiness-rules.mjs (imported above) so the go-live readiness card
// and this watcher stay in lockstep on what a client still owes.

const READINESS_MONITOR = `${OPERATOR_HOME}/.openclaw/scripts/readiness-monitor.py`;
// Per-client go-live readiness card in the RRD Operations bot. Pure visibility:
// wrapped so a monitor failure can never break provisioning or client email.
function syncReadinessCard(client, pack, entry, specialForms) {
  try {
    if (!fs.existsSync(READINESS_MONITOR)) return;
    const checklist = buildChecklist({ client, pack, entry: entry || {}, specialForms: specialForms || [] });
    execFileSync(READINESS_MONITOR, [
      'sync', '--client', String(client.id), '--lane', 'recovery_desk',
      '--title', checklist.title, '--groups-json', JSON.stringify(checklist.groups),
    ], { encoding: 'utf8', timeout: 30000, env: { ...process.env, HOME: OPERATOR_HOME } });
  } catch { /* visibility only — never break onboarding */ }
}
async function sendSimpleEmail(to, subject, text) {
  const sent = await agentmail('POST', `/inboxes/${encodeURIComponent(INBOX_ID)}/messages/send`, { to, subject, text });
  return { to, subject, messageId: sent.message_id || sent.id || null };
}
async function operatorNotify(text) {
  const { chatId } = telegramCfg();
  if (!chatId) return { skipped: true };
  const msg = await telegramRequest('sendMessage', { chat_id: chatId, text });
  return { messageId: msg.message_id };
}
function welcomeSend(id, args = []) {
  const out = run('/Users/AIAgenterminal/rrd-welcome-pack', args, { timeout: 180000 });
  return JSON.parse(out);
}
function loadRuntimePolicy() {
  const fallback = {
    defaultMode: 'orgo',
    localSandboxAllowlist: ['rr-test'],
    profileModes: { 'rr-test': 'local-sandbox' },
    note: 'Real client instances must not run locally. Use local-sandbox only for rr-test/demo; default real-client runtime is Orgo/cloud.'
  };
  try { return { ...fallback, ...JSON.parse(fs.readFileSync(RUNTIME_POLICY_PATH, 'utf8')) }; }
  catch { return fallback; }
}
function runtimeModeFor(entry, client) {
  const policy = loadRuntimePolicy();
  const profile = entry.profile;
  if (policy.profileModes && policy.profileModes[profile]) return policy.profileModes[profile];
  if ((policy.localSandboxAllowlist || []).includes(profile)) return 'local-sandbox';
  return policy.defaultMode || 'orgo';
}
function orgoStatus(profile) {
  try {
    const out = run('/Users/AIAgenterminal/rrd-orgo', ['status', profile], { timeout: 120000 });
    const parsed = JSON.parse(out);
    return { ok: true, projectId: parsed.projectId || parsed.fleet?.projectId || null, state: parsed.fleet?.state || (parsed.running ? 'running' : 'stopped'), running: parsed.running || 0, exists: !!parsed.exists };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}
function orgoProvision(profile, company) {
  try {
    const args = ['provision', profile];
    if (company) args.push('--company', company);
    const out = run('/Users/AIAgenterminal/rrd-orgo', args, { timeout: 180000 });
    return JSON.parse(out);
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}
function runSandboxDemo(profile, mode) {
  const flag = mode === 'live-readonly' ? '--live-readonly' : '--fake';
  const out = run('/Users/AIAgenterminal/rrd-local-sandbox', ['demo', profile, flag], { timeout: 240000 });
  const parsed = JSON.parse(out);
  return {
    ok: true,
    mode: parsed.mode,
    outputFile: parsed.outputFile,
    summaryFile: parsed.summaryFile,
    sandbox: parsed.sandbox,
    safety: parsed.safety || null,
    gateOnlyProbe: parsed.gateOnlyProbe || null,
    approvalGateProbe: parsed.approvalGateProbe || null,
  };
}
async function ensureRuntimeReady(client, entry, state) {
  if (entry.runtimeReadySentAt || entry.sandboxReadySentAt) return false;
  if (!entry.provisionedAt) return false;
  const mode = runtimeModeFor(entry, client);
  entry.runtime = { ...(entry.runtime || {}), mode, decidedAt: entry.runtime?.decidedAt || nowIso() };
  try {
    if (mode === 'local-sandbox') {
      entry.sandbox = entry.sandbox || {};
      if (!entry.sandbox.fake?.ok) {
        entry.sandbox.fake = runSandboxDemo(entry.profile, 'fake');
        entry.sandbox.root = entry.sandbox.fake.sandbox;
        saveState(state);
      }
      if (!entry.sandbox.liveReadonly?.ok) {
        entry.sandbox.liveReadonly = runSandboxDemo(entry.profile, 'live-readonly');
        entry.sandbox.root = entry.sandbox.root || entry.sandbox.liveReadonly.sandbox;
        saveState(state);
      }
      entry.runtime.localSandboxUsed = true;
    } else {
      entry.runtime.localSandboxUsed = false;
      const provisioned = orgoProvision(entry.profile, client.company || entry.company);
      const status = orgoStatus(entry.profile);
      entry.orgo = { provisioned, ...status, checkedAt: nowIso() };
      saveState(state);
    }
    const tg = await sendRuntimeTelegram(entry, client);
    entry.runtimeTelegram = tg;
    entry.runtimeReadySentAt = nowIso();
    // Backwards-compatible field for older status checks; means runtime packet sent, not necessarily local sandbox.
    entry.sandboxReadySentAt = entry.runtimeReadySentAt;
    saveState(state);
    return true;
  } catch (e) { markError(entry, 'runtime-ready', e); saveState(state); throw e; }
}
function markError(entry, stage, e) {
  entry.errors = entry.errors || [];
  entry.errors.push({ at: nowIso(), stage, message: e && e.message ? e.message : String(e) });
}
async function processSubmission(client, state) {
  const pack = buildHermesPack(client);
  const id = client.id;
  const entry = state.submissions[id] || { id, company: client.company, email: client.email, createdAt: client.submittedAt, profile: pack.profileName };
  entry.profile = entry.profile || pack.profileName;
  entry.company = entry.company || client.company;
  entry.email = entry.email || client.email;
  state.submissions[id] = entry;

  if (!entry.provisionedAt) {
    try {
      const out = run('/Users/AIAgenterminal/rrd-provision', [id], { timeout: 240000 });
      try { run('/Users/AIAgenterminal/rrd-agent-llm', ['init', pack.profileName], { timeout: 60000 }); }
      catch (llmInitError) { markError(entry, 'llm-runtime-init', llmInitError); }
      entry.provisionedAt = nowIso();
      entry.provisionOutput = out.trim().slice(-2000);
      saveState(state);
    } catch (e) { markError(entry, 'provision', e); saveState(state); throw e; }
  }

  const envKeys = pack.manifest.envKeysNeeded || [];
  if (envKeys.length && !entry.vaultUrl) {
    try {
      const out = run('/Users/AIAgenterminal/rrd-vault', ['new', id], { timeout: 180000 });
      const parsed = parseVaultNewOutput(out);
      if (!parsed.url || !parsed.dropId) throw new Error('Could not parse vault URL/drop id from rrd-vault output');
      entry.vaultUrl = parsed.url;
      entry.vaultDropId = parsed.dropId;
      entry.vaultLinkCreatedAt = nowIso();
      saveState(state);
    } catch (e) { markError(entry, 'vault-new', e); saveState(state); throw e; }
  }

  const oauthNeeded = pack.manifest.oauthConnectionsNeeded || [];
  const composioNeeded = pack.manifest.composioConnectionsNeeded || [];
  entry.oauthUrls = entry.oauthUrls || {};
  entry.oauthErrors = entry.oauthErrors || {};
  for (const provider of oauthNeeded) {
    if (entry.oauthUrls[provider] || entry.oauthErrors[provider]) continue;
    try {
      const out = run('/Users/AIAgenterminal/rrd-vault', ['connect', id, provider], { timeout: 180000 });
      const parsed = parseConnectOutput(out);
      if (!parsed.url || !parsed.dropId) throw new Error(`Could not parse ${provider} connect URL/drop id from rrd-vault output`);
      entry.oauthUrls[provider] = { url: parsed.url, dropId: parsed.dropId, createdAt: nowIso() };
      saveState(state);
    } catch (e) {
      entry.oauthErrors[provider] = { at: nowIso(), message: e && e.message ? e.message : String(e) };
      saveState(state);
    }
  }

  if (!entry.welcomeSentAt) {
    try {
      const res = welcomeSend(id, ['welcome', id]);
      entry.welcomeSentAt = nowIso();
      entry.welcomeMessageId = res.messageId || null;
      saveState(state);
    } catch (e) { markError(entry, 'welcome-send', e); saveState(state); throw e; }
  }

  const hasAnyAccessLink = !!entry.vaultUrl || Object.keys(entry.oauthUrls || {}).length > 0 || composioNeeded.length > 0;
  const accessNeeded = envKeys.length || oauthNeeded.length || composioNeeded.length;
  entry.accessNeeded = !!accessNeeded;
  if (!accessNeeded && !entry.accessSkippedAt) {
    entry.accessSkippedAt = nowIso();
    entry.accessSkipReason = 'no API-key, OAuth, or Composio integrations detected';
    saveState(state);
  }
  if (accessNeeded && hasAnyAccessLink && !entry.accessSentAt && !entry.accessSkippedAt) {
    try {
      const args = ['access', id];
      if (entry.vaultUrl) args.push('--vault-url', entry.vaultUrl);
      for (const [provider, item] of Object.entries(entry.oauthUrls || {})) args.push('--oauth-url', `${provider}=${item.url}`);
      const res = welcomeSend(id, args);
      entry.accessSentAt = nowIso();
      entry.accessMessageId = res.messageId || null;
      saveState(state);
    } catch (e) { markError(entry, 'access-send', e); saveState(state); throw e; }
  }

  if (needsSopReview(client) && !entry.sopReviewSentAt) {
    try {
      const res = welcomeSend(id, ['sop', id]);
      entry.sopReviewSentAt = nowIso();
      entry.sopReviewMessageId = res.messageId || null;
      saveState(state);
    } catch (e) { markError(entry, 'sop-review-send', e); saveState(state); throw e; }
  }

  const readinessMissing = missingReadinessItems(client);
  entry.readinessMissing = readinessMissing;
  if (readinessMissing.length && !entry.readinessSentAt) {
    try {
      const res = welcomeSend(id, ['readiness', id]);
      entry.readinessSentAt = nowIso();
      entry.readinessMessageId = res.messageId || null;
      saveState(state);
    } catch (e) { markError(entry, 'readiness-send', e); saveState(state); throw e; }
  }

  const mappingNeeded = needsMapping(client, [...oauthNeeded, ...composioNeeded]);
  entry.mappingNeeded = mappingNeeded;
  if (mappingNeeded && !entry.mappingSentAt) {
    try {
      const res = welcomeSend(id, ['mapping', id]);
      entry.mappingSentAt = nowIso();
      entry.mappingMessageId = res.messageId || null;
      saveState(state);
    } catch (e) { markError(entry, 'mapping-send', e); saveState(state); throw e; }
  }

  const runtimeReady = await ensureRuntimeReady(client, entry, state);

  return { id, company: client.company, profile: pack.profileName, welcomeSent: !!entry.welcomeSentAt, accessSent: !!entry.accessSentAt, sopReviewSent: !!entry.sopReviewSentAt, readinessSent: !!entry.readinessSentAt, mappingSent: !!entry.mappingSentAt, readinessMissing, runtimeMode: entry.runtime?.mode || null, runtimeReady: !!entry.runtimeReadySentAt, runtimeNotifiedNow: runtimeReady, localSandboxUsed: !!entry.runtime?.localSandboxUsed, vaultDropId: entry.vaultDropId || null, oauthProviders: Object.keys(entry.oauthUrls || {}), oauthErrors: entry.oauthErrors || {} };
}
async function processDeposits(state) {
  await sweepExpired().catch(() => {});
  const out = [];
  const deposited = await listDeposited();
  for (const drop of deposited || []) {
    const dstate = state.deposits[drop.id] || { id: drop.id, company: drop.company, profile: drop.profile };
    state.deposits[drop.id] = dstate;
    if (dstate.clientAckSentAt) continue;
    if (!drop.submission_id) { dstate.skipped = 'missing submission_id'; saveState(state); continue; }
    const client = await getSubmission(drop.submission_id);
    if (!client) { dstate.skipped = 'submission not found'; saveState(state); continue; }
    try {
      const ack = await sendClientDropAck(client, drop);
      dstate.clientAckSentAt = nowIso();
      dstate.clientAckMessageId = ack.messageId;
      dstate.to = ack.to;
      out.push({ dropId: drop.id, company: client.company || drop.company, to: ack.to, messageId: ack.messageId });
      saveState(state);
    } catch (e) { markError(dstate, 'deposit-client-ack', e); saveState(state); throw e; }
  }
  // prune old non-live deposit state lightly but keep sent audit entries
  return out;
}
async function processSpecialFormResponses(submissions, state) {
  state.forms = state.forms || {};
  const out = [];
  for (const row of submissions.filter(isSpecialFormRecord)) {
    const fstate = state.forms[row.id] || { id: row.id, catalyst: row.catalyst, company: row.company, email: row.email };
    state.forms[row.id] = fstate;
    if (fstate.processedAt) continue;
    const payload = row.businessProfile || row.recoveryProcess?.sopReview || row.recoveryProcess?.readiness || row.recoveryProcess?.mapping || {};
    try {
      if (row.catalyst === 'SOP_REVIEW_WEB') {
        const status = payload.status || row.businessProfile?.status || 'unknown';
        if (status === 'accepted') {
          await operatorNotify(`✅ ${row.company} accepted the FlowAudit default recovery SOP. Source submission: ${payload.sourceSubmissionId || 'unknown'}`);
        } else {
          await operatorNotify(`⚠️ ${row.company} requested SOP changes. Notes: ${payload.changeRequest || 'No notes provided'} Booking link included in follow-up. Source submission: ${payload.sourceSubmissionId || 'unknown'}`);
          const text = `Hi there,\n\nThanks for reviewing the recovery SOP. We saw that you requested changes before approval.\n\nPlease reply with any extra detail about what you want adjusted — cadence, tone, escalation points, approval rules, channels, payment plans, discounts, or any internal compliance requirements.\n\nYou can also book a setup call here:\n${BOOKING_URL}\n\nWe will not use the default SOP for live recovery until the changes are understood and approved.\n\nThanks,\nRevenue Recovery Desk\n`;
          const sent = await sendSimpleEmail(row.email, `SOP changes requested — ${row.company}`, text);
          fstate.followUpMessageId = sent.messageId;
        }
      } else if (row.catalyst === 'READINESS_DETAILS_WEB') {
        await operatorNotify(`✅ ${row.company} submitted go-live readiness details. Source submission: ${payload.sourceSubmissionId || 'unknown'}`);
      } else if (row.catalyst === 'MAPPING_DETAILS_WEB') {
        await operatorNotify(`✅ ${row.company} submitted integration/data mapping details. Source submission: ${payload.sourceSubmissionId || 'unknown'}`);
      }
      fstate.processedAt = nowIso();
      out.push({ id: row.id, catalyst: row.catalyst, company: row.company });
      saveState(state);
    } catch (e) { markError(fstate, 'special-form-response', e); saveState(state); throw e; }
  }
  return out;
}
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const state = loadState();
  if (dryRun) {
    const submissions = await listSubmissions();
    const deposited = await listDeposited();
    console.log(JSON.stringify({ ok: true, dryRun: true, submissions: submissions.map((c) => ({ id: c.id, company: c.company, email: c.email, catalyst: c.catalyst || null, specialForm: isSpecialFormRecord(c), alreadyProcessed: !!state.submissions[c.id] })), deposited: deposited.map((d) => ({ id: d.id, company: d.company, status: 'deposited', alreadyAcked: !!state.deposits[d.id]?.clientAckSentAt })) }, null, 2));
    return;
  }

  const summaries = [];
  const submissions = await listSubmissions();
  const specialForms = submissions.filter(isSpecialFormRecord);
  const specialResponses = await processSpecialFormResponses(submissions, state);
  for (const client of submissions.filter((c) => !isSpecialFormRecord(c))) {
    const entry = state.submissions[client.id];
    const sopDone = !needsSopReview(client) || !!entry?.sopReviewSentAt;
    const readinessDone = !missingReadinessItems(client).length || !!entry?.readinessSentAt;
    const pack = buildHermesPack(client);
    const mappingDone = !needsMapping(client, [...(pack.manifest.oauthConnectionsNeeded || []), ...(pack.manifest.composioConnectionsNeeded || [])]) || !!entry?.mappingSentAt;
    const alreadyDone = entry && entry.welcomeSentAt && (!entry.accessNeeded || entry.accessSentAt || entry.accessSkippedAt) && entry.sandboxReadySentAt && sopDone && readinessDone && mappingDone;
    if (!alreadyDone) {
      const before = JSON.stringify(entry || {});
      const result = await processSubmission(client, state);
      if (JSON.stringify(state.submissions[client.id] || {}) !== before) summaries.push(result);
    }
    // Go-live readiness card: reflect this client's current state every cycle.
    // Idempotent — the monitor only edits the bubble when content actually changed.
    syncReadinessCard(client, buildHermesPack(client), state.submissions[client.id], specialForms);
  }
  const depositAcks = await processDeposits(state);

  if (summaries.length || depositAcks.length || specialResponses.length) {
    console.log(JSON.stringify({ ok: true, processedSubmissions: summaries, specialResponses, depositAcknowledgements: depositAcks }, null, 2));
  }
}

withJobLock('rrd-onboarding-email-watch', main, { staleMs: 30 * 60 * 1000 }).catch((e) => { console.error(e.stack || e.message); process.exit(1); });
