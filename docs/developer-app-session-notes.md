# OAuth developer app setup notes — Intuit, Pipedrive, Salesforce

Session-derived notes for Revenue Recovery Desk developer-account setup. Use alongside `oauth-developer-app-links.md` and `local-oauth-credential-install.md`.

## Intuit / QuickBooks

For the current Vercel deployment, Intuit app-review/setup fields can use:

```text
Host domain: revenue-recovery-web-ivory.vercel.app
Launch URL: https://revenue-recovery-web-ivory.vercel.app/
Disconnect URL: https://revenue-recovery-web-ivory.vercel.app/
Connect/Reconnect URL: https://revenue-recovery-web-ivory.vercel.app/oauth-start
End-user license agreement URL: https://revenue-recovery-web-ivory.vercel.app/terms
Privacy policy URL: https://revenue-recovery-web-ivory.vercel.app/privacy
Redirect/callback URL: https://revenue-recovery-web-ivory.vercel.app/oauth-callback
```

`/disconnect` and `/integrations` were not live routes during setup; use `/` for disconnect until a dedicated route exists. When moving to final FlowAudit/live domain, add live-domain equivalents to Intuit before removing Vercel URLs.

Local credential installer:

```bash
/Users/AIAgenterminal/rrd-intuit-oauth-install.mjs
```

It writes compatibility aliases in `/Users/AIAgenterminal/.openclaw/.env`; verify only key names. Storing the app credentials is not the same as wiring QuickBooks into client-facing `rrd-vault connect`.

## Pipedrive

Private app is acceptable for development/testing and can remain acceptable for limited/manual production use. A public/Marketplace app is needed only if we want broad self-serve “Connect Pipedrive” without manually allowing clients and with less app-warning friction.

Use the shared callback URL:

```text
https://revenue-recovery-web-ivory.vercel.app/oauth-callback
```

For read-only discovery/mapping, prefer these Pipedrive scopes/permissions:

```text
Access to basic information
Deals
Contacts
Activities
Read users data
Deal Fields: Full access
Contact Fields: Full access
```

Avoid write/admin/mail/messaging scopes unless a specific client workflow requires them later.

Local credential installer:

```bash
/Users/AIAgenterminal/rrd-pipedrive-oauth-install.mjs
```

Important: current RRD integration mapping has historically treated Pipedrive as `PIPEDRIVE_API_TOKEN` via secure vault, not OAuth. Do not promise client-facing Pipedrive OAuth until `rrd-oauth.mjs` / `rrd-vault connect` support is verified or added.

## Salesforce signup blocker

Salesforce Developer Edition signup may fail with a generic screen:

```text
Oops! Something went wrong. Please try again.
```

If changing email does not help, treat it as a provider signup/anti-abuse/session blocker rather than a form-field mistake. Do not keep retrying the same form. Try, in order:

1. Existing Salesforce/Trailhead account/org.
2. Trailhead Playground orgs page.
3. Salesforce free trial org.
4. Park Salesforce as “blocked by provider signup” and continue GTM with other connectors.

Salesforce remains useful but should not block Revenue Recovery Desk soft GTM when HubSpot, Zoho, Xero, Google, Intuit credentials, Pipedrive credentials, and API-key vault flows are ready.
