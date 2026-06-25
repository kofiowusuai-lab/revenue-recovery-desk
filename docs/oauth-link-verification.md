# OAuth connect-link verification

Use this when checking whether RRD OAuth connect links will send a client to the provider authorization screen without immediate app/callback errors.

## Verification model

A link is considered healthy when the provider authorize URL returns either:

- a 3xx redirect to provider login/consent, or
- a 200 provider page that is clearly an auth/login/consent page and does not contain `invalid_client`, `redirect_uri_mismatch`, `unauthorized_client`, or equivalent callback/client-id errors.

Do **not** follow through login or consent. Do not approve a real OAuth grant during this smoke test.

## Current callback stance

- Use branded callback by default where provider apps accept it:
  - `https://flowaudit.co.uk/revenue-recovery/oauth-callback`
- Xero should use the ivory callback unless its developer app is updated to include branded:
  - `https://revenue-recovery-web-ivory.vercel.app/oauth-callback`
- Keep the callback used in `rrd-vault connect` aligned with the redirect URI registered in that provider's app; otherwise the link can look valid locally but fail at provider auth.

## Provider quirks observed

- Xero: branded callback redirects to the Xero identity error page; ivory callback reaches login. `rrd-vault` should default Xero connect links to ivory unless `--base` is explicitly provided.
- Salesforce: branded callback reaches Salesforce authorization; ivory callback can return a redirect URI error for the current app registration.
- Google: branded callback reaches Google sign-in; ivory may redirect to Google's OAuth error page if not registered for the current client.
- Pipedrive: HTTP 401 with `unauthorized access` from `developers.pipedrive.com` means the app credentials/app setup need repair; it is not a FlowAudit web route problem.
- Zoho Books: can reuse a Zoho Accounts OAuth app if the app can request Zoho Books scopes; still store the values under `ZOHOBOOKS_OAUTH_CLIENT_ID` / `_SECRET` so Zoho CRM and Zoho Books readiness remain distinct.

## Safe reporting

Report credential presence as `present`/`missing` only. Never print client IDs, client secrets, authorization codes, access tokens, refresh tokens, or full authorize URLs containing `client_id`/`state`.