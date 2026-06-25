# Intuit / QuickBooks and Pipedrive developer app setup notes

Use this when the operator is finishing developer accounts after HubSpot/Xero/Google/Zoho, or when Intuit/Pipedrive app screens ask for app URLs, legal URLs, callbacks, scopes, or client credentials.

## Shared current deployment URLs

Current Vercel deployment used during setup:

```text
Base / launch URL: https://revenue-recovery-web-ivory.vercel.app/
OAuth callback:   https://revenue-recovery-web-ivory.vercel.app/oauth-callback
OAuth start:      https://revenue-recovery-web-ivory.vercel.app/oauth-start
Terms/EULA:       https://revenue-recovery-web-ivory.vercel.app/terms
Privacy policy:   https://revenue-recovery-web-ivory.vercel.app/privacy
```

When the final FlowAudit/live domain is deployed, add the final-domain equivalents to every developer app before removing these Vercel URLs:

```text
https://<live-domain>/
https://<live-domain>/oauth-callback
https://<live-domain>/oauth-start
https://<live-domain>/terms
https://<live-domain>/privacy
```

Prefer keeping both Vercel and live-domain redirect URLs during transition where the provider allows multiple values.

## Intuit / QuickBooks app fields

On Intuit app URL screens:

- **Host domain**: `revenue-recovery-web-ivory.vercel.app` (no `https://`)
- **Launch URL**: `https://revenue-recovery-web-ivory.vercel.app/`
- **Disconnect URL**: `https://revenue-recovery-web-ivory.vercel.app/` until a dedicated `/disconnect` route exists
- **Connect/Reconnect URL**: `https://revenue-recovery-web-ivory.vercel.app/oauth-start`
- **End-user license agreement URL**: `https://revenue-recovery-web-ivory.vercel.app/terms`
- **Privacy policy URL**: `https://revenue-recovery-web-ivory.vercel.app/privacy`

Local credential installer created in the setup session:

```bash
/Users/AIAgenterminal/rrd-intuit-oauth-install.mjs
```

It serves a tokenized localhost form on `127.0.0.1` port `8791` and writes aliases to `/Users/AIAgenterminal/.openclaw/.env`:

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

Never ask the operator to paste Intuit secrets into chat. Start the helper, open the printed localhost URL on the Mac, then verify only that key names are present.

## Pipedrive app setup

Pipedrive can be kept **private** for early/internal/manual clients. A public/Marketplace app is only needed for scalable self-serve client authorization and to reduce client-side trust friction.

For the app type screen, choose **Private app** while testing. For callback URL:

```text
https://revenue-recovery-web-ivory.vercel.app/oauth-callback
```

Initial scope stance: **read-only discovery/mapping**. Enable only what is needed to inspect CRM context:

```text
Access to basic information
Deals
Contacts
Activities
Read users data
Deal Fields: Full access
Contact Fields: Full access
```

Avoid write/admin/mail/messaging scopes unless a later client workflow specifically needs notes/tasks/logging and the recovery executor/guardrails support those write actions.

Local credential installer created in the setup session:

```bash
/Users/AIAgenterminal/rrd-pipedrive-oauth-install.mjs
```

It serves a tokenized localhost form on `127.0.0.1` port `8792` and writes aliases to `/Users/AIAgenterminal/.openclaw/.env`:

```text
PIPEDRIVE_OAUTH_CLIENT_ID
PIPEDRIVE_OAUTH_CLIENT_SECRET
PIPEDRIVE_CLIENT_ID
PIPEDRIVE_CLIENT_SECRET
```

## Current implementation caveat

As of this setup session, the developer credentials for Intuit/QuickBooks and Pipedrive may be stored locally, but `rrd-vault connect` is wired only for:

```text
google, xero, hubspot, salesforce, zoho
```

Before sending client-facing “Connect QuickBooks” or “Connect Pipedrive” links, implement these providers in `rrd-oauth.mjs`, update integration mapping, and add tests for authorize URL, token exchange, refresh, and env key mapping.
