#!/usr/bin/env node
/**
 * rrd-letter-queue.mjs — converts client Postal Portal signed approvals into
 * gated PostGrid sends.
 *
 * Safety model:
 * - client dashboard only writes `letter_approval` artifacts;
 * - this operator-side worker verifies the matching source letter event + signed
 *   approval artifact;
 * - it builds a Letter action and calls rrd-recover.execute(..., send:true), so
 *   guardrails/caps/tool allowlist/PostGrid key selection still decide dispatch;
 * - if required PostGrid mailing fields are missing, it records a blocked event
 *   instead of sending.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execute } from "./rrd-recover.mjs";
import { assertSafeProfile } from "./rrd-profile-safety.mjs";

const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || "/Users/AIAgenterminal";
const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "";
const DEFAULT_LIMIT = Math.max(1, Math.min(Number(process.env.RRD_LETTER_QUEUE_LIMIT || 10) || 10, 50));

function serviceHeaders(extra = {}) {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...extra };
}
async function rest(resource, init = {}) {
  if (!URL_BASE || !SERVICE_KEY) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for letter queue processing.");
  const r = await fetch(`${URL_BASE}/rest/v1/${resource}`, { ...init, headers: serviceHeaders(init.headers) });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(data?.message || data?.error || text || `Supabase ${r.status}`);
  return data;
}
function sha1(s) { return crypto.createHash("sha1").update(String(s)).digest("hex"); }
function sha256(s) { return crypto.createHash("sha256").update(String(s)).digest("hex"); }
function esc(s) { return String(s ?? "").replace(/[&<>\"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c])); }
function cleanText(v, max = 2000) { return String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
export function eventKey(e = {}) { return [e.invoice_id, e.channel, e.customer_name].join("|"); }

function parseEnvFile(file) {
  const out = {};
  if (!file || !fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [k, ...rest] = line.split("=");
    let v = rest.join("=").trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k.trim()] = v;
  }
  return out;
}
function profileEnv(profile) {
  profile = assertSafeProfile(profile);
  return parseEnvFile(path.join(process.env.HERMES_PROFILES_DIR || path.join(OPERATOR_HOME, ".hermes", "profiles"), profile, ".env"));
}
function parseJsonish(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(String(v)); } catch { return null; }
}
function encryptionKey(env = process.env) {
  const secret = env.RRD_SIGNATURE_ENCRYPTION_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY || "";
  if (!secret) throw new Error("Missing signature encryption key for letter approval verification.");
  return crypto.createHash("sha256").update(secret).digest();
}
export function decryptSignature(signature, { env = process.env } = {}) {
  const sig = obj(signature);
  if (sig.alg !== "aes-256-gcm" || !sig.iv || !sig.tag || !sig.data) throw new Error("Invalid encrypted signature artifact.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(env), Buffer.from(sig.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sig.tag, "base64"));
  const text = Buffer.concat([decipher.update(Buffer.from(sig.data, "base64")), decipher.final()]).toString("utf8");
  if (sig.sha256 && sha256(text) !== sig.sha256) throw new Error("Signature hash mismatch.");
  return text;
}
function paragraphs(text) {
  return String(text || "").split(/\n{2,}|\r?\n/).map(p => cleanText(p, 3000)).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join("\n");
}
function defaultFromAddress(profile, env = {}) {
  return parseJsonish(env.RRD_POSTGRID_FROM_JSON || env.POSTGRID_FROM_JSON || env.LETTER_FROM_JSON) || null;
}
function validAddress(a = {}) {
  return !!(a && (a.addressLine1 || a.line1) && a.city && (a.provinceOrState || a.province || a.state) && (a.postalOrZip || a.postal || a.zip) && a.country);
}
function normalizeAddress(a = {}) {
  return {
    firstName: a.firstName || a.first_name || undefined,
    lastName: a.lastName || a.last_name || undefined,
    companyName: a.companyName || a.company || a.name || undefined,
    addressLine1: a.addressLine1 || a.line1 || a.street || a.street1 || undefined,
    addressLine2: a.addressLine2 || a.line2 || a.street2 || undefined,
    city: a.city || a.town || undefined,
    provinceOrState: a.provinceOrState || a.province || a.state || a.region || a.county || undefined,
    postalOrZip: a.postalOrZip || a.postal || a.zip || a.postcode || a.postalCode || undefined,
    country: a.country || a.countryCode || a.country_code || undefined
  };
}
function coerceAddress(v) {
  if (!v) return null;
  if (typeof v === "string") return parseAddressText(v);
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const direct = normalizeAddress(v);
  if (validAddress(direct)) return direct;
  for (const key of ["address", "mailingAddress", "postalAddress", "billingAddress", "shippingAddress", "registeredAddress", "primaryAddress"]) {
    const nested = coerceAddress(v[key]);
    if (validAddress(nested)) return nested;
  }
  return null;
}
function stripHtmlToLines(text = "") {
  return String(text)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .split(/\r?\n/).map(l => cleanText(l, 240)).filter(Boolean);
}
function parseAddressText(text = "") {
  const lines = stripHtmlToLines(text);
  const uk = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
  const northAmerica = /\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?|[A-Z]\d[A-Z]\s*\d[A-Z]\d)\b/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ukMatch = line.match(uk);
    const naMatch = line.match(northAmerica);
    if (!ukMatch && !naMatch) continue;
    const countryLine = lines[i + 1] && /^(gb|uk|united kingdom|us|usa|united states|canada|ca)$/i.test(lines[i + 1]) ? lines[i + 1] : "";
    if (naMatch) {
      const cityState = line.slice(0, naMatch.index).replace(/[,\s]+$/, "");
      const block = lines.slice(Math.max(0, i - 4), i).filter(Boolean);
      const addressLine1 = block.length > 1 ? block[block.length - 1] : block[0];
      const companyName = block.length > 1 ? block.slice(0, -1).join(" ") : undefined;
      return normalizeAddress({ companyName, addressLine1, city: cityState || undefined, provinceOrState: naMatch[1], postalOrZip: naMatch[2], country: /canada|ca/i.test(countryLine) || /^[A-Z]\d[A-Z]/i.test(naMatch[2]) ? "CA" : "US" });
    }
    const block = lines.slice(Math.max(0, i - 4), i).filter(Boolean);
    const city = block[block.length - 1];
    const addressLine1 = block.length > 1 ? block[block.length - 2] : undefined;
    const companyName = block.length > 2 ? block.slice(0, -2).join(" ") : undefined;
    return normalizeAddress({ companyName, addressLine1, city, provinceOrState: city, postalOrZip: ukMatch[0].toUpperCase(), country: /^(us|usa|united states)$/i.test(countryLine) ? "US" : "GB" });
  }
  return null;
}
function findContactAddress(contacts, source = {}) {
  const list = Array.isArray(contacts) ? contacts : [];
  const email = cleanText(source.customer_email || source.email || "").toLowerCase();
  const name = cleanText(source.customer_name || source.name || "").toLowerCase();
  const scored = list.map(c => ({ c, score: (email && String(c.email || c.customer_email || "").toLowerCase() === email ? 4 : 0) + (name && String(c.name || c.companyName || c.company || "").toLowerCase().includes(name) ? 2 : 0) + (coerceAddress(c) ? 1 : 0) }))
    .filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.length ? coerceAddress(scored[0].c) : null;
}
function firstValidAddress(candidates = []) {
  for (const candidate of candidates) {
    const address = coerceAddress(candidate);
    if (validAddress(address)) return address;
  }
  return null;
}
function resolveRecipientAddress({ actionTemplate = {}, sourceMeta = {}, source = {} } = {}) {
  return firstValidAddress([
    actionTemplate.to, sourceMeta.to, sourceMeta.toAddress, sourceMeta.recipientAddress, sourceMeta.postgridTo,
    sourceMeta.customerAddress, sourceMeta.contactAddress, sourceMeta.debtorAddress, sourceMeta.billingAddress, sourceMeta.mailingAddress,
    sourceMeta.customer, sourceMeta.contact, sourceMeta.debtor, sourceMeta.recipient, sourceMeta.invoice, sourceMeta.account,
    findContactAddress(actionTemplate.contacts, source), findContactAddress(sourceMeta.contacts, source),
    actionTemplate.addressBlock, sourceMeta.addressBlock, sourceMeta.recipientAddressBlock, sourceMeta.letterAddressBlock,
    actionTemplate.html, actionTemplate.text, sourceMeta.previewText, sourceMeta.letterText, sourceMeta.draftText
  ]);
}
function resolveSenderAddress({ actionTemplate = {}, sourceMeta = {}, env = {} } = {}) {
  return firstValidAddress([
    actionTemplate.from, sourceMeta.from, sourceMeta.fromAddress, sourceMeta.postgridFrom, sourceMeta.senderAddress,
    defaultFromAddress(null, env)
  ]);
}

export function buildApprovedLetterAction({ approval, source, profileEnv: env = {}, signatureDataUrl = "" } = {}) {
  const meta = obj(approval?.meta);
  const sourceMeta = obj(source?.meta);
  if (!approval || !source) throw new Error("Approval and source letter event are required.");
  if (meta.letterKey !== eventKey(source)) throw new Error("Approval letterKey does not match source letter event.");
  if (!meta.signerName || !meta.signerTitle) throw new Error("Approval is missing signer name/title.");
  if (!meta.signature || !meta.signatureHash) throw new Error("Approval is missing encrypted signature artifact.");
  if (signatureDataUrl && sha256(signatureDataUrl) !== meta.signatureHash) throw new Error("Decrypted signature does not match approval hash.");

  const actionTemplate = obj(sourceMeta.postgridAction || sourceMeta.letterAction || sourceMeta.sendAction);
  const to = resolveRecipientAddress({ actionTemplate, sourceMeta, source });
  const from = resolveSenderAddress({ actionTemplate, sourceMeta, env });
  if (!validAddress(to)) throw new Error("Source letter is missing a PostGrid recipient mailing address from the source event, connected-system contact, or letter preview.");
  if (!validAddress(from)) throw new Error("Source letter is missing a PostGrid sender/from mailing address.");

  const subject = sourceMeta.subject || actionTemplate.subject || `Overdue invoice ${source.invoice_number || source.invoice_id || "reminder"}`;
  const draft = sourceMeta.draftText || actionTemplate.text || `Dear ${source.customer_name || "Customer"},\n\nPlease arrange payment for ${source.invoice_number || source.invoice_id || "your overdue invoice"}.`;
  const sig = signatureDataUrl ? `<p><img alt="Signature" style="max-width:310px;max-height:88px" src="${signatureDataUrl}"></p>` : "";
  const signer = `<p>Sincerely,<br>${esc(meta.signerName)}<br>${esc(meta.signerTitle)}</p>`;
  const html = actionTemplate.html || `<!doctype html><html><body><h2>${esc(subject)}</h2>${paragraphs(draft)}${sig}${signer}</body></html>`;

  return {
    ...actionTemplate,
    channel: "Letter",
    tool: "send_via_executor",
    approved: true,
    atHour: new Date().getHours(),
    to,
    from,
    html,
    pdfUrl: actionTemplate.pdfUrl,
    pdf: actionTemplate.pdf,
    mailingClass: actionTemplate.mailingClass || sourceMeta.mailingClass || "first_class",
    certified: !!(actionTemplate.certified ?? sourceMeta.certified ?? /formal|firm|legal|certified/i.test(String(source.rung || ""))),
    invoiceId: source.invoice_id,
    invoiceNumber: source.invoice_number,
    rung: source.rung,
    costUsd: Number(actionTemplate.costUsd || sourceMeta.costUsd || 0) || 0,
    metadata: {
      ...(actionTemplate.metadata || {}),
      sourceEventId: source.id,
      approvalEventId: approval.id,
      letterKey: meta.letterKey,
      previewHash: meta.previewHash,
      signatureHash: meta.signatureHash,
      signerName: meta.signerName,
      signerTitle: meta.signerTitle
    }
  };
}

async function fetchSourceEvent(submissionId, approvalMeta, deps) {
  if (deps?.fetchSourceEvent) return deps.fetchSourceEvent(submissionId, approvalMeta);
  const id = approvalMeta.sourceEventId;
  if (id) {
    const rows = await rest(`recovery_events?id=eq.${encodeURIComponent(id)}&submission_id=eq.${encodeURIComponent(submissionId)}&select=*`);
    return rows && rows[0];
  }
  const rows = await rest(`recovery_events?submission_id=eq.${encodeURIComponent(submissionId)}&requires_human=eq.true&channel=ilike.*Letter*&select=*&order=occurred_at.desc&limit=500`);
  return (rows || []).find(e => eventKey(e) === approvalMeta.letterKey);
}
async function writeEvent(event, deps) {
  if (deps?.writeEvent) return deps.writeEvent(event);
  const rows = await rest("recovery_events", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(event) });
  return rows && rows[0] ? rows[0] : event;
}
function eventBase({ approval, source, type, outcome, meta }) {
  const now = new Date().toISOString();
  return {
    submission_id: approval.submission_id,
    profile: approval.profile,
    dedupe_key: sha1(`${approval.id}|${type}|${meta.providerId || meta.error || ""}`),
    event_type: type,
    occurred_at: now,
    invoice_id: source.invoice_id,
    invoice_number: source.invoice_number,
    customer_name: source.customer_name,
    customer_email: source.customer_email,
    amount_usd: source.amount_usd,
    currency: source.currency,
    channel: "Letter",
    rung: source.rung,
    outcome,
    requires_human: false,
    allowed: type === "letter_postgrid_sent",
    meta: { ...meta, approvalEventId: approval.id, sourceEventId: source.id, recordedAt: now }
  };
}

export async function processApproval(approval, { dryRun = false, deps = {} } = {}) {
  const profile = assertSafeProfile(approval.profile);
  const meta = obj(approval.meta);
  if (approval.event_type !== "letter_approval") return { skipped: true, reason: "not_letter_approval" };
  if (meta.sendGate !== "approved_for_executor_review" && meta.sendGate !== "blocked_until_letter_executor_verifies_signed_approval") return { skipped: true, reason: "not_queued" };
  const source = await fetchSourceEvent(approval.submission_id, meta, deps);
  if (!source) throw new Error("Matching source letter event was not found.");
  let signatureDataUrl = "";
  if (!dryRun) signatureDataUrl = (deps.decryptSignature || decryptSignature)(meta.signature, deps);
  const env = deps.profileEnv || { ...process.env, ...profileEnv(profile) };
  let action;
  try {
    action = buildApprovedLetterAction({ approval, source, profileEnv: env, signatureDataUrl });
  } catch (e) {
    const blocked = eventBase({ approval, source, type: "letter_postgrid_blocked", outcome: "blocked_missing_send_fields", meta: { letterKey: meta.letterKey, error: e.message } });
    if (!dryRun) await writeEvent(blocked, deps);
    return { sent: false, blocked: true, error: e.message, event: dryRun ? blocked : undefined };
  }
  if (dryRun) return { dryRun: true, action: { ...action, html: action.html ? "[html omitted]" : undefined } };

  const result = await (deps.execute || execute)(profile, action, { send: true, deps: deps.executorDeps || {} });
  if (result.sent) {
    const providerId = result.result && (result.result.id || result.result.letterId);
    await writeEvent(eventBase({ approval, source, type: "letter_postgrid_sent", outcome: "sent_to_postgrid", meta: { letterKey: meta.letterKey, providerId, providerStatus: result.result && result.result.status, previewHash: meta.previewHash, signatureHash: meta.signatureHash } }), deps);
  } else {
    await writeEvent(eventBase({ approval, source, type: "letter_postgrid_blocked", outcome: "blocked_by_executor", meta: { letterKey: meta.letterKey, decision: result.decision || null } }), deps);
  }
  return result;
}

async function fetchQueuedApprovals(limit = DEFAULT_LIMIT, deps) {
  if (deps?.fetchQueuedApprovals) return deps.fetchQueuedApprovals(limit);
  const rows = await rest(`recovery_events?event_type=eq.letter_approval&order=occurred_at.asc&limit=${limit}&select=*`);
  const terminal = await rest(`recovery_events?event_type=in.(letter_postgrid_sent,letter_postgrid_blocked)&select=meta`);
  const done = new Set((terminal || []).map(r => obj(r.meta).approvalEventId).filter(Boolean).map(String));
  return (rows || []).filter(r => !done.has(String(r.id)) && ["approved_for_executor_review", "blocked_until_letter_executor_verifies_signed_approval"].includes(obj(r.meta).sendGate));
}

export async function runOnce({ limit = DEFAULT_LIMIT, dryRun = false, deps = {} } = {}) {
  const approvals = await fetchQueuedApprovals(limit, deps);
  const results = [];
  for (const approval of approvals) {
    try { results.push({ approvalId: approval.id, ...(await processApproval(approval, { dryRun, deps })) }); }
    catch (e) { results.push({ approvalId: approval.id, sent: false, error: e.message }); }
  }
  return { ok: true, dryRun, scanned: approvals.length, results };
}

function usage() {
  console.error(`rrd-letter-queue — process signed Postal Portal approvals into gated PostGrid sends\n\nUsage:\n  rrd-letter-queue run [--limit N] [--dry-run]\n`);
}
async function main() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd || ["-h", "--help", "help"].includes(cmd)) { usage(); process.exit(cmd ? 0 : 1); }
  if (cmd !== "run") { usage(); process.exit(1); }
  let dryRun = false, limit = DEFAULT_LIMIT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--limit") limit = Math.max(1, Math.min(Number(args[++i]) || DEFAULT_LIMIT, 50));
  }
  console.log(JSON.stringify(await runOnce({ limit, dryRun }), null, 2));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
