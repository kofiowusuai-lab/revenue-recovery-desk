# OAuth developer app links for Revenue Recovery Desk

Use this when the operator asks which developer sites to use for OAuth apps/connectors.

## Shared callback URL

Register this redirect/callback URL in provider apps:

```text
https://flowaudit.co.uk/revenue-recovery/oauth-callback
```

## Currently wired in `rrd-vault connect`

These providers are implemented in `rrd-oauth.mjs` and can use `rrd-vault connect <submission-id> <provider>` once app credentials are configured on the operator Mac.

### Salesforce

Developer/login links:

- https://login.salesforce.com/
- https://developer.salesforce.com/signup

Env vars expected:

```text
SALESFORCE_OAUTH_CLIENT_ID
SALESFORCE_OAUTH_CLIENT_SECRET
```

Scopes in current code: `api refresh_token`.

### HubSpot

Developer links:

- https://developers.hubspot.com/
- https://app.hubspot.com/developer/

Env vars expected:

```text
HUBSPOT_OAUTH_CLIENT_ID
HUBSPOT_OAUTH_CLIENT_SECRET
```

Scopes in current code: `oauth`, `crm.objects.contacts.read`, `crm.objects.companies.read`, `crm.objects.deals.read`.

Current UI pitfall: HubSpot's **Legacy Apps → Create legacy app → Public** path can show: "New legacy public app creation is disabled. Run `hs project create` in the HubSpot CLI to build OAuth apps for multiple accounts." Do not keep clicking this blocked UI. For a reusable/public multi-client Revenue Recovery Desk OAuth app, switch to the HubSpot CLI/project workflow (`hs project create`) and then capture the client id/secret into the operator env. Private legacy apps are for one account only and are not the intended multi-client connector.

### Zoho CRM

Developer link:

- https://api-console.zoho.com/

Env vars expected:

```text
ZOHO_OAUTH_CLIENT_ID
ZOHO_OAUTH_CLIENT_SECRET
```

Scopes in current code: `ZohoCRM.modules.contacts.READ`, `ZohoCRM.modules.deals.READ`, `ZohoCRM.users.READ`.

App creation note: in Zoho API Console, choose **Server-based Applications** for Revenue Recovery Desk. It is the correct fit for a web OAuth callback hosted at `https://revenue-recovery-web-ivory.vercel.app/oauth-callback`. Avoid Client-based/Mobile/Non-browser/Self Client for the reusable production connector.

### QuickBooks Online / Intuit

Developer links:

- https://developer.intuit.com/app/developer/homepage
- https://developer.intuit.com/app/developer/myapps

Env vars expected:

```text
INTUIT_OAUTH_CLIENT_ID
INTUIT_OAUTH_CLIENT_SECRET
QUICKBOOKS_OAUTH_CLIENT_ID
QUICKBOOKS_OAUTH_CLIENT_SECRET
```

Current code maps QuickBooks to the `quickbooks` provider and stores per-client tokens as `QUICKBOOKS_ACCESS_TOKEN`, `QUICKBOOKS_REFRESH_TOKEN`, `QUICKBOOKS_TOKEN_EXPIRES_AT`, and `QUICKBOOKS_REALM_ID`. Intuit token exchange uses HTTP Basic auth for the app client ID/secret. Scope: `com.intuit.quickbooks.accounting`.

App URL reminders:

- Host domain: `flowaudit.co.uk` (domain only)
- Launch URL: `https://flowaudit.co.uk/revenue-recovery`
- Connect/Reconnect URL: `https://flowaudit.co.uk/revenue-recovery/oauth-start`
- Disconnect URL: `https://flowaudit.co.uk/revenue-recovery/offboard`
- EULA: `https://flowaudit.co.uk/revenue-recovery/terms`
- Privacy: `https://flowaudit.co.uk/revenue-recovery/privacy`

### Pipedrive

Developer links:

- https://developers.pipedrive.com/
- https://developers.pipedrive.com/docs/marketplace

Env vars expected:

```text
PIPEDRIVE_OAUTH_CLIENT_ID
PIPEDRIVE_OAUTH_CLIENT_SECRET
```

Current code maps Pipedrive to the `pipedrive` OAuth provider and stores per-client tokens as `PIPEDRIVE_ACCESS_TOKEN`, `PIPEDRIVE_REFRESH_TOKEN`, `PIPEDRIVE_TOKEN_EXPIRES_AT`, and `PIPEDRIVE_API_DOMAIN`. Pipedrive permissions are controlled in the developer app settings; the authorize URL intentionally omits a `scope` parameter. Private app is acceptable for early GTM; public/marketplace verification can be deferred unless Pipedrive becomes a core self-serve connector.

Pitfall: `https://developers.pipedrive.com/app-extensions` has returned a "page doesn't exist" screen; prefer the marketplace docs link above when opening setup tabs.

## Next connector roadmap links

These are roadmap OAuth connectors from the integration strategy; they are not necessarily fully wired in `rrd-vault connect` yet.

### QuickBooks Online / Intuit

Developer links:

- https://developer.intuit.com/app/developer/homepage
- https://developer.intuit.com/app/developer/myapps

Env vars expected:

```text
INTUIT_OAUTH_CLIENT_ID
INTUIT_OAUTH_CLIENT_SECRET
QUICKBOOKS_OAUTH_CLIENT_ID
QUICKBOOKS_OAUTH_CLIENT_SECRET
```

Launch settings for the FlowAudit deployment:

```text
Host domain: flowaudit.co.uk
Launch URL: https://flowaudit.co.uk/revenue-recovery
Connect/Reconnect URL: https://flowaudit.co.uk/revenue-recovery/oauth-start
Disconnect URL: https://flowaudit.co.uk/revenue-recovery/offboard
EULA/Terms: https://flowaudit.co.uk/revenue-recovery/terms
Privacy: https://flowaudit.co.uk/revenue-recovery/privacy
Redirect URI: https://flowaudit.co.uk/revenue-recovery/oauth-callback
```

OAuth scope in current code: `com.intuit.quickbooks.accounting`. Intuit's accounting scope is broad; enforce read-only launch behavior through RRD policy/guardrails unless explicit write actions are approved later.

Current app setup notes from live Intuit setup:
- Use current Vercel URLs until the final FlowAudit/live domain is deployed; later add the production domain alongside the Vercel URL before removing old callbacks.
- Host domain: `revenue-recovery-web-ivory.vercel.app` (no `https://`).
- Launch URL: `https://revenue-recovery-web-ivory.vercel.app/`.
- Disconnect URL: `https://revenue-recovery-web-ivory.vercel.app/` until a dedicated `/disconnect` route exists.
- Connect/Reconnect URL: `https://revenue-recovery-web-ivory.vercel.app/oauth-start`.
- EULA / Terms URL: `https://revenue-recovery-web-ivory.vercel.app/terms`.
- Privacy Policy URL: `https://revenue-recovery-web-ivory.vercel.app/privacy`.
- Local credential installer: `/Users/AIAgenterminal/rrd-intuit-oauth-install.mjs`; see `references/local-oauth-credential-install.md`.
- Current status: app-level Intuit credentials can be stored locally, but verify QuickBooks/Intuit is wired in `rrd-oauth.mjs` / `rrd-vault connect` before promising a working per-client QuickBooks connect link.

### Xero

```text
Host domain: revenue-recovery-web-ivory.vercel.app
Launch URL: https://revenue-recovery-web-ivory.vercel.app/
Disconnect URL: https://revenue-recovery-web-ivory.vercel.app/
Connect/Reconnect URL: https://revenue-recovery-web-ivory.vercel.app/oauth-start
```

Notes:
- Intuit's **Host domain** field wants only the domain, with no `https://` protocol.
- Launch / Disconnect / Connect-Reconnect fields want full `https://` URLs.
- `/disconnect` is not currently deployed; use `/` as the safe Disconnect URL until a dedicated disconnect route exists.
- After the final live domain is deployed, add/update the same fields to the live domain and keep the Vercel URLs temporarily if the provider allows multiple values. Then verify/publish the app to reduce client-side OAuth warning screens.

### Pipedrive

- https://developers.pipedrive.com/
- https://developers.pipedrive.com/docs/marketplace

Env vars expected:

```text
PIPEDRIVE_OAUTH_CLIENT_ID
PIPEDRIVE_OAUTH_CLIENT_SECRET
PIPEDRIVE_CLIENT_ID
PIPEDRIVE_CLIENT_SECRET
```

Private app is acceptable for early/manual launch. Use this callback URL:

```text
https://flowaudit.co.uk/revenue-recovery/oauth-callback
```

Pipedrive app permissions are controlled in the app settings rather than a `scope` URL param. For launch, keep permissions read-oriented for CRM discovery/mapping: basic info, Deals, Contacts, Activities, users, Deal Fields, and Contact Fields. Avoid admin/mail/messaging/write-like permissions unless there is a specific approved client need.

Pitfall: `https://developers.pipedrive.com/app-extensions` has returned a "page doesn't exist" screen; prefer the marketplace docs link above when opening setup tabs.

- https://console.cloud.google.com/apis/credentials
- https://console.cloud.google.com/apis/credentials/consent

Browser creation runbook for the RRD web connector:

1. Open the project credentials page directly:

   ```text
   https://console.cloud.google.com/auth/clients/create?project=freedom-495303
   ```

2. Choose **Application type → Web application**.
3. Name it `Revenue Recovery Desk Web`.
4. Add this **Authorized JavaScript origin**:

   ```text
   https://revenue-recovery-web-ivory.vercel.app
   ```

5. Add this **Authorized redirect URI**:

   ```text
   https://flowaudit.co.uk/revenue-recovery/oauth-callback
   ```

6. Click **Create**, then capture the client id/secret into the operator env without printing the secret in chat.

Pitfalls from live console work:
- The modern Google Auth Platform route is `/auth/clients` / `/auth/clients/create`, not only the older `/apis/credentials` page.
- In a crowded Chrome window, use the tab title/URL list and switch back to the exact Google tab before clicking; the plus/add controls in different developer tabs are visually similar, and accidental clicks can land in Xero/other provider setup.
- If a Google Console help tooltip blocks the page, press Escape before continuing.

### Microsoft 365 / Outlook

- https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade
- https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app

Env vars expected:

```text
MICROSOFT_OAUTH_CLIENT_ID
MICROSOFT_OAUTH_CLIENT_SECRET
```

Current code maps Microsoft to the `microsoft` provider and stores per-client tokens as `MICROSOFT_ACCESS_TOKEN`, `MICROSOFT_REFRESH_TOKEN`, and `MICROSOFT_TOKEN_EXPIRES_AT`. Scopes: `offline_access User.Read Mail.Read Files.Read`. For detailed Azure CLI setup, personal Outlook/Hotmail support, and the `requestedAccessTokenVersion=2` pitfall, see `references/microsoft-oauth-setup.md`.

### Pipedrive

- https://developers.pipedrive.com/
- https://developers.pipedrive.com/docs/marketplace

Env vars expected:

```text
PIPEDRIVE_OAUTH_CLIENT_ID
PIPEDRIVE_OAUTH_CLIENT_SECRET
PIPEDRIVE_CLIENT_ID
PIPEDRIVE_CLIENT_SECRET
```

Private app is acceptable for early/manual launch. Use this callback URL:

```text
https://flowaudit.co.uk/revenue-recovery/oauth-callback
```

Pipedrive app permissions are controlled in the app settings rather than a `scope` URL param. For launch, keep permissions read-oriented for CRM discovery/mapping: basic info, Deals, Contacts, Activities, users, Deal Fields, and Contact Fields. Avoid admin/mail/messaging/write-like permissions unless there is a specific approved client need.

Pitfall: `https://developers.pipedrive.com/app-extensions` has returned a "page doesn't exist" screen; prefer the marketplace docs link above when opening setup tabs.
- A **Private app** is acceptable for development/testing and can remain acceptable for occasional/manual client use, but a Public/Marketplace app is the scalable path if many unrelated clients need a self-serve “Connect Pipedrive” flow without manual enabling or trust friction.
- Callback URL: `https://revenue-recovery-web-ivory.vercel.app/oauth-callback` (replace the domain after final FlowAudit/live-domain deploy; keep both old/new callbacks during migration if Pipedrive allows it).
- Start with read-only discovery/mapping permissions: basic information, Deals, Contacts, Activities, users, Deal Fields full access, and Contact Fields full access. Avoid admin/mail/messaging/write permissions until a client need requires notes/tasks/logging and the guardrails are updated for it.
- Current RRD code still treats Pipedrive as API-token/vault-based (`PIPEDRIVE_API_TOKEN`), so developer app credentials alone do not mean `rrd-vault connect ... pipedrive` is live. Wire Pipedrive into `rrd-oauth.mjs` and tests before promising OAuth connect links.

Pitfall: `https://developers.pipedrive.com/app-extensions` has returned a "page doesn't exist" screen; prefer the marketplace docs link above when opening setup tabs.

### Intuit / QuickBooks Online

- https://developer.intuit.com/app/developer/homepage
- https://developer.intuit.com/app/developer/myapps

Setup notes from live app creation:
- Host domain: `revenue-recovery-web-ivory.vercel.app` (no `https://`).
- Launch URL: `https://revenue-recovery-web-ivory.vercel.app/`.
- Connect/Reconnect URL: `https://revenue-recovery-web-ivory.vercel.app/oauth-start`.
- Disconnect URL: use `https://revenue-recovery-web-ivory.vercel.app/` until a dedicated disconnect page exists; `/disconnect` was not live during setup.
- End-user license agreement URL: `https://revenue-recovery-web-ivory.vercel.app/terms`.
- Privacy policy URL: `https://revenue-recovery-web-ivory.vercel.app/privacy`.
- Replace the Vercel domain with the final FlowAudit/live domain after deployment, then update app verification settings to remove client-side warnings. Keep the Vercel callback/URLs temporarily where provider settings allow multiple URLs.

## Opening all developer pages for the operator

When asked to open all RRD developer pages in Chrome for OAuth setup, open a new Google Chrome window with the links in this reference. Include the shared callback URL in the final reply, but do not type secrets or interact with login/password/2FA screens.

## Installed CLI/MCP tooling on this Mac

Installed and verified for app/setup work:
- CLIs: `hs` (HubSpot CLI 8.9.1), `sf`/`sfdx` (Salesforce CLI 2.139.6), `az` (Azure CLI 2.87.0), `gcloud` (Google Cloud SDK 573.0.0).
- MCP binaries: `azmcp`, `mcp-hubspot`, `sf-mcp-server`, `xero-mcp-server`, `google-workspace-mcp`, `quickbooks-mcp`, `mcp-pipedrive`, `zoho-mcp-server`.
- npm global bins live in `/Users/AIAgenterminal/.npm-global/bin` and are symlinked into `/Users/AIAgenterminal/.local/bin`; shell profiles include npm/gcloud PATH.

Do not assume these MCPs are enabled in Hermes: `hermes --profile recoverydesk mcp list` showed no configured MCP servers at install time. Add/test individual MCP servers only after the relevant account auth/client credentials exist, because several fail without env tokens (HubSpot private token, Xero env, Pipedrive API token, etc.).

## Classification reminder

OAuth apps are for platforms where clients authorize directly with the vendor: Salesforce, HubSpot, Zoho, QuickBooks, Xero, Google, Microsoft, often Pipedrive.

API-key/token systems should go through the secure vault instead, not OAuth app creation by default: Stripe, Square, PayPal, Twilio, PostGrid, SendGrid, Postmark, Mailgun.
