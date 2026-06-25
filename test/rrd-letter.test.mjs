import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLetterBody, sendLetter, getLetterStatus, listLetters } from "../rrd-letter.mjs";

const TO = { firstName: "Jane", lastName: "Doe", addressLine1: "20-20 Bay St", city: "Toronto", provinceOrState: "ON", postalOrZip: "M5J 2N8", country: "CA" };
const FROM = { firstName: "John", lastName: "Smith", addressLine1: "100 Main St", city: "New York", provinceOrState: "NY", postalOrZip: "10001", country: "US" };

/* ---------- pure unit tests: buildLetterBody (no network) ---------- */

test("buildLetterBody: html mode + defaults", () => {
  const b = buildLetterBody({ to: TO, from: FROM, html: "<b>Hi {{name}}</b>" });
  assert.equal(b.html, "<b>Hi {{name}}</b>");
  assert.equal(b.pdf, undefined);
  assert.equal(b.mailingClass, "first_class");
  assert.equal(b.color, false);
  assert.equal(b.doubleSided, true);
  assert.equal(b.extraService, undefined);
  assert.deepEqual(b.to, TO);
  assert.deepEqual(b.from, FROM);
});

test("buildLetterBody: pdf mode via pdfUrl", () => {
  const b = buildLetterBody({ to: TO, from: FROM, pdfUrl: "https://example.com/notice.pdf" });
  assert.equal(b.pdf, "https://example.com/notice.pdf");
  assert.equal(b.html, undefined);
});

test("buildLetterBody: certified -> extraService:'certified'", () => {
  const b = buildLetterBody({ to: TO, from: FROM, html: "<p>x</p>", certified: true });
  assert.equal(b.extraService, "certified");
});

test("buildLetterBody: explicit extraService wins over certified flag", () => {
  const b = buildLetterBody({ to: TO, from: FROM, html: "<p>x</p>", certified: true, extraService: "registered" });
  assert.equal(b.extraService, "registered");
});

test("buildLetterBody: overrides for color/doubleSided/mailingClass", () => {
  const b = buildLetterBody({ to: TO, from: FROM, html: "<p>x</p>", color: true, doubleSided: false, mailingClass: "standard_class" });
  assert.equal(b.color, true);
  assert.equal(b.doubleSided, false);
  assert.equal(b.mailingClass, "standard_class");
});

test("buildLetterBody: mergeVariables, description, metadata passthrough", () => {
  const b = buildLetterBody({ to: TO, from: FROM, html: "<p>{{amt}}</p>", mergeVariables: { amt: "$250" }, description: "Dunning #1", metadata: { clientId: "c_1" } });
  assert.deepEqual(b.mergeVariables, { amt: "$250" });
  assert.equal(b.description, "Dunning #1");
  assert.deepEqual(b.metadata, { clientId: "c_1" });
});

test("buildLetterBody: empty mergeVariables/metadata omitted", () => {
  const b = buildLetterBody({ to: TO, from: FROM, html: "<p>x</p>", mergeVariables: {}, metadata: {} });
  assert.equal("mergeVariables" in b, false);
  assert.equal("metadata" in b, false);
});

test("buildLetterBody: requires to and from", () => {
  assert.throws(() => buildLetterBody({ from: FROM, html: "<p>x</p>" }), /'to' address is required/);
  assert.throws(() => buildLetterBody({ to: TO, html: "<p>x</p>" }), /'from' address is required/);
});

test("buildLetterBody: requires html or pdf, not both", () => {
  assert.throws(() => buildLetterBody({ to: TO, from: FROM }), /either 'html' or 'pdfUrl'/);
  assert.throws(() => buildLetterBody({ to: TO, from: FROM, html: "<p>x</p>", pdfUrl: "https://x/y.pdf" }), /only one of/);
});

/* ---------- live smoke test (guarded by POSTGRID_API_KEY) ---------- */

test("live: sendLetter creates a test letter and getLetterStatus reads it back", { skip: !process.env.POSTGRID_API_KEY ? "POSTGRID_API_KEY not set" : false }, async () => {
  const created = await sendLetter({
    to: TO,
    from: FROM,
    html: "<b>Hello {{name}}</b> — this is an automated RRD test letter.",
    mergeVariables: { name: "Jane" },
    description: "rrd-letter live smoke test",
    metadata: { source: "rrd-letter.test.mjs" }
  });
  assert.ok(created.id, "created letter has an id");
  assert.match(created.id, /^letter_/, "id is a PostGrid letter id");
  assert.ok(created.status, "created letter has a status");

  const fetched = await getLetterStatus(created.id);
  assert.equal(fetched.id, created.id, "getLetterStatus returns the same letter");
  assert.ok(fetched.status, "fetched letter has a status");

  const recent = await listLetters(5);
  assert.ok(Array.isArray(recent), "listLetters returns an array");
});
