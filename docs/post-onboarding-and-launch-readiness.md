# Post-onboarding emails, web routes, and launch-readiness checks

Use this when operating the Revenue Recovery Desk funnel after a client signs, or when asked whether the system is ready for launch.

## Live web route map

Do not confuse the sales landing page with the onboarding form.

- Landing page / public sales page: `https://revenue-recovery-web-ivory.vercel.app/`
- Onboarding form: `https://revenue-recovery-web-ivory.vercel.app/onboarding`
- Internal dashboard: `https://revenue-recovery-web-ivory.vercel.app/desk`
- OAuth callback / redirect URI for developer apps: `https://revenue-recovery-web-ivory.vercel.app/oauth-callback`
- Bare vault page: `https://revenue-recovery-web-ivory.vercel.app/vault` — do not send bare page; send generated one-time vault links.
- Bare OAuth start page: `https://revenue-recovery-web-ivory.vercel.app/oauth-start` — do not send bare page; send generated one-time connect links.

When verifying routes, check actual page identity, not just HTTP 200. The landing page should contain the hero text `Your Clients Owe You`; the onboarding page title is `Revenue Recovery Desk — Client Onboarding`; the dashboard title is `Revenue Recovery Desk — Internal`.

## Welcome pack vs integration-access email

Welcome pack is an operating/customer-success email, not a technical setup email.

Welcome pack should include:
- what Revenue Recovery Desk will do,
- approvals and safety rules,
- reporting/visibility expectations,
- support contact,
- cancellation instructions by emailing support from the business email on file.

Welcome pack must NOT include:
- a direct offboarding form link,
- the phrase/link `secure offboarding form`,
- PostGrid/Twilio/Stripe/etc. setup steps,
- raw API-key requests.

Cancellation wording pattern:
- Client can request cancellation by emailing `flowaudit-support@agentmail.to` from the business email on file.
- Security: cancellation/offboarding requests must come from and match the active business/billing email on file.

Integration-access email is separate. It is where API/OAuth setup details belong:
- API-key providers such as Stripe, Square, PayPal, Twilio, PostGrid, SendGrid, Postmark, Mailgun go through `rrd-vault new <submission-id>`.
- OAuth providers use `rrd-vault connect <submission-id> <provider>` where supported.
- Always warn: do not email API keys, passwords, card details, or private credentials.
- Salesforce clients get an extra field-mapping section asking where invoices/receivables live and which fields represent invoice number, customer/account, contact/email, amount due/paid/balance, due date, status, payment link, owner, last contacted, do-not-contact, dispute, payment plan, VIP, and recovery notes. The email should reassure them that plain English/screenshots are fine and that RRD will run a read-only metadata scan and send a proposed map for approval before recovery activity.

## Developer apps to create for launch readiness

Use this redirect URI for all OAuth apps:

```text
https://revenue-recovery-web-ivory.vercel.app/oauth-callback
```

After creating an OAuth app, install its app credentials via a local-only handoff — never by pasting secrets into Telegram. See `references/local-oauth-credential-install.md`. For the Google OAuth app specifically, use the local helper `/Users/AIAgenterminal/rrd-google-oauth-install.mjs` to write `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` plus compatibility aliases without printing values.

Currently wired in `rrd-oauth.mjs`:
- Salesforce: `SALESFORCE_OAUTH_CLIENT_ID`, `SALESFORCE_OAUTH_CLIENT_SECRET`
- HubSpot: `HUBSPOT_OAUTH_CLIENT_ID`, `HUBSPOT_OAUTH_CLIENT_SECRET`
- Zoho CRM: `ZOHO_OAUTH_CLIENT_ID`, `ZOHO_OAUTH_CLIENT_SECRET`

High-priority apps to build next:
1. Salesforce
2. HubSpot
3. QuickBooks Online
4. Xero
5. Google Workspace / Gmail
6. Microsoft 365 / Outlook
7. Zoho CRM

Recommended developer URLs:
- HubSpot: `https://developers.hubspot.com/` and `https://app.hubspot.com/developer/`
- Salesforce: `https://login.salesforce.com/` and `https://developer.salesforce.com/signup`
- Zoho: `https://api-console.zoho.com/`
- QuickBooks / Intuit: `https://developer.intuit.com/app/developer/homepage`
- Xero: `https://developer.xero.com/app/manage`
- Google Cloud credentials: `https://console.cloud.google.com/apis/credentials`
- Microsoft Entra app registrations: `https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade`
- Pipedrive: `https://developers.pipedrive.com/`

## Orgo launch decision

Do not treat unpaid Orgo as a blocker before first client revenue. The user's current launch stance:
- do not pay for Orgo until money comes in from a client,
- use the one free Orgo computer for end-to-end testing,
- run the first full rehearsal with faux Stripe data and a spare Stripe key,
- upgrade Orgo only after a paid client makes the runtime cost justified.

## Full pipeline rehearsal checklist

Before saying the system is ready, verify with real commands and a fake/test client:

1. Landing page loads at `/` and onboarding loads at `/onboarding`.
2. Onboarding submission appears in the live dashboard/book.
3. Provision profile:
   ```bash
   /Users/AIAgenterminal/rrd-provision <submission-id>
   ```
4. Generate secure API-key link:
   ```bash
   /Users/AIAgenterminal/rrd-vault new <submission-id>
   ```
5. Generate OAuth connect links for supported providers after app creds are present:
   ```bash
   /Users/AIAgenterminal/rrd-vault connect <submission-id> salesforce
   ```
6. Send/preview welcome pack separately from access email:
   ```bash
   /Users/AIAgenterminal/rrd-welcome-pack welcome <submission-id> --dry-run
   /Users/AIAgenterminal/rrd-welcome-pack access <submission-id> --vault-url <secure-vault-link> --dry-run
   ```
7. Claim deposited test secrets:
   ```bash
   /Users/AIAgenterminal/rrd-vault claim <drop-id>
   ```
8. Run a gate check before any send:
   ```bash
   /Users/AIAgenterminal/rrd-recover gate rr-<company> '{"channel":"Email","to":{"email":"customer@example.com"},"approved":true,"atHour":10}'
   ```
9. Run/rehearse Orgo/brain path with the free computer or dry-run path:
   ```bash
   /Users/AIAgenterminal/rrd-brain cycle rr-<company> --dry-run
   ```

If a generated test vault link is created only for verification, expire it after the check so no unused live link remains.
