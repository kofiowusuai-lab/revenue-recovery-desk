# Salesforce Connected App setup via Trailhead Playground

Use this when Salesforce Developer Edition signup fails or blocks the operator while setting up the reusable RRD Salesforce OAuth connector.

## Durable pitfall

The Salesforce Developer Edition signup form can fail with a generic message such as:

```text
Oops! Something went wrong. Please try again.
```

Changing email addresses may not help. Treat this as a Salesforce provider/signup blocker, not necessarily a bad form entry.

## Working fallback: Trailhead Playground

1. Go to Trailhead Hands-On Orgs.
2. Create a Playground.
3. If Launch initially returns a 404 on the playground domain, wait 1–2 minutes and retry. If it stays broken, disconnect and create another Playground.
4. Once inside the org, click the gear icon → **Setup**.
5. Search for **App Manager**.
6. In Lightning Experience App Manager, click **New External Client App**.

## External Client App fields

Basic information:

```text
External Client App Name: Revenue Recovery Desk
API Name: Revenue_Recovery_Desk
Distribution State: Local
Description: Revenue Recovery Desk provides approved, read-only revenue recovery workflows for client CRM, invoice, and customer follow-up operations.
```

Use the operator/business email as the contact email.

OAuth callback:

```text
https://revenue-recovery-web-ivory.vercel.app/oauth-callback
```

OAuth scopes needed by the current RRD connector:

```text
Manage user data via APIs (api)
Perform requests at any time (refresh_token, offline_access)
```

Flow Enablement:

- Enable **Authorization Code and Credentials Flow**.
- Leave Client Credentials, Device Flow, JWT Bearer, and Token Exchange off unless explicitly needed later.

Security:

- Keep **Require secret for Web Server Flow** enabled.
- Keep **Require secret for Refresh Token Flow** enabled.
- Disable **Require PKCE for Code Exchange** unless `rrd-oauth.mjs` has been updated to send a PKCE verifier.

After creation, collect the Consumer Key/Client ID and Consumer Secret/Client Secret through the local Salesforce installer, never in chat:

```bash
/Users/AIAgenterminal/rrd-salesforce-oauth-install.mjs
```

It writes `SALESFORCE_OAUTH_CLIENT_ID`, `SALESFORCE_OAUTH_CLIENT_SECRET`, and compatibility aliases into `/Users/AIAgenterminal/.openclaw/.env`.
