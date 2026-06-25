/**
 * Tests for the Twilio SMS adapter (rrd-sms.mjs). Pure payload + injected fetch.
 * Run: node --test test/rrd-sms.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { detectConfigured, buildPayload, sendSms } from "../rrd-sms.mjs";

const ENV = { TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "+15551112222" };
const MSG = { to: "+15553334444", body: "Invoice INV-1 is past due: https://pay/x" };

test("detectConfigured needs SID + token", () => {
  assert.equal(detectConfigured(ENV), true);
  assert.equal(detectConfigured({ TWILIO_ACCOUNT_SID: "AC" }), false);
  assert.equal(detectConfigured({}), false);
});

test("buildPayload targets the account Messages endpoint with basic auth + From", () => {
  const p = buildPayload(MSG, ENV);
  assert.match(p.url, /api\.twilio\.com\/2010-04-01\/Accounts\/AC123\/Messages\.json/);
  assert.match(p.headers.Authorization, /^Basic /);
  assert.equal(Buffer.from(p.headers.Authorization.slice(6), "base64").toString(), "AC123:tok");
  assert.match(p.body, /To=%2B15553334444/);
  assert.match(p.body, /From=%2B15551112222/);
  assert.match(p.body, /Body=Invoice/);
});

test("buildPayload prefers a Messaging Service over a From number", () => {
  const p = buildPayload(MSG, { ...ENV, TWILIO_MESSAGING_SERVICE_SID: "MG9" });
  assert.match(p.body, /MessagingServiceSid=MG9/);
  assert.doesNotMatch(p.body, /From=/);
});

test("buildPayload accepts msg.from override and msg.text as body", () => {
  const p = buildPayload({ to: "+1555", text: "hi", from: "+1999" }, { TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t" });
  assert.match(p.body, /From=%2B1999/);
  assert.match(p.body, /Body=hi/);
});

test("buildPayload fails closed on missing creds / recipient / sender / body", () => {
  assert.throws(() => buildPayload(MSG, {}), /TWILIO_ACCOUNT_SID/);
  assert.throws(() => buildPayload({ body: "x" }, ENV), /missing 'to'/);
  assert.throws(() => buildPayload({ to: "+1555" }, ENV), /empty message body/);
  assert.throws(() => buildPayload({ to: "+1555", body: "x" }, { TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t" }), /missing sender/);
});

test("sendSms dispatches and returns the message sid + status", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([url, init]); return { ok: true, status: 201, text: async () => JSON.stringify({ sid: "SM1", status: "queued" }) }; };
  const r = await sendSms(MSG, { env: ENV, fetchImpl });
  assert.equal(r.provider, "twilio");
  assert.equal(r.id, "SM1");
  assert.equal(r.status, "queued");
  assert.equal(calls.length, 1);
});

test("sendSms fails closed without credentials", async () => {
  await assert.rejects(() => sendSms(MSG, { env: {} }), /not configured/);
});

test("sendSms surfaces the Twilio error on non-2xx", async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ code: 21211, message: "Invalid 'To' Phone Number" }) });
  await assert.rejects(() => sendSms(MSG, { env: ENV, fetchImpl }), /twilio 400: Invalid 'To' Phone Number/);
});
