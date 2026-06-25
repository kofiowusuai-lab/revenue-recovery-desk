# Vault claim troubleshooting

Use this when a user replies with `approve <drop-id>` (or legacy `claim <drop-id>`) or asks who has deposited API keys.

## Safe workflow
1. Run `/Users/AIAgenterminal/rrd-vault approve <drop-id>` for the exact ID.
2. If it fails, run `/Users/AIAgenterminal/rrd-vault status` to find the current state and any newer deposited drops for the same client/profile.
3. Never print secret values. Report only key names filled, skipped, or still needed.
4. Format any next command the user should copy as a standalone inline code field, e.g. `claim <drop-id>` or `provision <submission-id>`.

## Common outcomes
- `consumed` with no ciphertext: the drop has already been burned/claimed; there is nothing left to decrypt for that drop.
- `deposited`: it is ready to claim, but must be claimed by the profile/machine holding the matching private key.
- missing private key for profile: do not treat this as missing client keys, and do NOT assume the drop came from another machine. The usual cause on THIS machine is a `$HOME` mismatch: the vault keys live under the operator home `/Users/AIAgenterminal/.hermes/vault/keys/<profile>.pem`, but a sandboxed agent runs its terminal with `$HOME` inside its own profile dir, so a raw claim looks in the wrong vault. The `rrd-vault` wrapper now pins `RRD_VAULT_HOME=/Users/AIAgenterminal`, so always claim via the full wrapper path `/Users/AIAgenterminal/rrd-vault claim <drop-id>` (never call `node rrd-vault.mjs` directly without that env). Before concluding the key is truly absent, verify: `ls -l /Users/AIAgenterminal/.hermes/vault/keys/<profile>.pem`. If that file exists, the drop is claimable here — re-run via the wrapper. Only if the `.pem` genuinely does not exist anywhere on this machine is it a real missing-key case (claim from the machine that generated the link, restore the key securely, or generate a fresh link and have the client resubmit).
- existing `.env` values / `skipped (already set, not overwritten)`: the deposited secrets were not installed for those key names. If output says `Drop NOT burned`, the drop is intentionally still `deposited` so real keys are not lost. Report only the skipped key names, explain that placeholders or old values must be cleared first, then rerun the same `claim <drop-id>`. Do not claim success until a rerun reports the keys were actually written or intentionally skipped because the existing values are confirmed real. If the user asks to clear existing values, blank only the named keys (for example `KEY=`), do not print prior values, and verify the keys are blank by key name only.
- fresh/resend link after clearing values: prefer rerunning the existing deposited `claim <drop-id>` when possible. If generating a new link, confirm the `rrd-vault new <submission-id>` output names the same intended client/profile whose `.env` was cleared before emailing it. This avoids sending a vault link for a different submission/profile.
- sending vault-link email: include the one-time link and expiration, instruct the client not to email secrets, and report mail results precisely. If the mail tool only returns local acceptance, say "accepted locally for sending" rather than "delivered".
- `pending`: client has not deposited secrets yet.
- `expired`: generate a new vault link.

## Reply shape
Lead with the status and actionability:
- "I tried to claim it; that drop is already consumed, so there is nothing left to decrypt."
- "The private key for this profile is present on this machine; the earlier failure was a home-path mismatch. I re-ran the claim through the wrapper and it went through." (only after verifying the `.pem` exists and the claim actually succeeded)
- "The private key for this profile is not on this machine at all, so I can't decrypt this drop here. Claim it from the machine that generated the link, or generate a fresh link for resubmission." (only when the `.pem` genuinely does not exist)

Then provide the relevant copyable command as its own field:

`claim <drop-id>`
