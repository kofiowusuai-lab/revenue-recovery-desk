# Revenue Recovery Desk sales payment links

Use this when the operator asks for a Stripe payment link for Revenue Recovery Desk / Flow Audit sales.

## Purpose

Create fast live Stripe Payment Links during sales calls, using the Flow Audit Stripe account configured for the `recoverydesk` profile. Never print or expose API key values.

For the setup + ongoing Revenue Recovery Desk sales pattern, prefer `references/sales-payment-link-ops.md`; this file covers the general helper and simple one-time links.

## Key path and helper

- Stripe keys live in the recoverydesk profile env as:
  - `FLOW_AUDIT_STRIPE_PUBLISHABLE_KEY`
  - `FLOW_AUDIT_STRIPE_SECRET_KEY`
- Helper script:
  - `/Users/AIAgenterminal/rrd-payment-link`
- The helper creates Stripe Products, Prices, and Payment Links and prints only the URL and non-secret Stripe IDs.
- Sales retainer automation:
  - `/Users/AIAgenterminal/rrd-sales-retainer.mjs`
  - cron job `RRD Sales Retainer Auto-Start Watcher`

## Simple one-time link

When the user asks for a one-time setup/payment link:

```bash
/Users/AIAgenterminal/rrd-payment-link \
  --amount 3500 \
  --currency usd \
  --name "Acron LTD — Revenue Recovery Desk Setup Fee" \
  --description "One-time setup fee for Revenue Recovery Desk onboarding and implementation." \
  --metadata client="Acron LTD" \
  --metadata type=setup_fee
```

Report only:
- payment link URL,
- amount/currency,
- whether live mode,
- non-secret IDs if useful.

## Setup + ongoing retainer default

For Revenue Recovery Desk sales, the operator's default model is:

- setup fee at checkout,
- card saved for future off-session billing,
- agreed retainer amount billed every 4 weeks after the first month of service,
- no client-facing `trial`, `free`, or `subscription` wording.

Do **not** include a delayed recurring line item in a Stripe Payment Link if it creates `trial`/`free` wording. Instead:

1. Create a setup/authorization Payment Link with only the setup-fee line item.
2. Set `payment_intent_data[setup_future_usage]=off_session`.
3. Create/reuse a separate recurring retainer Price with `recurring[interval]=week` and `recurring[interval_count]=4`.
4. Register the Payment Link + retainer Price with:

```bash
/Users/AIAgenterminal/rrd-sales-retainer.mjs register <payment_link_id> <retainer_price_id> "<client>" <setup_amount> <retainer_amount>
```

The watcher polls paid setup checkout sessions and creates the retainer subscription with the first billing anchor at checkout + 28 days.

## Client-facing wording rules

Use neutral payment terms. Good:

```text
Payment terms: $3,500 setup fee; $3,000 Revenue Recovery Desk retainer billed every 4 weeks after the first month of service. Card saved for future retainer billing.
```

Avoid:
- `setup paid now` before the payment has happened,
- `about to be paid`,
- `28 days free`,
- `trial`,
- `subscription` for the recurring Revenue Recovery Desk charge.

## Replacing a bad link

If wording, cadence, timing, or line items are wrong, deactivate the old Payment Link before sharing a replacement:

```bash
POST /v1/payment_links/<plink_id> active=false
```

Then create the replacement and register the active link with the retainer watcher if applicable.

## Safety rules

- Do not print Stripe secret/publishable keys.
- Confirm and include the currency the user requested; default to USD only when the user used `$` or explicitly says dollars.
- Use live mode deliberately for sales links; report `livemode: true` in the summary when useful.
- If replacing a bad link, state that the old link was deactivated and provide the new URL.
- Keep the final response short and sales-call friendly: URL first, then neutral terms, then non-secret Stripe IDs.
