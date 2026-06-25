import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const terms = fs.readFileSync(new URL("../revenue-recovery-web/terms.html", import.meta.url), "utf8");
const msa = fs.readFileSync(new URL("../revenue-recovery-contracts/01-master-services-agreement.md", import.meta.url), "utf8");
const order = fs.readFileSync(new URL("../revenue-recovery-contracts/03-order-form-template.md", import.meta.url), "utf8");
const welcome = fs.readFileSync(new URL("../rrd-welcome-pack.mjs", import.meta.url), "utf8");

test("letter pricing is disclosed in terms, MSA, order form, and access email copy", () => {
  for (const src of [terms, msa, order, welcome]) {
    assert.match(src, /\$1\.219/);
    assert.match(src, /20p per page/);
  }
});
