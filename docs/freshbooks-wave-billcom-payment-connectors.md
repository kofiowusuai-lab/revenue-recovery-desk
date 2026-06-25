# FreshBooks, Wave, Bill.com, PayPal, Square, Braintree, GoCardless connector stance

Use this when explaining or setting up the requested launch connectors.

## App vs vault decision

When the user asks “which do I need to make an app for?” answer directly:

- **Make OAuth apps for:** FreshBooks, Wave / Wave Invoicing.
- **Do not make RRD platform OAuth apps for launch:** PayPal, Square, Braintree, GoCardless, Bill.com. Those use client-supplied vault/API credentials.
- **Sage:** OAuth app was handled separately via Sage Accounting self-service.

## OAuth accounting connectors

### FreshBooks

Treat FreshBooks as an OAuth accounting/invoicing connector.

- Client link: `rrd-vault connect <submission-id> freshbooks`
- Operator app credentials:
  - `FRESHBOOKS_OAUTH_CLIENT_ID`
  - `FRESHBOOKS_OAUTH_CLIENT_SECRET`
- Client profile token keys written after approval:
  - `FRESHBOOKS_ACCESS_TOKEN`
  - `FRESHBOOKS_REFRESH_TOKEN`
  - `FRESHBOOKS_TOKEN_EXPIRES_AT`
- OAuth endpoints:
  - authorize: `https://auth.freshbooks.com/oauth/authorize/`
  - token: `https://api.freshbooks.com/auth/oauth/token`
- Requested read scopes:
  - `user:profile:read`
  - `user:clients:read`
  - `user:invoices:read`

FreshBooks token exchange expects JSON; the RRD OAuth helper handles that.

FreshBooks app setup notes:
- Use the FreshBooks developer/app management area (`https://www.freshbooks.com/#/developer`) and FreshBooks API authentication docs.
- Register callback: `https://revenue-recovery-web-ivory.vercel.app/oauth-callback`.
- If multiple callbacks are allowed, also add: `https://flowaudit.co.uk/revenue-recovery/oauth-callback`.

### Wave / Wave Invoicing

Treat Wave as an OAuth accounting/invoicing connector.

- Client link: `rrd-vault connect <submission-id> wave`
- Operator app credentials:
  - `WAVE_OAUTH_CLIENT_ID`
  - `WAVE_OAUTH_CLIENT_SECRET`
- Client profile token keys written after approval:
  - `WAVE_ACCESS_TOKEN`
  - `WAVE_REFRESH_TOKEN`
  - `WAVE_TOKEN_EXPIRES_AT`
- OAuth endpoints:
  - authorize: `https://api.waveapps.com/oauth2/authorize/`
  - token: `https://api.waveapps.com/oauth2/token/`
- Requested read scopes:
  - `business:read`
  - `customer:read`
  - `invoice:read`

Wave app setup notes:
- Use the Wave developer app portal/docs (`https://developer.waveapps.com/`).
- Register callback: `https://revenue-recovery-web-ivory.vercel.app/oauth-callback`.
- If multiple callbacks are allowed, also add: `https://flowaudit.co.uk/revenue-recovery/oauth-callback`.

## Local credential installation pattern

For operator-owned OAuth app credentials, do **not** ask the user to paste secrets into Telegram. Use a local-only installer page on `127.0.0.1` that writes to `/Users/AIAgenterminal/.openclaw/.env` and prints only installed key names, never values.

Session-proven installer:

```bash
node --check /Users/AIAgenterminal/rrd-freshbooks-wave-oauth-install.mjs
chmod 700 /Users/AIAgenterminal/rrd-freshbooks-wave-oauth-install.mjs
node /Users/AIAgenterminal/rrd-freshbooks-wave-oauth-install.mjs
```

It writes:

- `FRESHBOOKS_OAUTH_CLIENT_ID`
- `FRESHBOOKS_OAUTH_CLIENT_SECRET`
- `WAVE_OAUTH_CLIENT_ID`
- `WAVE_OAUTH_CLIENT_SECRET`

After the user submits the local page, verify presence without printing values, e.g. by loading the provider creds through `rrd-oauth.mjs` or by checking non-empty env keys.

## Vault/API-key connectors

These are launch vault connectors. Generate the client vault link with `rrd-vault new <submission-id>` and never ask for login passwords.

- PayPal: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`
- Square: `SQUARE_ACCESS_TOKEN`
- Braintree: `BRAINTREE_MERCHANT_ID`, `BRAINTREE_PRIVATE_KEY`
- GoCardless: `GOCARDLESS_ACCESS_TOKEN`
- Bill.com: `BILLCOM_API_KEY`

Bill.com can appear as either payment platform or accounting/invoicing system. For launch, both paths require `BILLCOM_API_KEY` via the secure vault.

## Operational caveat

Connection is not go-live by itself. For FreshBooks, Wave, and Bill.com, confirm field mapping before recovery:

- invoice source/object/report
- invoice number/reference
- customer/contact relationship
- amount due / balance / currency
- due date / status / paid status
- payment URL or hosted invoice URL if present
- dispute, payment plan, do-not-contact, VIP/sensitive flags
