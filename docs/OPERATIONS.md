# Revenue Recovery Desk Operations

Reference: `docs/COMPLETION_BRIEF.md`.

## Daily operator loop

- Review `/admin/clients` for new submissions, provisioning state, readiness blockers, and live clients.
- Review `/admin/jobs` for cron health, stuck `job_locks`, failed `agent_runs`, and retry queues.
- Review `/admin/escalations` before allowing any risky thread to proceed.
- Review `/admin/reports` for weekly report delivery and client ROI summaries.

## Cron cadence

- Every 5 minutes: send dispatcher, reply monitor, job health watch.
- Every 15 minutes: readiness watch, approval reminder.
- Hourly: invoice sync, payment reconcile, Orgo idle stop.
- Daily: recovery planner, escalation review.
- Weekly: weekly client report.

`agents/workflows/cron-role-manifest.json` maps each cron job to its roles and execution type.

## Agent-role discipline

- Treat the prompt files as role definitions for background workflows, not as a client-facing swarm.
- The client never chats with onboarding, provisioning, integration, invoice, payment, or health agents.
- Form intake and the client profile are the source of truth; jobs read stored state instead of re-asking for what the client already submitted.
- Use deterministic modules for state transitions, provider calls, readiness checks, dispatch, and reconciliation.
- Use LLM assistance only where it adds judgment or language quality: message drafting, reply triage, compliance review, escalation summaries, weekly reports, and operator prioritization.

## Run rules

- Every job must be idempotent, use deterministic keys, and write an `agent_runs` entry.
- Do not draft duplicates for the same invoice/stage.
- Do not send duplicates, after replies, after payment, or to do-not-contact records.
- Always run the gate immediately before dispatch.

## Incident response

- If provider health fails: mark integration failed, notify operator, and block dependent recovery sends.
- If a reply indicates stop, dispute, hardship, anger, wrong person, or legal risk: pause thread and escalate.
- If a secret/OAuth issue appears: request reconnect through Settings/vault flow; do not print secrets.
- If Orgo/runtime is idle or stuck: stop it and log the health action.

## Release checklist

- Run targeted tests for changed areas.
- Verify prompt safety tests pass.
- Confirm no `.env` or secret files changed.
- Confirm dispatch paths still require `rrd-recover` gate/send.
