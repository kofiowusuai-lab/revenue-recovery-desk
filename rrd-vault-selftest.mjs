#!/usr/bin/env node
/**
 * rrd-vault-selftest.mjs — live end-to-end check of the vault, using a throwaway
 * value (never a real secret). Run after applying the migration:
 *
 *   ./rrd-vault   # (wrapper sources .env.local)  -- or:
 *   node rrd-vault-selftest.mjs
 *
 * Proves, against the real Supabase project:
 *   1. service-role can create a drop
 *   2. anon (browser identity) can read public fields via vault_get
 *   3. anon CANNOT read the table directly (ciphertext stays hidden)
 *   4. anon can deposit ciphertext once via vault_deposit; a second deposit fails
 *   5. service-role reads ciphertext; the local private key decrypts it
 *   6. cleanup removes the test row
 */
import { generateRsaKeypair, sealEnvelope, openEnvelope, newToken } from "./rrd-vault-core.mjs";

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
// anon key is public (it ships in vault.html); used here to play the browser's role.
const ANON = process.env.SUPABASE_ANON_KEY || "__SUPABASE_ANON_KEY_PLACEHOLDER__";

const TESTVAL = "selftest-" + Date.now();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

async function sr(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const txt = await res.text();
  return { status: res.status, body: txt ? JSON.parse(txt) : null };
}
async function rpc(path, body, useSr = false) {
  const k = useSr ? SR : ANON;
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${path}`, { method: "POST", headers: { apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const txt = await res.text();
  return { status: res.status, body: txt ? (() => { try { return JSON.parse(txt); } catch { return txt; } })() : null };
}
async function anonSelect() {
  const res = await fetch(`${URL_BASE}/rest/v1/vault_drops?select=*`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  return { status: res.status, body: await res.text() };
}

async function main() {
  if (!URL_BASE || !SR) { console.error("missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
  console.log("Vault live self-test (throwaway value, no real secret)\n");

  const kp = generateRsaKeypair();
  const { token, tokenHash } = newToken();
  const expires = new Date(Date.now() + 3600 * 1000).toISOString();

  // 1. create drop (service-role)
  const created = await sr("vault_drops", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ profile: "vault-selftest", company: "Self Test Co", env_keys: ["TEST_KEY"], public_key: kp.publicKeyPem, token_hash: tokenHash, expires_at: expires }) });
  ok(created.status === 201 && created.body && created.body[0], "service-role created a drop");
  const id = created.body && created.body[0] && created.body[0].id;

  // 2. anon reads public fields via vault_get
  const got = await rpc("vault_get", { p_token: token });
  const row = Array.isArray(got.body) ? got.body[0] : null;
  ok(got.status === 200 && row && row.public_key && Array.isArray(row.env_keys), "anon vault_get returns public fields");
  ok(row && row.public_key && !JSON.stringify(row).includes("ciphertext"), "vault_get never exposes ciphertext");

  // 3. anon cannot read the table directly
  const direct = await anonSelect();
  ok(direct.status === 401 || direct.status === 403 || direct.body === "[]" || /permission|denied/i.test(direct.body), "anon direct SELECT on vault_drops is blocked");

  // 4. anon deposits once; second deposit fails
  const env = sealEnvelope(kp.publicKeyPem, TESTVAL);
  const dep1 = await rpc("vault_deposit", { p_token: token, p_ciphertext: { TEST_KEY: env } });
  ok(dep1.status === 200, "anon vault_deposit succeeds once");
  const dep2 = await rpc("vault_deposit", { p_token: token, p_ciphertext: { TEST_KEY: env } });
  ok(dep2.status >= 400, "second vault_deposit is rejected (link burned)");

  // 5. service-role reads ciphertext; local key decrypts
  const back = await sr(`vault_drops?id=eq.${id}&select=ciphertext,status`);
  const ct = back.body && back.body[0] && back.body[0].ciphertext;
  ok(ct && ct.TEST_KEY, "service-role can read the deposited ciphertext");
  let plain = null; try { plain = openEnvelope(kp.privateKeyPem, ct.TEST_KEY); } catch {}
  ok(plain === TESTVAL, "local private key decrypts the deposited value");

  // 6. cleanup
  const del = await sr(`vault_drops?id=eq.${id}`, { method: "DELETE" });
  ok(del.status === 200 || del.status === 204, "cleanup removed the test row");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
