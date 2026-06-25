# HubSpot Composio experiment — deferred

## Current RRD route
HubSpot is back on **native RRD OAuth** for new clients.

- Registry route: CRM `HubSpot` uses `auth: "oauth"` with provider `hubspot`.
- Client connect path: `rrd-vault connect <submission-id> hubspot` / OAuth start page.
- Native app credentials are required in the operator env when generating/approving HubSpot OAuth links:
  - `HUBSPOT_OAUTH_CLIENT_ID`
  - `HUBSPOT_OAUTH_CLIENT_SECRET`
- Client/profile tokens after approval:
  - `HUBSPOT_ACCESS_TOKEN`
  - `HUBSPOT_REFRESH_TOKEN`
  - `HUBSPOT_TOKEN_EXPIRES_AT`

## Why Composio is deferred
The Composio-managed HubSpot test link requested a broad generic HubSpot scope set, including write/admin-ish scopes beyond RRD's current read-only requirement. That failed authorization and is not the clean consent screen we want for clients.

Do **not** route HubSpot through `COMPOSIO_HUBSPOT_CONNECTED_ACCOUNT_ID` for normal new RRD clients until a constrained Composio HubSpot config has been deliberately reviewed and tested.

## Scope expectations
The active native RRD HubSpot OAuth scope set is explicit and read-only:

- `oauth`
- `crm.objects.contacts.read`
- `crm.objects.companies.read`
- `crm.objects.deals.read`

The RRD functional minimum for current HubSpot collection is read-only CRM access for:
- Deals
- Contacts
- Companies

If later we need HubSpot invoices, payments, marketing, or write actions, treat that as a separate reviewed scope change. Do not broaden HubSpot scopes silently.

## What to say if asked about the Composio link
- The Composio test showed the managed HubSpot link was too broad for our current needs.
- We intentionally switched back to native HubSpot OAuth.
- Composio can be revisited later only with constrained scopes or a custom auth config.

## Verification pattern
Safe checks should print metadata/key names only, never API keys/secrets:

```bash
node --test /Users/AIAgenterminal/test/rrd-hermes-integrations.test.mjs /Users/AIAgenterminal/test/rrd-collect.test.mjs /Users/AIAgenterminal/test/rrd-readiness-checklist.test.mjs
```

Expected key tests:
- `HubSpot CRM is native OAuth → no vault key and no Composio dependency`
- `HubSpot source defaults to native OAuth token even if Composio id is present`
