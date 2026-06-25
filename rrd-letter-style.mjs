#!/usr/bin/env node
/**
 * rrd-letter-style.mjs — deterministic client letter-style mimic layer.
 *
 * Reads RRD_LETTER_STYLE_ASSETS_JSON from a client profile .env, fetches uploaded
 * Supabase Storage assets when needed, and wraps recovery-letter HTML in a
 * PostGrid-safe template that preserves client branding. It does not use secrets
 * from chat and never prints API keys. The output is HTML for PostGrid to render.
 *
 * Fidelity model:
 * - logo/brand images are embedded as data URIs and placed in the header;
 * - letterhead/background images are embedded behind the page body;
 * - margins/typography are inferred from supplied style hints or conservative
 *   business-letter defaults;
 * - PDF/DOCX assets are reconstructed through the local PyMuPDF/python-docx
 *   extractor when available; preview approval remains the final accuracy gate.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || "/Users/AIAgenterminal";
const PROFILES_DIR = process.env.HERMES_PROFILES_DIR || path.join(OPERATOR_HOME, ".hermes", "profiles");
const STORAGE_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const STORAGE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const DEFAULT_BUCKET = "onboarding-docs";
const EXTRACTOR = path.join(OPERATOR_HOME, "rrd-letter-design-extract.py");

const IMAGE_EXT = /\.(png|jpe?g|svg|webp)$/i;
const LETTERHEAD_NAME = /(letter\s*head|letterhead|template|background|stationery|headed)/i;
const LOGO_NAME = /(logo|brand|mark|wordmark)/i;

export function parseEnvFile(file) {
  const out = {};
  if (!file || !fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [k, ...rest] = line.split("=");
    let v = rest.join("=").trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k.trim()] = v;
  }
  return out;
}

export function loadLetterStyleManifest(profile, { profilesDir = PROFILES_DIR } = {}) {
  const env = parseEnvFile(path.join(profilesDir, profile, ".env"));
  if (!env.RRD_LETTER_STYLE_ASSETS_JSON) return null;
  try {
    const manifest = JSON.parse(env.RRD_LETTER_STYLE_ASSETS_JSON);
    if (!manifest || typeof manifest !== "object") return null;
    return normalizeManifest(manifest);
  } catch {
    return null;
  }
}

export function normalizeManifest(manifest = {}) {
  const bucket = manifest.bucket || DEFAULT_BUCKET;
  const assets = Array.isArray(manifest.assets) ? manifest.assets.map((a) => ({
    name: String(a.name || path.basename(a.path || "asset")),
    path: String(a.path || ""),
    type: String(a.type || mimeFromName(a.name || a.path || "")),
    size: Number(a.size) || 0,
    role: String(a.role || inferRole(a)),
  })).filter((a) => a.path) : [];
  return { ...manifest, bucket, assets };
}

export function inferRole(asset = {}) {
  const name = String(asset.name || asset.path || "");
  const type = String(asset.type || "");
  if ((LOGO_NAME.test(name) || asset.role === "logo_or_brand_asset") && (IMAGE_EXT.test(name) || type.startsWith("image/"))) return "logo_or_brand_asset";
  if ((LETTERHEAD_NAME.test(name) || asset.role === "letterhead_or_template") && (IMAGE_EXT.test(name) || type.startsWith("image/"))) return "letterhead_background";
  if (IMAGE_EXT.test(name) || type.startsWith("image/")) return "logo_or_brand_asset";
  return "letter_template_or_sample";
}

export function analyzeLetterStyle(manifest = null, hints = {}) {
  const m = manifest ? normalizeManifest(manifest) : { bucket: DEFAULT_BUCKET, assets: [] };
  const imageAssets = m.assets.filter((a) => IMAGE_EXT.test(a.name) || /^image\//.test(a.type));
  const logo = imageAssets.find((a) => a.role === "logo_or_brand_asset" || LOGO_NAME.test(a.name)) || null;
  const letterhead = imageAssets.find((a) => a.role === "letterhead_background" || LETTERHEAD_NAME.test(a.name)) || null;
  const samples = m.assets.filter((a) => !imageAssets.includes(a));
  return {
    version: 1,
    source: m.assets.length ? "uploaded_assets" : "default_rrd_letter",
    bucket: m.bucket || DEFAULT_BUCKET,
    logo,
    letterhead,
    samples,
    typography: {
      fontFamily: hints.fontFamily || "Arial, Helvetica, sans-serif",
      fontSizePt: Number(hints.fontSizePt) || 11,
      lineHeight: Number(hints.lineHeight) || 1.45,
      color: hints.color || "#111827",
    },
    layout: {
      pageWidth: "8.5in",
      minHeight: "11in",
      marginTop: hints.marginTop || (letterhead ? "1.85in" : "1.35in"),
      marginRight: hints.marginRight || "0.8in",
      marginBottom: hints.marginBottom || "0.8in",
      marginLeft: hints.marginLeft || "0.8in",
      logoPlacement: hints.logoPlacement || "top-left",
      logoMaxWidth: hints.logoMaxWidth || "1.65in",
    },
    fidelity: {
      usesEmbeddedLogo: !!logo,
      usesLetterheadBackground: !!letterhead,
      referenceSamples: samples.map((s) => ({ name: s.name, path: s.path, type: s.type })),
      note: samples.length ? "PDF/DOCX/sample letters retained as style references; image/logo/letterhead assets are rendered automatically." : "Image/logo/letterhead assets are rendered automatically.",
    },
  };
}

export async function styleLetterHtmlForProfile(profile, html, opts = {}) {
  const manifest = opts.manifest || loadLetterStyleManifest(profile, opts);
  const style = analyzeLetterStyle(manifest, opts.hints || {});
  return styleLetterHtml(html, style, opts);
}

export async function styleLetterHtml(html, style, opts = {}) {
  if (!html) return html;
  const fetchAsset = opts.fetchAsset || fetchStorageAsset;
  style = await reconstructDesignFromAssets(style, { fetchAsset, extractor: opts.extractor || EXTRACTOR });
  let logoDataUri = null;
  let letterheadDataUri = null;
  if (style.logo) logoDataUri = await assetDataUri(style.bucket, style.logo, fetchAsset);
  if (!logoDataUri && style.reconstruction?.logo?.dataUri) logoDataUri = style.reconstruction.logo.dataUri;
  if (style.letterhead) letterheadDataUri = await assetDataUri(style.bucket, style.letterhead, fetchAsset);
  return renderStyledLetterHtml({ bodyHtml: html, style, logoDataUri, letterheadDataUri });
}

export async function reconstructDesignFromAssets(style, { fetchAsset = fetchStorageAsset, extractor = EXTRACTOR } = {}) {
  const samples = [...(style.samples || [])];
  if (!samples.length || !fs.existsSync(extractor)) return style;
  const recon = [];
  for (const asset of samples) {
    if (!/\.(pdf|docx)$/i.test(asset.name || asset.path || "")) continue;
    const bytes = await fetchAsset(style.bucket, asset.path);
    const ext = path.extname(asset.name || asset.path) || (asset.type === "application/pdf" ? ".pdf" : ".bin");
    const tmp = path.join(os.tmpdir(), `rrd-letter-style-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
    try {
      fs.writeFileSync(tmp, Buffer.from(bytes));
      const raw = execFileSync("python3", [extractor, tmp], { encoding: "utf8", timeout: 60000 });
      recon.push({ asset: asset.name, path: asset.path, ...JSON.parse(raw) });
    } finally {
      try { fs.unlinkSync(tmp); } catch {}
    }
  }
  if (!recon.length) return style;
  const first = recon.find((r) => r.type === "pdf") || recon[0];
  const typ = first.typography || {};
  const lay = first.layout || {};
  return {
    ...style,
    typography: {
      ...style.typography,
      fontFamily: typ.fontFamily || style.typography.fontFamily,
      fontSizePt: typ.fontSizePt || style.typography.fontSizePt,
    },
    layout: {
      ...style.layout,
      marginLeft: lay.marginLeftPt ? `${(lay.marginLeftPt / 72).toFixed(2)}in` : style.layout.marginLeft,
      marginTop: lay.marginTopPt ? `${(lay.marginTopPt / 72).toFixed(2)}in` : style.layout.marginTop,
      marginRight: lay.marginRightPt ? `${(lay.marginRightPt / 72).toFixed(2)}in` : style.layout.marginRight,
      marginBottom: lay.marginBottomPt ? `${(lay.marginBottomPt / 72).toFixed(2)}in` : style.layout.marginBottom,
    },
    reconstruction: {
      engine: "pymupdf/python-docx",
      requiresPreviewApproval: true,
      extractedAt: new Date().toISOString(),
      assets: recon,
      logo: recon.map((r) => r.logo).find((l) => l && l.dataUri) || null,
    },
    fidelity: {
      ...style.fidelity,
      note: "PDF/DOCX samples are OCR/layout-extracted locally; client preview approval remains the final accuracy gate before live letters."
    }
  };
}

export function renderStyledLetterHtml({ bodyHtml, style, logoDataUri = null, letterheadDataUri = null }) {
  const t = style.typography;
  const l = style.layout;
  const logoBlock = logoDataUri ? `<div class="rrd-letter-logo"><img src="${escAttr(logoDataUri)}" alt="Client logo"></div>` : "";
  const bgCss = letterheadDataUri ? `background-image:url('${cssUrl(letterheadDataUri)}');background-repeat:no-repeat;background-position:top center;background-size:100% auto;` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Recovery letter</title><style>
  @page{size:Letter;margin:0;}
  html,body{margin:0;padding:0;background:#fff;color:${t.color};font-family:${t.fontFamily};font-size:${t.fontSizePt}pt;line-height:${t.lineHeight};}
  .rrd-page{box-sizing:border-box;width:${l.pageWidth};min-height:${l.minHeight};margin:0 auto;position:relative;${bgCss}padding:${l.marginTop} ${l.marginRight} ${l.marginBottom} ${l.marginLeft};}
  .rrd-letter-logo{position:absolute;top:0.55in;left:${l.marginLeft};max-width:${l.logoMaxWidth};max-height:0.85in;}
  .rrd-letter-logo img{max-width:${l.logoMaxWidth};max-height:0.85in;height:auto;width:auto;display:block;}
  .rrd-content{position:relative;z-index:1;white-space:normal;}
  .rrd-content p{margin:0 0 0.14in;}
  .rrd-content table{border-collapse:collapse;width:100%;}
  .rrd-content a{color:inherit;}
  </style></head><body><main class="rrd-page">${logoBlock}<section class="rrd-content">${bodyHtml}</section></main></body></html>`;
}

async function assetDataUri(bucket, asset, fetchAsset) {
  const bytes = await fetchAsset(bucket, asset.path);
  if (!bytes || !bytes.length) return null;
  const mime = asset.type || mimeFromName(asset.name || asset.path);
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

export async function fetchStorageAsset(bucket, objectPath) {
  if (!STORAGE_BASE || !STORAGE_KEY) throw new Error("Supabase storage config missing for letter style asset fetch");
  const url = `${STORAGE_BASE}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
  const res = await fetch(url, { headers: { apikey: STORAGE_KEY, Authorization: `Bearer ${STORAGE_KEY}` } });
  if (!res.ok) throw new Error(`Could not fetch letter style asset ${objectPath}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function mimeFromName(name = "") {
  const n = String(name).toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".svg")) return "image/svg+xml";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}
function escAttr(s) { return String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;"); }
function cssUrl(s) { return String(s).replace(/'/g,"%27").replace(/\)/g,"%29"); }

async function main() {
  const profile = process.argv[2];
  const html = process.argv[3] || "<p>Example recovery letter body.</p>";
  if (!profile) throw new Error("usage: node rrd-letter-style.mjs <profile> '<html>'");
  console.log(await styleLetterHtmlForProfile(profile, html));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message || e); process.exit(1); });
