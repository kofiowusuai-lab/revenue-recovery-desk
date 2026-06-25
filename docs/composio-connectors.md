# Composio connector fallback

Use Composio as a fallback/expansion layer when direct OAuth setup is too slow or brittle, especially for long-tail CRMs/accounting tools.

## Current status

- Local API key lives in `/Users/AIAgenterminal/.openclaw/.env` as `COMPOSIO_API_KEY` (never print value).
- Helper command: `/Users/AIAgenterminal/rrd-composio`
- Python SDK installed in Hermes agent venv (`/Users/AIAgenterminal/.hermes/hermes-agent/venv`).

## HubSpot via Composio — deferred

HubSpot is **not currently Composio-managed** for normal new RRD clients. We tested a Composio-managed HubSpot link and it requested a broad generic HubSpot permission set beyond RRD's read-only needs, so the active route is native RRD OAuth.

Verified facts from the live Composio SDK:

- toolkit slug: `hubspot`
- Composio-managed OAuth is available (`OAUTH2` in `composio_managed_auth_schemes`)
- HubSpot search tool exists: `HUBSPOT_SEARCH_DEALS`
- useful read tools include `HUBSPOT_SEARCH_DEALS`, `HUBSPOT_LIST_DEALS`, and `HUBSPOT_GET_DEAL`

RRD implementation stance:

- Classify HubSpot as `auth:"oauth"`, `provider:"hubspot"` in `rrd-hermes.mjs` and dashboard mirrors.
- New HubSpot client manifests should include `oauthConnectionsNeeded: ["HubSpot"]`, not Composio needs.
- Use native HubSpot app credentials (`HUBSPOT_OAUTH_CLIENT_ID` / `HUBSPOT_OAUTH_CLIENT_SECRET`) for the operator-side OAuth app.
- `rrd-collect recover --source hubspot` should default to native `HUBSPOT_ACCESS_TOKEN`, even if a stale/test `COMPOSIO_HUBSPOT_CONNECTED_ACCOUNT_ID` exists.
- Readiness should use native HubSpot OAuth token env names for new clients. Do not require `COMPOSIO_HUBSPOT_CONNECTED_ACCOUNT_ID` unless a future constrained Composio config is reviewed and intentionally re-enabled.

Safe SDK probe pattern, without printing credentials:

```python
from composio import Composio
c = Composio(api_key=COMPOSIO_API_KEY)
tk = c.toolkits.get('hubspot')
tools = c.tools.get_raw_composio_tools(search='search deals', toolkits=['hubspot'], limit=5)
print(tk.slug, 'OAUTH2' in (tk.composio_managed_auth_schemes or []), [t.slug for t in tools])
```

Expected compact result shape:

```text
toolkit: hubspot
managed_oauth: true
tool_slugs: HUBSPOT_SEARCH_DEALS
```

Google is different: keep Google Workspace/Gmail flexible/native unless a clearly equivalent Composio Workspace/Gmail path is proven. Do not assume Google Search Console or other Google-specific toolkits replace Google Cloud Console / Workspace OAuth verification for Gmail/Drive scopes.

## Pipedrive via Composio

Direct Pipedrive OAuth previously returned 401 even with the private app live, and even Pipedrive's own Share URL returned `unauthorized access`, so Pipedrive was proven through Composio during earlier connector work. Re-check current `rrd-hermes.mjs` classification before promising the active path; the registry may now route Pipedrive through native OAuth.

Durable setup quirks:

- Composio does **not** currently provide managed Pipedrive credentials; create a `use_custom_auth` auth config with the Pipedrive client id/secret.
- The Composio auth-config creation fields report `oauth_redirect_uri` defaulting to `https://backend.composio.dev/api/v1/auth-apps/add`; this is the callback that must be registered in the Pipedrive app for Composio-managed authorization.
- Starting a connected account must include the Pipedrive company subdomain, e.g. config `{"auth_scheme":"OAUTH2","val":{"subdomain":"kofi-sandbox"}}`. If omitted/mis-captured, Composio may store a bad API domain and tool execution can fail with DNS/SSRF guard errors.
- Manual `tools.execute` calls need both the `user_id` associated with the connected account and a pinned toolkit `version` (for Pipedrive currently `20260616_00`); otherwise Composio raises `ConnectedAccountEntityIdRequired` or `ToolVersionRequiredError`.

Local env names:

```text
COMPOSIO_PIPEDRIVE_AUTH_CONFIG_ID
COMPOSIO_PIPEDRIVE_TEST_CONNECTED_ACCOUNT_ID
COMPOSIO_PIPEDRIVE_TOOLKIT_VERSION   # optional, default 20260616_00
COMPOSIO_PIPEDRIVE_USER_ID           # optional, default rrd-pipedrive-test-2
```

Composio required the Pipedrive OAuth app callback URL:

```text
https://backend.composio.dev/api/v1/auth-apps/add
```

Composio Pipedrive connection requires the company subdomain, e.g. `kofi-sandbox` for `https://kofi-sandbox.pipedrive.com`.

Verified smoke command:

```bash
/Users/AIAgenterminal/rrd-composio status
/Users/AIAgenterminal/rrd-composio pipedrive-smoke
```

Verified results after authorization:

- connection status: `ACTIVE`
- `PIPEDRIVE_GET_ALL_DEALS`: successful, 0 rows in sandbox
- `PIPEDRIVE_GET_ALL_PERSONS`: successful, 0 rows in sandbox
- `PIPEDRIVE_GET_ALL_ORGANIZATIONS`: successful, 0 rows in sandbox
- `PIPEDRIVE_GET_ALL_DEAL_FIELDS`: successful, returned deal field metadata

## Helper usage

```bash
/Users/AIAgenterminal/rrd-composio status
/Users/AIAgenterminal/rrd-composio pipedrive-smoke
/Users/AIAgenterminal/rrd-composio tools PIPEDRIVE deal
/Users/AIAgenterminal/rrd-composio execute PIPEDRIVE_GET_ALL_DEALS '{"limit":3,"status":"all_not_deleted"}'
```

The helper prints compact read results and never prints Composio or provider token values.

Reusable skill probe for future stack-expansion sessions:

```bash
/Users/AIAgenterminal/.hermes/hermes-agent/venv/bin/python ~/.hermes/profiles/recoverydesk/skills/recovery-desk/scripts/composio-toolkit-probe.py
```

Use it to confirm live Composio toolkit existence, tool counts, and whether the toolkit needs custom OAuth/API-key credentials before promising support. For the current credential-burden snapshot and the onboarding-label → registry → vault/OAuth review checklist, see `references/composio-auth-classification-and-registry-wiring.md`.

## Composio-backed stack added to onboarding

These are now first-class onboarding options but should be treated as **Composio-backed / smoke-test per client**, not guaranteed native connectors until a real read-only connection has been exercised.

### Payment / ecommerce

- Whop (`whop`) — custom OAuth app credentials installed in Composio; local `COMPOSIO_WHOP_AUTH_CONFIG_ID` is present. Treat as Composio-managed for client authorization, with write/payment scopes still approval-gated by RRD policy.
- Shopify (`shopify`)
- Maxio (`maxio`)
- Paystack (`paystack`)
- Razorpay (`razorpay`)
- Lemon Squeezy (`lemon_squeezy`)
- MoonClerk (`moonclerk`)
- Square (`square`), PayPal (`paypal`) can also use Composio as fallback where native/vault access is awkward.

### Accounting / invoicing / AR

- Zoho Invoice (`zoho_invoice`)
- Chaser (`chaser`)
- Clientary (`clientary`)
- Moneybird (`moneybird`)
- Sevdesk (`sevdesk`)
- Lexoffice (`lexoffice`)
- Quaderno (`quaderno`)
- Elorus (`elorus`)
- Coupa (`coupa`)
- Odoo (`odoo`), NetSuite (`netsuite`) can be CRM/accounting depending on the client stack.

### CRM / sales / field-service systems

- Pipedrive (`pipedrive`) — proven active via Composio on the RRD sandbox.
- Capsule CRM (`capsule_crm`)
- Close (`close`)
- Attio (`attio`)
- Nutshell (`nutshell`)
- Salesflare (`salesflare`)
- Salesmate (`salesmate`)
- Kommo (`kommo`)
- noCRM.io (`nocrm_io`)
- ActiveCampaign (`active_campaign`)
- Dynamics 365 (`dynamics365`)
- Odoo (`odoo`)
- NetSuite (`netsuite`)
- RepairShopr (`repairshopr`)
- AccuLynx (`acculynx`)
- ServiceM8 (`servicem8`)

Operator burden is usually light: I can discover the Composio toolkit, create the auth config/connect link, run read-only smoke tests, and document the mapping. Human/client input is still needed for provider login/authorization, sometimes a provider subdomain or tenant id, and occasionally one-time custom OAuth app setup when Composio does not provide managed credentials (as happened with Pipedrive).

## Expansion stance

For platforms not already supported directly, use Composio to quickly test whether we can get read-only access to the needed objects. RRD still owns:

- client consent and readiness;
- mapping/client approval;
- recovery policy and guardrails;
- do-not-contact/VIP/dispute/payment-plan flags;
- approval-gated sending;
- audit logs and offboarding.

Composio should be treated as an integration access layer, not the recovery decision system.
