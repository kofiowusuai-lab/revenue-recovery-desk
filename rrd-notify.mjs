#!/usr/bin/env node
/**
 * rrd-notify.mjs — notify the recoverydesk Hermes whenever a new client onboards.
 *
 * Polls Supabase for submissions created since the last check and delivers a
 * concise summary to the recoverydesk Telegram home channel via `hermes send`
 * (no LLM, no agent loop). State is a single timestamp in .rrd-notify-state.json.
 * On first run it initializes to "now" so existing rows are never re-announced.
 *
 * Run via the rrd-notify wrapper (sets PATH + sources .env.local).
 */

import { rowToRecord } from "./rrd-hermes.mjs";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { withJobLock } from './rrd-job-lock.mjs';
import { loadJsonState, writeJsonState } from './rrd-state-file.mjs';

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const STATE = "/Users/AIAgenterminal/.rrd-notify-state.json";
const SEND = os.homedir() + "/.local/bin/recoverydesk";

function loadState() { return loadJsonState(STATE, null, 'new-client notifier state'); }
function saveState(s) { writeJsonState(STATE, s); }

async function rest(path) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

const yn = (v) => (v ? "yes" : "no");
const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");

function summary(s) {
  const facts = [
    s.priority ? `${s.priority.toLowerCase()} priority` : null,
    s.approxOutstanding ? `about ${money(s.approxOutstanding)} owed` : null
  ].filter(Boolean).join(" and ");
  return `🆕 New client just came in: ${s.company || "a new business"}${s.industry ? ` (${s.industry})` : ""}.`
    + (facts ? ` Looks like ${facts}.` : "")
    + ` Let me take a look and I'll send over a recommendation.`;
}

// deliver new-client notices to the RRD Operations bot/channel, not the main Hermes chat.
async function sendMsg(text) {
  const token = process.env.RRD_OPS_BOT_TOKEN || process.env.RRD_APPROVAL_TELEGRAM_BOT_TOKEN || "";
  const chatId = process.env.RRD_OPS_CHAT_ID || process.env.RRD_APPROVAL_TELEGRAM_CHAT_ID || "";
  if (!token || !chatId) {
    // Last-resort fallback keeps notifications alive if Ops routing is misconfigured.
    execFileSync(SEND, ["send", "--to", "telegram", "--quiet", text], { stdio: ["ignore", "ignore", "inherit"] });
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`RRD Ops Telegram send failed ${res.status}: ${body.slice(0, 300)}`);
}

// run the recoverydesk agent (gpt-5.5) to draft a grounded provisioning recommendation.
// The agent inspects the client via the harness + a dry-run provision before recommending.
function agentRecommendation(id) {
  const prompt =
    `A new client just onboarded to the Revenue Recovery Desk (id ${id}). ` +
    `Quietly check them with the harness first — run rrd-harness get '"${id}"' and rrd-provision --dry-run ${id} so you understand how ready they are and which integration keys they'll need — but do NOT paste any of that raw output. ` +
    `Then write me a short recommendation in plain, natural English, like you're texting a teammate. Two to four full sentences. ` +
    `Say which company it is, whether we should set them up now and why (in words — e.g. their payment system and CRM are already connected, they gave us consent to contact their customers, they handed over their collections process), roughly how much they're owed and how urgent it feels, and your honest call. ` +
    `If they have no SOP but asked us to build one, mention we'll draft them a starter SOP to confirm. If they opted to fully automate any channel (no per-message approval), mention that and that the safety rails still apply. ` +
    `Finish by telling me I can just reply "provision ${id}" to spin them up. ` +
    `Write it the way a person talks. No labels, no "field: value", no bullet points, no markdown, no data dump. Output only the message text, nothing else.`;
  const out = execFileSync(SEND, ["-z", prompt], { encoding: "utf8", timeout: 150000, maxBuffer: 4 * 1024 * 1024 });
  return (out || "").trim();
}

async function main() {
  if (!URL_BASE || !KEY) { console.error("missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

  let st = loadState();
  if (!st || !st.lastSeen) {
    const rows = await rest("submissions?select=created_at&order=created_at.desc&limit=1");
    const last = (rows[0] && rows[0].created_at) || new Date(0).toISOString();
    saveState({ lastSeen: last });
    console.log("initialized lastSeen=" + last + " (no notifications on first run)");
    return;
  }

  // ISO-8601 with a fixed offset compares lexicographically == chronologically
  const rows = await rest(`submissions?select=*&created_at=gt.${encodeURIComponent(st.lastSeen)}&order=created_at.asc`);
  if (!rows.length) return;

  // Pass 1 — deterministic notifications (guaranteed, fast). Advance state on success.
  let newest = st.lastSeen, notified = 0;
  for (const r of rows) {
    try {
      await sendMsg(summary(rowToRecord(r)));
      notified++;
      if (r.created_at > newest) newest = r.created_at;
    } catch (e) {
      console.error("notify failed for " + r.id + ": " + (e && e.message || e));
      break; // keep state at last success; retry on next tick
    }
  }
  saveState({ lastSeen: newest });

  // Pass 2 — agent-drafted provisioning recommendation (best-effort, only for notified rows).
  let recommended = 0;
  for (const r of rows.filter((r) => r.created_at <= newest)) {
    try {
      const rec = agentRecommendation(r.id);
      if (rec) { await sendMsg(rec); recommended++; }
    } catch (e) {
      console.error("recommendation failed for " + r.id + ": " + (e && e.message || e));
    }
  }
  console.log(`notified ${notified}, recommended ${recommended}`);
}

withJobLock('rrd-notify', main, { staleMs: 30 * 60 * 1000 }).catch((e) => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
