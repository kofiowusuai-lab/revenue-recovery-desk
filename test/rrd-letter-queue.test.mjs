import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildApprovedLetterAction, processApproval, runOnce, eventKey } from "../rrd-letter-queue.mjs";

const SIGNATURE = "data:image/png;base64,abc123";
const SIG_HASH = crypto.createHash("sha256").update(SIGNATURE).digest("hex");

const source = {
  id: 101,
  submission_id: "22222222-2222-4222-8222-222222222222",
  invoice_id: "inv_1",
  invoice_number: "INV-1",
  customer_name: "Debtor Ltd",
  amount_usd: 1200,
  channel: "Letter",
  rung: "formal notice",
  requires_human: true,
  meta: {
    subject: "Formal notice: INV-1",
    draftText: "Dear Debtor Ltd,\n\nPlease arrange payment.",
    to: { companyName: "Debtor Ltd", addressLine1: "1 Debtor St", city: "London", provinceOrState: "London", postalOrZip: "SW1A 1AA", country: "GB" },
    from: { companyName: "FlowAudit", addressLine1: "10 Sender St", city: "London", provinceOrState: "London", postalOrZip: "EC1A 1BB", country: "GB" }
  }
};
const approval = {
  id: 202,
  submission_id: source.submission_id,
  profile: "rr-acme",
  event_type: "letter_approval",
  meta: {
    letterKey: eventKey(source),
    sourceEventId: source.id,
    signerName: "Kofi Owusu",
    signerTitle: "Director",
    signature: { alg: "aes-256-gcm", iv: "x", tag: "y", data: "z" },
    signatureHash: SIG_HASH,
    previewHash: "preview_hash",
    sendGate: "approved_for_executor_review"
  }
};

test("buildApprovedLetterAction turns a signed approval into an approved gated Letter action", () => {
  const action = buildApprovedLetterAction({ approval, source, signatureDataUrl: SIGNATURE });
  assert.equal(action.channel, "Letter");
  assert.equal(action.approved, true);
  assert.equal(action.tool, "send_via_executor");
  assert.equal(action.to.companyName, "Debtor Ltd");
  assert.equal(action.from.companyName, "FlowAudit");
  assert.match(action.html, /Kofi Owusu/);
  assert.match(action.html, /Director/);
  assert.match(action.html, /data:image\/png/);
  assert.equal(action.metadata.approvalEventId, approval.id);
  assert.equal(action.metadata.previewHash, "preview_hash");
});

test("processApproval sends through injected rrd-recover executor and writes PostGrid sent event", async () => {
  const written = [];
  const calls = [];
  const result = await processApproval(approval, { deps: {
    fetchSourceEvent: async () => source,
    profileEnv: {},
    decryptSignature: () => SIGNATURE,
    execute: async (profile, action, opts) => { calls.push({ profile, action, opts }); return { sent: true, result: { id: "letter_pg_1", status: "ready" }, decision: { allowed: true } }; },
    writeEvent: async (event) => { written.push(event); return { ...event, id: 303 }; }
  }});
  assert.equal(result.sent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].profile, "rr-acme");
  assert.equal(calls[0].action.channel, "Letter");
  assert.equal(written.length, 1);
  assert.equal(written[0].event_type, "letter_postgrid_sent");
  assert.equal(written[0].meta.providerId, "letter_pg_1");
});

test("processApproval fails closed and writes blocked event when mailing address is missing", async () => {
  const written = [];
  const badSource = { ...source, meta: { subject: "No address", draftText: "Body" } };
  const result = await processApproval({ ...approval, meta: { ...approval.meta, letterKey: eventKey(badSource) } }, { deps: {
    fetchSourceEvent: async () => badSource,
    profileEnv: {},
    decryptSignature: () => SIGNATURE,
    execute: async () => { throw new Error("must not execute"); },
    writeEvent: async (event) => { written.push(event); return event; }
  }});
  assert.equal(result.blocked, true);
  assert.match(result.error, /recipient mailing address/);
  assert.equal(written[0].event_type, "letter_postgrid_blocked");
  assert.equal(written[0].outcome, "blocked_missing_send_fields");
});

test("buildApprovedLetterAction can pull recipient address from connected-system contacts", () => {
  const contactSource = {
    ...source,
    meta: {
      subject: "Formal notice: INV-1",
      draftText: "Dear Debtor Ltd,\n\nPlease arrange payment.",
      contacts: [
        { name: "Other", email: "other@example.com" },
        { name: "Debtor Ltd", email: "debtor@example.com", mailingAddress: { line1: "44 Contact Rd", city: "Manchester", state: "Greater Manchester", postcode: "M1 1AE", country: "GB" } }
      ],
      from: source.meta.from
    },
    customer_email: "debtor@example.com"
  };
  const action = buildApprovedLetterAction({ approval: { ...approval, meta: { ...approval.meta, letterKey: eventKey(contactSource) } }, source: contactSource, signatureDataUrl: SIGNATURE });
  assert.equal(action.to.addressLine1, "44 Contact Rd");
  assert.equal(action.to.postalOrZip, "M1 1AE");
});

test("buildApprovedLetterAction can pull recipient address from the rendered letter text", () => {
  const letterSource = {
    ...source,
    meta: {
      subject: "Formal notice: INV-1",
      draftText: "Debtor Ltd\n9 Letter Lane\nBristol\nBS1 4ST\n\nDear Debtor Ltd,\n\nPlease arrange payment.",
      from: source.meta.from
    }
  };
  const action = buildApprovedLetterAction({ approval: { ...approval, meta: { ...approval.meta, letterKey: eventKey(letterSource) } }, source: letterSource, signatureDataUrl: SIGNATURE });
  assert.equal(action.to.companyName, "Debtor Ltd");
  assert.equal(action.to.addressLine1, "9 Letter Lane");
  assert.equal(action.to.city, "Bristol");
  assert.equal(action.to.postalOrZip, "BS1 4ST");
});

test("runOnce skips already-terminal approvals via injected queue and processes queued ones", async () => {
  const result = await runOnce({ deps: {
    fetchQueuedApprovals: async () => [approval],
    fetchSourceEvent: async () => source,
    profileEnv: {},
    decryptSignature: () => SIGNATURE,
    execute: async () => ({ sent: true, result: { id: "letter_pg_2", status: "ready" }, decision: { allowed: true } }),
    writeEvent: async (event) => event
  }});
  assert.equal(result.ok, true);
  assert.equal(result.scanned, 1);
  assert.equal(result.results[0].sent, true);
});
