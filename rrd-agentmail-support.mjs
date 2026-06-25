#!/usr/bin/env node
// rrd-agentmail-support.mjs — Flow Audit / RRD support + cancellation inbox watcher.
//
// Phase 1: create/use flowaudit-support@agentmail.to, detect cancellation/support
// inbound messages, reply with an offboarding questionnaire by email, and label
// messages so we do not double-send. Full payment/offboard automation can be
// plugged into the structured response handler once billing-period data is
// available.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { parseOffboardingForm, isAuthorizedOffboardingForm, normalizeCompany } from './rrd-cancellation-core.mjs';
import { securityScanInboundEmail } from './rrd-email-security.mjs';
import { signedClientActionUrl } from './rrd-client-action-token.mjs';
import { withJobLock } from './rrd-job-lock.mjs';
import { loadJsonState, writeJsonState } from './rrd-state-file.mjs';

const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || '/Users/AIAgenterminal';
const PROFILE_ENV = `${OPERATOR_HOME}/.hermes/profiles/recoverydesk/.env`;
const OPENCLAW_ENV = `${OPERATOR_HOME}/.openclaw/.env`;
const STATE_PATH = process.env.RRD_AGENTMAIL_SUPPORT_STATE || `${OPERATOR_HOME}/.openclaw/rrd-agentmail-support.json`;
const INBOX_ID = process.env.RRD_SUPPORT_INBOX_ID || 'flowaudit-support@agentmail.to';
const API_BASE = process.env.AGENTMAIL_API_BASE || 'https://api.agentmail.to/v0';

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
loadDotenv(OPENCLAW_ENV);
loadDotenv(PROFILE_ENV);

function apiKey() {
  const key = process.env.AGENTMAIL_API_KEY;
  if (!key) throw new Error('AGENTMAIL_API_KEY not configured');
  return key;
}

async function agentmail(method, endpoint, body = undefined, query = undefined) {
  const url = new URL(`${API_BASE}/${endpoint.replace(/^\//, '')}`);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const opts = { method, headers: { Authorization: `Bearer ${apiKey()}` } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.message || data?.error?.message || text || `AgentMail HTTP ${res.status}`;
    throw new Error(`AgentMail API error ${res.status}: ${msg}`);
  }
  return data;
}

function readState() {
  const state = loadJsonState(STATE_PATH, { version: 1, processed: {} }, 'AgentMail support state');
  state.processed ||= {};
  state.unverifiedSenders ||= {};
  return state;
}

function writeState(state) { writeJsonState(STATE_PATH, state); }

function msgText(m) {
  return securityScanInboundEmail(m).lowerText;
}

function safeMsgText(m) {
  return securityScanInboundEmail(m).safeText;
}

function looksLikeCancellation(m) {
  const t = msgText(m);
  return /\b(cancel|cancellation|offboard|offboarding|terminate|termination|close account|stop service|end service|unsubscribe)\b/.test(t);
}

function displaySender(m) {
  const from = m.from || m.sender || m.reply_to;
  if (Array.isArray(from)) return from.join(', ');
  if (typeof from === 'object' && from) return from.email || from.address || JSON.stringify(from);
  return from || 'there';
}

function senderEmail(m) {
  const from = m.from || m.sender || m.reply_to;
  if (Array.isArray(from)) return senderEmail({ from: from[0] });
  if (typeof from === 'object' && from) return String(from.email || from.address || '').trim().toLowerCase();
  const raw = String(from || '');
  const match = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : '';
}

function harness(command, jsonArg) {
  const args = [command];
  if (jsonArg !== undefined) args.push(JSON.stringify(jsonArg));
  const out = execFileSync('/Users/AIAgenterminal/rrd-harness', args, { encoding: 'utf8', timeout: 120000 });
  return JSON.parse(out);
}

function isWebOffboardingQueueRecord(c) {
  return c?.catalyst === 'OFFBOARDING_REQUEST_WEB' || c?.businessProfile?.requestType === 'offboarding';
}

function emailDomain(email) {
  const s = String(email || '').trim().toLowerCase();
  const at = s.lastIndexOf('@');
  return at >= 0 ? s.slice(at + 1) : '';
}

const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com',
  'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me',
  'protonmail.com', 'pm.me', 'hey.com', 'mail.com', 'zoho.com'
]);

function clientEmailDomains(client) {
  const domains = new Set();
  const add = (email) => { const d = emailDomain(email); if (d) domains.add(d); };
  add(client?.email);
  for (const c of client?.contacts || []) add(c?.email);
  return domains;
}

function exactEmailMatch(client, email) {
  const e = String(email || '').trim().toLowerCase();
  return String(client?.email || '').trim().toLowerCase() === e
    || (client?.contacts || []).some(c => String(c?.email || '').trim().toLowerCase() === e);
}

function findClientForCancellationMessage(m) {
  const email = senderEmail(m);
  if (!email) return null;
  const domain = emailDomain(email);
  const active = harness('list', {}).filter(c => c?.id && !isWebOffboardingQueueRecord(c));

  // Exact email address match is always acceptable.
  const exact = active.filter(c => exactEmailMatch(c, email));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  // Otherwise require exactly one active client with the same business email domain.
  // Generic/public inbox domains are not accepted by domain alone.
  if (!domain || GENERIC_EMAIL_DOMAINS.has(domain)) return null;
  const byDomain = active.filter(c => clientEmailDomains(c).has(domain));
  return byDomain.length === 1 ? byDomain[0] : null;
}

function offboardingUrlForClient(client) {
  const rawBase = process.env.RRD_OFFBOARD_BASE || `${(process.env.RRD_WEB_BASE || 'https://flowaudit.co.uk/revenue-recovery').replace(/\/+$/, '')}/offboard`;
  const u = new URL(rawBase);
  const base = `${u.origin}${u.pathname.replace(/\/offboard\/?$/, '')}`;
  return signedClientActionUrl('offboard', client, 'offboarding', { base });
}

function offboardingReply(client) {
  if (!client?.id || !client?.email || !client?.company) {
    return `Thanks for reaching out — we can help with cancellation/offboarding.\n\nFor security, please send the cancellation request from your company/business email address so we can verify it against the active client account. We cannot send an offboarding link from an unverified address.\n\nPlease do not send API keys, passwords, or card details by email.`;
  }
  const url = offboardingUrlForClient(client);
  return `Thanks for reaching out — we can help with cancellation/offboarding.\n\nPlease complete the secure offboarding form here:\n${url}\n\nFor security, the company and business/billing email fields are pre-filled from the active account and cannot be changed. The request will not be processed unless the company and email match the active client record.\n\nWhat happens next:\n- Once the form is submitted, we email confirmation that it was received.\n- We calculate any amount owed up to the requested cancellation date.\n- If anything is due, we send a prorated payment link.\n- Once the final invoice is paid, we offboard the client profile, take down the active system/integrations, archive the account, and send confirmation.\n\nPlease do not send API keys, passwords, or card details by email.`;
}

function recordUnverifiedCancellationAttempt(state, email) {
  const key = String(email || 'unknown').trim().toLowerCase() || 'unknown';
  const entry = state.unverifiedSenders[key] || { count: 0, firstSeenAt: new Date().toISOString(), blocked: false };
  entry.count += 1;
  entry.lastSeenAt = new Date().toISOString();
  if (entry.count >= 3) {
    entry.blocked = true;
    entry.blockedAt ||= new Date().toISOString();
  }
  state.unverifiedSenders[key] = entry;
  return { key, ...entry };
}

function writeTempMessage(message) {
  const dir = `${OPERATOR_HOME}/.openclaw/agentmail-messages`;
  fs.mkdirSync(dir, { recursive: true });
  const file = `${dir}/${message.message_id || message.id || Date.now()}.json`;
  fs.writeFileSync(file, JSON.stringify(message, null, 2));
  fs.chmodSync(file, 0o600);
  return file;
}

function runCancellationPrepare(message) {
  const file = writeTempMessage(message);
  const out = execFileSync('/Users/AIAgenterminal/rrd-cancellation-offboard.mjs', ['prepare', file], { encoding: 'utf8', timeout: 120000 });
  return JSON.parse(out);
}

async function replyToMessage(messageId, text) {
  return agentmail('POST', `/inboxes/${encodeURIComponent(INBOX_ID)}/messages/${encodeURIComponent(messageId)}/reply`, { text });
}

async function updateLabels(messageId, addLabels = [], removeLabels = []) {
  const body = {};
  if (addLabels.length) body.add_labels = addLabels;
  if (removeLabels.length) body.remove_labels = removeLabels;
  return agentmail('PATCH', `/inboxes/${encodeURIComponent(INBOX_ID)}/messages/${encodeURIComponent(messageId)}`, body);
}

async function poll() {
  const state = readState();
  const data = await agentmail('GET', `/inboxes/${encodeURIComponent(INBOX_ID)}/messages`, undefined, { limit: 50 });
  const messages = data.messages || [];
  const events = [];
  for (const m of messages) {
    const id = m.message_id || m.id;
    if (!id || state.processed[id]) continue;
    const labels = new Set(m.labels || []);
    if (labels.has('rrd_processed') || labels.has('rrd_cancellation_form_sent')) {
      state.processed[id] = { seenAt: new Date().toISOString(), skippedLabel: true };
      continue;
    }
    const scan = securityScanInboundEmail(m);
    if (scan.suspicious) {
      await updateLabels(id, ['rrd_security_review', 'rrd_prompt_injection_suspected', 'rrd_processed'], ['unread']);
      state.processed[id] = {
        processedAt: new Date().toISOString(),
        type: 'security_review_prompt_injection',
        matches: scan.promptInjectionMatches.slice(0, 5),
      };
      events.push({ type: 'security_review_prompt_injection', from: displaySender(m), subject: m.subject || '', messageId: id });
      continue;
    }
    if (looksLikeCancellation(m)) {
      const form = parseOffboardingForm(safeMsgText(m));
      if (isAuthorizedOffboardingForm(form)) {
        const prepared = runCancellationPrepare(m);
        await updateLabels(id, ['rrd_cancellation', 'rrd_offboarding_prepared', 'rrd_processed'], ['unread']);
        state.processed[id] = { processedAt: new Date().toISOString(), type: 'cancellation_prepared', prepared };
        events.push({ type: 'cancellation_prepared', from: displaySender(m), subject: m.subject || '', messageId: id, prepared });
      } else {
        const client = findClientForCancellationMessage(m);
        if (client?.id) {
          const sent = await replyToMessage(id, offboardingReply(client));
          await updateLabels(id, ['rrd_cancellation', 'rrd_cancellation_form_sent', 'rrd_processed'], ['unread']);
          state.processed[id] = { processedAt: new Date().toISOString(), type: 'cancellation', clientId: client.id, reply: sent.message_id || sent.id || null };
          events.push({ type: 'cancellation_form_sent', from: displaySender(m), subject: m.subject || '', messageId: id, client: client.company || null });
        } else {
          const sender = senderEmail(m) || displaySender(m);
          const attempt = recordUnverifiedCancellationAttempt(state, sender);
          if (attempt.blocked && attempt.count >= 3) {
            await updateLabels(id, ['rrd_cancellation', 'rrd_unverified_sender_blocked', 'rrd_processed'], ['unread']);
            state.processed[id] = { processedAt: new Date().toISOString(), type: 'unverified_sender_blocked', sender: attempt.key, attempts: attempt.count };
            events.push({ type: 'unverified_sender_blocked', from: displaySender(m), sender: attempt.key, attempts: attempt.count, subject: m.subject || '', messageId: id });
          } else {
            const sent = await replyToMessage(id, offboardingReply(null));
            await updateLabels(id, ['rrd_cancellation', 'rrd_cancellation_needs_review', 'rrd_processed'], ['unread']);
            state.processed[id] = { processedAt: new Date().toISOString(), type: 'cancellation_needs_review', sender: attempt.key, attempts: attempt.count, reply: sent.message_id || sent.id || null };
            events.push({ type: 'cancellation_needs_review', from: displaySender(m), sender: attempt.key, attempts: attempt.count, subject: m.subject || '', messageId: id, client: null });
          }
        }
      }
    } else {
      await updateLabels(id, ['rrd_support_untriaged'], []);
      state.processed[id] = { processedAt: new Date().toISOString(), type: 'support_untriaged' };
      events.push({ type: 'support_untriaged', from: displaySender(m), subject: m.subject || '', messageId: id });
    }
  }
  writeState(state);
  if (events.length) console.log(JSON.stringify({ ok: true, inbox: INBOX_ID, events }, null, 2));
}

async function list() {
  const [inboxes, state] = await Promise.all([
    agentmail('GET', '/inboxes', undefined, { limit: 20 }),
    Promise.resolve(readState()),
  ]);
  console.log(JSON.stringify({ inbox: INBOX_ID, inboxes, state }, null, 2));
}

async function testSend(to) {
  if (!to) throw new Error('Usage: rrd-agentmail-support.mjs test-send <email>');
  const sent = await agentmail('POST', `/inboxes/${encodeURIComponent(INBOX_ID)}/messages/send`, {
    to,
    subject: 'Flow Audit support inbox test',
    text: 'This is a test from the Flow Audit / Revenue Recovery Desk support inbox.',
  });
  console.log(JSON.stringify({ ok: true, sent }, null, 2));
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'poll') return poll();
  if (cmd === 'list') return list();
  if (cmd === 'test-send') return testSend(args[0]);
  throw new Error('Usage: rrd-agentmail-support.mjs poll|list|test-send <email>');
}

withJobLock('rrd-agentmail-support', main, { staleMs: 30 * 60 * 1000 }).catch(err => { console.error(err.message); process.exit(1); });
