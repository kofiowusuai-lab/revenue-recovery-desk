# Zoho Books, FreeAgent, and Authorize.net connector stance

Use this after the connector batch that added Zoho Books and FreeAgent OAuth and confirmed Authorize.net vault support.

## Zoho Books

Treat Zoho Books as an OAuth accounting/invoicing connector. Keep it distinct from Zoho CRM at the provider/profile-token layer so a Zoho CRM authorization cannot accidentally satisfy Zoho Books readiness.

- Client link: `rrd-vault connect <submission-id> zohobooks`
- Operator app credentials:
  - `ZOHOBOOKS_OAUTH_CLIENT_ID`
  - `ZOHOBOOKS_OAUTH_CLIENT_SECRET`
- App reuse stance: Zoho Books uses Zoho Accounts OAuth, the same OAuth platform family as Zoho CRM. If the existing Zoho CRM app is a suitable server-based app with the RRD callback URL registered and Zoho Books scopes allowed, the same client id/secret can be installed into the `ZOHOBOOKS_*` env names. Prefer a separate Zoho Books app only if the existing CRM app cannot request Books scopes, has the wrong redirect URI/data-center setup, or we want cleaner app naming/consent separation.
- Client profile token keys written after approval:
  - `ZOHOBOOKS_ACCESS_TOKEN`
  - `ZOHOBOOKS_REFRESH_TOKEN`
  - `ZOHOBOOKS_TOKEN_EXPIRES_AT`
  - `ZOHOBOOKS_API_DOMAIN`
- Authorize URL: `https://accounts.zoho.com/oauth/v2/auth`
- Token URL: data-center aware via the Zoho accounts server callback; default `https://accounts.zoho.com/oauth/v2/token`
- Scopes:
  - `ZohoBooks.invoices.READ`
  - `ZohoBooks.contacts.READ`
  - `ZohoBooks.settings.READ`
- Extra auth params: `access_type=offline`, `prompt=consent`
- Public docs to monitor:
  - Zoho Accounts OAuth: `https://www.zoho.com/accounts/protocol/oauth.html`
  - Zoho Books API OAuth: `https://www.zoho.com/books/api/v3/oauth/`
  - Zoho Books API introduction/data centers: `https://www.zoho.com/books/api/v3/introduction/`

## FreeAgent

Treat FreeAgent as an OAuth accounting/invoicing connector.

- Client link: `rrd-vault connect <submission-id> freeagent`
- Operator app credentials:
  - `FREEAGENT_OAUTH_CLIENT_ID`
  - `FREEAGENT_OAUTH_CLIENT_SECRET`
- Client profile token keys written after approval:
  - `FREEAGENT_ACCESS_TOKEN`
  - `FREEAGENT_REFRESH_TOKEN`
  - `FREEAGENT_TOKEN_EXPIRES_AT`
- Authorize URL: `https://api.freeagent.com/v2/approve_app`
- Token URL: `https://api.freeagent.com/v2/token_endpoint`
- Token exchange uses HTTP Basic auth with client id/secret.
- Public docs to monitor:
  - FreeAgent API documentation: `https://dev.freeagent.com/docs`
  - FreeAgent OAuth documentation: `https://dev.freeagent.com/docs/oauth`

## Authorize.net

Authorize.net is a secure vault/API-key payment connector for launch, not OAuth.

- Vault link: `rrd-vault new <submission-id>`
- Required client keys:
  - `AUTHNET_API_LOGIN_ID`
  - `AUTHNET_TRANSACTION_KEY`
- Public docs to monitor:
  - Authorize.net API reference: `https://developer.authorize.net/api/reference/index.html`

Do not ask for an Authorize.net username/password.

## Mapping / readiness

These connectors only establish access. Client mapping still controls operational readiness. Before recovery, get/approve:

- where invoices/open receivables live;
- how overdue/open status is identified;
- customer/contact email fields;
- balance/due date/status fields;
- hosted invoice/payment URL behavior;
- dispute, payment-plan, do-not-contact, VIP/sensitive flags.

The client can provide field names, screenshots, report names, or Loom walkthroughs. Do not ask them to email credentials or sensitive exports.
