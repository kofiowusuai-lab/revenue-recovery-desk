# Daily operator summary

Use this when the user asks to wire in or explain daily Revenue Recovery Desk operator reporting.

## Purpose
Send the operator a concise daily control-tower summary from live book data, plus any actionable blockers. Do not fabricate recovered dollars: only report actual recovery/payment totals when the backend exposes recovery events or payment reconciliation data.

## Minimum live commands
Run real harness commands, never from memory. Because this summary is a multi-command scheduled/control-tower job, open one task monitor first and route it to the RRD lane:

```bash
ID=$(HOME=/Users/AIAgenterminal /Users/AIAgenterminal/.openclaw/scripts/task-monitor start "Daily Revenue Recovery Summary" \
  --lane recovery_desk \
  --stages "Harness,Vault,Format")
```

Then run the live data commands:

```bash
/Users/AIAgenterminal/rrd-harness stats
/Users/AIAgenterminal/rrd-harness query '{"sort":"-outstanding","fields":["id","company","approxOutstanding","priority","integrationReady","hasSop","consent","crm"],"limit":10}'
/Users/AIAgenterminal/rrd-harness aggregate '{"groupBy":"crm","op":"count"}'
/Users/AIAgenterminal/rrd-harness aggregate '{"groupBy":"paymentPlatform","op":"count"}'
```

Optionally run `/Users/AIAgenterminal/rrd-vault status`; if it errors, mention vault status is unavailable rather than blocking the report. If it succeeds, do not paste the whole vault listing into the summary. Condense it to status counts and only actionable deposited/pending items. For copyable approve actions, include only deposited drops that are clearly relevant to active/non-test priorities; stale test/demo drops can be summarized as cleanup/review items.

## Telegram format

```markdown
## Daily Revenue Recovery Summary
- Onboarded clients: N
- Total approx overdue: $X
- Integration-ready: N
- With SOP: N
- Critical/High priority: N
- Recovered today: Not yet available unless backend recovery/payment events exist

## Top priorities
- Client — $X overdue — Priority — readiness/blocker/action

## Stack coverage
- CRM: Salesforce N, HubSpot N, blank N
- Payments: Stripe N, Square N, PayPal N, etc.

## Operator actions
- Claim/provision/connect actions. Put copy commands in standalone inline-code fields.
```

## Scheduling pattern
Use the cronjob tool for a durable daily Telegram delivery back to the origin chat. Recommended default: `0 9 * * *` unless the user specifies another time. Attach the `recovery-desk` skill and restrict toolsets to `terminal` and `skills` where supported.

## Future backend metric
For real recovered-dollar reporting, add either:
- a recovery event table written by per-client agents when payment is confirmed, or
- daily payment-system reconciliation from Stripe/Square/PayPal/QuickBooks/Xero, ideally both.

Recovery event fields should include client/profile, invoice/customer reference, amount, currency, recovered_at, source system, status/confidence, and agent/action reference.