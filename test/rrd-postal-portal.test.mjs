import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const pagePath = new URL("../revenue-recovery-web/postal-portal.html", import.meta.url);
const welcomePath = new URL("../rrd-welcome-pack.mjs", import.meta.url);

function pageHtml() {
  assert.equal(fs.existsSync(pagePath), true, "postal-portal.html should exist");
  return fs.readFileSync(pagePath, "utf8");
}

test("postal portal page exists and uses the FlowAudit house theme", () => {
  const html = pageHtml();
  assert.match(html, /<title>FlowAudit Postal Portal<\/title>/);
  assert.match(html, /<link rel="stylesheet" href="theme\.css">/);
  assert.match(html, /class="fa-wordmark">FlowAudit/);
  assert.match(html, /Revenue Recovery Postal Portal/);
  assert.match(html, /Secure postal approvals/);
});

test("postal portal MVP lists pending letters and opens a signing workspace", () => {
  const html = pageHtml();
  assert.match(html, /pendingLetters/);
  assert.match(html, /Needs signature/);
  assert.match(html, /viewLetter\(/);
  assert.match(html, /letter-list/);
  assert.match(html, /letter-detail/);
  assert.match(html, /Apply signature preview/);
});

test("postal portal collects signer name, team, and signature upload before approval", () => {
  const html = pageHtml();
  assert.match(html, /id="signerName"/);
  assert.match(html, /id="signerTitle"/);
  assert.match(html, /id="signatureUpload"/);
  assert.match(html, /signatureImageData/);
  assert.match(html, /Approve signature and queue this letter/);
  assert.match(html, /Reject \/ request changes/);
});

test("postal portal signer inputs do not rerender the form on every keystroke", () => {
  const html = pageHtml();
  assert.doesNotMatch(html, /oninput="syncPreview\(\)"/);
  assert.match(html, /oninput="rememberSigner\(\);syncOpenPreview\(\)"/);
  assert.match(html, /function rememberSigner\(\)/);
});

test("postal portal preserves signer details while loading signature and refreshes open preview", () => {
  const html = pageHtml();
  assert.match(html, /signerDrafts\[selectedId\]=signer/);
  assert.match(html, /const signer=currentSigner\(\)/);
  assert.match(html, /signatureImageData=r\.result; renderDetail\(\); syncOpenPreview\(\);/);
});

test("postal portal opens the full reconstructed letter in a modal from a Preview letter button", () => {
  const html = pageHtml();
  assert.match(html, /Preview letter/);
  assert.match(html, /openLetterPreview\(\)/);
  assert.match(html, /id="letterPreviewModal"/);
  assert.match(html, /id="letterPreviewStage"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /renderLetterPreviewPage/);
  assert.doesNotMatch(html, /<div class=\"preview-card\"><div class=\"secure-access-preview-shell\">/);
});

test("postal portal preview modal can be closed without duplicate close buttons", () => {
  const html = pageHtml();
  assert.match(html, /onclick="closePreviewFromBackdrop\(event\)"/);
  assert.match(html, /function closePreviewFromBackdrop\(event\)/);
  assert.match(html, /event\.target === event\.currentTarget/);
  assert.match(html, /aria-label="Close preview"/);
  assert.doesNotMatch(html, /class="close-preview-btn"/);
  assert.doesNotMatch(html, /<button class="close-preview-btn"/);
});

test("postal portal modal preview uses the uploaded-template style full letter, not the old mock letterhead", () => {
  const html = pageHtml();
  assert.match(html, /secure-access-preview-shell/);
  assert.match(html, /aspect-ratio:\s*8\.5\s*\/\s*11/);
  assert.match(html, /target-letter-hero/);
  assert.match(html, /NORTHERN PEAK/);
  assert.match(html, /Subject: Overdue invoice reminder/);
  assert.match(html, /INNOVATE/);
  assert.match(html, /COLLABORATE/);
  assert.match(html, /ELEVATE/);
  assert.match(html, /assets\/northern-peak-header-reference\.jpg/);
  assert.match(html, /assets\/northern-peak-logo-contact-reference\.jpg/);
  assert.doesNotMatch(html, /FlowAudit client letterhead/);
  assert.doesNotMatch(html, /min-height:720px/);
});

test("postal portal preview header does not overlay the letter while scrolling", () => {
  const html = pageHtml();
  assert.match(html, /preview-dialog-head\{[^}]*border-bottom:1px solid var\(--fa-line\)/);
  assert.doesNotMatch(html, /preview-dialog-head\{[^}]*position:sticky/);
  assert.doesNotMatch(html, /preview-dialog-head\{[^}]*top:0/);
});

test("postal portal recommends and renders a properly sized signature", () => {
  const html = pageHtml();
  assert.match(html, /900 × 270 px/);
  assert.match(html, /3:1 ratio/);
  assert.match(html, /signature-img\{max-width:310px;max-height:88px/);
  assert.match(html, /signature-placeholder\{width:310px;height:78px/);
});

test("postal portal reference template is asset-backed and not freestyled", () => {
  const html = pageHtml();
  assert.match(html, /target-letter-hero\{[^}]*url\('assets\/northern-peak-header-reference\.jpg'\)/);
  assert.match(html, /<img class=\"target-letter-brand-img\"/);
  assert.doesNotMatch(html, /mountain-mark/);
  assert.doesNotMatch(html, /⌂⌂⌂/);
  assert.doesNotMatch(html, /radial-gradient\(ellipse at 54% 24%/);
});

test("postal portal preview body spans the page instead of being trapped in a narrow left column", () => {
  const html = pageHtml();
  assert.match(html, /target-letter-top/);
  assert.match(html, /target-letter-main/);
  assert.match(html, /class=\"body-copy letter-main-copy\"/);
  assert.doesNotMatch(html, /target-letter-grid\{display:grid;grid-template-columns:1fr 270px/);
});

test("postal portal states the hard gate that no letter sends without portal sign-off", () => {
  const html = pageHtml();
  assert.match(html, /No portal signature approval, no physical letter/);
  assert.match(html, /This MVP does not send live letters/);
  assert.match(html, /final send remains blocked until the signed-preview hash is recorded/);
});

test("welcome pack references the postal portal as part of the client welcome flow", () => {
  const src = fs.readFileSync(welcomePath, "utf8");
  assert.match(src, /signedPostalPortalUrl/);
  assert.match(src, /Postal Portal/);
  assert.match(src, /pending physical letters/);
  assert.match(src, /No physical letter is sent without portal sign-off/);
});
