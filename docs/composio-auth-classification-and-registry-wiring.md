# Composio auth classification + RRD registry wiring

Use this when expanding the RRD onboarding/integration list with Composio-backed platforms.

## Always probe before promising credential burden

Run the Composio toolkit probe and classify each toolkit by the auth fields Composio reports. Do not infer from provider familiarity.

```bash
/Users/AIAgenterminal/.hermes/hermes-agent/venv/bin/python \
  /Users/AIAgenterminal/.hermes/profiles/recoverydesk/skills/recovery-desk/scripts/composio-toolkit-probe.py
```

If the probe reports `OAUTH2: client_id, client_secret`, the operator likely needs a reusable/custom provider app credential before RRD can generate the managed connection. If the probe reports `managed/none listed by Composio`, RRD can usually proceed to client login/auth + smoke test without the operator first creating a provider OAuth app.

## Snapshot from the platform-expansion batch

Composio reported custom `client_id` + `client_secret` for several providers, but the RRD launch rule is now: **if a provider has a native per-client API key/token/client-credentials route, prefer the secure vault over Composio OAuth**. That avoids reusable app setup while keeping secrets out of chat.

### Prefer native API / secure vault

- Whop — `WHOP_API_KEY`

- Maxio — `MAXIO_SUBDOMAIN`, `MAXIO_API_KEY`
- Paystack — `PAYSTACK_SECRET_KEY`
- Razorpay — `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
- Lemon Squeezy — `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`
- MoonClerk — `MOONCLERK_API_KEY`
- Clientary — `CLIENTARY_API_KEY`
- Moneybird — `MONEYBIRD_ACCESS_TOKEN`, `MONEYBIRD_ADMINISTRATION_ID`
- Sevdesk — `SEVDESK_API_TOKEN`
- Lexoffice — `LEXOFFICE_API_KEY`
- Quaderno — `QUADERNO_API_KEY`, `QUADERNO_PRIVATE_KEY`
- Elorus — `ELORUS_API_KEY`
- Coupa — `COUPA_BASE_URL`, `COUPA_CLIENT_ID`, `COUPA_CLIENT_SECRET` (tenant/client-credentials style; still collected through the vault)
- Odoo — `ODOO_BASE_URL`, `ODOO_DATABASE`, `ODOO_USERNAME`, `ODOO_API_KEY`
- Capsule CRM — `CAPSULE_ACCESS_TOKEN`
- Attio — `ATTIO_API_KEY`
- Kommo — `KOMMO_BASE_URL`, `KOMMO_ACCESS_TOKEN`
- Nutshell — `NUTSHELL_USER_EMAIL`, `NUTSHELL_API_KEY`
- Salesflare — `SALESFLARE_API_KEY`
- Salesmate — `SALESMATE_DOMAIN`, `SALESMATE_ACCESS_KEY`, `SALESMATE_SESSION_TOKEN`
- noCRM.io — `NOCRM_SUBDOMAIN`, `NOCRM_API_KEY`
- ActiveCampaign — `ACTIVECAMPAIGN_API_URL`, `ACTIVECAMPAIGN_API_KEY`
- RepairShopr — `REPAIRSHOPR_SUBDOMAIN`, `REPAIRSHOPR_API_TOKEN`

### Keep as OAuth / Composio-style connection, not pasted API key

- Shopify — OAuth/Composio route preferred so clients do not need to create a custom Shopify app first. Composio reports Shopify as OAuth2 with `client_id` + `client_secret`, so the operator still needs reusable Shopify app credentials before managed client authorizations work.
- Zoho Invoice — OAuth-first; prefer existing Zoho Books OAuth where the client uses Zoho Books/Invoice together.
- Dynamics 365 — Microsoft/Entra OAuth route.
- ServiceM8 — OAuth route.
- Chaser — leave Composio-managed until a stable native client API-token path is confirmed.
- AccuLynx — leave Composio-managed/partner route until a stable client API-token path is confirmed.

This classification is a probe result plus public-doc/API-route review, not a permanent API guarantee. Re-run/probe before important client setup and smoke-test every new provider on a real/sandbox client account before marking operational readiness.

## Direct RRD OAuth app credentials still needed

These direct RRD OAuth providers use operator app credentials even if they also appear in onboarding:

- Zoho Books: `ZOHOBOOKS_OAUTH_CLIENT_ID`, `ZOHOBOOKS_OAUTH_CLIENT_SECRET`
- FreeAgent: `FREEAGENT_OAUTH_CLIENT_ID`, `FREEAGENT_OAUTH_CLIENT_SECRET`
- monday.com: `MONDAY_OAUTH_CLIENT_ID`, `MONDAY_OAUTH_CLIENT_SECRET`
- GoHighLevel: `GOHIGHLEVEL_OAUTH_CLIENT_ID`, `GOHIGHLEVEL_OAUTH_CLIENT_SECRET`

## Registry wiring checklist

When adding an onboarding option, do not stop at making the label visible in HTML. Also verify:

1. `rrd-oauth.mjs` has a provider only if RRD directly owns the OAuth exchange.
2. `rrd-hermes.mjs` `INTEGRATIONS` maps the display label to either `auth:"oauth"` with the right provider or `auth:"apikey"` with exact vault keys.
3. `revenue-recovery-web/desk.html` mirrors the `INTEGRATIONS` registry so the dashboard shows the same access path.
4. `revenue-recovery-web/vault.html` does not list stale API-key prompts for platforms that are now OAuth-first.
5. Tests cover `envKeysFor()` and `oauthConnectionsFor()` for the new option, not just a string/option presence check.
6. Run focused tests:

```bash
node --test /Users/AIAgenterminal/test/rrd-onboarding-form.test.mjs \
  /Users/AIAgenterminal/test/rrd-oauth.test.mjs \
  /Users/AIAgenterminal/test/rrd-hermes-integrations.test.mjs
node --check /Users/AIAgenterminal/rrd-hermes.mjs
node --check /Users/AIAgenterminal/rrd-oauth.mjs
```

## Known pitfall from review

A prior batch made `monday.com` selectable in onboarding and had a monday OAuth provider, but forgot the `rrd-hermes.mjs` registry entry, so `oauthConnectionsFor()` returned `[]`. GoHighLevel had the opposite mismatch: OAuth existed but the registry/vault still treated it as `GHL_API_KEY`. Code review caught both. Future reviews should explicitly test onboarding-label → registry → vault/OAuth routing end to end.
