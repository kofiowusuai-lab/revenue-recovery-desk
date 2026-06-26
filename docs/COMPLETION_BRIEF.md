# Revenue Recovery Desk Completion Brief

## Mission

Complete Revenue Recovery Desk into a managed AI revenue recovery operating system.

The product should onboard a client, create a dedicated Hermes agent profile, securely connect the client’s payment/accounting/CRM/email/SMS/mail systems, detect overdue invoices, draft recovery messages, collect approval where required, send only through the gated executor, monitor replies/payments, escalate risky cases, and report ROI to the client every week.

The client experience should feel proactive, safe, and premium — more like hiring a reliable AI recovery team than buying automation scripts.

## Existing foundation to preserve

The repo already includes:

- Hermes profile provisioning.
- Client-specific SOUL, memory, manifest, policy, and skills generation.
- Integration registry for payment, accounting, CRM, email, SMS, and mail providers.
- Secrets vault and OAuth helpers.
- Profile-local ChatGPT/Codex runtime helper.
- Readiness checker and go-live checklist builder.
- Guardrail engine.
- Gated recovery executor.
- Email, SMS, and PostGrid letter adapters.
- Usage tracking and audit logging.
- New-client notification watcher.
- Node test suite.

Do not replace this architecture. Extend it.

## Non-negotiable safety rule

Every outbound recovery action must go through the gated executor.

No agent, cron job, browser workflow, portal route, or integration adapter may send emails, SMS, letters, payment links, or customer-facing messages directly.

The core executor path is:

1. Create or update a recovery action record.
2. Run the gate through `rrd-recover`.
3. Only if allowed, dispatch through `rrd-recover send` / the gated executor.
4. Store the gate decision, provider result, audit event, and thread update.

## Product gaps to complete

### Client web portal

Build/complete a client-facing portal where the client can:

- Complete onboarding.
- See go-live readiness.
- Connect integrations.
- Submit API keys through the vault.
- Authorize OAuth providers.
- Upload SOPs and documents.
- Confirm recovery rules.
- Confirm do-not-contact rules.
- Confirm tone of voice.
- Confirm discount/payment-plan limits.
- Confirm escalation rules.
- Review drafted messages.
- Approve, reject, or edit recovery batches.
- See recovered amount.
- See outstanding invoices.
- See messages sent.
- See replies needing attention.
- See blocked/escalated cases.
- Download weekly reports.
- Request offboarding.

Required client-facing portal pages:

- `/onboarding`
- `/dashboard`
- `/readiness`
- `/approvals`
- `/invoices`
- `/threads`
- `/reports`
- `/settings`
- `/offboarding`

Connection UX rule:

- Integrations, vault links, OAuth re-connects, API-key status, and provider health should live inside `/settings` as a clear **Connections & Integrations** section/tab.
- `/vault`, `/oauth-start`, and `/oauth-callback` are allowed to remain as technical one-time secure flow routes because OAuth providers and secure vault drops need redirect/landing URLs.
- Do not present `/oauth-start` or `/oauth-callback` as normal navigation pages. A client should reach them only by clicking a connect/reconnect button from Settings or by using a secure emailed link.
- If a standalone `/integrations` route exists, it should redirect to or mirror `/settings#integrations`, not become another place where connection state can drift.

Main dashboard cards should show:

- Money recovered.
- Money currently being chased.
- Money blocked or needing client action.
- Approval requests waiting.
- Replies needing human attention.
- Upcoming recovery actions.
- Integration health.
- Last agent activity.
- Weekly ROI.

### Operator/admin dashboard

Build/complete an internal operator dashboard for FlowAudit / Revenue Recovery Desk.

It should show:

- New client submissions.
- Provisioning status.
- Readiness status.
- Missing secrets.
- Missing OAuth connections.
- Failed provider probes.
- Clients ready to serve.
- Active recovery runs.
- Blocked sends.
- Escalations.
- Reply alerts.
- Payment reconciliation status.
- Agent health.
- Cron job health.
- Orgo desktop status.
- Usage and cost per client.
- Weekly report delivery status.

Required admin pages:

- `/admin/clients`
- `/admin/client/:id`
- `/admin/readiness`
- `/admin/jobs`
- `/admin/agent-runs`
- `/admin/audit`
- `/admin/escalations`
- `/admin/reports`
- `/admin/costs`
- `/admin/offboarding`

## Supabase schema and migrations

Add proper migrations under `supabase/migrations/`.

Required canonical tables:

- `submissions`
- `clients`
- `client_integrations`
- `invoices`
- `recovery_threads`
- `recovery_actions`
- `approval_requests`
- `customer_replies`
- `payments`
- `reports`
- `agent_runs`
- `job_locks`
- `audit_events`
- `client_settings`

Required status/state groups:

- Client statuses: `submitted`, `provisioning`, `awaiting_client`, `readiness_blocked`, `ready`, `live`, `paused`, `offboarding`, `offboarded`.
- Integration statuses: `needed`, `link_sent`, `authorized`, `installed`, `failed`, `revoked`.
- Invoice statuses: `open`, `overdue`, `in_recovery`, `payment_promised`, `paid`, `disputed`, `do_not_contact`, `escalated`, `written_off`.
- Thread statuses: `new`, `drafting`, `awaiting_approval`, `scheduled`, `sent`, `replied`, `payment_promised`, `paid`, `blocked`, `escalated`, `closed`.
- Thread stages: `preflight`, `friendly_reminder`, `follow_up`, `firm_notice`, `pre_escalation`, `final_notice`, `handback`.
- Action statuses: `drafted`, `queued_for_approval`, `approved`, `rejected`, `scheduled`, `sent`, `blocked`, `cancelled`, `failed`.
- Approval statuses: `pending`, `approved`, `rejected`, `expired`, `edited`.
- Reply classifications: `paid`, `promise_to_pay`, `dispute`, `hardship`, `stop_contact`, `wrong_person`, `needs_invoice_copy`, `question`, `angry`, `positive`, `unknown`.

Each table must support client isolation, auditability, and idempotent jobs.

## Backend API routes

### Client portal routes

- `POST /api/onboarding`
- `GET /api/client/me`
- `GET /api/client/readiness`
- `GET /api/client/integrations` — consumed by the Settings → Connections & Integrations UI; not a separate required top-level page.
- `POST /api/client/vault-link` — creates one-time secure vault links from Settings or onboarding reminders.
- `POST /api/client/oauth-link` — creates one-time OAuth connect/reconnect links from Settings or onboarding reminders.
- `GET /api/client/approvals`
- `POST /api/client/approvals/:id/approve`
- `POST /api/client/approvals/:id/reject`
- `POST /api/client/approvals/:id/edit`
- `GET /api/client/invoices`
- `GET /api/client/threads`
- `GET /api/client/reports`
- `POST /api/client/settings`
- `POST /api/client/pause`
- `POST /api/client/offboard`

### Admin routes

- `GET /api/admin/clients`
- `GET /api/admin/clients/:id`
- `POST /api/admin/clients/:id/provision`
- `POST /api/admin/clients/:id/run-readiness`
- `POST /api/admin/clients/:id/go-live`
- `POST /api/admin/clients/:id/pause`
- `POST /api/admin/clients/:id/resume`
- `GET /api/admin/jobs`
- `GET /api/admin/audit`
- `GET /api/admin/escalations`
- `GET /api/admin/reports`
- `POST /api/admin/reports/:id/send`

### Internal cron routes

- `POST /api/internal/jobs/new-client-watch`
- `POST /api/internal/jobs/readiness-watch`
- `POST /api/internal/jobs/invoice-sync`
- `POST /api/internal/jobs/recovery-planner`
- `POST /api/internal/jobs/approval-reminders`
- `POST /api/internal/jobs/send-dispatcher`
- `POST /api/internal/jobs/reply-monitor`
- `POST /api/internal/jobs/payment-reconcile`
- `POST /api/internal/jobs/escalation-monitor`
- `POST /api/internal/jobs/weekly-report`
- `POST /api/internal/jobs/health-watch`

All internal routes require a cron secret.

## Idempotency rules

Every cron job must be idempotent.

Rules:

- Use `job_locks`.
- Use deterministic keys for actions.
- Do not draft duplicate messages for the same invoice/stage.
- Do not send duplicate messages.
- Do not re-send after a customer replied.
- Do not contact a customer if the invoice became paid.
- Do not contact a do-not-contact customer.
- Always re-run the gate immediately before dispatch.

## Provider connector layer

Create normalized connector interfaces under `src/lib/connectors/`.

### Payment connector interface

```ts
interface PaymentConnector {
  listInvoices(clientId): Promise<NormalizedInvoice[]>;
  getInvoice(clientId, invoiceId): Promise<NormalizedInvoice>;
  createPaymentLink?(clientId, invoiceId): Promise<string>;
  listPayments(clientId, since): Promise<NormalizedPayment[]>;
}
```

Implement first:

- Stripe
- Xero
- QuickBooks
- Square
- PayPal

### CRM connector interface

```ts
interface CrmConnector {
  findCustomer(clientId, customerRef): Promise<NormalizedContact>;
  searchContacts(clientId, query): Promise<NormalizedContact[]>;
  getCompany?(clientId, companyRef): Promise<NormalizedCompany>;
}
```

Implement first:

- HubSpot
- Salesforce
- Pipedrive
- Zoho CRM
- GoHighLevel

### Reply connectors

Inbound reply detection:

- Gmail / Google Workspace
- Microsoft 365 / Outlook
- SendGrid webhook
- Postmark webhook
- Mailgun webhook
- AgentMail webhook
- Twilio webhook

### Physical letter connector

Extend the current PostGrid adapter with:

- status sync
- delivery tracking
- failed-mail detection
- certified letter proof link storage where available

## Specialized agent model

Hermes should be the manager, not one giant worker.

Use specialist agents/jobs:

1. RecoveryDesk Manager Agent
2. Onboarding Agent
3. Provisioning Agent
4. Integration Agent
5. Mapping Agent
6. Invoice Sync Agent
7. Contact Match Agent
8. Recovery Planner Agent
9. Message Drafting Agent
10. Approval Agent
11. Dispatch Agent
12. Reply Triage Agent
13. Payment Reconciliation Agent
14. Escalation Agent
15. Client Success Agent
16. Health Watch Agent
17. Compliance QA Agent

No specialist agent may bypass the gated executor for customer-facing actions.

## Cron jobs

### Every 5 minutes

- `cron:send-dispatcher`
- `cron:reply-monitor`
- `cron:job-health-watch`

### Every 15 minutes

- `cron:readiness-watch`
- `cron:approval-reminder`

### Hourly

- `cron:invoice-sync`
- `cron:payment-reconcile`
- `cron:integration-health`
- `cron:orgo-idle-stop`

### Daily

- `cron:recovery-planner`
- `cron:client-digest`
- `cron:escalation-review`

### Weekly

- `cron:weekly-client-report`
- `cron:weekly-qa-audit`

Every cron job must log into `agent_runs`.

## End-to-end workflows

### New client workflow

1. Client submits onboarding.
2. New-client watcher detects submission.
3. Onboarding Agent validates data.
4. Readiness Agent identifies missing items.
5. Provisioning Agent creates Hermes profile.
6. Integration Agent sends vault/OAuth links.
7. Client connects systems.
8. Mapping Agent validates data.
9. Readiness Agent runs smoke test.
10. Admin approves go-live.
11. Client status becomes `live`.

### Daily recovery workflow

1. Invoice Sync Agent pulls invoices.
2. Contact Match Agent enriches from CRM.
3. Recovery Planner chooses next stage.
4. Drafting Agent writes messages.
5. Compliance QA Agent reviews drafts.
6. Approval Agent sends approval batch.
7. Client approves.
8. Dispatch Agent sends through gated executor.
9. Reply Monitor watches replies.
10. Payment Reconciliation Agent detects payments.
11. Client Success Agent reports wins.

### Reply workflow

1. Customer replies.
2. Reply Monitor catches it.
3. Reply Triage Agent classifies it.
4. Thread is paused.
5. Future sends are cancelled.
6. Client/operator gets summary.
7. Recovery Planner recommends next action only if safe.

### Payment workflow

1. Payment detected.
2. Invoice marked paid.
3. Recovery thread closed.
4. Scheduled messages cancelled.
5. Client receives win notification.
6. Weekly report updated.

### Escalation workflow

Escalate when there is a dispute, stop request, hardship signal, angry reply, high-value invoice, guardrail block, exceeded cap, repeated non-response, legal wording need, or ambiguous integration data.

Escalation output:

- Summary.
- Relevant invoice/customer/thread.
- Risk reason.
- Recommended human action.
- `Do not send more until reviewed` flag.

## Client experience automations

The product should feel alive.

Add:

- Quick-win notifications.
- Blocker notifications.
- Weekly “you are in control” reports.
- Batch approval UX with approve all, reject all, edit one, comment, and send during next business window.
- Proactive improvement suggestions.

Weekly reports should reassure the client that:

- Nothing was sent outside their rules.
- Replies were stopped and escalated.
- Paid invoices were not chased.
- The AI is working, but safety rails are active.

## Safety and compliance requirements

The product is B2B-first unless legal review approves broader use.

Hard rules:

- Do not chase consumer debt without legal review.
- Do not send without consent.
- Do not send outside authorized channels.
- Do not contact do-not-contact records.
- Do not continue after a stop request.
- Do not continue after a dispute without human review.
- Do not threaten legal action.
- Do not pretend to be a lawyer.
- Do not add fees or penalties unless explicitly authorized.
- Do not invent invoice facts.
- Do not invent payment links.
- Do not expose secrets.
- Do not log secret values.
- Do not bypass `rrd-recover`.
- Do not use browser automation when an API path exists.
- Do not leave Orgo desktops running idle.

Every customer-facing send must create:

- action record
- gate decision
- audit event
- provider result
- thread update

## Required tests

Add tests for every new module.

Minimum coverage:

- Schema/migration tests.
- RLS/client-isolation tests.
- Job lock/idempotency tests.
- Invoice sync tests.
- Recovery planner tests.
- Approval flow tests.
- Dispatch tests proving `rrd-recover` is used before send.
- Reply classification tests.
- Payment reconciliation tests.
- Client report tests.
- No-direct-provider-send regression tests.

## Implementation order

### Phase 1 — Repo hardening

- Full architecture README.
- Setup guide.
- Full `.env.example` grouped by service.
- Migrations.
- Local dev seed data.
- Test command for all modules.
- CI.

### Phase 2 — Database and state layer

- Supabase migrations.
- Typed data access layer.
- Job lock helpers.
- Audit event writer.
- Agent run logger.
- Client status state machine.
- Integration status state machine.

### Phase 3 — Client and admin portal

- Auth.
- Client dashboard.
- Admin dashboard.
- Readiness page.
- Integration page.
- Approval page.
- Invoice/thread pages.
- Report pages.

### Phase 4 — Connector layer

- Stripe invoice/payment sync.
- HubSpot contact matching.
- SendGrid/Postmark/Mailgun send config validation.
- Google/Microsoft reply monitor.
- Twilio reply monitor.
- PostGrid status sync.
- Connector tests.

### Phase 5 — Recovery engine

- Invoice sync job.
- Contact match job.
- Recovery planner.
- Drafting prompt.
- Approval batching.
- Dispatcher.
- Reply triage.
- Payment reconciliation.
- Escalation monitor.

### Phase 6 — Proactive client success

- Quick-win notifications.
- Blocker notifications.
- Daily digest.
- Weekly report.
- Monthly ROI report.
- Improvement suggestions.
- Client feedback prompt.

### Phase 7 — Production hardening

- Observability.
- Job failure alerts.
- Provider rate-limit handling.
- Retries and dead-letter queue.
- Permission/RLS review.
- Data retention/offboarding.
- Backup/export.
- Legal copy review.
- Security review.
- Launch checklist.

## Concrete files/directories to add

```txt
supabase/migrations/
src/lib/db/
src/lib/jobs/
src/lib/connectors/
src/lib/recovery/
src/lib/approvals/
src/lib/reports/
src/lib/notifications/
src/lib/security/
src/lib/client-state/
src/app/client/
src/app/client/settings/connections/
src/app/admin/
src/app/api/client/
src/app/api/admin/
src/app/api/internal/
agents/
agents/prompts/
agents/workflows/
cron/
docs/
```

Important docs/prompts:

```txt
docs/ARCHITECTURE.md
docs/SETUP.md
docs/OPERATIONS.md
docs/SECURITY.md
docs/CLIENT_EXPERIENCE.md
docs/RECOVERY_POLICY.md

agents/prompts/recoverydesk-manager.md
agents/prompts/onboarding-agent.md
agents/prompts/integration-agent.md
agents/prompts/mapping-agent.md
agents/prompts/invoice-sync-agent.md
agents/prompts/recovery-planner-agent.md
agents/prompts/message-drafting-agent.md
agents/prompts/approval-agent.md
agents/prompts/dispatch-agent.md
agents/prompts/reply-triage-agent.md
agents/prompts/payment-reconciliation-agent.md
agents/prompts/client-success-agent.md
agents/prompts/compliance-qa-agent.md
agents/prompts/health-watch-agent.md

cron/readiness-watch.mjs
cron/invoice-sync.mjs
cron/recovery-planner.mjs
cron/approval-reminder.mjs
cron/send-dispatcher.mjs
cron/reply-monitor.mjs
cron/payment-reconcile.mjs
cron/escalation-review.mjs
cron/weekly-report.mjs
cron/health-watch.mjs
cron/orgo-idle-stop.mjs
```

## Agent build instruction

Build incrementally.

Do not rewrite the existing working safety architecture.

Start by adding the database schema, job framework, and recovery state model. Then add invoice sync and approval queue. Then add dispatch through the existing `rrd-recover` executor. Then add reply monitoring and payment reconciliation. Finally add client success reporting and dashboards.

Every module must include tests.
Every job must be idempotent.
Every customer-facing message must be approval-gated unless the client explicitly pre-authorized that channel.
Every send must pass through `rrd-recover`.
Every failure must be visible in admin.
Every client should see progress, blockers, recovered money, and next steps.

The key upgrade is this: Hermes should become the manager, not the whole worker. Cron jobs keep the machine moving, specialist agents do focused work, and `rrd-recover` stays as the locked gate for anything customer-facing. This gives autonomy without letting the AI become dangerous or messy.
