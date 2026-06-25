# FlowAudit Default Recovery SOP

Use this when a client has no documented credit-control / collections / recovery SOP, or when they ask FlowAudit to build one. This is the baseline; tailor it to the client's industry, tone, payment terms, approval routing, discount cap, and escalation rules before go-live.

## Non-negotiables

- No customer contact happens without the client-authorized approval model and guardrails.
- Every email/SMS/letter must reference a real overdue invoice or balance from the connected accounting/payment/CRM system.
- Stop immediately and escalate when a customer replies, disputes, claims hardship, asks to stop, says they paid, or requests a human.
- Never threaten, misrepresent legal status, add fees, offer discounts, or change payment terms unless the client explicitly authorized it.
- Only send during the client's approved business hours/timezone.
- Log every draft, approval, send, reply, dispute, payment-link click/payment signal where available, and final outcome.

## Default cadence

### Stage 0 — Pre-flight before first contact

- Confirm invoice/customer identity, amount due, due date, currency, and payment route.
- Check for recent replies, disputes, partial payments, promised payment dates, do-not-contact flags, and internal notes.
- If Stripe/another payment platform provides a hosted invoice/payment URL, include it in the draft.
- If no safe payment link exists, ask the approver whether to send one or request manual payment instructions.

### Stage 1 — Friendly reminder

Trigger: 1–3 days overdue, or first recovery contact if the invoice is lightly overdue.

- Tone: helpful, low-friction, relationship-preserving.
- Message: remind them of the invoice, amount, due date, and secure payment link if available.
- CTA: pay now or reply if already paid / if anything is wrong.

### Stage 2 — Follow-up

Trigger: about 7 days overdue or 5–7 days after Stage 1 with no reply/payment.

- Tone: polite but clearer.
- Message: invoice remains outstanding; ask for payment date if they cannot pay immediately.
- CTA: pay via link or confirm payment plan/date.

### Stage 3 — Firm notice

Trigger: about 14 days overdue or no response after Stage 2.

- Tone: firm, professional, still non-threatening.
- Message: balance is overdue and needs attention; remind them of contract/payment terms if known.
- CTA: pay now, provide remittance, or reply with a dispute/payment-plan request.

### Stage 4 — Pre-escalation

Trigger: about 21–30 days overdue or no response after Stage 3.

- Tone: firm and direct.
- Message: state that the account may be escalated internally if not resolved.
- CTA: pay or contact within a defined window.
- Requires explicit human approval unless the client has pre-authorized this stage.

### Stage 5 — Final notice / formal demand

Trigger: about 45–60+ days overdue, high-value balances, or repeated non-response.

- Tone: formal, factual, non-abusive.
- Message: final opportunity to resolve before the client decides next action.
- CTA: payment, dispute details, or agreed plan.
- Always human-approved. Physical letters/certified mail are approval-gated and cost-gated.

### Stage 6 — Handback / legal-collections decision

Trigger: about 90+ days overdue, dispute, insolvency signal, hardship, refusal, or client-defined threshold.

- Stop automated recovery.
- Package audit trail, invoice data, contact history, replies, and recommended next step for the client.
- Client decides whether to write off, hold, negotiate, collections, or legal.

## Default settlement/payment-plan rule

- Payment plans up to 3 monthly instalments may be drafted only if the client allows payment plans.
- Discounts require explicit client approval and must stay under the stored cap.
- Never imply a discount, waiver, fee, legal consequence, or credit reporting action unless expressly authorized.

## Default copy requirements

Every recovery message should include:

- Client/company name.
- Invoice number/reference.
- Amount due and currency.
- Due date or days overdue where appropriate.
- Clear CTA.
- Secure payment link if available and approved.
- Human reply path for disputes, payment confirmations, or questions.

## Payment-link handling

If the client has a Stripe API connection and the overdue item is a Stripe invoice with `hosted_invoice_url`, use that hosted invoice URL as the payment link. It points to the invoice's current amount remaining, so the email can directly ask for the overdue amount.

If the invoice lacks a hosted URL, generating/finalizing one may require Stripe write permission. If the overdue balance comes from CRM/accounting only and no Stripe invoice exists, creating a fresh Stripe Payment Link for the exact amount is a separate write action and must be explicitly authorized by the client/operator before use.
