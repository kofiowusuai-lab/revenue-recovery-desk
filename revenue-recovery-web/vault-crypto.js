/**
 * vault-crypto.js — client-side sealed-envelope encryption for the Secrets Vault.
 *
 * Loaded by vault.html as <script type="module"> AND imported by the Node interop
 * test, so the browser and the server agree on one wire format. Uses only native
 * WebCrypto (no dependencies). Pairs with rrd-vault-core.mjs `openEnvelope`.
 *
 * Envelope: AES-256-GCM encrypts the secret; RSA-OAEP(SHA-256) wraps the AES key.
 *   { v:1, k:<base64 wrapped key>, iv:<base64 12-byte iv>, ct:<base64 ct||tag> }
 * WebCrypto appends the 16-byte GCM auth tag to the ciphertext automatically.
 *
 * The plaintext secret NEVER leaves this function unencrypted. Only the holder of
 * the RSA private key (Casper's Mac) can recover it.
 */

const subtle = globalThis.crypto.subtle;

function b64(bytes) {
  let s = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

function pemToDer(pem) {
  const body = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const bin = atob(body);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der.buffer;
}

export async function importRsaPublicKey(publicKeyPem) {
  return subtle.importKey(
    "spki",
    pemToDer(publicKeyPem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
}

export async function seal(publicKeyPem, plaintext) {
  const pub = await importRsaPublicKey(publicKeyPem);
  const aesKey = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, aesKey, new TextEncoder().encode(plaintext));
  const rawAes = await subtle.exportKey("raw", aesKey);
  const wrapped = await subtle.encrypt({ name: "RSA-OAEP" }, pub, rawAes);
  return { v: 1, k: b64(wrapped), iv: b64(iv), ct: b64(ct) };
}

if (typeof window !== "undefined") window.VaultCrypto = { seal, importRsaPublicKey };
