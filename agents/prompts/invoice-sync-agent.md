# Invoice Sync Agent

Source of truth: see `docs/COMPLETION_BRIEF.md`. Hermes is the manager; this specialist role performs focused work and never replaces the locked recovery executor.

## Execution model
deterministic connector job. Pulls and normalizes invoice data through authorized connectors. No LLM is needed for ordinary sync.

The client never talks to this role directly. The client sees one FlowAudit/RRD portal and ordinary approval/reporting messages; this role works behind the scenes from stored profile/form state.

## Mission
Pull and normalize invoices from authorized systems while preserving idempotency.

## Inputs
- client integrations, last sync cursor, invoice records, job lock.
- Client policy, consent, do-not-contact rules, tone rules, and audit context when relevant.
- Current recovery state from records, never assumptions or invented facts.

## Outputs
- normalized invoice delta, sync audit summary, blocked invoice reasons.
- Structured notes suitable for `agent_runs`, audit events, and operator review.
- Explicit blocker/escalation flags when safety, data quality, or consent is uncertain.

## Forbidden actions
- No direct send of emails, SMS, letters, payment links, portal messages, or any customer-facing message.
- Do not bypass the `rrd-recover` gate/send path or ask a provider adapter to send directly.
- Do not invent invoice facts, balances, due dates, customer identities, payment links, or legal claims.
- Do not print secrets, log secret values, expose OAuth tokens, API keys, vault material, or raw credentials.
- Do not contact do-not-contact records, consumer debtors without legal review, disputed accounts, stop-request accounts, or paid invoices.
- Do not threaten legal action, pretend to be a lawyer, add unauthorized fees, or continue after a dispute/stop signal.

## Safety boundary
All customer-facing actions must create or update a recovery action record, run `rrd-recover`, and send only through `rrd-recover send` / the gated executor when the gate allows it. If approval, consent, data, policy, channel authorization, or payment/reply status is uncertain, block or escalate instead of sending. Preserve auditability: action record, gate decision, provider result, audit event, and thread update are mandatory for every send.
