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
- Hourly: invoice sync, payment reconcile, integration health, Orgo idle stop.
- Daily: recovery planner, client digest, escalation review.
- Weekly: weekly client report, weekly QA audit.

`agents/workflows/cron-role-manifest.json` maps each cron job to its specialist roles.

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
