# Pipedrive app setup notes

Use this when the operator is setting up a Pipedrive developer app for Revenue Recovery Desk.

## Private vs public app

A **Private app** is acceptable for development, testing, and limited/manual client enablement. It avoids marketplace approval and gets setup moving quickly.

A **Public app** / Marketplace app is needed when Revenue Recovery Desk should scale to arbitrary Pipedrive clients without manual enablement and with lower client-side trust friction.

Recommended stance:

- Use **Private app** now for testing and early manual setup.
- Revisit public verification only if Pipedrive becomes a common launch CRM.

## Callback URL

Pipedrive private apps allow **one callback URL per app**. Use the URL that is currently registered/tested for the app; do not assume multiple callbacks can be added.

Current RRD smoke checks showed the branded FlowAudit callback is the intended/default callback for Pipedrive app setup:

```text
https://flowaudit.co.uk/revenue-recovery/oauth-callback
```

If you intentionally create a separate Pipedrive app for the ivory app host, use this instead, but remember it is a separate one-callback app decision:

```text
https://revenue-recovery-web-ivory.vercel.app/oauth-callback
```

## Permissions / scopes

Start read-only. Recommended minimum read permissions:

```text
Access to basic information
Deals
Contacts
Activities
Read users data
Deal Fields: Full access
Contact Fields: Full access
```

Optional only if the client's Pipedrive data model needs them:

```text
Products
Product Fields: Full access
Search for all data
Leads
```

Avoid unless a specific approved writeback use case exists:

```text
Mail
Administer account
Messaging integration
Video calls integration
Webhooks
Projects
Call logs
Goals
write/admin permissions
```

## Current RRD implementation stance

Pipedrive OAuth is wired in RRD (`rrd-oauth.mjs` / `rrd-vault connect`) and app credentials can be stored locally with:

```bash
/Users/AIAgenterminal/rrd-pipedrive-oauth-install.mjs
```

A Pipedrive authorize URL returning HTTP `401` with body like `unauthorized access` / `Please check developers.pipedrive.com` usually points to the Pipedrive developer app setup or installed client credentials, not the FlowAudit callback page. Reinstall the current app's Client ID/Secret locally, confirm the app is the intended Private app, and use **Install & test** or **Change to live** before rechecking. Do not paste the secret in chat.

## Private app creation checklist

From Pipedrive's private-app docs:

1. Use a developer sandbox account; Developer Hub appears from the profile/company menu only for sandbox/developer accounts.
2. Click **Create an app** / **+ Create an app**, then **Create private app**. App type cannot be changed later.
3. In **Basic info**, fill:
   - App name, e.g. `Revenue Recovery Desk`.
   - OAuth Callback URL — exactly one URL per app; see callback section above.
4. Click **Save** to reach **OAuth & access scopes**.
5. Select the minimum read scopes needed for recovery discovery.
6. Copy Client ID/Secret into the local installer only.
7. Use **Install & test** for sandbox testing, or **Change to live** before sharing the direct private-app installation link externally.
