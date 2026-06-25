/**
 * rrd-vault-fs.mjs — filesystem side of the Hermes Secrets Vault.
 *
 * Owns RSA keypair custody (private key local-only, chmod 600) and safe writing
 * of decrypted secrets into a Hermes profile's .env (fill placeholders only,
 * never overwrite a populated key, back up first, lock to 600). Secret values
 * are never logged. The `opts.home` override exists for tests.
 *
 * Home resolution: the vault is a MACHINE-level secret store. Its keys and the
 * profile .env files always live under the real operator home, not under
 * whatever $HOME a caller happens to have. A sandboxed Hermes agent (e.g. the
 * recoverydesk profile) runs its terminal tool with $HOME pointed at its own
 * profile sandbox, so os.homedir() there is wrong for the vault. The wrapper
 * pins RRD_VAULT_HOME to the operator home so claims resolve to the same vault
 * the link was generated against, regardless of the calling agent's $HOME.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateRsaKeypair, fillEnvContent } from "./rrd-vault-core.mjs";
import { assertSafeProfile } from "./rrd-profile-safety.mjs";

function home(opts) {
  return (opts && opts.home) || process.env.RRD_VAULT_HOME || os.homedir();
}

export function keyPaths(profile, opts = {}) {
  const safe = assertSafeProfile(profile);
  const dir = path.join(home(opts), ".hermes", "vault", "keys");
  return { dir, priv: path.join(dir, safe + ".pem"), pub: path.join(dir, safe + ".pub.pem") };
}

export function profileEnvPath(profile, opts = {}) {
  return path.join(home(opts), ".hermes", "profiles", assertSafeProfile(profile), ".env");
}

/** Return this profile's keypair, generating + persisting it on first use. */
export function loadOrCreateKeypair(profile, opts = {}) {
  const p = keyPaths(profile, opts);
  if (fs.existsSync(p.priv) && fs.existsSync(p.pub)) {
    return { publicKeyPem: fs.readFileSync(p.pub, "utf8"), privateKeyPem: fs.readFileSync(p.priv, "utf8") };
  }
  const kp = generateRsaKeypair();
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.priv, kp.privateKeyPem, { mode: 0o600 });
  fs.chmodSync(p.priv, 0o600); // enforce even if umask interfered
  fs.writeFileSync(p.pub, kp.publicKeyPem, { mode: 0o644 });
  return kp;
}

/**
 * Write decrypted secrets into a Hermes profile .env. Backs up an existing file
 * to .env.bak, fills empty placeholders (never overwrites populated keys unless
 * the key is in `overwrite`), appends missing keys, then locks the file to 600.
 * Returns the fill report. `overwrite` lets OAuth tokens replace stale values on
 * re-connect / refresh; pasted API keys are never passed here.
 */
export function writeEnvSecrets(envPath, secrets, overwrite = []) {
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  if (existing) fs.copyFileSync(envPath, envPath + ".bak");
  const seed = existing || "# Revenue-recovery integration secrets for this Hermes profile.\n# Filled by the secrets vault. NEVER commit this file.\n\n";
  const report = fillEnvContent(seed, secrets, overwrite);
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, report.content.endsWith("\n") ? report.content : report.content + "\n", { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
  return report;
}

/**
 * Read a single KEY's value from a profile .env (for the refresh command, which
 * needs the stored refresh token + data-center host). Returns null if absent or
 * empty. Strips surrounding quotes. Never logs the value.
 */
export function readEnvValue(envPath, key) {
  if (!fs.existsSync(envPath)) return null;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const ln of lines) {
    const m = ln.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && m[1] === key) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
      return v.length ? v : null;
    }
  }
  return null;
}
