import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../revenue-recovery-web/onboarding.html", import.meta.url), "utf8");

test("onboarding CRM dropdown includes supported Composio-backed CRM options", () => {
  for (const option of ["monday.com", "Capsule CRM", "Attio", "Nutshell", "Salesflare", "Salesmate", "Kommo", "noCRM.io", "ActiveCampaign", "Dynamics 365", "Odoo", "NetSuite", "RepairShopr", "AccuLynx", "ServiceM8"]) {
    assert.match(html, new RegExp(`<option>${option.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}<\\/option>`));
  }
});

test("onboarding payment/accounting dropdowns include Composio-backed long-tail options", () => {
  for (const platform of ["Whop", "Shopify", "Maxio", "Paystack", "Razorpay", "Lemon Squeezy", "MoonClerk"]) {
    assert.match(html, new RegExp(`\\"${platform.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\"`));
  }
  for (const option of ["Zoho Invoice", "Chaser", "Clientary", "Moneybird", "Sevdesk", "Lexoffice", "Quaderno", "Elorus", "Coupa"]) {
    assert.match(html, new RegExp(`<option>${option.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}<\\/option>`));
  }
});

test("onboarding captures draft approval routing details", () => {
  assert.match(html, /id="f_approvalContacts"/);
  assert.match(html, /id="f_approvalChannel"/);
  assert.match(html, /<option>Slack<\/option>/);
  assert.match(html, /<option>Microsoft Teams<\/option>/);
  assert.match(html, /<option>CRM task<\/option>/);
  assert.match(html, /<option>Shared inbox<\/option>/);
  assert.match(html, /id="f_approvalSla"/);
  assert.match(html, /id="f_approvalNotes"/);
  assert.match(html, /approvalRouting:\{approvers:val\("f_approvalContacts"\),preferredChannel:val\("f_approvalChannel"\),sla:val\("f_approvalSla"\),notes:val\("f_approvalNotes"\)\}/);
});

test("onboarding letter section warns about PostGrid opt-out and pass-through billing", () => {
  assert.match(html, /Letter billing notice/);
  assert.match(html, /opt out in the secure access form/);
  assert.match(html, /billed at month-end in addition to your maintenance\/retainer fee/);
  assert.match(html, /\$1\.219 per letter \+ 20p per page/);
});
