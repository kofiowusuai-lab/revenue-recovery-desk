# Sales payment-link operations

Use this when the operator asks for a Stripe payment link for Revenue Recovery Desk / Flow Audit sales while on a client call.

## Defaults and terminology
- Use **retainer**, not **subscription**, in client-facing product names, descriptions, summaries, and Telegram replies.
- Treat the setup fee as the amount due today.
- Treat the agreed ongoing amount as a **retainer billed every 4 weeks**, not monthly, unless the operator explicitly says otherwise.
- If the operator says "monthly terms" in this sales context, clarify only if needed; the current default is: setup fee now, retainer every 4 weeks after the first month of service.

## One-card setup + later retainer pattern
The operator wants the client to enter card details once, pay setup now, and have the same card used later for the retainer.

Stripe Payment Links display delayed recurring line items as trial/free periods. Avoid that for this workflow.

Preferred implementation:
1. Create a setup/authorization checkout link with the setup price as the only checkout line item. Product name and description should state neutral payment terms only, not status/future-tense wording. Use e.g. `Client — Revenue Recovery Desk Setup + Retainer Authorization` and `Payment terms: $Y setup fee; $X Revenue Recovery Desk retainer billed every 4 weeks after the first month of service. Card saved for future retainer billing.` Always include the retainer amount in the visible description for transparency. Do not say `setup paid now`, `about to be paid`, `trial`, or `free` in the client-facing copy.
2. Set `payment_intent_data[setup_future_usage]=off_session` so Stripe saves the card for later off-session billing.
3. Create a separate recurring retainer Price with `recurring[interval]=week` and `recurring[interval_count]=4`.
4. Register the setup Payment Link + retainer Price with the local automation:
   `/Users/AIAgenterminal/rrd-sales-retainer.mjs register <payment_link_id> <retainer_price_id> "<client>" <setup_amount> <retainer_amount>`
5. The cron job `RRD Sales Retainer Auto-Start Watcher` runs `scripts/rrd-sales-retainer-watch.sh` every 10 minutes. It polls paid Checkout Sessions for registered setup links, retrieves the saved payment method, sets it as the customer default, and creates the retainer subscription with `billing_cycle_anchor = setup checkout time + 28 days` and `proration_behavior=none`.
6. Do **not** include the retainer recurring price as a delayed line item in the Payment Link if it causes Stripe to show "trial" or "free" wording.
7. Deactivate any incorrect prior Payment Links before giving the corrected link.

## Reply shape
Keep replies concise and sales-call ready:
- Lead with the live payment URL.
- State neutral payment terms only: setup fee amount, card saved for future retainer billing, retainer amount, and 4-week cadence after the first month of service.
- Do not write status/future-tense phrases like "setup paid now", "about to be paid", or "will be paid" in client-facing descriptions or operator summaries.
- List Stripe IDs only after the URL/terms.
- Never print Stripe API keys or secret values.

Example wording:

"New Acron LTD link: <url>\n\nTerms: $3,500 setup fee; card saved for future retainer billing; $3,000 Revenue Recovery Desk retainer billed every 4 weeks after the first month of service."

## Pitfalls
- Do not call the recurring charge a "subscription" unless the operator explicitly requests that wording.
- Do not create a visible 28-day trial/free checkout when the business meaning is "setup covers the first month, then the retainer begins." The client should not see trial/free language.
- If a wrong link was already created, deactivate it and create a replacement rather than trying to explain around it.
