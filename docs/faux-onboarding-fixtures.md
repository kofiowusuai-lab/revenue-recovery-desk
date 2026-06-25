# Faux onboarding fixtures for RRD testing

Use when the operator asks to create fake/test onboarded companies for end-to-end RRD testing.

## Principles

- Use the live onboarding browser flow when explicitly requested, then verify with `/Users/AIAgenterminal/rrd-harness`.
- Make company names clearly fake, e.g. `— Faux Test`, and add notes such as `Treat as a sandbox/faux company. Do not use real customer outreach.`
- Use real recipient emails only when the operator supplied them for testing.
- Fill enough detail to exercise provisioning, SOP/default-SOP selection, approval routing, payment/CRM integration split, and guardrails.
- After submission, report submission IDs, companies, emails, integration readiness, SOP status, consent, CRM, payment platforms, and approximate overdue.

## Browser automation pattern

1. Open `https://flowaudit.co.uk/revenue-recovery/onboarding`.
2. Inspect fields with the browser console if needed: `document.querySelectorAll('input,select,textarea')`.
3. Fill all core fields: business profile, payments/accounting, CRM, process/SOP, outreach, contacts/approval routing, goals, consent.
4. Submit via the form's own `handleSubmit` or UI button so the live Supabase insert path is exercised.
5. Verify with live harness commands, for example:

```bash
/Users/AIAgenterminal/rrd-harness query '{"search":"Faux Test","fields":["id","company","email","industry","crm","paymentPlatforms","approxOutstanding","hasSop","integrationReady","consent"],"sort":"-submittedAt","limit":10}'
```

```bash
/Users/AIAgenterminal/rrd-harness stats
```

## Fixture coverage recommendations

Create at least two different shapes when testing onboarding automation:

- **Client SOP path:** `hasSop` or `Somewhat`, with explicit cadence, tone, templates, settlement rules, escalation ladder.
- **FlowAudit default SOP path:** `hasSop: No`, `wantSopBuilt: true`, minimal client process, explicit approval gates.

Vary integrations:

- Stripe + accounting OAuth such as Xero/QuickBooks.
- CRM OAuth such as HubSpot/Pipedrive/Salesforce.
- Email provider such as Google Workspace or Microsoft 365.

Always include approval routing:

- approver name/role/email,
- preferred approval channel,
- SLA,
- notes for discounts/high balances/no auto-send.

## Reporting format

Use concise bullets with copiable IDs:

```text
Company: <name>
Email: <email>
ID: <submission-id>
Integration ready: true/false
Consent: true/false
```
