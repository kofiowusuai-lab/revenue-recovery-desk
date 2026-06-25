# Revenue Recovery Desk links + OAuth app setup notes

Use this when the user asks for operator/client links or where to create OAuth apps.

## Current verified web routes

- Onboarding form: `https://revenue-recovery-web-ivory.vercel.app/`
- Internal dashboard: `https://revenue-recovery-web-ivory.vercel.app/desk`
- Secure API-key vault page: `https://revenue-recovery-web-ivory.vercel.app/vault`
- OAuth start page: `https://revenue-recovery-web-ivory.vercel.app/oauth-start`
- OAuth callback / redirect URI: `https://revenue-recovery-web-ivory.vercel.app/oauth-callback`

Important pitfall: do **not** call the root URL the landing page unless you have verified it. In this deployment the root currently serves the onboarding form. A locally built landing page was found at `/Users/AIAgenterminal/Downloads/landing-page.html`, but it was not deployed under `/`, `/landing`, `/landing-page`, `/sales`, or `/home` when checked.

Recommended clean routing if the landing page is deployed later:

- Landing page: `/`
- Onboarding form: `/onboarding`
- Internal dashboard: `/desk`

## OAuth developer app sites

Use this redirect URI for apps unless the deployment changes:

```text
https://revenue-recovery-web-ivory.vercel.app/oauth-callback
```

Currently wired in `rrd-oauth.mjs`:

- Salesforce Connected App
  - Login/setup: `https://login.salesforce.com/`
  - Developer signup: `https://developer.salesforce.com/signup`
  - Env vars: `SALESFORCE_OAUTH_CLIENT_ID`, `SALESFORCE_OAUTH_CLIENT_SECRET`
- HubSpot App
  - Developer portal: `https://developers.hubspot.com/`
  - App dashboard: `https://app.hubspot.com/developer/`
  - Env vars: `HUBSPOT_OAUTH_CLIENT_ID`, `HUBSPOT_OAUTH_CLIENT_SECRET`
- Zoho CRM OAuth Client
  - API Console: `https://api-console.zoho.com/`
  - Env vars: `ZOHO_OAUTH_CLIENT_ID`, `ZOHO_OAUTH_CLIENT_SECRET`

Next connector roadmap / apps to create:

- QuickBooks Online / Intuit: `https://developer.intuit.com/app/developer/homepage` and `https://developer.intuit.com/app/developer/myapps`
- Xero: `https://developer.xero.com/` and `https://developer.xero.com/app/manage`
- Google Workspace / Gmail: `https://console.cloud.google.com/apis/credentials` and `https://console.cloud.google.com/apis/credentials/consent`
- Microsoft 365 / Outlook: `https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade`
- Pipedrive: `https://developers.pipedrive.com/`

Do not route API-key/token systems through OAuth unless the integration strategy changes. Stripe, Square, PayPal, Twilio, PostGrid, SendGrid, Postmark, and Mailgun go through `rrd-vault new <submission-id>` / secure vault collection.
