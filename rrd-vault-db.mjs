/**
 * rrd-vault-db.mjs — service-role Supabase access for the Secrets Vault (Mac only).
 *
 * Uses the same REST pattern as rrd-notify.mjs. Requires SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY in the environment (sourced from .env.local by the
 * wrapper). The service role is the ONLY identity allowed to read ciphertext.
 */
function cfg() {
  return {
    urlBase: (process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  };
}
function headers(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra };
}
function assertCfg(urlBase, key) {
  if (!urlBase || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Supabase → Settings → API).");
}
async function rest(path, init = {}) {
  const { urlBase, key } = cfg();
  assertCfg(urlBase, key);
  const res = await fetch(`${urlBase}/rest/v1/${path}`, { ...init, headers: headers(key, init.headers) });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function createDrop(row) {
  const rows = await rest("vault_drops", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  return rows[0];
}

export async function getDropById(id) {
  const rows = await rest(`vault_drops?id=eq.${encodeURIComponent(id)}&select=*`);
  return rows[0] || null;
}

export async function listDeposited() {
  return rest("vault_drops?status=eq.deposited&select=id,submission_id,profile,company,env_keys,kind,provider,deposited_at&order=deposited_at.asc");
}

export async function listDrops(limit = 50) {
  return rest(`vault_drops?select=id,profile,company,status,env_keys,kind,provider,expires_at,created_at,deposited_at,consumed_at&order=created_at.desc&limit=${limit}`);
}

/** Burn a claimed drop: mark consumed and delete the ciphertext from the DB. */
export async function markConsumed(id) {
  return rest(`vault_drops?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "consumed", consumed_at: new Date().toISOString(), ciphertext: null }),
  });
}

/** Lazily flag pending-but-past-expiry rows as expired (housekeeping). */
export async function sweepExpired() {
  return rest(`vault_drops?status=eq.pending&expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "expired" }),
  });
}
