import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertSafeProfile } from './rrd-profile-safety.mjs';

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const DEFAULT_OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || '/Users/AIAgenterminal';
const DEFAULT_EVENT_DIR = process.env.RRD_EVENTS_DIR || path.join(DEFAULT_OPERATOR_HOME, '.openclaw', 'rrd-events');

export function initialClientPassword(len = 25, { randomBytes = crypto.randomBytes } = {}) {
  if (!Number.isInteger(len) || len < 12) throw new Error('Password length must be at least 12 characters.');
  const alphabet = PASSWORD_ALPHABET;
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  let out = '';
  while (out.length < len) {
    for (const b of randomBytes(Math.max(len, 32))) {
      if (b >= limit) continue;
      out += alphabet[b % alphabet.length];
      if (out.length >= len) break;
    }
  }
  return out;
}

function sha1(s) { return crypto.createHash('sha1').update(String(s)).digest('hex'); }
function arr(x) { return Array.isArray(x) ? x : []; }
function cleanString(v, max = 500) { return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim()); }
function compactObject(o) { return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')); }
function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

export function eventTypeForResult(result = {}) {
  if (result.eventType) return result.eventType;
  if (result.outcome === 'sent') return 'send_dispatch';
  if (result.outcome === 'would_send' || result.outcome === 'blocked') return 'gate_decision';
  if (result.outcome === 'closed' || result.outcome === 'paid') return 'collection_paid';
  if (result.outcome === 'already_tracked') return 'collection_state';
  if (result.outcome === 'skipped') return 'outcome';
  return 'outcome';
}

export function normalizeRecoveryEvent({ profile, submissionId, result, occurredAt = new Date().toISOString(), meta = {} } = {}) {
  if (!profile) throw new Error('profile is required');
  profile = assertSafeProfile(profile);
  if (!submissionId) throw new Error('submissionId is required');
  const r = result || {};
  const eventType = eventTypeForResult(r);
  const invoiceKey = r.invoiceId || r.number || r.customer || 'run';
  const outcome = r.outcome || 'unknown';
  const rung = r.rung || '';
  const dedupe_key = sha1([profile, eventType, invoiceKey, rung, occurredAt, outcome].join('|'));
  const violations = arr(r.violations).map((v) => typeof v === 'string' ? v : (v && (v.code || v.message || v.msg))).filter(Boolean).map(String);
  const amount = Number(r.amountUsd ?? r.amount_usd ?? r.amount);
  const recovered = eventType === 'collection_paid' ? (Number.isFinite(amount) ? amount : null) : null;
  const resultId = r.result && typeof r.result === 'object' ? (r.result.id || r.result.message_id || r.result.status) : undefined;
  return compactObject({
    submission_id: submissionId,
    profile,
    dedupe_key,
    event_type: eventType,
    occurred_at: occurredAt,
    invoice_id: r.invoiceId || r.invoice_id,
    invoice_number: r.number || r.invoiceNumber || r.invoice_number,
    customer_name: r.customer || r.customerName || r.customer_name,
    customer_email: r.email || r.customerEmail || r.customer_email,
    amount_usd: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : undefined,
    currency: r.currency,
    days_overdue: Number.isFinite(Number(r.daysOverdue)) ? Number(r.daysOverdue) : undefined,
    channel: r.channel || 'Email',
    rung,
    outcome,
    allowed: eventType === 'send_dispatch' ? true : eventType === 'gate_decision' ? outcome !== 'blocked' : undefined,
    requires_human: !!r.requiresHuman,
    violations,
    payment_url: r.paymentUrl || r.payment_url,
    recovered_usd: recovered,
    agreement: r.agreement,
    meta: compactObject({
      subject: r.subject,
      reason: r.reason,
      source: r.source,
      result_id: resultId,
      ...meta,
    }),
  });
}

export function appendRecoveryEvents(profile, { manifest = {}, results = [], occurredAt = new Date().toISOString(), meta = {} } = {}, { dir = DEFAULT_EVENT_DIR } = {}) {
  profile = assertSafeProfile(profile);
  const submissionId = manifest.submissionId || manifest.submission_id || manifest.id || manifest.submission?.id;
  if (!submissionId) return { written: 0, skipped: results.length, reason: 'manifest missing submission id' };
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${profile}.ndjson`);
  const rows = results.map((result) => normalizeRecoveryEvent({ profile, submissionId, result, occurredAt, meta }));
  if (rows.length) {
    fs.appendFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch {}
  }
  return { written: rows.length, file };
}

function normalizeBusinessInfo(info = {}, row = {}) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(info, 'company')) patch.company = cleanString(info.company, 180);
  if (Object.prototype.hasOwnProperty.call(info, 'industry')) patch.industry = cleanString(info.industry, 120);
  if (Object.prototype.hasOwnProperty.call(info, 'size')) patch.size = cleanString(info.size, 120);
  if (Object.prototype.hasOwnProperty.call(info, 'website')) patch.website = cleanString(info.website, 240);
  if (Object.prototype.hasOwnProperty.call(info, 'primaryContact')) patch.primary_contact = cleanString(info.primaryContact, 180);
  if (Object.prototype.hasOwnProperty.call(info, 'phone')) patch.phone = cleanString(info.phone, 80);
  if (Object.prototype.hasOwnProperty.call(info, 'address')) patch.business_profile = { ...(row.business_profile || {}), address: cleanString(info.address, 300) };
  return patch;
}

function normalizeContacts(items) {
  return arr(items).slice(0, 25).map((c) => {
    const email = cleanString(c.email || '', 254).toLowerCase();
    if (email && !validEmail(email)) throw new Error(`Invalid contact email: ${email}`);
    return compactObject({
      name: cleanString(c.name || c.contactName || '', 120),
      role: cleanString(c.role || c.title || '', 120),
      email,
      phone: cleanString(c.phone || '', 80),
      tags: arr(c.tags).map((t) => cleanString(t, 40)).filter(Boolean).slice(0, 10),
    });
  }).filter((c) => c.name || c.email || c.role || c.phone);
}

function normalizeApprovalRouting(ar = {}) {
  const approvers = arr(ar.approvers).map((x) => cleanString(x, 254).toLowerCase()).filter(Boolean);
  for (const a of approvers) if (a.includes('@') && !validEmail(a)) throw new Error(`Invalid approver email: ${a}`);
  return compactObject({
    approvers,
    preferredChannel: cleanString(ar.preferredChannel || ar.channel || '', 60),
    slaHours: ar.slaHours == null ? undefined : Math.max(1, Math.min(168, Number(ar.slaHours) || 24)),
  });
}

function normalizeLetterSettings(letters = {}, submissionId = '') {
  const out = {};
  if (letters.returnAddress && typeof letters.returnAddress === 'object') {
    out.returnAddress = compactObject({
      name: cleanString(letters.returnAddress.name, 120),
      line1: cleanString(letters.returnAddress.line1, 160),
      line2: cleanString(letters.returnAddress.line2, 160),
      city: cleanString(letters.returnAddress.city, 80),
      region: cleanString(letters.returnAddress.region, 80),
      postalCode: cleanString(letters.returnAddress.postalCode || letters.returnAddress.postcode, 40),
      country: cleanString(letters.returnAddress.country, 80),
    });
  }
  if (letters.mailClass != null) {
    const v = cleanString(letters.mailClass, 40).toLowerCase();
    if (!['standard', 'first_class', 'certified', 'registered', 'tracked'].includes(v)) throw new Error('Invalid letter mailing class.');
    out.mailClass = v;
  }
  if (letters.certifiedOnDemand != null) out.certifiedOnDemand = !!letters.certifiedOnDemand;
  if (letters.templatePath != null) {
    const p = cleanString(letters.templatePath, 500);
    if (!p.startsWith(`${submissionId}/`)) throw new Error('Letter template path must stay inside this client folder.');
    out.templatePath = p;
  }
  return out;
}

export function mergeClientSettings(row = {}, body = {}, { submissionId = row.id } = {}) {
  if (!submissionId) throw new Error('submission id is required');
  const patch = {};
  const reasons = new Set();
  if (body.businessInfo && typeof body.businessInfo === 'object') {
    Object.assign(patch, normalizeBusinessInfo(body.businessInfo, row));
    reasons.add('business_info_changed');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'contacts')) {
    patch.contacts = normalizeContacts(body.contacts);
    reasons.add('contacts_changed');
  }
  const existingGuardrails = clone(row.guardrails || {});
  let guardrails = existingGuardrails;
  if (body.approvalRouting) {
    guardrails = { ...guardrails, approvalRouting: normalizeApprovalRouting(body.approvalRouting) };
    reasons.add('approval_changed');
  }
  if (body.outreachMode) {
    const mode = cleanString(body.outreachMode, 20).toLowerCase();
    if (!['auto', 'draft'].includes(mode)) throw new Error('Invalid outreach mode.');
    guardrails = {
      ...guardrails,
      approvalModel: mode === 'auto' ? 'auto_email_sms_letter_signer_gated' : 'draft_requires_approval',
      autoSendChannels: mode === 'auto' ? ['Email', 'SMS'] : [],
    };
    reasons.add('policy_changed');
  }
  if (body.guardrails && Array.isArray(body.guardrails.autoSendChannels)) {
    const channels = body.guardrails.autoSendChannels.map((x) => cleanString(x, 20)).filter(Boolean);
    if (channels.some((x) => /^letter$/i.test(x))) throw new Error('Letter cannot be auto-sent; physical letters always require signer approval.');
    const allowed = channels.filter((x) => /^(email|sms)$/i.test(x)).map((x) => x.toLowerCase() === 'sms' ? 'SMS' : 'Email');
    guardrails = { ...guardrails, autoSendChannels: [...new Set(allowed)] };
    reasons.add('policy_changed');
  }
  if (guardrails !== existingGuardrails) patch.guardrails = guardrails;

  if (body.letters) {
    const existing = clone(row.recovery_process || {});
    patch.recovery_process = { ...existing, letter: { ...(existing.letter || {}), ...normalizeLetterSettings(body.letters, submissionId) } };
    reasons.add('letter_changed');
  }
  return { patch, reasons: [...reasons] };
}
