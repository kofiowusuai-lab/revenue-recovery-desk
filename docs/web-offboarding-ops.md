# Web offboarding + credential destruction

Use this when changing cancellation/offboarding automation for Revenue Recovery Desk.

## Current client flow

- Public form: `https://revenue-recovery-web-ivory.vercel.app/offboard`
- Payment success page: `https://revenue-recovery-web-ivory.vercel.app/offboarded`
- Cancellation email watcher sends the form link rather than an email questionnaire.
- On form submission, the backend processor sends a confirmation email that the form was submitted and that Flow Audit / Revenue Recovery Desk will follow up with any final payment or completion confirmation.
- If a prorated final balance is due, the system creates/sends a Stripe Payment Link.
- Once paid, the final-payment watcher runs `rrd-harness offboard`, archives the account, tears down Orgo, destroys credentials, and emails confirmation.
- If no final balance is due, the system offboards immediately and emails confirmation.

## Silent background preference

The support/cancellation watcher and final-payment/offboard watcher should keep running, but their cron delivery should be `local` unless the user explicitly asks for immediate alerts. The operator expects cancellation requests and completed cancellations to show up in the morning brief instead of chat spam.

Relevant cron jobs:
- `573a77f9f704` — Flow Audit Support/Cancellation Inbox Watcher
- `f19adc431d01` — RRD Cancellation Final Payment Offboard Watcher

## Credential destruction on offboard

Normal offboarding must destroy live credentials, not just archive the account. `rrd-harness offboard` now performs this automatically for the derived `rr-<company>` profile:

- Best-effort overwrite + delete profile `.env`
- Best-effort overwrite + delete `.env.bak`
- Delete the profile vault private key: `~/.hermes/vault/keys/<profile>.pem`
- In Supabase `vault_drops`, set ciphertext to null and mark profile drops consumed
- Destroy the client's Orgo project/computer through existing offboard teardown

Never print secret values. Report only file/key categories and whether cleanup ran.

Emergency standalone command, if credentials must be destroyed without moving the active book row:

`/Users/AIAgenterminal/rrd-harness purgeCredentials '"rr-<company>"'`

## Verification checklist after changes

- `node --check /Users/AIAgenterminal/rrd-agent.mjs`
- `node --check /Users/AIAgenterminal/rrd-cancellation-offboard.mjs`
- Run a smoke `purgeCredentials` on a nonexistent profile to confirm no secret values print.
- Run `rrd-cancellation-offboard.mjs process-web` and `poll` to confirm processors still return OK.
- Before deploying web changes, confirm deployed HTML embeds only anon JWTs, never service-role keys.
