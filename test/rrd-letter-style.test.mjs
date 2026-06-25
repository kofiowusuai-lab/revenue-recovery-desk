import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  analyzeLetterStyle,
  loadLetterStyleManifest,
  reconstructDesignFromAssets,
  styleLetterHtml,
} from "../rrd-letter-style.mjs";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

const manifest = {
  bucket: "onboarding-docs",
  purpose: "replicate_client_letter_layout_for_approved_recovery_letters",
  assets: [
    { name: "Acme Logo.png", path: "letter-style/drop/acme-logo.png", type: "image/png", size: PNG_1X1.length, role: "logo_or_brand_asset" },
    { name: "blank-letterhead-background.png", path: "letter-style/drop/blank-letterhead-background.png", type: "image/png", size: PNG_1X1.length, role: "letterhead_or_template" },
    { name: "previous-recovery-letter.pdf", path: "letter-style/drop/previous-recovery-letter.pdf", type: "application/pdf", size: 1234, role: "letter_template_or_sample" },
  ],
};

test("analyzeLetterStyle chooses logo, letterhead background, and reference samples", () => {
  const style = analyzeLetterStyle(manifest);
  assert.equal(style.source, "uploaded_assets");
  assert.equal(style.logo.name, "Acme Logo.png");
  assert.equal(style.letterhead.name, "blank-letterhead-background.png");
  assert.equal(style.fidelity.usesEmbeddedLogo, true);
  assert.equal(style.fidelity.usesLetterheadBackground, true);
  assert.equal(style.fidelity.referenceSamples[0].name, "previous-recovery-letter.pdf");
});

test("styleLetterHtml embeds uploaded logo/background as data URIs and keeps recovery copy", async () => {
  const style = analyzeLetterStyle(manifest);
  const html = await styleLetterHtml("<p>Dear Jane, please pay invoice INV-1.</p>", style, {
    fetchAsset: async () => PNG_1X1,
  });
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /rrd-letter-logo/);
  assert.match(html, /background-image:url/);
  assert.match(html, /please pay invoice INV-1/);
});

test("loadLetterStyleManifest reads RRD_LETTER_STYLE_ASSETS_JSON from profile env", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rrd-letter-style-"));
  const dir = path.join(root, "rr-acme");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".env"), `RRD_LETTER_STYLE_ASSETS_JSON=${JSON.stringify(manifest)}\n`);
  const loaded = loadLetterStyleManifest("rr-acme", { profilesDir: root });
  assert.equal(loaded.bucket, "onboarding-docs");
  assert.equal(loaded.assets.length, 3);
});

test("rrd-recover wires letter HTML through styleLetterHtmlForProfile before PostGrid send", () => {
  const src = fs.readFileSync(new URL("../rrd-recover.mjs", import.meta.url), "utf8");
  assert.match(src, /styleLetterHtmlForProfile/);
  assert.match(src, /html && !action\.pdfUrl && !action\.pdf/);
  assert.match(src, /to: action\.to, from: action\.from, html, pdfUrl: action\.pdfUrl/);
});

test("reconstructDesignFromAssets extracts PDF layout hints for preview-approved style", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rrd-letter-recon-"));
  const pdf = path.join(tmp, "sample-letter.pdf");
  execFileSync("python3", ["-c", `
import fitz
doc=fitz.open(); page=doc.new_page(width=612,height=792)
page.insert_text((72,72),'ACME ACCOUNTS',fontsize=18,fontname='helv')
page.insert_text((90,180),'Dear Customer,',fontsize=11,fontname='helv')
page.insert_text((90,210),'Please pay invoice INV-1.',fontsize=11,fontname='helv')
doc.save(r'${pdf}')
`]);
  const pdfBytes = fs.readFileSync(pdf);
  const m = { bucket: "onboarding-docs", assets: [{ name: "sample-letter.pdf", path: "x/sample-letter.pdf", type: "application/pdf", size: pdfBytes.length, role: "letter_template_or_sample" }] };
  const style = analyzeLetterStyle(m);
  const reconstructed = await reconstructDesignFromAssets(style, { fetchAsset: async () => pdfBytes });
  assert.equal(reconstructed.reconstruction.engine, "pymupdf/python-docx");
  assert.equal(reconstructed.reconstruction.requiresPreviewApproval, true);
  assert.ok(reconstructed.layout.marginTop.endsWith("in"));
  assert.equal(reconstructed.typography.fontSizePt, 11);
});
