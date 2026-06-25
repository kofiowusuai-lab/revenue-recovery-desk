import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../revenue-recovery-web/vault.html", import.meta.url), "utf8");

test("vault page gives PostGrid clients an explicit physical-letter opt-out", () => {
  assert.match(html, /f_POSTGRID_LETTERS_OPT_OUT/);
  assert.match(html, /I do not want FlowAudit \/ Revenue Recovery Desk to send physical letters/);
  assert.match(html, /POSTGRID_LETTERS_OPT_OUT/);
});

test("vault page discloses PostGrid pass-through billing before key deposit", () => {
  assert.match(html, /If Letters remain enabled/);
  assert.match(html, /postage, print, processing, certified-mail/);
  assert.match(html, /billed at month-end in addition to your maintenance\/retainer fee/);
});

test("vault page prevents conflicting PostGrid key plus opt-out submission", () => {
  assert.match(html, /Choose one PostGrid option/);
  assert.match(html, /either provide your PostGrid API key or opt out/);
  assert.match(html, /filter\(\(i\) => i\.dataset\.key\)/);
});

test("vault page lets letter clients upload style templates and logos", () => {
  assert.match(html, /Letter style template \+ logos/);
  assert.match(html, /OCR\/design reconstruction/);
  assert.match(html, /logo placement, text style, fonts, spacing, and layout/);
  assert.match(html, /RRD_LETTER_STYLE_ASSETS_JSON/);
  assert.match(html, /RRD_LETTER_STYLE_PREVIEW_APPROVED/);
  assert.match(html, /Recovery notice preview/);
  assert.match(html, /letter-style\//);
});

test("vault page renders uploaded full-page image letters as the template preview", () => {
  assert.match(html, /letter-preview-template/);
  assert.match(html, /Uploaded full-page letter or PDF preview/);
  assert.match(html, /has-template-image/);
  assert.match(html, /return "letterhead_or_template";/);
  assert.match(html, /templateImg\.src = imageTemplate\.previewUrl/);
  assert.match(html, /letter-preview-copy\{display:block;padding:96px 44px 44px;\}/);
  assert.match(html, /img\.removeAttribute\("src"\)/);
});

test("vault page renders uploaded PDFs to image-backed recovery letter previews", () => {
  assert.match(html, /pdfjs-dist/);
  assert.match(html, /renderPdfCleanRecoveryPreviewUrl/);
  assert.match(html, /reconstructed_letter_image/);
  assert.match(html, /has-clean-reconstruction/);
  assert.match(html, /Quality-preserving whiteout workflow/);
  assert.match(html, /ctx\.drawImage\(source, 0, 0, source\.width, source\.height, 0, 0, out\.width, out\.height\)/);
  assert.match(html, /const whiteouts = \[/);
  assert.match(html, /fullTextLeft = 0\.095/);
  assert.match(html, /fullTextWidth = 0\.835/);
  assert.match(html, /full old body text, edge-to-edge/);
  assert.match(html, /textLeft = 0\.125\*out\.width/);
  assert.match(html, /textWidth = 0\.74\*out\.width/);
  assert.match(html, /leave blank signature space/);
  assert.match(html, /date: cover the template date completely before redrawing ours/);
  assert.match(html, /dateBaselineY = 0\.286\*out\.height/);
  assert.match(html, /ctx\.font = "30px Georgia, 'Times New Roman', serif";\n  ctx\.fillText\("20 May 2024", textLeft, dateBaselineY\)/);
  assert.match(html, /recipient block matches main body text size/);
  assert.doesNotMatch(html, /ctx\.font = "38px Georgia, 'Times New Roman', serif"/);
  assert.match(html, /targetWidth = 2200/);
  assert.match(html, /Rendering your PDF into a styled recovery-letter preview/);
  assert.match(html, /renderingPreview: previewKind === "pdf"/);
  assert.match(html, /previewUrl: previewKind === "image" \? URL\.createObjectURL\(file\) : ""/);
  assert.match(html, /has-template-pdf/);
  assert.match(html, /previewKindFor/);
  assert.match(html, /return "pdf"/);
  assert.match(html, /return out\.toDataURL\("image\/png"\)/);
  assert.match(html, /Dear Customer/);
});

test("vault page prevents letter uploads while opting out", () => {
  assert.match(html, /You uploaded letter style files but also opted out of physical letters/);
  assert.match(html, /Please wait for the letter template\/logo uploads to finish/);
});

test("vault page discloses exact letter per-piece pricing", () => {
  assert.match(html, /\$1\.219 per letter \+ 20p per page/);
  assert.match(html, /certified-mail or provider pass-through extras/);
});
