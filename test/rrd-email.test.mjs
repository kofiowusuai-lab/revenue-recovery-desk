/**
 * Tests for the email adapter (rrd-email.mjs). Provider detection + payload shape
 * are pure; sending uses an injected fetch. Fail-closed behavior verified.
 * Run: node --test test/rrd-email.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { detectProvider, buildPayload, sendEmail } from "../rrd-email.mjs";

const MSG = { to: "jane@cust.com", from: "ar@acme.com", subject: "Past due", text: "Please pay", html: "<p>Please pay</p>" };

test("detectProvider honors explicit override then key presence then null", () => {
  assert.equal(detectProvider({ RRD_EMAIL_PROVIDER: "mailgun", SENDGRID_API_KEY: "x" }), "mailgun");
  assert.equal(detectProvider({ SENDGRID_API_KEY: "x" }), "sendgrid");
  assert.equal(detectProvider({ POSTMARK_SERVER_TOKEN: "x" }), "postmark");
  assert.equal(detectProvider({ MAILGUN_API_KEY: "x" }), "mailgun");
  assert.equal(detectProvider({ AGENTMAIL_API_KEY: "x" }), "agentmail");
  assert.equal(detectProvider({}), null);
});

test("buildPayload: SendGrid shape", () => {
  const p = buildPayload("sendgrid", MSG, { SENDGRID_API_KEY: "SG.x" });
  assert.equal(p.url, "https://api.sendgrid.com/v3/mail/send");
  assert.equal(p.headers.Authorization, "Bearer SG.x");
  const body = JSON.parse(p.body);
  assert.equal(body.personalizations[0].to[0].email, "jane@cust.com");
  assert.equal(body.from.email, "ar@acme.com");
  assert.equal(body.content.length, 2);
});

test("buildPayload: Postmark shape", () => {
  const p = buildPayload("postmark", MSG, { POSTMARK_SERVER_TOKEN: "tok" });
  assert.equal(p.url, "https://api.postmarkapp.com/email");
  assert.equal(p.headers["X-Postmark-Server-Token"], "tok");
  const body = JSON.parse(p.body);
  assert.equal(body.To, "jane@cust.com");
  assert.equal(body.HtmlBody, "<p>Please pay</p>");
});

test("buildPayload: Mailgun shape (form-encoded, needs domain)", () => {
  const p = buildPayload("mailgun", MSG, { MAILGUN_API_KEY: "key-x", MAILGUN_DOMAIN: "mg.acme.com" });
  assert.match(p.url, /api\.mailgun\.net\/v3\/mg\.acme\.com\/messages/);
  assert.match(p.headers.Authorization, /^Basic /);
  assert.match(p.body, /to=jane%40cust\.com/);
  assert.throws(() => buildPayload("mailgun", MSG, { MAILGUN_API_KEY: "key-x" }), /MAILGUN_DOMAIN/);
});

test("buildPayload: AgentMail shape", () => {
  const p = buildPayload("agentmail", MSG, { AGENTMAIL_API_KEY: "am_x", RRD_SUPPORT_INBOX_ID: "support@example.com" });
  assert.equal(p.url, "https://api.agentmail.to/v0/inboxes/support%40example.com/messages/send");
  assert.equal(p.headers.Authorization, "Bearer am_x");
  const body = JSON.parse(p.body);
  assert.equal(body.to, "jane@cust.com");
  assert.equal(body.subject, "Past due");
  assert.equal(body.text, "Please pay");
  assert.equal(body.html, "<p>Please pay</p>");
});

test("buildPayload fails closed on missing to/from", () => {
  assert.throws(() => buildPayload("sendgrid", { from: "a@b.com" }, { SENDGRID_API_KEY: "x" }), /missing 'to'/);
  assert.throws(() => buildPayload("sendgrid", { to: "a@b.com" }, { SENDGRID_API_KEY: "x" }), /missing 'from'/);
});

test("from falls back to RRD_DEFAULT_FROM", () => {
  const p = buildPayload("sendgrid", { to: "a@b.com", subject: "hi", text: "x" }, { SENDGRID_API_KEY: "x", RRD_DEFAULT_FROM: "noreply@acme.com" });
  assert.equal(JSON.parse(p.body).from.email, "noreply@acme.com");
});

test("sendEmail dispatches and returns provider + id (Postmark)", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([url, init]); return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ MessageID: "abc-123" }) }; };
  const r = await sendEmail(MSG, { env: { POSTMARK_SERVER_TOKEN: "tok" }, fetchImpl });
  assert.equal(r.provider, "postmark");
  assert.equal(r.id, "abc-123");
  assert.equal(r.status, "sent");
  assert.equal(calls.length, 1);
});

test("sendEmail dispatches and returns provider + id (AgentMail)", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([url, init]); return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ message_id: "am-123" }) }; };
  const r = await sendEmail(MSG, { env: { AGENTMAIL_API_KEY: "am_x", RRD_SUPPORT_INBOX_ID: "support@example.com" }, fetchImpl });
  assert.equal(r.provider, "agentmail");
  assert.equal(r.id, "am-123");
  assert.equal(r.status, "sent");
  assert.equal(calls.length, 1);
});

test("sendEmail picks up SendGrid X-Message-Id header on empty 202 body", async () => {
  const fetchImpl = async () => ({ ok: true, status: 202, headers: { get: (k) => (k === "x-message-id" ? "sg-1" : null) }, text: async () => "" });
  const r = await sendEmail(MSG, { env: { SENDGRID_API_KEY: "x" }, fetchImpl });
  assert.equal(r.provider, "sendgrid");
  assert.equal(r.id, "sg-1");
});

test("sendEmail fails closed with no provider configured", async () => {
  await assert.rejects(() => sendEmail(MSG, { env: {} }), /not configured/);
});

test("sendEmail throws provider error on non-2xx", async () => {
  const fetchImpl = async () => ({ ok: false, status: 422, headers: { get: () => null }, text: async () => JSON.stringify({ Message: "Sender signature not confirmed" }) });
  await assert.rejects(() => sendEmail(MSG, { env: { POSTMARK_SERVER_TOKEN: "tok" }, fetchImpl }), /postmark 422: Sender signature not confirmed/);
});
