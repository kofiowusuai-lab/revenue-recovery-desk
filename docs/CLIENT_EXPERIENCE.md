# Revenue Recovery Desk Client Experience

Reference: `docs/COMPLETION_BRIEF.md`.

## Product feel

The client should feel like they hired a reliable AI recovery team: proactive, safe, explainable, and always under their control.

The client should not feel like they are interacting with a swarm of agents. They see one clean FlowAudit/RRD portal plus approval, blocker, and report messages. Background roles may process their stored form/profile data, but they stay behind the scenes.

## Required portal areas

- `/onboarding`: collect business profile, channels, consent, policies, tone, escalation rules, and documents.
- `/dashboard`: show money recovered, money being chased, blockers, approvals, replies, upcoming actions, integration health, last agent activity, and weekly ROI.
- `/readiness`: show missing steps before go-live.
- `/approvals`: review, approve, reject, or edit drafted recovery batches.
- `/invoices` and `/threads`: show invoice/thread status and recovery stage.
- `/reports`: weekly summaries and downloadable reports.
- `/settings`: client settings plus Connections & Integrations.
- `/offboarding`: request shutdown/export/revocation.

## Connections UX

Integration status belongs in Settings → Connections & Integrations. Technical `/vault`, `/oauth-start`, and `/oauth-callback` routes are allowed only as secure one-time flows reached from connect/reconnect buttons or secure links.

Clients should not generate arbitrary vault or OAuth links themselves. The system/operator/onboarding workflow should create one-time secure actions when needed, then the portal can show their status and next step.

## Client communications

- Quick-win notifications celebrate recovered revenue.
- Blocker notifications explain what the client needs to do.
- Weekly reports reassure that nothing was sent outside rules, replies stopped automation, paid invoices were not chased, and safety rails stayed active.

## Approval posture

Customer-facing messages are approval-gated unless the client explicitly pre-authorized a channel and policy. Even pre-authorized sends still require `rrd-recover` gate/send.
