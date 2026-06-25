#!/usr/bin/env node
/**
 * rrd-draft.mjs — deterministic dunning-message drafter for the Revenue Recovery Desk.
 *
 * Backs the `draft_message` tool with REAL, testable code instead of relying on an
 * LLM loop that has never run. Given a normalized invoice (from rrd-stripe.mjs) and
 * the client's voice, it produces a {subject, text, html} dunning message whose tone
 * escalates with the age of the debt. Pure and dependency-free, so the same draft is
 * reproducible offline and in tests.
 *
 * An optional `drafter` hook lets a caller swap in an LLM polish pass later without
 * changing the call sites; the deterministic template is always the safe default.
 *
 *   import { rungFor, draftMessage } from "./rrd-draft.mjs";
 *   const msg = draftMessage({ invoice, company: "Acme", voice: { fromName, signature, tone } });
 */

/** The dunning rungs, friendliest first. Thresholds are days overdue (>=). */
export const RUNGS = [
  { key: "reminder",       minDays: 0,  label: "friendly reminder" },
  { key: "follow_up",     minDays: 4,  label: "follow-up" },
  { key: "firm",          minDays: 14, label: "firm notice" },
  { key: "final_notice",  minDays: 30, label: "final notice" },
  { key: "pre_escalation", minDays: 60, label: "pre-escalation notice" }
];

/** rungFor — PURE. Pick the dunning rung for a given days-overdue count. */
export function rungFor(daysOverdue) {
  const d = Number(daysOverdue) || 0;
  let chosen = RUNGS[0];
  for (const r of RUNGS) if (d >= r.minDays) chosen = r;
  return chosen.key;
}

function money(amount, currency = "USD") {
  const n = Number(amount) || 0;
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n); }
  catch { return `${currency} ${n.toFixed(2)}`; }
}

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Per-rung copy. {who} fills the customer's name; the body lines are assembled below.
const COPY = {
  reminder: {
    subject: (co, inv) => `Friendly reminder: invoice ${inv.number || inv.id} from ${co}`,
    opener: (co) => `This is a quick, friendly reminder from ${co}.`,
    ask: "Whenever you have a moment, you can settle it securely using the link below. If you have already paid, please disregard this note."
  },
  follow_up: {
    subject: (co, inv) => `Following up on invoice ${inv.number || inv.id} from ${co}`,
    opener: (co) => `We are following up on an invoice from ${co} that is now past due.`,
    ask: "Please use the secure link below to bring the account up to date. If something is holding up payment, reply and let us know how we can help."
  },
  firm: {
    subject: (co, inv) => `Past due: invoice ${inv.number || inv.id} from ${co}`,
    opener: (co) => `Our records show the invoice below from ${co} remains unpaid and is now well past its due date.`,
    ask: "Please arrange payment using the secure link below. If you need a short payment plan, reply and we will work something out."
  },
  final_notice: {
    subject: (co, inv) => `Final notice: invoice ${inv.number || inv.id} from ${co}`,
    opener: (co) => `This is a final notice regarding the overdue invoice below from ${co}.`,
    ask: "Please settle the balance using the secure link below to avoid further action on the account. If you have already paid, contact us so we can update our records."
  },
  pre_escalation: {
    subject: (co, inv) => `Action required before escalation: invoice ${inv.number || inv.id} from ${co}`,
    opener: (co) => `Despite previous notices, the invoice below from ${co} remains unpaid and is significantly overdue.`,
    ask: "Please resolve the balance immediately using the secure link below. Without payment or a response, this account will be escalated for further collection steps."
  }
};

/**
 * draftMessage — PURE. Build the dunning message for one invoice.
 *   args: {
 *     invoice,                       // normalized invoice from rrd-stripe
 *     company,                       // the client we recover FOR
 *     rung,                          // optional override; default rungFor(invoice.daysOverdue)
 *     voice: { fromName, signature, tone, alwaysPhrases },  // optional client voice
 *     paymentUrl,                    // optional override; default invoice.hostedInvoiceUrl
 *     drafter                        // optional (msg, ctx) => msg  hook for LLM polish
 *   }
 */
export function draftMessage(args = {}) {
  const inv = args.invoice || {};
  const company = args.company || "our team";
  const rung = args.rung || rungFor(inv.daysOverdue);
  const copy = COPY[rung] || COPY.reminder;
  const voice = args.voice || {};
  const fromName = voice.fromName || company;
  const payUrl = args.paymentUrl || inv.hostedInvoiceUrl || null;
  const who = inv.customerName || "there";
  const amount = money(inv.amount, inv.currency);
  const ref = inv.number || inv.id || "(no reference)";

  const facts = [
    `Invoice: ${ref}`,
    `Amount due: ${amount}`,
    inv.dueDate ? `Due date: ${inv.dueDate}` : null,
    (Number(inv.daysOverdue) > 0) ? `Days overdue: ${inv.daysOverdue}` : null
  ].filter(Boolean);

  const subject = copy.subject(company, inv);

  // plain text
  const tLines = [];
  tLines.push(`Hi ${who},`);
  tLines.push("");
  tLines.push(copy.opener(company));
  if (voice.alwaysPhrases) tLines.push(voice.alwaysPhrases);
  tLines.push("");
  tLines.push(...facts);
  tLines.push("");
  tLines.push(copy.ask);
  if (payUrl) { tLines.push(""); tLines.push(`Pay securely: ${payUrl}`); }
  tLines.push("");
  tLines.push("Thank you,");
  tLines.push(voice.signature || fromName);
  const text = tLines.join("\n");

  // html
  const factHtml = facts.map((f) => `<li>${esc(f)}</li>`).join("");
  const btn = payUrl
    ? `<p style="margin:24px 0"><a href="${esc(payUrl)}" style="background:#0a7d2c;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">Pay invoice securely</a></p><p style="font-size:12px;color:#666">Or paste this link into your browser: ${esc(payUrl)}</p>`
    : "";
  const sigHtml = esc(voice.signature || fromName).replace(/\n/g, "<br>");
  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;line-height:1.5">`,
    `<p>Hi ${esc(who)},</p>`,
    `<p>${esc(copy.opener(company))}${voice.alwaysPhrases ? " " + esc(voice.alwaysPhrases) : ""}</p>`,
    `<ul>${factHtml}</ul>`,
    `<p>${esc(copy.ask)}</p>`,
    btn,
    `<p>Thank you,<br>${sigHtml}</p>`,
    `</div>`
  ].join("");

  let msg = { rung, subject, text, html, paymentUrl: payUrl };
  if (typeof args.drafter === "function") {
    const polished = args.drafter(msg, { invoice: inv, company, voice, rung });
    if (polished && typeof polished === "object") msg = { ...msg, ...polished, rung, paymentUrl: payUrl };
  }
  return msg;
}

/* ---------------- CLI ---------------- */
async function main() {
  const [, , rawArg] = process.argv;
  if (!rawArg) {
    console.error(`rrd-draft — deterministic dunning drafter

Usage:  node rrd-draft.mjs '{"invoice":{"number":"INV-1","amount":1200,"currency":"USD","daysOverdue":21,"customerName":"Jane","hostedInvoiceUrl":"https://pay..."},"company":"Acme"}'`);
    process.exit(1);
  }
  let arg;
  try { arg = JSON.parse(rawArg); } catch (e) { console.error("invalid JSON: " + e.message); process.exit(1); }
  console.log(JSON.stringify(draftMessage(arg), null, 2));
}

const invokedDirectly = process.argv[1] && (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1]));
if (invokedDirectly) {
  main().catch((e) => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
}
