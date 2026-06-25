# OAuth link smoke verification

Use this when checking whether RRD `rrd-vault connect` links are ready before sending them to clients.

## What to verify

1. Local developer-app credentials are present in `/Users/AIAgenterminal/.openclaw/.env` without printing values.
2. The RRD web start/callback pages return 200.
3. Each provider authorize URL can be built with the intended callback URL.
4. Provider authorize endpoints return a login/consent page or redirect, not an app/callback error.

## Safe interpretation

- `200` auth page or `30x` redirect to the provider login/consent flow = smoke-pass.
- Provider page/redirect containing `redirect_uri_mismatch`, `invalid redirect`, or `redirect uri` = callback is not registered exactly.
- Provider page/redirect containing `invalid_client`, `unknown client`, or `unauthorized_client` = app credentials/app setup problem.
- Pipedrive `401` body `unauthorized access` / `Please check developers.pipedrive.com` = app state/setup or installed Pipedrive client credentials problem; re-check Private app, callback, scopes, Install & test/live status, and reinstall client ID/secret.
- Do not follow through to account authorization in a smoke test; stop at provider login/consent/error classification.

## Current callback nuance from live checks

Use the callback actually registered for each provider app. As of the latest check:

- Pipedrive private apps allow only one callback URL per app.
- Xero worked with the ivory callback and failed on branded, so default Xero connect links should use `https://revenue-recovery-web-ivory.vercel.app/oauth-callback` unless the Xero app is explicitly updated.
- Pipedrive should use the callback saved in that one-callback app; current RRD setup uses `https://flowaudit.co.uk/revenue-recovery/oauth-callback`.
- Zoho Books can reuse Zoho Accounts OAuth credentials if the app can request Books scopes; install under `ZOHOBOOKS_*` env names separately from Zoho CRM.

## Verification command pattern

Load `.openclaw/.env` into a Node process, import `OAUTH_PROVIDERS`, `appCreds`, and `buildAuthorizeUrl` from `/Users/AIAgenterminal/rrd-oauth.mjs`, build each authorize URL with a dummy state, then `fetch(..., { redirect: 'manual' })`. Redact `client_id` and `state` from any logged URLs. Report only provider/result/status; never print client IDs or secrets.

After code changes related to OAuth, run:

```bash
node --check /Users/AIAgenterminal/rrd-oauth.mjs
node --check /Users/AIAgenterminal/rrd-vault.mjs
node --test /Users/AIAgenterminal/test/rrd-oauth.test.mjs
node --test /Users/AIAgenterminal/test/*.test.mjs
```
