# FlowAudit live-domain OAuth migration notes

Use this when migrating Revenue Recovery Desk links from the old Vercel app to the live FlowAudit path, verifying OAuth callbacks, or diagnosing post-migration provider errors.

## Current live base URLs

```text
Base:      https://flowaudit.co.uk/revenue-recovery
Callback:  https://flowaudit.co.uk/revenue-recovery/oauth-callback
Vault:     https://flowaudit.co.uk/revenue-recovery/vault
OAuth:     https://flowaudit.co.uk/revenue-recovery/oauth-start
Onboarding:https://flowaudit.co.uk/revenue-recovery/onboarding
Offboard:  https://flowaudit.co.uk/revenue-recovery/offboard
Terms:     https://flowaudit.co.uk/revenue-recovery/terms
Privacy:   https://flowaudit.co.uk/revenue-recovery/privacy
```

Operator env keys should point at the live base:

```text
RRD_WEB_BASE=https://flowaudit.co.uk/revenue-recovery
RRD_VAULT_BASE=https://flowaudit.co.uk/revenue-recovery
RRD_OFFBOARD_BASE=https://flowaudit.co.uk/revenue-recovery/offboard
PUBLIC_BASE_URL=https://flowaudit.co.uk/revenue-recovery
NEXT_PUBLIC_BASE_URL=https://flowaudit.co.uk/revenue-recovery
```

After changing these, restart the relevant gateway/cron process before relying on automated link generation.

## Developer portals to update

Every OAuth/developer app should use the live FlowAudit callback exactly:

```text
https://flowaudit.co.uk/revenue-recovery/oauth-callback
```

Update portals for:

- Google Cloud OAuth client + OAuth consent screen
- HubSpot developer app
- Xero developer app
- Zoho API Console server-based app
- Intuit / QuickBooks app
- Pipedrive developer/private app
- Salesforce External Client App / Connected App

Use these legal/metadata URLs where requested:

```text
Homepage / Launch: https://flowaudit.co.uk/revenue-recovery
Connect URL:       https://flowaudit.co.uk/revenue-recovery/oauth-start
Disconnect URL:    https://flowaudit.co.uk/revenue-recovery/offboard
Terms / EULA:      https://flowaudit.co.uk/revenue-recovery/terms
Privacy:           https://flowaudit.co.uk/revenue-recovery/privacy
```

For Google specifically, the Authorized JavaScript origin should be the origin only:

```text
https://flowaudit.co.uk
```

## Important callback-path pitfall

When an app is hosted under a path prefix (`/revenue-recovery`), the callback page must preserve `location.pathname` when depositing the OAuth payload. Do **not** reconstruct the redirect URI as `location.origin + "/oauth-callback"`, because that drops `/revenue-recovery` and causes provider token exchanges to fail with errors such as:

```text
redirect_uri must match configuration
```

Correct callback payload value:

```js
const callbackUri = location.origin + location.pathname;
```

Then pass/store `redirect_uri: callbackUri` in the encrypted vault payload so the Mac exchanges the code using the exact same redirect URI used during authorization.

## Smoke-test pattern after domain migration

1. Generate a fresh provider connect link with `rrd-vault connect <submission-id> <provider>`.
2. Confirm the authorization URL includes:

   ```text
   redirect_uri=https://flowaudit.co.uk/revenue-recovery/oauth-callback
   ```

3. Authorize with a test account.
4. Confirm FlowAudit callback deposits the encrypted drop.
5. Run:

   ```text
   approve <drop-id>
   ```

6. Confirm token keys were written and the drop burned.

Known-good smoke tests completed during migration:

- Salesforce: live FlowAudit callback deposited and approved into `rr-test`.
- Google: live FlowAudit callback deposited and approved into `rr-test`.

## Google warning nuance

Even if the technical OAuth flow works, Google can still show `Google hasn’t verified this app` if consent screen publishing/verification or displayed developer identity is not complete for the specific OAuth client/scopes. Treat this as a provider verification/trust issue, not a FlowAudit callback failure, if the user can proceed through Advanced and the callback/drop approval succeeds.

## QuickBooks and Pipedrive launch behavior

For launch, QuickBooks Online and Pipedrive are OAuth/connect-link integrations, not vague/manual-only setup:

- QuickBooks/Intuit stores `QUICKBOOKS_ACCESS_TOKEN`, `QUICKBOOKS_REFRESH_TOKEN`, `QUICKBOOKS_TOKEN_EXPIRES_AT`, `QUICKBOOKS_REALM_ID`.
- Pipedrive stores `PIPEDRIVE_ACCESS_TOKEN`, `PIPEDRIVE_REFRESH_TOKEN`, `PIPEDRIVE_TOKEN_EXPIRES_AT`, `PIPEDRIVE_API_DOMAIN`.

Intuit's OAuth scope is broad (`com.intuit.quickbooks.accounting`), so enforce read-only behavior by RRD policy/guardrails unless write actions are explicitly approved. Pipedrive app permissions are controlled in the developer app rather than via a `scope` URL parameter.
