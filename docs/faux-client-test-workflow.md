# Faux client onboarding + provisioning test workflow

Use this when the operator asks to create sandbox/faux clients for end-to-end Revenue Recovery Desk testing.

## Purpose

Create realistic non-real client records that exercise onboarding, welcome/access automation, approval routing, SOP/default-SOP paths, vault/OAuth drops, provisioning, and gateway startup without touching real customers.

## Naming and safety

- Put `— Faux Test` in the company name.
- Put sandbox wording in `anything_else` / notes: `Treat as a sandbox/faux company. Do not use real customer outreach.`
- Use the operator-provided test email addresses exactly.
- Use fake websites/domains such as `.example` and fake phone numbers.
- Keep real-client runtime rules: real clients do not run locally; faux/demo profiles can be used for local/browser validation.

## Browser automation pattern

The live onboarding form is at:

```text
https://flowaudit.co.uk/revenue-recovery/onboarding
```

For bulk faux submissions, browser console automation is faster and less error-prone than hand-clicking every step:

1. Open the onboarding page in the browser.
2. Inspect `buildRow()` and field ids if needed.
3. Programmatically set `#f_*` fields, check checkbox groups, fill the first contact row, set `#f_primaryContact`, check consent, then call `handleSubmit({ preventDefault(){} })`.
4. After each submit, wait for the success screen, then call `resetToForm()` before the next fake company.
5. Verify with the real harness, never by assuming browser success:

```bash
/Users/AIAgenterminal/rrd-harness query '{"search":"Faux Test","fields":["id","company","email","industry","crm","paymentPlatforms","approxOutstanding","hasSop","integrationReady","consent"],"sort":"-submittedAt","limit":10}'
```

## Recommended faux coverage

Create at least two contrasting clients when testing broad readiness:

- One with a partial/client SOP path (`hasSop: Somewhat` or `Yes`) and higher overdue amount.
- One with no SOP and `wantSopBuilt: true` to exercise the FlowAudit Default Recovery SOP path.
- Use different CRMs/accounting systems to exercise both API-key and OAuth connection paths.
- Include explicit approval routing fields (`f_approvalContacts`, `f_approvalChannel`, `f_approvalSla`, `f_approvalNotes`).

## Post-submission flow

After verifying records landed:

```bash
/Users/AIAgenterminal/rrd-provision <submission-id>
```

Report:

- profile name,
- profile path,
- env key names still needed,
- OAuth providers still needed,
- whether `.env` was left untouched because it already exists,
- Orgo project id if provision output includes it.

When a vault/OAuth watcher reports a deposited authorization, approve with:

```bash
/Users/AIAgenterminal/rrd-vault approve <drop-id>
```

Report only key names written, never values. If approval succeeds, the drop is burned/consumed.

## Gateway startup for a faux profile

If the operator asks to run the profile gateway:

```bash
hermes --profile rr-<company-slug> gateway run --replace
hermes --profile rr-<company-slug> gateway status
```

Run the gateway as a background long-lived process and verify status. State clearly when it is running manually rather than installed as a service.

## Good final status shape

Use concise bullets:

```text
Submitted: 2 faux onboarding forms
Verified in book: yes
Provisioned profiles: rr-...
Pending API-key secrets: ...
Pending OAuth connections: ...
Gateway: running manually / not installed as service
Safety: sandbox/faux only, no real customer outreach
```
