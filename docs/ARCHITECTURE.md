# Revenue Recovery Desk Architecture

This document is a concise operating architecture for the completion foundation. The canonical scope and safety rules remain in `docs/COMPLETION_BRIEF.md`.

## Core model

- Hermes is the manager and orchestrator, not a monolithic worker.
- Specialist agent roles live in `agents/prompts/` and perform bounded tasks: onboarding, provisioning, integration, mapping, invoice sync, contact match, recovery planning, drafting, approval, dispatch, reply triage, payment reconciliation, escalation, client success, health watch, and compliance QA.
- Workflow mapping lives in `agents/workflows/cron-role-manifest.json`.
- Cron/internal jobs advance state idempotently and record `agent_runs`.
- `rrd-recover` remains the locked gate for every outbound customer-facing action.

## State flow

1. Client submits onboarding.
2. Hermes routes validation, provisioning, integration, mapping, and readiness tasks to specialists.
3. Invoice sync and contact match normalize recovery candidates.
4. Recovery planner proposes next safe stages.
5. Message drafting creates drafts only.
6. Compliance QA and approval flow prepare reviewable batches.
7. Dispatch agent rechecks state and invokes `rrd-recover` then `rrd-recover send` only when allowed.
8. Reply triage and payment reconciliation stop or close work when replies/payments arrive.
9. Client success reports wins, blockers, and ROI.

## Safety invariant

No agent, cron job, browser workflow, portal route, or adapter may send directly. Sends require an action record, gate decision, gated provider result, audit event, and thread update.

## Data boundaries

- Secrets are stored through the vault/OAuth helpers only.
- Agents may reference secret presence/status, but must not print secrets or log secret values.
- Client data must remain isolated by client id and audited on every state transition.

## Extension points

- Add provider connectors behind normalized interfaces.
- Add cron implementations behind the manifest roles.
- Add portal/admin pages without moving integration state away from Settings → Connections & Integrations.
