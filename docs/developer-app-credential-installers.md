# Developer app credential installers

Use this when the operator has created provider OAuth/developer apps and needs to store client IDs/secrets locally without exposing values in Telegram.

## Rule

Never ask for OAuth app secrets in chat. Use the local-only installer pattern:

1. Start the provider-specific installer on `127.0.0.1`.
2. Open the printed tokenized localhost URL on the Mac.
3. Operator pastes the provider client ID/secret or API key into the local page.
4. Installer writes values to `/Users/AIAgenterminal/.openclaw/.env`, creates a timestamped backup, and exits.
5. Verify only key names are present; never print values.

## Existing installers

- Google: `/Users/AIAgenterminal/rrd-google-oauth-install.mjs`
- HubSpot: `/Users/AIAgenterminal/rrd-hubspot-oauth-install.mjs`
- Zoho / Zoho Books app credentials: `/Users/AIAgenterminal/rrd-zoho-oauth-install.mjs` (default port `8790`)
- Intuit / QuickBooks: `/Users/AIAgenterminal/rrd-intuit-oauth-install.mjs` (default port `8791`)
- Pipedrive: `/Users/AIAgenterminal/rrd-pipedrive-oauth-install.mjs` (default port `8792`)
- Salesforce: `/Users/AIAgenterminal/rrd-salesforce-oauth-install.mjs` (default port `8793`)
- FreeAgent: `/Users/AIAgenterminal/rrd-freeagent-oauth-install.mjs` (default port `8802`)
- Composio API key: `/Users/AIAgenterminal/rrd-composio-install.mjs` (default port `8803`)

## Local browser handoff pattern

When the operator asks for “a page to insert the id and secret,” start the relevant installer as a tracked background process, recover the tokenized localhost URL from the process output or the installer’s URL file, and open it on the Mac with `open '<url>'`. Then tell the operator to paste credentials in the local page, not in Telegram. After they submit, verify key presence only and never echo `.env` contents or the tokenized URL unless needed for local troubleshooting.

If the installer is already running and terminal output is blank, do not restart blindly and do not ask the operator to paste secrets in chat. Poll/read the helper’s URL artifact or inspect the installer script for its local URL output path, then open the existing `127.0.0.1` URL.

## Provider-specific notes

### Zoho / Zoho Books

Writes both canonical OAuth names and Zoho legacy aliases:

```text
ZOHO_OAUTH_CLIENT_ID
ZOHO_OAUTH_CLIENT_SECRET
ZOHO_CLIENT_ID
ZOHO_CLIENT_SECRET
```

Use the local page for both Client ID and Client Secret. After submit, report only whether the four key names are present.

### Pipedrive

Writes both canonical and legacy aliases:

```text
PIPEDRIVE_OAUTH_CLIENT_ID
PIPEDRIVE_OAUTH_CLIENT_SECRET
PIPEDRIVE_CLIENT_ID
PIPEDRIVE_CLIENT_SECRET
```

After installing, run an OAuth authorize-link smoke check rather than relying on key presence. A Pipedrive `401 unauthorized access` from `https://oauth.pipedrive.com/oauth/authorize` usually means the app/client is not usable yet: wrong value copied (App ID instead of Client ID), wrong sandbox/company, draft app not installed/tested or not live, or app type/callback setup problem. If Pipedrive native OAuth keeps failing, prefer the Composio-backed path in `references/composio-connectors.md`.

### FreeAgent

Writes:

```text
FREEAGENT_OAUTH_CLIENT_ID
FREEAGENT_OAUTH_CLIENT_SECRET
```

Use after the operator creates the FreeAgent developer app. Verify by presence only, then smoke-test the authorize URL.

### Composio

Writes:

```text
COMPOSIO_API_KEY
```

Use Composio as a broker/fallback for Pipedrive or long-tail providers only after confirming the operator accepts Composio holding/refreshing third-party OAuth tokens. For Composio-backed Pipedrive and the broader expansion list, see `references/composio-connectors.md`.

Non-secret Composio auth/config IDs can be stored in `.openclaw/.env` after creation, e.g.:

```text
COMPOSIO_PIPEDRIVE_AUTH_CONFIG_ID
COMPOSIO_PIPEDRIVE_TEST_CONNECTED_ACCOUNT_ID
COMPOSIO_PIPEDRIVE_TOOLKIT_VERSION
COMPOSIO_PIPEDRIVE_USER_ID
```

## Verification pattern

After the operator submits, run a safe presence-only check (no values):

```bash
node - <<'NODE'
const fs=require('fs');
const file='/Users/AIAgenterminal/.openclaw/.env';
const env=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
for (const k of ['PROVIDER_OAUTH_CLIENT_ID','PROVIDER_OAUTH_CLIENT_SECRET']) {
  const m=env.match(new RegExp('^'+k+'=(.*)$','m'));
  const v=m?m[1].trim():'';
  console.log(`${k}: ${v ? 'present' : 'missing'}`);
}
NODE
```

Adjust the key list per provider. Report only `present`/`missing`.
