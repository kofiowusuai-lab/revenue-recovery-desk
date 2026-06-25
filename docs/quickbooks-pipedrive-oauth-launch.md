# QuickBooks + Pipedrive OAuth launch wiring

Use this when deciding or verifying launch behavior for QuickBooks Online / Intuit and Pipedrive in Revenue Recovery Desk.

## Launch decision

For GTM, both are OAuth/connect-link providers, not manual-only loose ends:

- **QuickBooks Online / Intuit** — client-facing OAuth connect flow.
- **Pipedrive** — client-facing OAuth connect flow.
- **Close / GoHighLevel** — remain API-key/token vault integrations.
- **Stripe / Square / PayPal / Twilio / mail providers** — remain secure-vault/API-key integrations.

## QuickBooks / Intuit provider details

Developer app credentials live locally on the operator Mac, never in chat:

```text
INTUIT_OAUTH_CLIENT_ID
INTUIT_OAUTH_CLIENT_SECRET
QUICKBOOKS_OAUTH_CLIENT_ID
QUICKBOOKS_OAUTH_CLIENT_SECRET
INTUIT_CLIENT_ID
INTUIT_CLIENT_SECRET
QUICKBOOKS_CLIENT_ID
QUICKBOOKS_CLIENT_SECRET
```

OAuth provider wiring:

```text
authorizeUrl: https://appcenter.intuit.com/connect/oauth2
tokenUrl:     https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer
scope:        com.intuit.quickbooks.accounting
```

Token profile env keys:

```text
QUICKBOOKS_ACCESS_TOKEN
QUICKBOOKS_REFRESH_TOKEN
QUICKBOOKS_TOKEN_EXPIRES_AT
QUICKBOOKS_REALM_ID
```

Important Intuit caveat: `com.intuit.quickbooks.accounting` is broad at OAuth scope level. Keep runtime behavior read-only through RRD policy/guardrails until write actions are explicitly needed and approved.

Callback behavior: Intuit returns `realmId`; the callback page must preserve it into the sealed OAuth payload so `approve <drop-id>` can write `QUICKBOOKS_REALM_ID`.

## Pipedrive provider details

Developer app credentials live locally on the operator Mac:

```text
PIPEDRIVE_OAUTH_CLIENT_ID
PIPEDRIVE_OAUTH_CLIENT_SECRET
PIPEDRIVE_CLIENT_ID
PIPEDRIVE_CLIENT_SECRET
```

OAuth provider wiring:

```text
authorizeUrl: https://oauth.pipedrive.com/oauth/authorize
tokenUrl:     https://oauth.pipedrive.com/oauth/token
```

Do not send a `scope` parameter in the Pipedrive authorize URL. Pipedrive permissions are controlled by app settings in the Pipedrive developer UI. For launch, configure the app for read-only/discovery-style access: basic info, deals, contacts, activities, users, and custom deal/contact fields as needed. Avoid admin/mail/messaging/write scopes unless a client use case requires them.

Token profile env keys:

```text
PIPEDRIVE_ACCESS_TOKEN
PIPEDRIVE_REFRESH_TOKEN
PIPEDRIVE_TOKEN_EXPIRES_AT
PIPEDRIVE_API_DOMAIN
```

## RRD code expectations

`rrd-vault connect <submission-id> quickbooks` and `rrd-vault connect <submission-id> pipedrive` should both work after app credentials are installed locally.

`rrd-hermes.mjs` integration classification should treat:

```text
paymentStack.accounting = "QuickBooks Online" => OAuth connection "QuickBooks Online"
crm = "Pipedrive"                         => OAuth connection "Pipedrive"
```

The secure vault should no longer ask for `PIPEDRIVE_API_TOKEN` for Pipedrive clients when OAuth is available.

## Verification commands

Run focused checks after changing this area:

```bash
node --check /Users/AIAgenterminal/rrd-oauth.mjs
node --check /Users/AIAgenterminal/rrd-vault.mjs
node --test /Users/AIAgenterminal/test/rrd-oauth.test.mjs /Users/AIAgenterminal/test/rrd-hermes-integrations.test.mjs
```

A quick app-credential/authorize URL sanity check should confirm:

```text
quickbooks: creds present; authorize=https://appcenter.intuit.com/connect/oauth2; envKeys include QUICKBOOKS_REALM_ID; hasScope=true
pipedrive:  creds present; authorize=https://oauth.pipedrive.com/oauth/authorize; envKeys include PIPEDRIVE_API_DOMAIN; hasScope=false
```
