// Guards that provisioning auto-publishes each client's vault PUBLIC key so the
// serverless self-serve OAuth connect works for new clients without a manual step.
// Static checks (hermes-provision.mjs runs main() on import, so it can't be imported).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = () => fs.readFileSync(new URL('../hermes-provision.mjs', import.meta.url), 'utf8');

test('hermes-provision publishes the vault public key during provisioning', () => {
  const s = src();
  // Uses the Mac keypair loader (creates/keeps the private key locally).
  assert.match(s, /import \{ loadOrCreateKeypair \} from "\.\/rrd-vault-fs\.mjs"/);
  // Defines and calls the publisher.
  assert.match(s, /async function publishVaultPublicKey\(/);
  assert.match(s, /await publishVaultPublicKey\(opts\.id, pack\.profileName\)/);
  // Upserts only the PUBLIC key into the service-role-locked table.
  assert.match(s, /\/rest\/v1\/vault_public_keys/);
  assert.match(s, /resolution=merge-duplicates/);
  assert.match(s, /public_key: publicKeyPem/);
  // Skips preview (--out) runs and is non-fatal so provisioning never breaks on it.
  assert.match(s, /if \(!opts\.out\) \{[\s\S]*publishVaultPublicKey/);
  assert.match(s, /vault public key publish skipped/);
});
