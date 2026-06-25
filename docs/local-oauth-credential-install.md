# Local OAuth credential installation pattern

Use this when the operator has created a reusable OAuth app (Google, HubSpot, etc.) and needs to install the app client ID/secret on the Mac without posting secrets into Telegram.

## Rule

Never ask the operator to paste OAuth client secrets into chat. Use a local-only handoff:

1. Start a localhost form bound to `127.0.0.1` on the operator Mac.
2. Include an unguessable one-time token in the URL.
3. Let the operator paste either the downloaded OAuth JSON or the client ID/secret directly in Chrome.
4. Write the values to the local operator env file (`/Users/AIAgenterminal/.openclaw/.env`) with mode `600` and make a timestamped backup first.
5. Verify by checking that expected variable names exist, without printing values.

## Known helper from the Google setup session

A local helper was created at:

```bash
/Users/AIAgenterminal/rrd-google-oauth-install.mjs
```

It serves a one-time local form and writes these aliases:

```text
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
```

The duplicate `GOOGLE_CLIENT_*` aliases are intentional compatibility aliases for generic Google libraries/templates while `GOOGLE_OAUTH_*` is the RRD-style naming.

## Known helper from the HubSpot setup session

A local helper was created at:

```bash
/Users/AIAgenterminal/rrd-hubspot-oauth-install.mjs
```

Use it when the operator says they have found the HubSpot app credentials and need a local page to paste them. It serves a tokenized form on `127.0.0.1` (default port `8788`) and writes these aliases to `/Users/AIAgenterminal/.openclaw/.env`:

```text
HUBSPOT_OAUTH_CLIENT_ID
HUBSPOT_OAUTH_CLIENT_SECRET
HUBSPOT_CLIENT_ID
HUBSPOT_CLIENT_SECRET
```

Start it as a background process and open the printed URL locally:

```bash
chmod 700 /Users/AIAgenterminal/rrd-hubspot-oauth-install.mjs
/Users/AIAgenterminal/rrd-hubspot-oauth-install.mjs
```

After the operator submits the page, verify only that the expected variable names exist; never print the values. Then generate/test the HubSpot connect link with the RRD OAuth/vault helper.

## Known helper from the Zoho setup session

A local helper was created at:

```bash
/Users/AIAgenterminal/rrd-zoho-oauth-install.mjs
```

Use it after creating the Zoho API Console **Server-based Application**. It serves a tokenized form on `127.0.0.1` (default port `8790`) and writes these aliases to `/Users/AIAgenterminal/.openclaw/.env`:

```text
ZOHO_OAUTH_CLIENT_ID
ZOHO_OAUTH_CLIENT_SECRET
ZOHO_CLIENT_ID
ZOHO_CLIENT_SECRET
```

Start it as a background process and open the printed URL locally:

```bash
chmod 700 /Users/AIAgenterminal/rrd-zoho-oauth-install.mjs
/Users/AIAgenterminal/rrd-zoho-oauth-install.mjs
```

After the operator submits the page, verify only that the expected variable names exist; never print the values. Then generate/test a Zoho connect link with `rrd-vault connect <submission-id> zoho`.

## Known helper from the Intuit / QuickBooks setup session

A local helper was created at:

```bash
/Users/AIAgenterminal/rrd-intuit-oauth-install.mjs
```

Use it after creating the Intuit Developer app and reaching the app credentials page. It serves a tokenized form on `127.0.0.1` (default port `8791`) and writes these aliases to `/Users/AIAgenterminal/.openclaw/.env`:

```text
INTUIT_OAUTH_CLIENT_ID
INTUIT_OAUTH_CLIENT_SECRET
QUICKBOOKS_OAUTH_CLIENT_ID
QUICKBOOKS_OAUTH_CLIENT_SECRET
INTUIT_CLIENT_ID
INTUIT_CLIENT_SECRET
QUICKBOOKS_CLIENT_ID
QUICKBOOKS_CLIENT_SECRET
```

Start it as a background process and open the printed URL locally:

```bash
chmod 700 /Users/AIAgenterminal/rrd-intuit-oauth-install.mjs
/Users/AIAgenterminal/rrd-intuit-oauth-install.mjs
```

After the operator submits the page, verify only that the expected variable names exist; never print the values. Important: storing Intuit app credentials is not the same as a completed QuickBooks connector — check whether `rrd-oauth.mjs` / `rrd-vault connect` supports Intuit before generating client connect instructions.

## Known helper from the Intuit / QuickBooks setup session

A local helper was created at:

```bash
/Users/AIAgenterminal/rrd-intuit-oauth-install.mjs
```

Use it after creating the Intuit Developer / QuickBooks app. It serves a tokenized form on `127.0.0.1` (default port `8791`) and writes these aliases to `/Users/AIAgenterminal/.openclaw/.env`:

```text
INTUIT_OAUTH_CLIENT_ID
INTUIT_OAUTH_CLIENT_SECRET
QUICKBOOKS_OAUTH_CLIENT_ID
QUICKBOOKS_OAUTH_CLIENT_SECRET
INTUIT_CLIENT_ID
INTUIT_CLIENT_SECRET
QUICKBOOKS_CLIENT_ID
QUICKBOOKS_CLIENT_SECRET
```

Start it as a background process and open the printed URL locally:

```bash
chmod 700 /Users/AIAgenterminal/rrd-intuit-oauth-install.mjs
/Users/AIAgenterminal/rrd-intuit-oauth-install.mjs
```

After the operator submits the page, verify only that the expected variable names exist; never print the values. QuickBooks/Intuit OAuth connect support may still need wiring in `rrd-oauth.mjs` / `rrd-vault connect` before promising live client connect links.

## Known helper from the Pipedrive setup session

A local helper was created at:

```bash
/Users/AIAgenterminal/rrd-pipedrive-oauth-install.mjs
```

Use it after creating the Pipedrive developer app. It serves a tokenized form on `127.0.0.1` (default port `8792`) and writes these aliases to `/Users/AIAgenterminal/.openclaw/.env`:

```text
PIPEDRIVE_OAUTH_CLIENT_ID
PIPEDRIVE_OAUTH_CLIENT_SECRET
PIPEDRIVE_CLIENT_ID
PIPEDRIVE_CLIENT_SECRET
```

Start it as a background process and open the printed URL locally:

```bash
chmod 700 /Users/AIAgenterminal/rrd-pipedrive-oauth-install.mjs
/Users/AIAgenterminal/rrd-pipedrive-oauth-install.mjs
```

After the operator submits the page, verify only that the expected variable names exist; never print the values. Current RRD integration mapping still treats Pipedrive as `PIPEDRIVE_API_TOKEN` via secure vault, so Pipedrive OAuth must be wired separately before using client-facing connect links.

## Known helper from the Intuit / QuickBooks setup session

A local helper was created at:

```bash
/Users/AIAgenterminal/rrd-intuit-oauth-install.mjs
```

Use it after creating the Intuit Developer / QuickBooks app. It serves a tokenized form on `127.0.0.1` (default port `8791`) and writes these aliases to `/Users/AIAgenterminal/.openclaw/.env`:

```text
INTUIT_OAUTH_CLIENT_ID
INTUIT_OAUTH_CLIENT_SECRET
QUICKBOOKS_OAUTH_CLIENT_ID
QUICKBOOKS_OAUTH_CLIENT_SECRET
INTUIT_CLIENT_ID
INTUIT_CLIENT_SECRET
QUICKBOOKS_CLIENT_ID
QUICKBOOKS_CLIENT_SECRET
```

## Known helper from the Pipedrive setup session

A local helper was created at:

```bash
/Users/AIAgenterminal/rrd-pipedrive-oauth-install.mjs
```

Use it after creating the Pipedrive app. It serves a tokenized form on `127.0.0.1` (default port `8792`) and writes these aliases to `/Users/AIAgenterminal/.openclaw/.env`:

```text
PIPEDRIVE_OAUTH_CLIENT_ID
PIPEDRIVE_OAUTH_CLIENT_SECRET
PIPEDRIVE_CLIENT_ID
PIPEDRIVE_CLIENT_SECRET
```

For provider-specific URL fields, scopes, and implementation caveats, see `references/intuit-pipedrive-oauth-setup.md`.

## Known helper from the Intuit / QuickBooks setup session

A local helper was created at:

```bash
/Users/AIAgenterminal/rrd-intuit-oauth-install.mjs
```

Use it after creating the Intuit Developer / QuickBooks app. It serves a tokenized form on `127.0.0.1` (default port `8791`) and writes compatibility aliases to `/Users/AIAgenterminal/.openclaw/.env`:

```text
INTUIT_OAUTH_CLIENT_ID
INTUIT_OAUTH_CLIENT_SECRET
QUICKBOOKS_OAUTH_CLIENT_ID
QUICKBOOKS_OAUTH_CLIENT_SECRET
INTUIT_CLIENT_ID
INTUIT_CLIENT_SECRET
QUICKBOOKS_CLIENT_ID
QUICKBOOKS_CLIENT_SECRET
```

After the operator submits the page, verify only that the expected variable names exist; never print the values. Note: storing app credentials is not the same as wiring QuickBooks into `rrd-vault connect` — confirm connector support before promising client-facing QuickBooks connect links.

## Known helper from the Pipedrive setup session

A local helper was created at:

```bash
/Users/AIAgenterminal/rrd-pipedrive-oauth-install.mjs
```

Use it after creating the Pipedrive app. It serves a tokenized form on `127.0.0.1` (default port `8792`) and writes these aliases to `/Users/AIAgenterminal/.openclaw/.env`:

```text
PIPEDRIVE_OAUTH_CLIENT_ID
PIPEDRIVE_OAUTH_CLIENT_SECRET
PIPEDRIVE_CLIENT_ID
PIPEDRIVE_CLIENT_SECRET
```

After the operator submits the page, verify only that the expected variable names exist; never print the values. Important: current RRD integration mapping has historically treated Pipedrive as `PIPEDRIVE_API_TOKEN` via vault, so do not promise client-facing Pipedrive OAuth until `rrd-oauth.mjs` / `rrd-vault connect` support is verified or added.

## Additional provider installers

For the full current list of local-only OAuth/developer app credential installers and their env aliases, see `references/developer-app-credential-installers.md`. Use that reference for Zoho, Intuit/QuickBooks, Pipedrive, and Salesforce in addition to Google/HubSpot.

## Known helper pattern from Salesforce / Intuit / Pipedrive setup

For other OAuth developer apps, use the same local-only installer pattern rather than asking for credentials in Telegram. Helpers created/used during setup:

```text
/Users/AIAgenterminal/rrd-salesforce-oauth-install.mjs
/Users/AIAgenterminal/rrd-intuit-oauth-install.mjs
/Users/AIAgenterminal/rrd-pipedrive-oauth-install.mjs
```

Expected local env aliases:

```text
SALESFORCE_OAUTH_CLIENT_ID / SALESFORCE_OAUTH_CLIENT_SECRET
SALESFORCE_CLIENT_ID / SALESFORCE_CLIENT_SECRET

INTUIT_OAUTH_CLIENT_ID / INTUIT_OAUTH_CLIENT_SECRET
QUICKBOOKS_OAUTH_CLIENT_ID / QUICKBOOKS_OAUTH_CLIENT_SECRET
INTUIT_CLIENT_ID / INTUIT_CLIENT_SECRET
QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET

PIPEDRIVE_OAUTH_CLIENT_ID / PIPEDRIVE_OAUTH_CLIENT_SECRET
PIPEDRIVE_CLIENT_ID / PIPEDRIVE_CLIENT_SECRET
```

After submission, verify only `present`/`missing` for variable names and never print values.

## Local installer helper inventory

Use local-only installers whenever replacing app credentials; never ask the operator to paste OAuth secrets into chat. Existing helpers:

```text
/Users/AIAgenterminal/rrd-google-oauth-install.mjs      → GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET plus GOOGLE_CLIENT_* aliases
/Users/AIAgenterminal/rrd-hubspot-oauth-install.mjs    → HUBSPOT_OAUTH_CLIENT_ID / HUBSPOT_OAUTH_CLIENT_SECRET plus HUBSPOT_CLIENT_* aliases
/Users/AIAgenterminal/rrd-zoho-oauth-install.mjs       → ZOHO_OAUTH_CLIENT_ID / ZOHO_OAUTH_CLIENT_SECRET plus ZOHO_CLIENT_* aliases
/Users/AIAgenterminal/rrd-intuit-oauth-install.mjs     → INTUIT/QUICKBOOKS OAuth client ID/secret aliases
/Users/AIAgenterminal/rrd-pipedrive-oauth-install.mjs  → PIPEDRIVE_OAUTH_CLIENT_ID / PIPEDRIVE_OAUTH_CLIENT_SECRET plus PIPEDRIVE_CLIENT_* aliases
/Users/AIAgenterminal/rrd-salesforce-oauth-install.mjs → SALESFORCE_OAUTH_CLIENT_ID / SALESFORCE_OAUTH_CLIENT_SECRET plus SALESFORCE_CLIENT_* aliases
/Users/AIAgenterminal/rrd-xero-oauth-install.mjs       → XERO_OAUTH_CLIENT_ID / XERO_OAUTH_CLIENT_SECRET plus XERO_CLIENT_* aliases
```

After the operator submits an installer, verify only that expected variable names are present and that a generated authorize URL uses the live callback; never print values.

## Safe operating notes

- Do not reveal the localhost token in a public channel; it is only for the local browser session.
- Do not capture or quote the submitted secret values.
- If the user pasted a token/secret into Telegram, tell them to revoke/rotate it and continue using the local installer for the replacement.
- When confirming completion, say which variable names were installed and where, not their contents.

## Chrome/browser control pitfall

When Chrome has many provider setup tabs open, do not rely only on visual tab clicks. Use AppleScript tab listing and active-tab switching to return to the correct tab before continuing GUI work:

```bash
osascript -e 'tell application "Google Chrome" to tell front window to repeat with i from 1 to count of tabs
set t to tab i
log (i as text) & " " & title of t & " | " & URL of t
end repeat' 2>&1
```

Then switch explicitly:

```bash
osascript -e 'tell application "Google Chrome" to tell front window to set active tab index to <n>'
```

This avoids accidentally acting in Xero/HubSpot/etc. while intending to finish Google Cloud Console.
