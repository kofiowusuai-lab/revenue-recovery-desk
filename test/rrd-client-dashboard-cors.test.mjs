import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadCommon() {
  delete require.cache[require.resolve("../revenue-recovery-web/api/client-dashboard-common.js")];
  return require("../revenue-recovery-web/api/client-dashboard-common.js");
}

function resFor(origin) {
  const headers = {};
  return {
    headers,
    req: { headers: origin ? { origin } : {} },
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
  };
}

test("dashboard CORS allows configured web base and local development origins", () => {
  process.env.RRD_WEB_BASE = "https://dashboard.example.test";
  const { cors } = loadCommon();
  const prod = resFor("https://dashboard.example.test");
  cors(prod);
  assert.equal(prod.headers["access-control-allow-origin"], "https://dashboard.example.test");
  assert.equal(prod.headers.vary, "Origin");

  const local = resFor("http://localhost:5173");
  cors(local);
  assert.equal(local.headers["access-control-allow-origin"], "http://localhost:5173");

  const branded = resFor("https://flowaudit.co.uk");
  cors(branded);
  assert.equal(branded.headers["access-control-allow-origin"], "https://flowaudit.co.uk");

  const brandedWww = resFor("https://www.flowaudit.co.uk");
  cors(brandedWww);
  assert.equal(brandedWww.headers["access-control-allow-origin"], "https://www.flowaudit.co.uk");
});

test("dashboard CORS does not reflect untrusted origins", () => {
  process.env.RRD_WEB_BASE = "https://dashboard.example.test";
  const { cors } = loadCommon();
  const res = resFor("https://evil.example");
  cors(res);
  assert.notEqual(res.headers["access-control-allow-origin"], "*");
  assert.notEqual(res.headers["access-control-allow-origin"], "https://evil.example");
});
