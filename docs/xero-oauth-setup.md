# Xero OAuth setup for Revenue Recovery Desk

Use this when adding or troubleshooting Xero as an accounting connector.

## Connector classification

- Xero is an OAuth/connect provider, not an API-key vault provider.
- Register the reusable Xero app once; each client authorizes their own Xero org with a one-time `rrd-vault connect ... xero` link.
- Store Xero app-level credentials locally on the operator Mac only as `XERO_OAUTH_CLIENT_ID` and `XERO_OAUTH_CLIENT_SECRET`.

## Developer app settings

Create/configure the app in Xero Developer as a Web app.

Callback / redirect URI:

```text
https://revenue-recovery-web-ivory.vercel.app/oauth-callback
```

Local credential install helper:

```text
/Users/AIAgenterminal/rrd-xero-oauth-install.mjs
```

The helper opens a localhost form and writes the Client ID/Secret to `/Users/AIAgenterminal/.openclaw/.env` without printing secrets. Do not ask the user to paste Client IDs/secrets into chat.

## Known scope pitfall

Xero rejected several seemingly plausible scope sets during live testing:

- `offline_access accounting.transactions.read accounting.contacts.read accounting.settings.read` → `invalid_scope`
- `offline_access accounting.transactions.read accounting.contacts.read` → `invalid_scope` when those scopes are not enabled/saved on the Xero app
- `openid profile email offline_access accounting.transactions accounting.contacts` → `invalid_scope`
- `app.connections accounting.invoices.read accounting.contacts.read` → invalid for the normal Web-app authorization-code flow because `app.connections` is a **non-tenanted** Xero scope for the Client Credentials grant, not for client organisation authorization.

For invoice recovery, use the minimum Web-app OAuth scopes currently wired in `rrd-oauth.mjs`:

```text
offline_access
accounting.invoices.read
accounting.contacts.read
```

Scope rules to preserve:

- `offline_access` is required so `approve <drop-id>` can exchange the authorization code for a refresh token.
- Use only tenant/organisation accounting scopes for the reusable client connect link.
- Do **not** include `app.connections` in the authorization-code connect URL; it belongs to Xero's non-tenanted/client-credentials scope family.
- If scope errors continue, open the Xero Developer app and confirm the Accounting API is enabled and the exact requested accounting scopes are selected/saved.

If Xero callback reports:

```text
Requested wrong apps scopes
```

interpret it as the OAuth request scopes not matching the scopes enabled/saved on the Xero developer app, or as a grant-type mismatch such as accidentally requesting `app.connections`. Fix the Xero app scope selection first, save it, then generate a fresh one-time connect link. Do not keep retrying an already-failed/pending link.

## Operator sequence

1. Verify or install `XERO_OAUTH_CLIENT_ID` and `XERO_OAUTH_CLIENT_SECRET` locally with the installer helper.
2. Generate a client-specific link:

```text
/Users/AIAgenterminal/rrd-vault connect <submission-id> xero
```

3. Send the generated `/oauth-start?token=...` link to the client/operator browser.
4. If `approve <drop-id>` says the drop is `pending` with no ciphertext, the client has not completed authorization yet. Run `rrd-vault status` and wait for `deposited`.
5. Once deposited, install tokens with:

```text
approve <drop-id>
```

6. Report only key names/status, never token values.

## Test/verification notes

Relevant local tests:

```text
node --test test/rrd-oauth.test.mjs test/rrd-hermes-integrations.test.mjs
```

The Xero provider should be classified as an OAuth accounting integration and should not appear in vault API-key requests.
