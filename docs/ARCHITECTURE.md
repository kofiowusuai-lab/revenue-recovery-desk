# Revenue Recovery Desk Architecture

This document is a concise operating architecture for the completion foundation. The canonical scope and safety rules remain in `docs/COMPLETION_BRIEF.md`.

## Core model

- Hermes is the manager and orchestrator, not a monolithic worker.
- The client does **not** talk to a swarm of agents. The client sees one FlowAudit/RRD portal, approval screens, reports, and normal support/escalation messages.
- Most “agent” files in `agents/prompts/` are role definitions for background workflows, not separate live conversational agents.
- Deterministic jobs/modules handle state changes, provider work, profile provisioning, readiness, invoice sync, payment reconciliation, job health, and dispatch.
- LLM-assisted roles are reserved for work that benefits from judgment or language: operator coordination, message drafting, messy reply triage, compliance/risk review, escalation summaries, and client-success reporting.
- Workflow mapping lives in `agents/workflows/cron-role-manifest.json`.
- Cron/internal jobs advance state idempotently and record `agent_runs`.
- `rrd-recover` remains the locked gate for every outbound customer-facing action.

## Source-of-truth hierarchy

1. Onboarding form and secure follow-up forms collect client information once.
2. Provisioning writes that information into the client profile, policy, manifest, readiness checklist, and `.env` placeholders.
3. Background jobs read stored profile/form state. They should not re-collect or second-guess information that is already stored unless validation finds a blocker.
4. LLM-assisted roles may summarize, draft, classify, or review, but deterministic state and provider checks remain authoritative.

## Execution model

### Deterministic jobs/modules

Use deterministic code first for:

- onboarding intake validation from stored submissions
- profile provisioning
- vault/OAuth link generation and status tracking
- readiness checks
- mapping validation when confidence rules are clear
- invoice sync
- contact matching where exact/confident
- approval state updates
- gated dispatch
- payment reconciliation
- health monitoring
- Orgo idle cleanup

### LLM-assisted roles

Use Hermes/LLM assistance for:

- RecoveryDesk manager summaries and prioritization
- recovery message drafting
- messy reply triage and summarization
- compliance/risk review
- escalation summaries
- weekly client success reports and improvement suggestions

LLM roles create recommendations, drafts, summaries, or review flags. They do not directly mutate sensitive state unless wrapped by deterministic handlers and tests.

## State flow

1. Client submits onboarding; stored form/profile data becomes the source of truth.
2. Deterministic readiness/provisioning/integration jobs prepare the profile and identify missing items.
3. Invoice sync and contact match normalize recovery candidates.
4. Rules-first recovery planning proposes next safe stages.
5. Message drafting creates drafts only when language judgment is needed.
6. Compliance QA and approval flow prepare reviewable batches.
7. Dispatch rechecks state and invokes `rrd-recover` then `rrd-recover send` only when allowed.
8. Reply triage and payment reconciliation stop or close work when replies/payments arrive.
9. Client success reports verified wins, blockers, and ROI.

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
