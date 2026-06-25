#!/usr/bin/env node
/**
 * rrd-email.mjs — transactional email adapter for the Revenue Recovery Desk.
 *
 * Wires the email send channel that rrd-recover.mjs previously left throwing.
 * Provider is auto-detected from whichever key is present, so a client connects
 * their OWN SendGrid / Postmark / Mailgun account through the vault and sends from
 * their own domain. No npm deps (Node 18+ global fetch).
 *
 *   SendGrid:  SENDGRID_API_KEY
 *   Postmark:  POSTMARK_SERVER_TOKEN
 *   Mailgun:   MAILGUN_API_KEY + MAILGUN_DOMAIN   (MAILGUN_BASE for EU region)
 *   From addr: msg.from, else RRD_DEFAULT_FROM
 *
 *   node rrd-email.mjs send '{"to":"a@b.com","from":"ar@acme.com","subject":"Hi","text":"...","html":"<p>..</p>"}'
 *
 * buildPayload() is PURE (provider request shape); sendEmail() does the network and
 * fails CLOSED — a missing key/from or a provider error throws, never a silent no-op,
 * so the executor records ADAPTER_ERROR rather than reporting a phantom send.
 */

const PROVIDERS = ["sendgrid", "postmark", "mailgun", "agentmail"];

/** detectProvider — PURE. Which provider's credentials are present in `env`. */
export function detectProvider(env = process.env) {
  if (env.RRD_EMAIL_PROVIDER && PROVIDERS.includes(env.RRD_EMAIL_PROVIDER)) return env.RRD_EMAIL_PROVIDER;
  if (env.SENDGRID_API_KEY) return "sendgrid";
  if (env.POSTMARK_SERVER_TOKEN) return "postmark";
  if (env.MAILGUN_API_KEY) return "mailgun";
  if (env.AGENTMAIL_API_KEY) return "agentmail";
  return null;
}

function addr(v) {
  if (!v) return null;
  if (typeof v === "string") return { email: v, name: null };
  return { email: v.email, name: v.name || null };
}

/**
 * buildPayload — PURE. Returns {url, method, headers, body} for the given provider.
 * `env` supplies credentials/region. Throws if required fields are missing.
 */
export function buildPayload(provider, msg = {}, env = process.env) {
  const to = addr(msg.to);
  const from = addr(msg.from || env.RRD_DEFAULT_FROM);
  if (!to || !to.email) throw new Error("email: missing 'to'");
  if (!from || !from.email) throw new Error("email: missing 'from' (set msg.from or RRD_DEFAULT_FROM)");
  const subject = msg.subject || "";
  const text = msg.text || "";
  const html = msg.html || "";

  if (provider === "sendgrid") {
    const content = [];
    if (text) content.push({ type: "text/plain", value: text });
    if (html) content.push({ type: "text/html", value: html });
    if (!content.length) content.push({ type: "text/plain", value: " " });
    return {
      url: "https://api.sendgrid.com/v3/mail/send",
      method: "POST",
      headers: { "Authorization": `Bearer ${env.SENDGRID_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to.email, ...(to.name ? { name: to.name } : {}) }] }],
        from: { email: from.email, ...(from.name ? { name: from.name } : {}) },
        subject, content
      })
    };
  }
  if (provider === "postmark") {
    return {
      url: "https://api.postmarkapp.com/email",
      method: "POST",
      headers: { "X-Postmark-Server-Token": env.POSTMARK_SERVER_TOKEN, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        From: from.name ? `${from.name} <${from.email}>` : from.email,
        To: to.name ? `${to.name} <${to.email}>` : to.email,
        Subject: subject,
        ...(text ? { TextBody: text } : {}),
        ...(html ? { HtmlBody: html } : {}),
        MessageStream: env.POSTMARK_MESSAGE_STREAM || "outbound"
      })
    };
  }
  if (provider === "mailgun") {
    const domain = env.MAILGUN_DOMAIN;
    if (!domain) throw new Error("mailgun: missing MAILGUN_DOMAIN");
    const base = (env.MAILGUN_BASE || "https://api.mailgun.net").replace(/\/+$/, "");
    const form = {
      from: from.name ? `${from.name} <${from.email}>` : from.email,
      to: to.name ? `${to.name} <${to.email}>` : to.email,
      subject
    };
    if (text) form.text = text;
    if (html) form.html = html;
    return {
      url: `${base}/v3/${encodeURIComponent(domain)}/messages`,
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`api:${env.MAILGUN_API_KEY}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(form).toString()
    };
  }
  if (provider === "agentmail") {
    const inbox = env.RRD_SUPPORT_INBOX_ID || "flowaudit-support@agentmail.to";
    const base = (env.AGENTMAIL_API_BASE || "https://api.agentmail.to/v0").replace(/\/+$/, "");
    return {
      url: `${base}/inboxes/${encodeURIComponent(inbox)}/messages/send`,
      method: "POST",
      headers: { "Authorization": `Bearer ${env.AGENTMAIL_API_KEY}`, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        to: to.email,
        subject,
        ...(text ? { text } : {}),
        ...(html ? { html } : {})
      })
    };
  }
  throw new Error("email: unknown provider " + provider);
}

/** parse an id out of a provider's success response (best-effort). */
function extractId(provider, body) {
  if (!body || typeof body !== "object") return null;
  if (provider === "postmark") return body.MessageID || null;
  if (provider === "mailgun") return (body.id || "").replace(/^<|>$/g, "") || null;
  if (provider === "agentmail") return body.message_id || body.id || null;
  return null; // SendGrid returns 202 with empty body; id is in the X-Message-Id header
}

/**
 * sendEmail — dispatch one message. Fails CLOSED.
 *   opts: { env, fetchImpl }
 *   returns { provider, id, status:"sent" }
 */
export async function sendEmail(msg = {}, { env = process.env, fetchImpl = fetch } = {}) {
  const provider = detectProvider(env);
  if (!provider) throw new Error("email adapter not configured — set SENDGRID_API_KEY, POSTMARK_SERVER_TOKEN, or MAILGUN_API_KEY");
  const req = buildPayload(provider, msg, env);
  const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body });
  const text = await res.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  if (!res.ok) {
    const m = body && typeof body === "object"
      ? (body.Message || body.message || (Array.isArray(body.errors) && body.errors[0] && body.errors[0].message) || JSON.stringify(body))
      : (typeof body === "string" && body ? body : `HTTP ${res.status}`);
    throw new Error(`${provider} ${res.status}: ${m}`);
  }
  const headerId = res.headers && typeof res.headers.get === "function" ? res.headers.get("x-message-id") : null;
  return { provider, id: extractId(provider, body) || headerId || null, status: "sent" };
}

/* ---------------- CLI ---------------- */
async function main() {
  const [, , cmd, rawArg] = process.argv;
  if (cmd === "providers") { console.log(JSON.stringify({ detected: detectProvider(), supported: PROVIDERS }, null, 2)); return; }
  if (cmd !== "send" || !rawArg) {
    console.error(`rrd-email — transactional email adapter

Usage:  node rrd-email.mjs send '{"to":"a@b.com","from":"ar@acme.com","subject":"..","text":"..","html":"<p>..</p>"}'
        node rrd-email.mjs providers

Keys (any one): SENDGRID_API_KEY | POSTMARK_SERVER_TOKEN | MAILGUN_API_KEY (+MAILGUN_DOMAIN)`);
    process.exit(1);
  }
  let arg;
  try { arg = JSON.parse(rawArg); } catch (e) { console.error("invalid JSON: " + e.message); process.exit(1); }
  console.log(JSON.stringify(await sendEmail(arg), null, 2));
}

const invokedDirectly = process.argv[1] && (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1]));
if (invokedDirectly) {
  main().catch((e) => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
}
