# Sage OAuth setup for Revenue Recovery Desk

Use when adding or troubleshooting Sage accounting access for a client.

## Launch stance

Sage is treated as an OAuth accounting connector for launch, not a pasted API-key/vault connector.

Important distinction: the RRD code can support `rrd-vault connect <submission-id> sage`, but that does **not** remove the need to create/configure a Sage developer OAuth app once. The app supplies the platform-level `SAGE_OAUTH_CLIENT_ID` / `SAGE_OAUTH_CLIENT_SECRET`; each client then authorizes their own Sage account through the connect link.

- Client link: `rrd-vault connect <submission-id> sage`
- Operator app credentials: `SAGE_OAUTH_CLIENT_ID` and `SAGE_OAUTH_CLIENT_SECRET` in the operator connector environment (`/Users/AIAgenterminal/.openclaw/.env`, never chat)
- Client profile token keys written after approve:
  - `SAGE_ACCESS_TOKEN`
  - `SAGE_REFRESH_TOKEN`
  - `SAGE_TOKEN_EXPIRES_AT`

The current RRD provider uses Sage Accounting OAuth. Create the platform OAuth client in Sage's Accounting developer self-service portal, **not** the generic 4-option Sage product picker:

- App registration/login: `https://developerselfservice.sageone.com/`
- Docs: `https://developer.sage.com/accounting/docs/v1.0.0/guides/learning/getting-started/client_app_registration/`
- Authorize URL: `https://www.sageone.com/oauth2/auth/central`
- Token URL: `https://oauth.accounting.sage.com/token`
- Scope: `full_access`
- Extra auth parameter: `filter=apiv3.1`

Sage exposes broad access rather than granular read-only scopes, so keep recovery behavior read-only through RRD policy/guardrails until an explicit write action is approved.

## Developer portal note

The Sage developer console may ask you to choose a product/API. The user screenshot showed the Sage API picker with options including:

- Sage Operations / X3 SaaS
- Sage 200 Spain Essential
- Sage 200 Spain Professional
- Sage Intacct

If Sage's generic developer "Create app" flow shows only the four-product picker (Sage Operations / X3 SaaS, Sage 200 Spain Essential, Sage 200 Spain Professional, Sage Intacct), that is the wrong place for standard Sage Accounting. Do **not** choose one as a workaround unless the client actually uses that product. Use `https://developerselfservice.sageone.com/` for Sage Accounting app registration.

If the target client is specifically on Sage Intacct or Sage 200, choose the matching API in the Sage portal and confirm field/API behavior before live recovery. The RRD `sage` connector is the generic OAuth/token plumbing; operational readiness still depends on mapping the client’s actual Sage product and fields.

## Common pitfall: connector code vs OAuth app

If the user asks “so no need to make an OAuth app?”, answer clearly: **an OAuth app is still required once**. The connector implementation only teaches RRD how to generate Sage links, exchange authorization codes, and store tokens. Sage still requires an app/client in the developer portal so the generated connect URL has a valid `client_id` and the callback exchange has a valid client secret.

Use this wording:

> Yes, make the Sage OAuth app once. Each client then authorizes their own Sage account through our connect link.

## Local installer for app credentials

When the operator has the Sage Accounting app's client ID/secret, do **not** ask them to paste secrets into chat. Open the local installer page instead:

```bash
node /Users/AIAgenterminal/rrd-sage-oauth-install.mjs
```

It serves a one-time localhost form on `127.0.0.1:8797` and writes these keys to `/Users/AIAgenterminal/.openclaw/.env`:

- `SAGE_OAUTH_CLIENT_ID`
- `SAGE_OAUTH_CLIENT_SECRET`

After submission, verify only that the keys are present; never print the values.

## Field mapping required before go-live

After OAuth approval, treat Sage as connected but not operational until mapping is confirmed:

- invoice/source object or report
- invoice number/reference
- customer/contact relationship
- amount due / balance remaining / currency
- invoice date / due date / status
- payment link or hosted invoice URL if present
- credit notes, partial payments, write-offs
- dispute / payment-plan / do-not-contact / VIP flags

Do not ask for Sage usernames or passwords. Clients authorize on Sage’s own screen via the one-time connect link.
