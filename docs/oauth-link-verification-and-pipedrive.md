# OAuth link verification and Pipedrive app setup notes

Use this when checking whether RRD OAuth connect links are actually usable before sending them to clients.

## Presence is not enough

A provider can have `*_OAUTH_CLIENT_ID` / `*_OAUTH_CLIENT_SECRET` present locally but still reject the authorize URL. Verify by building a real authorize URL and requesting it with redirects disabled. Treat provider login/consent redirects or a non-error auth page as success; treat explicit `redirect_uri_mismatch`, `invalid_client`, `unauthorized_client`, or provider `401` as a blocker.

Never print client IDs, secrets, or full authorize URLs containing real `client_id` / `state` values. Redact those query params in any diagnostic output.

## Callback base quirks verified during OAuth smoke testing

- Default branded base: `https://flowaudit.co.uk/revenue-recovery`
- Ivory base: `https://revenue-recovery-web-ivory.vercel.app`
- Xero currently works with the ivory callback and fails/errors with the branded callback. `rrd-vault connect` should use ivory for Xero unless an operator explicitly passes `--base`.
- Salesforce currently works with the branded callback and rejects the ivory callback.
- Google currently works with the branded callback; an ivory check can redirect to Google's OAuth error page if that callback is not registered for the installed app.
- Zoho Books can reuse the Zoho Accounts OAuth app credentials if that app can request the Books scopes. Install the same values under `ZOHOBOOKS_OAUTH_CLIENT_ID` / `ZOHOBOOKS_OAUTH_CLIENT_SECRET` only if the callback and scope setup are valid.

## Pipedrive private app creation checklist

Pipedrive private apps are created in Developer Hub and can have only **one** OAuth callback URL per app.

1. Use a Pipedrive developer sandbox/company account with access to **Developer Hub**.
2. Create a **Private app**. App type cannot be changed later.
3. Basic info:
   - App name: `Revenue Recovery Desk`
   - OAuth callback URL: `https://flowaudit.co.uk/revenue-recovery/oauth-callback` unless the app is intentionally registered for the ivory callback instead.
4. Save, then open **OAuth & access scopes**.
5. Select least-privilege read scopes needed for recovery discovery, e.g. deals, persons/contacts, organizations, activities, users, and relevant field/custom-field reads. Avoid write/admin/mail scopes for launch.
6. Use **Install & test** for sandbox/company testing, or **Change to live** before sharing the private app outside the sandbox/company. Pipedrive validates the callback URL when changing to live.
7. Copy the **Client ID** and **Client Secret** specifically — not the app ID, slug, marketplace ID, or installation link — then install locally with `/Users/AIAgenterminal/rrd-pipedrive-oauth-install.mjs`.

## Interpreting Pipedrive failures

A Pipedrive authorize request returning:

```text
HTTP 401
{"success":false,"error":"unauthorized access","errorCode":401,"error_info":"Please check developers.pipedrive.com"}
```

means Pipedrive rejected the app/client before callback handling. Re-check app type/status, copied Client ID vs app ID, sandbox/company ownership, and whether the private app is installed/tested or live. It is not primarily a FlowAudit route problem if both branded and ivory callbacks return the same 401.

## Useful docs

- Private app registration: `https://pipedrive.readme.io/docs/marketplace-registering-a-private-app`
- OAuth authorization: `https://pipedrive.readme.io/docs/marketplace-oauth-authorization`
- Client ID and client secret: `https://pipedrive.readme.io/docs/client-id-and-client-secret`
