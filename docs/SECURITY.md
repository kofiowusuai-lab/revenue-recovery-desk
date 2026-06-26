# Revenue Recovery Desk Security

Reference: `docs/COMPLETION_BRIEF.md` safety and compliance requirements.

## Non-negotiables

- No direct send from agents, cron jobs, portal routes, browser workflows, or provider adapters.
- Every customer-facing send must go through `rrd-recover` gate and `rrd-recover send` / gated executor.
- Do not print secrets. Do not log secret values. Do not expose OAuth tokens, API keys, vault payloads, or raw credentials.
- Do not bypass client approval or consent rules.

## Secrets and credentials

- Use vault links and OAuth helpers for credential collection.
- Store only secret references/status in normal app records.
- Logs may include provider name, integration status, and last check time; never include tokens or key material.
- Offboarding must revoke/delete provider access and record audit evidence.

## Customer-contact controls

Block or escalate when any condition is uncertain or unsafe:

- Consumer debt without legal review.
- Missing consent or unauthorized channel.
- Do-not-contact record.
- Stop request, dispute, hardship, angry reply, or wrong-person signal.
- Paid invoice or payment promise requiring pause.
- Unverified balance, due date, customer identity, or payment link.

## Audit requirements

Every send must persist:

- Recovery action record.
- Gate decision.
- Provider result from the gated executor.
- Audit event.
- Thread update.

## Admin controls

- Internal cron routes require a cron secret.
- Admin pages must show failed providers, blocked sends, escalations, job health, and report delivery state.
- Client isolation and RLS must be tested before production use.
