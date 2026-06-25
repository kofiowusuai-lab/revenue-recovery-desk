# Microsoft 365 / Outlook OAuth setup for Revenue Recovery Desk

Use this when adding or operating Microsoft Entra ID / Microsoft 365 / Outlook as an OAuth connector for client onboarding.

## Provider identity

Treat the connector as Microsoft Graph OAuth for business clients, not a generic Azure infrastructure integration.

Recommended provider id:

```text
microsoft
```

Useful display aliases:

```text
Microsoft
Microsoft 365
Office 365
Outlook
Azure
Azure AD
Entra
Microsoft Entra
```

## OAuth app registration

Developer portal:

```text
https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade
```

Register a reusable multi-client web app with:

```text
Name: Revenue Recovery Desk
Platform: Web
Redirect URI: https://flowaudit.co.uk/revenue-recovery/oauth-callback
Supported account types: Accounts in any organizational directory
```

Use the live FlowAudit callback only if it is registered exactly. The OAuth callback is under `/revenue-recovery`; dropping that prefix will break token exchange / redirect validation.

## Environment keys

Operator developer-app credentials on the Mac:

```text
MICROSOFT_OAUTH_CLIENT_ID
MICROSOFT_OAUTH_CLIENT_SECRET
```

Per-client profile keys after approval:

```text
MICROSOFT_ACCESS_TOKEN
MICROSOFT_REFRESH_TOKEN
MICROSOFT_TOKEN_EXPIRES_AT
```

## OAuth endpoints

Use the v2.0 common tenant endpoints for multi-tenant client authorization:

```text
Authorize: https://login.microsoftonline.com/common/oauth2/v2.0/authorize
Token:     https://login.microsoftonline.com/common/oauth2/v2.0/token
```

## Launch scopes

Start with least-privilege delegated Microsoft Graph scopes:

```text
offline_access
User.Read
Mail.Read
Files.Read
```

Purpose:
- `offline_access` — allows refresh-token based operation after the initial client authorization.
- `User.Read` — identifies the signed-in user and tenant context.
- `Mail.Read` — reads Outlook email context relevant to invoices, payment promises, disputes, and client communication.
- `Files.Read` — reads signed-in user OneDrive files when needed for invoice/document metadata or attachments.

Avoid broader tenant-wide scopes such as `Mail.Read.Shared`, `Files.Read.All`, or `Sites.Read.All` unless a specific client workflow requires them and the recovery guardrails are updated accordingly.

## Code wiring checklist

Add the provider to `rrd-oauth.mjs`:
- `OAUTH_PROVIDERS.microsoft`
- aliases in `NAME_TO_ID`
- `scopeSep: " "`
- `extraAuthParams: { prompt: "consent" }` if re-consent/refresh-token behavior needs to be forced during tests
- env keys listed above

Update tests in `test/rrd-oauth.test.mjs`:
- provider alias resolution
- env key list
- authorize URL host/path + scopes
- token endpoint exchange
- token-to-env mapping

Run at minimum:

```bash
cd /Users/AIAgenterminal
node --test test/rrd-oauth.test.mjs
```

Also run onboarding/integration tests if the dropdown or manifest classification changes:

```bash
node --test test/rrd-hermes-integrations.test.mjs test/rrd-onboarding-form.test.mjs
```

## End-to-end launch rehearsal pattern

When the operator wants to finish setup and verify HubSpot's publish/install threshold, run two full onboarding-form E2E rehearsals rather than hand-wiring profiles. For each submission:
1. Submit a real onboarding form.
2. Let the onboarding watcher provision/send access emails, or run the equivalent watcher manually if notifications are local-only.
3. Generate provider connect links from the new submission ids.
4. Authorize HubSpot / Microsoft / target providers from the client side.
5. Approve each deposited OAuth drop with `approve <drop-id>`.
6. Verify only key NAMES written to each profile; never print token values.
7. Run a recovery dry-run / smoke check for the profile.

For HubSpot publication/verification, verify the developer portal's install count rather than assuming. Two new form-based installs plus an existing test install may satisfy a 3-install minimum, but report it as confirmed only after the provider dashboard or CLI shows it.

## Notification preference pitfall

The operator may ask to stop watcher notifications in the current Telegram chat while keeping automation running. Do not pause/remove the watcher unless asked. Instead update the cron delivery target to local-only, e.g. `deliver: local`, so outputs are saved locally but no longer posted to the chat.
