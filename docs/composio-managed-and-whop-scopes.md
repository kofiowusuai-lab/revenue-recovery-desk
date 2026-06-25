# Composio-managed connectors and Whop permission justifications

Use this when expanding RRD connector coverage through Composio and when setting up the Whop developer app.

## Composio-managed vs native OAuth vs vault

When Composio reports `managed/none listed by Composio`, classify the platform as a Composio-managed authorization rather than a native RRD OAuth app or client-pasted vault secret.

Recommended manifest shape from the 2026-06 connector batch:

- `envKeysNeeded`: client-pasted API-key/vault secrets only.
- `oauthConnectionsNeeded`: native RRD OAuth connect flows only.
- `composioConnectionsNeeded`: Composio-managed authorizations.
- `composioEnvKeysNeeded`: local connected-account id placeholders, e.g. `COMPOSIO_MAXIO_CONNECTED_ACCOUNT_ID`.

For readiness, check the Composio connected-account id presence separately from API keys and native OAuth token env names. Do not ask the client to paste Composio tokens or provider passwords into the vault.

## No-custom-app Composio providers wired in the batch

These were classified as Composio-managed because the live Composio probe reported no custom `client_id`/`client_secret` fields at that time:

- Maxio
- Paystack
- Lemon Squeezy
- MoonClerk
- Chaser
- Clientary
- Sevdesk
- Lexoffice
- Quaderno
- Elorus
- Odoo
- Nutshell
- Salesflare
- Salesmate
- noCRM.io
- ActiveCampaign
- RepairShopr
- AccuLynx

Re-run the Composio probe before high-stakes/client-specific setup because Composio auth requirements can change.

## Registry/update checklist

When adding a Composio-managed provider, update all of these together:

1. `rrd-hermes.mjs` `INTEGRATIONS` entry with `auth: "composio"` and the Composio toolkit slug in `provider`.
2. Manifest fields: `composioConnectionsNeeded` and `composioEnvKeysNeeded`.
3. `rrd-ready.mjs` readiness checks for each `COMPOSIO_*_CONNECTED_ACCOUNT_ID`.
4. `rrd-vault.mjs` output so Composio authorizations are explicitly reported as separate from the vault.
5. `hermes-provision.mjs` output so provisioning reports Composio-managed connections.
6. `rrd-welcome-pack.mjs` access email wording so clients are told they will authorize through a secure Composio link, not paste secrets.
7. Web/dashboard mirrors such as `revenue-recovery-web/desk.html`.
8. Tests for `envKeysFor`, `oauthConnectionsFor`, `composioConnectionsFor`, `composioEnvKeysFor`, and manifest output.

Focused verification used in the batch:

```bash
node --check /Users/AIAgenterminal/rrd-hermes.mjs \
  /Users/AIAgenterminal/rrd-ready.mjs \
  /Users/AIAgenterminal/rrd-vault.mjs \
  /Users/AIAgenterminal/hermes-provision.mjs \
  /Users/AIAgenterminal/rrd-welcome-pack.mjs

node --test /Users/AIAgenterminal/test/rrd-hermes-integrations.test.mjs \
  /Users/AIAgenterminal/test/rrd-onboarding-form.test.mjs \
  /Users/AIAgenterminal/test/rrd-oauth.test.mjs
```

## Whop app setup: recovery-oriented permission justifications

Whop app permissions require a human-readable justification. Keep the copy short, plain-English, and tied to revenue recovery. For write/money-moving permissions, explicitly mention client approval.

Use these justifications in this order when configuring the app:

### `access_pass:basic:read`

Needed to read the company’s access passes so the recovery agent can understand which products/customers relate to unpaid balances and avoid chasing the wrong account.

### `company:basic:read`

Needed to identify the Whop company/account being connected, verify the correct business workspace, and tie invoice/payment recovery activity to the right company.

### `member:basic:read`

Needed to read basic member/customer records so unpaid invoices and payment activity can be matched to the correct customer before any recovery message is drafted.

### `member:email:read`

Needed to read member email addresses so approved recovery messages and payment reminders can be routed to the correct customer contact.

### `member:phone:read`

Needed to read member phone numbers only where the client has approved phone/SMS recovery, so the agent can match customer records and avoid contacting the wrong person.

### `member:payment_methods:read`

Needed to read customer payment method status for recovery/payment-plan workflows, so the agent can understand available payment options without exposing card details.

### `payment:basic:read`

Needed to read payments so the recovery agent can identify unpaid, failed, disputed, or partially paid transactions and avoid chasing already-paid customers.

### `invoice:basic:read`

Needed to read invoices so the recovery agent can find open/unpaid invoices, verify balances and due dates, and create accurate recovery drafts for approval.

### `invoice:create`

Needed to create invoices only when explicitly approved by the client, for recovery workflows such as payment plans, repayment schedules, or reissuing an unpaid balance.

### `invoice:update`

Needed to update invoices only with client approval, for recovery workflows such as adjusting payment-plan terms, updating invoice status, or correcting recovery-related invoice details.

### `payment:charge`

Needed to charge a customer only after explicit client approval, for agreed repayment plans or authorized collection of an outstanding balance through Whop.

### `payment:manage`

Needed to manage payments only for approved recovery actions such as generating payment collection flows, handling repayment-plan payments, and reconciling payment status.

### `payment:dispute`

Needed to manage payment disputes where relevant to recovery, so disputed unpaid balances can be identified, escalated, and handled according to the client’s approved policy.

### `member:manage`

Needed to manage member records only when required for approved recovery workflows, such as updating recovery status, account notes, or payment-plan related membership handling.

### `member:payment_methods:manage`

Needed to manage member payment methods only when explicitly approved, for payment-plan setup or authorized repayment collection without asking customers to send card details insecurely.

### `company:update`

Needed to update company settings only if required to configure the recovery integration, such as approved payment/recovery settings for the connected Whop company.

## Guardrail stance for Whop write scopes

It is acceptable to request write/money-moving Whop scopes when the client uses Whop for payments and RRD needs to support payment links, payment plans, or authorized collections. However, in RRD these actions remain high-risk and must stay behind explicit client/operator approval and executor guardrails. Do not treat app-level write permission as permission to auto-charge, auto-update invoices, or alter members without policy approval.
