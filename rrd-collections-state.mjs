#!/usr/bin/env node
/**
 * Durable collections ledger for RRD recovery cycles.
 *
 * Purpose:
 * - Do not redraft the same communication for the same invoice on every run.
 * - Track which rung was already drafted/sent/blocked.
 * - Wait the client's/SOP cadence before the next rung is eligible.
 * - Mark accounts paid/resolved when they disappear from the overdue feed.
 *
 * No secret values are stored here: invoice ids, customer labels/emails, amounts,
 * statuses, timestamps, and outcomes only.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { assertSafeProfile } from "./rrd-profile-safety.mjs";

const DEFAULT_DIR = process.env.RRD_COLLECTIONS_DIR || path.join(os.homedir(), ".openclaw", "rrd-collections");
const DEFAULT_FOLLOWUP_DAYS = Number(process.env.RRD_FOLLOWUP_INTERVAL_DAYS || 7) || 7;

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
function safeProfile(profile) { return assertSafeProfile(profile || "rr-unknown"); }
export function statePath(profile, { dir = DEFAULT_DIR } = {}) { return path.join(dir, `${safeProfile(profile)}.json`); }

export function invoiceKey(inv = {}, source = "stripe") {
  return `${source}:${String(inv.id || inv.number || inv.hostedInvoiceUrl || "unknown")}`;
}

export function loadState(profile, opts = {}) {
  const file = opts.path || statePath(profile, opts);
  let state = { version: 1, profile, createdAt: new Date(opts.nowMs || Date.now()).toISOString(), invoices: {}, runs: [] };
  if (fs.existsSync(file)) {
    try { state = { ...state, ...JSON.parse(fs.readFileSync(file, "utf8")) }; }
    catch (e) {
      if (e instanceof SyntaxError) {
        const quarantine = `${file}.corrupt.${Date.now()}`;
        try { fs.renameSync(file, quarantine); } catch { /* best effort */ }
        throw new Error(`Collections state is corrupt for ${profile}; quarantined at ${quarantine}. Recovery is blocked until reviewed.`);
      }
      throw e;
    }
  }
  state.profile = profile;
  state.invoices ||= {};
  state.runs ||= [];
  return state;
}

export function saveState(profile, state, opts = {}) {
  const file = opts.path || statePath(profile, opts);
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  return file;
}

export function cadenceDays(manifest = {}, env = process.env) {
  const fromEnv = Number(env.RRD_FOLLOWUP_INTERVAL_DAYS || env.COLLECTION_FOLLOWUP_DAYS || "");
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  const sop = manifest.sop || {};
  const auto = manifest.automation || {};
  const candidates = [sop.followUpIntervalDays, sop.followupIntervalDays, auto.followUpIntervalDays, auto.collectionFollowUpDays];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_FOLLOWUP_DAYS;
}

export function shouldDraftInvoice(state, inv, { source = "stripe", rung, nowMs = Date.now(), followUpDays = DEFAULT_FOLLOWUP_DAYS } = {}) {
  const key = invoiceKey(inv, source);
  const row = state.invoices[key];
  if (!row) return { draft: true, key, reason: "new_invoice" };
  if (row.status === "paid_or_resolved") return { draft: true, key, reason: "reappeared_after_resolution" };
  if (row.rungs && row.rungs[rung]) return { draft: false, key, reason: `rung_already_drafted:${rung}` };
  const next = row.nextEligibleAt ? Date.parse(row.nextEligibleAt) : 0;
  if (next && Number.isFinite(next) && nowMs < next) {
    return { draft: false, key, reason: `waiting_until:${row.nextEligibleAt}` };
  }
  return { draft: true, key, reason: "next_rung_due" };
}

export function markSeen(state, inv, { source = "stripe", nowMs = Date.now() } = {}) {
  const key = invoiceKey(inv, source);
  const iso = new Date(nowMs).toISOString();
  const row = state.invoices[key] || { key, source, firstSeenAt: iso, rungs: {}, history: [] };
  row.status = "active";
  row.lastSeenAt = iso;
  row.invoiceId = inv.id || row.invoiceId;
  row.number = inv.number || row.number;
  row.customerEmail = inv.customerEmail || row.customerEmail;
  row.customerName = inv.customerName || row.customerName;
  row.amount = inv.amount;
  row.currency = inv.currency;
  row.daysOverdue = inv.daysOverdue;
  state.invoices[key] = row;
  return key;
}

export function markDrafted(state, inv, { source = "stripe", rung, outcome, subject, nowMs = Date.now(), followUpDays = DEFAULT_FOLLOWUP_DAYS } = {}) {
  const key = markSeen(state, inv, { source, nowMs });
  const row = state.invoices[key];
  const iso = new Date(nowMs).toISOString();
  row.lastDraftedAt = iso;
  row.nextEligibleAt = new Date(nowMs + followUpDays * 86400000).toISOString();
  row.rungs ||= {};
  row.rungs[rung] = { at: iso, outcome, subject };
  row.history ||= [];
  row.history.push({ at: iso, event: "drafted", rung, outcome, subject });
  return key;
}

export function closeUnseen(state, seenKeys = new Set(), { nowMs = Date.now(), reason = "not_in_overdue_feed" } = {}) {
  const iso = new Date(nowMs).toISOString();
  const closed = [];
  for (const [key, row] of Object.entries(state.invoices || {})) {
    if (row.status === "active" && !seenKeys.has(key)) {
      row.status = "paid_or_resolved";
      row.closedAt = iso;
      row.closeReason = reason;
      row.history ||= [];
      row.history.push({ at: iso, event: "closed", reason });
      closed.push(key);
    }
  }
  return closed;
}

export function recordRun(state, summary = {}, { nowMs = Date.now() } = {}) {
  state.lastRunAt = new Date(nowMs).toISOString();
  state.runs ||= [];
  state.runs.push({ at: state.lastRunAt, summary });
  if (state.runs.length > 100) state.runs = state.runs.slice(-100);
}
