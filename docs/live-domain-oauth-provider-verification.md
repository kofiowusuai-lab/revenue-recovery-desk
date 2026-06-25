# Live-domain OAuth/provider verification for Revenue Recovery Desk

Use this after the Revenue Recovery web app moves domains or when the operator asks whether developer portals still need callback/legal URL updates.

## Current live FlowAudit base

```text
https://flowaudit.co.uk/revenue-recovery
```

Canonical URLs to use in provider portals:

```text
Homepage / launch:  https://flowaudit.co.uk/revenue-recovery
OAuth callback:    https://flowaudit.co.uk/revenue-recovery/oauth-callback
OAuth start:       https://flowaudit.co.uk/revenue-recovery/oauth-start
Vault:             https://flowaudit.co.uk/revenue-recovery/vault
Terms / EULA:      https://flowaudit.co.uk/revenue-recovery/terms
Privacy policy:    https://flowaudit.co.uk/revenue-recovery/privacy
Disconnect/offboard: https://flowaudit.co.uk/revenue-recovery/offboard
```

Operator env keys that should point at the live base:

```text
RRD_WEB_BASE=https://flowaudit.co.uk/revenue-recovery
RRD_VAULT_BASE=https://flowaudit.co.uk/revenue-recovery
RRD_OFFBOARD_BASE=https://flowaudit.co.uk/revenue-recovery/offboard
PUBLIC_BASE_URL=https://flowaudit.co.uk/revenue-recovery
NEXT_PUBLIC_BASE_URL=https://flowaudit.co.uk/revenue-recovery
```

## Important callback path pitfall

When the app is mounted under `/revenue-recovery`, the OAuth callback page must preserve the full path when depositing the OAuth code. Use the actual callback page path, not only `location.origin`.

Correct payload value:

```js
const callbackUri = location.origin + location.pathname;
```

Wrong when mounted under a subpath:

```js
location.origin + "/oauth-callback"
```

The wrong form causes providers such as Salesforce to reject token exchange with `redirect_uri must match configuration` even when the portal callback field is typed correctly.

## Provider portal update checklist

Update every developer/OAuth app created during setup:

1. Google Cloud Console / Google Auth Platform
   - JavaScript origin: `https://flowaudit.co.uk`
   - Redirect URI: `https://flowaudit.co.uk/revenue-recovery/oauth-callback`
   - Consent screen homepage/privacy/terms set to the live URLs.
   - Publish to production and submit verification for sensitive scopes such as `gmail.readonly`.

2. HubSpot developer app/project
   - Redirect/callback URL set to live callback.
   - App/home/privacy/terms URLs set to live URLs where available.

3. Xero developer app
   - Redirect URI set to live callback.
   - App/home/privacy/terms URLs set to live URLs where available.
   - If `invalid_scope` appears, confirm the app is a Web app with Accounting API enabled, not identity-only.

4. Zoho API Console
   - Server-based Application.
   - Homepage URL set to live base.
   - Authorized Redirect URI set to live callback.

5. Intuit / QuickBooks
   - Host domain: `flowaudit.co.uk` (domain only).
   - Launch URL: live base.
   - Connect/Reconnect URL: live OAuth start.
   - Disconnect URL: live offboard.
   - EULA: live terms.
   - Privacy: live privacy.
   - Redirect URI/callback: live callback if shown separately.

6. Pipedrive developer app
   - Callback URL set to live callback.
   - App/home/privacy/terms URLs set where available.
   - Private app is acceptable for early GTM; public/marketplace review can be deferred unless Pipedrive becomes a core self-serve connector.

7. Salesforce External Client App / Connected App
   - Callback URL set to live callback.
   - OAuth scopes: `api` and `refresh_token/offline_access`.
   - Enable Authorization Code and Credentials Flow.
   - Avoid requiring PKCE unless `rrd-oauth.mjs` sends a code verifier.

## Smoke-test sequence after updates

For each key provider, generate a fresh connect link with `rrd-vault connect <submission-id> <provider>`, authorize in the browser, then approve the deposited drop:

```text
approve <drop-id>
```

A successful test should show the provider access/refresh token key names written to the target profile and the drop burned/consumed. Never report token values.

## Google warning / verification-remediation workflow

If Google still shows `Google hasn't verified this app`, the technical OAuth flow may still work, but Google does not consider the app/consent screen verified for the requested scopes. To remove the warning:

- Use the FlowAudit project/client credentials, not old client-specific project credentials.
- Set publishing status to production.
- Verify/authorize `flowaudit.co.uk` as the domain.
- Submit OAuth app verification for sensitive scopes such as Gmail read-only.
- If warning-free launch is urgent and Gmail read access is not needed on day one, remove `gmail.readonly` until verification completes.

When Google replies that the homepage is missing the privacy policy link or reviewers cannot log in/test the app, fix the **actual branded homepage** at `https://flowaudit.co.uk/revenue-recovery`, not only the ivory/source app. The homepage should visibly include:

- a direct link to `https://flowaudit.co.uk/revenue-recovery/privacy` (not just root `/privacy` when Google requested the subpath privacy URL);
- a direct link to `https://flowaudit.co.uk/revenue-recovery/client?login=1` or the current reviewer login page;
- brief instructions: sign in with the reviewer credentials supplied in Google Cloud, 2FA disabled for that review account, open Settings/secure setup, choose Connect Google Workspace, then continue to Google's OAuth consent screen;
- a direct link to `https://flowaudit.co.uk/revenue-recovery/oauth-start` as the OAuth setup entry point, with the caveat that a valid one-time setup link is required for live authorization.

After deploy, verify the exact branded homepage HTML contains the reviewer block/links. A Vercel alias such as `flowaudit-platform-ecru.vercel.app` showing the fix is **not enough** if `flowaudit.co.uk/revenue-recovery` still serves older HTML. If the branded domain is controlled by a separate FlowAudit project/rewrite layer, ask Curtis to redeploy that exact project or provide access; do not report the Google remediation as complete until the branded URL itself shows the content.

Also verify the global footer/legal links while on `/revenue-recovery`: Google reviewers may treat root `/privacy` as the wrong policy when they requested the product subpath. The FlowAudit platform footer should route Revenue Recovery pages to `/revenue-recovery/privacy` and `/revenue-recovery/terms`, while leaving the rest of the agency site on `/privacy` and `/terms`. If implementing this in Next, avoid overly broad path predicates: match `pathname === "/revenue-recovery" || pathname.startsWith("/revenue-recovery/")`, not just `startsWith("/revenue-recovery")`, so future similarly prefixed routes do not inherit the wrong legal links.

When replacing Google app credentials, use the local installer pattern and verify only key names are present; do not paste secrets in chat.

For Google verification demo videos, use `references/google-oauth-verification-demo-video.md`. It captures the current approved positioning: official URL `https://flowaudit.co.uk/revenue-recovery`, app name `Revenue Recovery Desk`, both Gmail readonly + Drive metadata readonly, Kofi PVC ElevenLabs voiceover preference, and the safe local-only key installer pattern.

