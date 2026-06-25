#!/usr/bin/env node
/**
 * rrd-sms.mjs — Twilio SMS adapter for the Revenue Recovery Desk.
 *
 * Wires the SMS send channel that rrd-recover.mjs previously left throwing. Each
 * client connects their OWN Twilio account (SID + token + a sending number or a
 * Messaging Service) through the vault; on a per-client Orgo VM these land in the
 * tmpfs env injected per cycle. No npm deps (Node 18+ global fetch).
 *
 *   TWILIO_ACCOUNT_SID       AC...
 *   TWILIO_AUTH_TOKEN        ...
 *   TWILIO_FROM              +15551234567        (a verified sending number)   OR
 *   TWILIO_MESSAGING_SERVICE_SID  MG...          (a Messaging Service, preferred at volume)
 *
 *   node rrd-sms.mjs send '{"to":"+15557654321","body":"Your invoice INV-1 is past due: https://pay..."}'
 *
 * buildPayload() is PURE; sendSms() does the network and fails CLOSED — a missing
 * credential/recipient or a Twilio error throws, never a silent no-op, so the
 * executor records ADAPTER_ERROR instead of a phantom send.
 */

/** detectConfigured — PURE. Are Twilio credentials present in `env`? */
export function detectConfigured(env = process.env) {
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
}

function phone(v) {
  if (!v) return null;
  if (typeof v === "string") return v;
  return v.phone || v.number || null;
}

/**
 * buildPayload — PURE. Returns {url, method, headers, body} for the Twilio
 * Messages API. `env` supplies credentials + the sender. Throws on missing fields.
 */
export function buildPayload(msg = {}, env = process.env) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("sms: missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN");
  const to = phone(msg.to);
  if (!to) throw new Error("sms: missing 'to' phone number");
  const body = msg.body || msg.text || "";
  if (!body.trim()) throw new Error("sms: empty message body");

  const form = { To: to, Body: body };
  const svc = msg.messagingServiceSid || env.TWILIO_MESSAGING_SERVICE_SID;
  const from = phone(msg.from) || env.TWILIO_FROM;
  if (svc) form.MessagingServiceSid = svc;
  else if (from) form.From = from;
  else throw new Error("sms: missing sender — set TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID (or msg.from)");

  const base = (env.TWILIO_API_BASE || "https://api.twilio.com").replace(/\/+$/, "");
  return {
    url: `${base}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(form).toString()
  };
}

/**
 * sendSms — dispatch one message. Fails CLOSED.
 *   opts: { env, fetchImpl }
 *   returns { provider:"twilio", id, status }
 */
export async function sendSms(msg = {}, { env = process.env, fetchImpl = fetch } = {}) {
  if (!detectConfigured(env)) throw new Error("sms adapter not configured — set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN");
  const req = buildPayload(msg, env);
  const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) {
    const m = data && typeof data === "object" ? (data.message || data.detail || JSON.stringify(data))
      : (typeof data === "string" && data ? data : `HTTP ${res.status}`);
    throw new Error(`twilio ${res.status}: ${m}`);
  }
  return { provider: "twilio", id: (data && data.sid) || null, status: (data && data.status) || "queued" };
}

/* ---------------- CLI ---------------- */
async function main() {
  const [, , cmd, rawArg] = process.argv;
  if (cmd === "config") { console.log(JSON.stringify({ configured: detectConfigured() }, null, 2)); return; }
  if (cmd !== "send" || !rawArg) {
    console.error(`rrd-sms — Twilio SMS adapter

Usage:  node rrd-sms.mjs send '{"to":"+1555...","body":"..","from":"+1555.."}'
        node rrd-sms.mjs config

Keys: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + (TWILIO_FROM | TWILIO_MESSAGING_SERVICE_SID)`);
    process.exit(1);
  }
  let arg;
  try { arg = JSON.parse(rawArg); } catch (e) { console.error("invalid JSON: " + e.message); process.exit(1); }
  console.log(JSON.stringify(await sendSms(arg), null, 2));
}

const invokedDirectly = process.argv[1] && (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1]));
if (invokedDirectly) {
  main().catch((e) => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
}
