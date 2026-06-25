# Vault link and email ops notes

Use this for secure API-key collection flows after provisioning or when a user asks for a fresh client vault link.

## Safe `.env` clearing before re-claim
- When a claim reports `skipped (already set, not overwritten)`, the deposited secrets were not installed.
- If the user asks to clear blocking values, blank only the named keys, e.g. `STRIPE_API_KEY=` and `HUBSPOT_ACCESS_TOKEN=`.
- Never print old values or the new submitted values.
- Verify by key name only: report `KEY: blank`, `missing`, or `still_set` — not contents.
- If an existing deposited drop is still available, prefer clearing blockers and rerunning the same `claim <drop-id>` over asking the client to resubmit.

## Fresh link generation checks
- The vault link must match the exact tech stack the client gave during onboarding. Do not send generic credential forms. Derive fields from: payment platforms, accounting system, CRM, CRM API-access answer, email provider, SMS provider, and letter/mail channel.
- If onboarding says accounting is `Spreadsheets`, request spreadsheet-access fields in the vault rather than burying this in email: `SPREADSHEET_SOURCE_URL`, `SPREADSHEET_ACCESS_INSTRUCTIONS`, and `SPREADSHEET_REFRESH_CADENCE`. Reliable access should be a live read-only Google Sheet/Excel/SharePoint link, secure export location, or clear CSV upload cadence with column mapping.
- Before `rrd-vault new <submission-id>`, use the harness to resolve the intended client record when there is any alias/confusion.
- After `rrd-vault new`, read the output carefully and confirm it names the intended company/profile and requests only the expected missing fields for that client's stack. Do not send a link if the output profile does not match the profile whose `.env` you just cleared.
- If a previously generated pending link missed stack-derived fields, expire/replace it before sending the corrected link so the client does not complete the wrong form.
- Some onboarding records may have a company display name that differs from the domain/contact name (for example a domain-branded client whose submitted company field says `Test`). In the reply, name both the human-recognizable client and the generated profile if they differ.

## Vault page UX rules
- Keep the vault form stack-specific and low-friction: the page should show only fields derived from the client's onboarding stack, not a generic catch-all checklist.
- Do not put long Grant/Why explanations permanently under every field. Put them behind an inline `ⓘ`/info button next to the field heading, and tell clients at the top of the page to click `ⓘ` for why each item is requested.
- Info behavior: clicking `ⓘ` opens the help panel; clicking outside that field closes it; opening another `ⓘ` closes the previous one. Avoid native `<details>` toggles if they require users to click the same control twice to close.
- Use larger textareas for instruction-style fields (spreadsheet access instructions, CRM docs/endpoint notes, refresh cadence) with example placeholder text showing what to write. Keep actual secrets/API tokens as password fields.
- Avoid generic placeholders like `paste value` for every field. Each field should have a concrete example: e.g. spreadsheet link + shared-with identity + tab name, CRM API base URL, Stripe `rk_live_...` restricted key, PostGrid `live_sk_...`/`test_sk_...`.
- The visible page copy should be concise. Move detailed permission/scoping rationale into the info panel so the form does not look word-heavy.

## Email delivery precision
- Do not treat local macOS `mail` / `sendmail` exit code 0 as proof of external delivery. It only means accepted locally for sending.
- For reliable client email, use an authenticated provider/tool (Gmail/Google Workspace, Himalaya SMTP, or a configured transactional provider). If none is configured, give the user the link to forward manually and say the attempted local mail path was not verified delivered.
- When sending a vault link email, include: one-time link, expiration, explicit instruction not to email secrets, and that the link burns after one deposit.
- Be specific about credential type so clients do not submit the wrong key. For Stripe ask for a **Restricted Secret Key** (`rk_...`) or secret key with the listed scopes — never the publishable `pk_...` key. For PostGrid specify live API key vs test key. For Twilio distinguish Account/Subaccount SID from Auth Token or scoped API Key/Secret. For email providers specify restricted send-only API/server/domain keys where possible.
- Vault page UX should not be word-heavy. Keep field instructions concise, move concrete examples into placeholders, and use multiline textareas for instruction/note fields (spreadsheet access, refresh cadence, custom CRM docs) instead of generic `paste value` placeholders. Use password fields only for actual secrets.
- If onboarding says the CRM is custom/own/internal/proprietary and `crmData.apiAccess` is `Yes`, the vault link must request custom CRM API setup fields too: `CUSTOM_CRM_API_BASE_URL`, `CUSTOM_CRM_API_KEY`, and `CUSTOM_CRM_API_DOCS_URL`. Use read-only/restricted language; do not ask for a user password. If there are no docs, route to a mapping call or CSV/export workflow.

## Vault page UX / field design rules
- Keep the vault form compact and stack-specific. Do not expose long Grant/Why explanations permanently under every field; this makes the page feel word-heavy.
- Put field rationale behind a small inline `ⓘ` / info button beside the field heading. Tell clients at the top of the page to click `ⓘ` to see why each field is needed and what access to grant.
- The info panel must be an overlay/popover or otherwise must not participate in the heading layout. Pitfall: placing the info details inside a flex header can crush long labels into a skinny vertical column when opened.
- Use field-specific placeholders with concrete examples instead of generic `paste value`. Instruction-style fields should be larger multiline textareas; actual secrets/tokens remain password fields.
- For spreadsheet access fields, use example placeholders that show the desired answer shape: live Google Sheet/Excel/SharePoint link, shared read-only identity, tab names, key columns, do-not-contact/dispute flags, and refresh cadence.
- For custom CRM fields, ask for API base URL, restricted/read-only API key/token, and docs/endpoint notes; never imply they should paste a user password or generic login page.

## Vault drop install mode
- The vault watcher is now allowed to auto-install deposited drops when `RRD_VAULT_AUTO_APPROVE=1` in `/Users/AIAgenterminal/rrd-vault-watch`.
- Auto-install must be fail-closed: reload the onboarding record, rebuild the expected Hermes pack, require exact profile/company match, require requested/submitted keys to be onboarding-stack-derived, block unexpected ciphertext keys, block overwriting existing API-key values, process OAuth only on this Mac, and burn only after `rrd-vault approve` reports a complete install.
- If any guard fails, leave the drop deposited/not burned and notify for manual review. Never print secret values.

## Copyable commands
Manual approval should be a fallback, not the normal path. If auto-install blocks and the user explicitly approves after review, put the user's next action in a standalone inline-code field:

`approve <drop-id>`

`provision <submission-id>`
