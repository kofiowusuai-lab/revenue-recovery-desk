#!/usr/bin/env node
/**
 * rrd-letter.mjs — PostGrid print-and-mail letters module for the Revenue Recovery Desk.
 *
 * Sends physical recovery letters (dunning notices, certified/legal-proof demands)
 * through PostGrid's print-and-mail API. No browser, zero npm deps (Node 18+ global
 * fetch). A test_sk_... key creates letters in test mode (preview PDF, no real mail,
 * no charge). The gated executor chooses client POSTGRID_API_KEY first, then shared
 * fallback, and records per-profile usage for pass-through billing.
 *
 *   export POSTGRID_API_KEY="test_sk_..."        # required (Settings → API)
 *   export POSTGRID_API_BASE="https://api.postgrid.com/print-mail/v1"   # optional override
 *
 *   node rrd-letter.mjs send '{"to":{...},"from":{...},"html":"<b>Hi {{name}}</b>","mergeVariables":{"name":"Jane"}}'
 *   node rrd-letter.mjs send '{"to":{...},"from":{...},"pdfUrl":"https://…/notice.pdf","certified":true}'
 *   node rrd-letter.mjs status '"letter_..."'
 *   node rrd-letter.mjs verify '{"addressLine1":"100 Main St","city":"New York","provinceOrState":"NY","postalOrZip":"10001","country":"US"}'
 *   node rrd-letter.mjs list '10'
 *   node rrd-letter.mjs help
 *
 * Address objects use PostGrid fields:
 *   firstName, lastName, companyName, addressLine1, addressLine2,
 *   city, provinceOrState, postalOrZip, country (ISO-2, e.g. "US"/"CA").
 */

const API_BASE = (process.env.POSTGRID_API_BASE || "https://api.postgrid.com/print-mail/v1").replace(/\/+$/, "");
const DEFAULT_KEY = process.env.POSTGRID_API_KEY || "";

const METHODS = new Set(["send", "status", "verify", "list", "help"]);

function usage() {
  console.error(`rrd-letter — PostGrid print-and-mail for the Revenue Recovery Desk

Usage:  node rrd-letter.mjs <method> [jsonArg]

Methods: ${[...METHODS].join(", ")}

Setup:
  export POSTGRID_API_KEY="test_sk_..."          # test mode: preview only, no real mail
  export POSTGRID_API_BASE="${API_BASE}"  # optional

Examples:
  node rrd-letter.mjs send '{"to":{"firstName":"Jane","lastName":"Doe","addressLine1":"20-20 Bay St","city":"Toronto","provinceOrState":"ON","postalOrZip":"M5J 2N8","country":"CA"},"from":{"firstName":"John","lastName":"Smith","addressLine1":"100 Main St","city":"New York","provinceOrState":"NY","postalOrZip":"10001","country":"US"},"html":"<b>Hello {{name}}</b>","mergeVariables":{"name":"Jane"}}'
  node rrd-letter.mjs status '"letter_..."'
  node rrd-letter.mjs list '10'`);
}

function need(apiKey = DEFAULT_KEY) {
  if (!apiKey) throw new Error("Missing config. Set POSTGRID_API_KEY (PostGrid → Settings → API). A test_sk_... key runs in test mode.");
}

async function api(path, init = {}, { apiKey = DEFAULT_KEY } = {}) {
  const res = await fetch(`${API_BASE}/${path}`, {
    ...init,
    headers: { "x-api-key": apiKey, "Content-Type": "application/json", ...(init.headers || {}) }
  });
  const text = await res.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  if (!res.ok) {
    const msg = body && typeof body === "object" && body.error
      ? (body.error.message || JSON.stringify(body.error))
      : (typeof body === "string" ? body : `HTTP ${res.status}`);
    throw new Error(`PostGrid ${res.status}: ${msg}`);
  }
  return body;
}

/**
 * buildLetterBody — PURE. Maps friendly options to the exact PostGrid /letters body.
 * Content is html OR pdf (pdfUrl). certified -> extraService:'certified'.
 */
export function buildLetterBody(opts = {}) {
  const {
    to, from, html, pdf, pdfUrl,
    mailingClass = "first_class",
    certified = false,
    extraService,
    color = false,
    doubleSided = true,
    mergeVariables,
    description,
    metadata,
    addressPlacement
  } = opts;

  if (!to) throw new Error("buildLetterBody: 'to' address is required");
  if (!from) throw new Error("buildLetterBody: 'from' address is required");

  const content = pdf || pdfUrl;
  if (!html && !content) throw new Error("buildLetterBody: provide either 'html' or 'pdfUrl'");
  if (html && content) throw new Error("buildLetterBody: provide only one of 'html' or 'pdfUrl', not both");

  const body = {
    to,
    from,
    mailingClass,
    color: !!color,
    doubleSided: !!doubleSided
  };

  if (html) body.html = html;
  else body.pdf = content;

  const svc = extraService || (certified ? "certified" : undefined);
  if (svc) body.extraService = svc;

  if (mergeVariables && Object.keys(mergeVariables).length) body.mergeVariables = mergeVariables;
  if (addressPlacement) body.addressPlacement = addressPlacement;
  if (description) body.description = description;
  if (metadata && Object.keys(metadata).length) body.metadata = metadata;

  return body;
}

/** sendLetter — create a letter. Returns the created letter object ({id,status,...}). */
export async function sendLetter(opts = {}) {
  const apiKey = opts.apiKey || DEFAULT_KEY;
  need(apiKey);
  const body = buildLetterBody(opts);
  return api("letters", { method: "POST", body: JSON.stringify(body) }, { apiKey });
}

/** getLetterStatus — fetch one letter by id. Returns the letter object. */
export async function getLetterStatus(id, opts = {}) {
  const apiKey = opts.apiKey || DEFAULT_KEY;
  need(apiKey);
  if (!id) throw new Error("getLetterStatus expects a letter id");
  return api(`letters/${encodeURIComponent(id)}`, {}, { apiKey });
}

/** listLetters — return an array of recent letters. */
export async function listLetters(limit = 10, opts = {}) {
  const apiKey = opts.apiKey || DEFAULT_KEY;
  need(apiKey);
  const n = Math.max(1, Math.min(Number(limit) || 10, 100));
  const res = await api(`letters?limit=${n}`, {}, { apiKey });
  if (Array.isArray(res)) return res;
  return (res && Array.isArray(res.data)) ? res.data : [];
}

/**
 * verifyAddress — best-effort PostGrid address verification.
 * The print-mail key may not have access to the address-verification product,
 * so on any 404/error we soft-skip rather than hard-fail.
 */
export async function verifyAddress(addr = {}, opts = {}) {
  const apiKey = opts.apiKey || DEFAULT_KEY;
  need(apiKey);
  const bases = [
    "https://api.postgrid.com/v1/addver/verifications",
    `${API_BASE}/addresses/verifications`
  ];
  const payload = JSON.stringify({
    address: {
      line1: addr.addressLine1 || addr.line1,
      line2: addr.addressLine2 || addr.line2,
      city: addr.city,
      provinceOrState: addr.provinceOrState,
      postalOrZip: addr.postalOrZip,
      country: addr.country
    }
  });
  for (const url of bases) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
        body: payload
      });
      if (!res.ok) continue;
      const text = await res.text();
      const body = text ? JSON.parse(text) : null;
      const data = body && body.data ? body.data : body;
      return { verified: data && (data.status === "verified" || data.verified === true) ? true : (data ? false : null), data };
    } catch { /* try next base */ }
  }
  return { verified: null, skipped: true };
}

async function run(method, arg) {
  if (method === "help") {
    return {
      name: "rrd-letter", backend: "PostGrid print-and-mail v1", base: API_BASE,
      mode: DEFAULT_KEY.startsWith("test_") ? "test (preview only, no real mail)" : (DEFAULT_KEY ? "live" : "unconfigured"),
      methods: [
        ["send(opts)", "create a letter (html or pdfUrl); certified->extraService"],
        ["status(id)", "fetch one letter by id"],
        ["verify(addr)", "best-effort address verification (soft-skips if unavailable)"],
        ["list(limit?)", "recent letters (default 10)"],
        ["help", "this manifest"]
      ],
      addressFields: ["firstName", "lastName", "companyName", "addressLine1", "addressLine2", "city", "provinceOrState", "postalOrZip", "country"],
      sendOptions: ["to", "from", "html", "pdfUrl", "mailingClass", "certified", "color", "doubleSided", "mergeVariables", "description", "metadata"]
    };
  }
  if (method === "send") {
    if (!arg || typeof arg !== "object") throw new Error("send expects a JSON object: {to,from,html|pdfUrl,...}");
    return sendLetter(arg);
  }
  if (method === "status") {
    const id = typeof arg === "string" ? arg : (arg && arg.id);
    return getLetterStatus(id);
  }
  if (method === "verify") {
    if (!arg || typeof arg !== "object") throw new Error("verify expects a JSON address object");
    return verifyAddress(arg);
  }
  if (method === "list") {
    const limit = typeof arg === "number" ? arg : (arg && arg.limit) || 10;
    return listLetters(limit);
  }
  throw new Error("Unhandled method: " + method);
}

async function main() {
  const [, , method, rawArg] = process.argv;
  if (!method || method === "-h" || method === "--help") { usage(); process.exit(method ? 0 : 1); }
  if (!METHODS.has(method)) { console.error(`Unknown method: ${method}\n`); usage(); process.exit(1); }
  let arg;
  if (rawArg != null && rawArg !== "") { try { arg = JSON.parse(rawArg); } catch { arg = rawArg; } }
  const result = await run(method, arg);
  if (method === "help") {
    console.log(`${result.name} — ${result.backend}  [${result.mode}]\n`);
    result.methods.forEach(([sig, desc]) => console.log(`  ${sig.padEnd(16)} ${desc}`));
    console.log(`\naddress fields: ${result.addressFields.join(", ")}`);
    console.log(`send options:   ${result.sendOptions.join(", ")}`);
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

// Only run the CLI when invoked directly, not when imported by tests.
const invokedDirectly = process.argv[1] && (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1]));
if (invokedDirectly) {
  main().catch((e) => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
}
