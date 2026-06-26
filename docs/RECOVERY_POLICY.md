# Revenue Recovery Desk Recovery Policy

Reference: `docs/COMPLETION_BRIEF.md`.

## Recovery principles

- B2B-first unless legal review approves broader use.
- Be factual, polite, and proportionate.
- Use client-approved tone, channels, timing, payment-plan limits, discount limits, and escalation rules.
- Never invent invoice facts, balances, due dates, contacts, or payment links.

## Stage model

Thread stages should remain within the brief's recovery model:

- `preflight`
- `friendly_reminder`
- `follow_up`
- `firm_notice`
- `pre_escalation`
- `final_notice`
- `handback`

## Mandatory stops

Stop, pause, block, or escalate before any further contact when there is:

- Payment detected.
- Customer reply requiring review.
- Stop-contact request.
- Dispute.
- Hardship signal.
- Angry or legal-risk reply.
- Wrong-person signal.
- Do-not-contact record.
- Missing consent or unauthorized channel.
- Guardrail block or ambiguous integration data.

## Send path

All outbound recovery actions must follow this path:

1. Create or update a recovery action record.
2. Run `rrd-recover` gate.
3. Send only with `rrd-recover send` / gated executor if allowed.
4. Store gate decision, provider result, audit event, and thread update.

No direct send is allowed from any agent, cron, browser workflow, portal route, or provider adapter.

## Escalation output

Escalations must include summary, invoice/customer/thread, risk reason, recommended human action, and a `Do not send more until reviewed` flag.
