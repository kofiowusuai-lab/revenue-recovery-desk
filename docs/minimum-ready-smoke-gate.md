# Minimum-ready smoke gate for client go-live

Use when checking whether a client profile is ready to start the gateway / Orgo brain.

## Command

```bash
/Users/AIAgenterminal/rrd-ready check rr-<company> --allow-no-orgo
```

- Use `--allow-no-orgo` before the paid Orgo plan is active. This lets the gate report `waiting_for_paid_orgo` without treating it as a hard system blocker.
- The gate must still fail closed on missing consent, integration readiness, missing profile files, missing required env key names, failed provider probes, and guardrail failures.
- Output reports key NAMES/status only; never print token values.

## What it checks

- Profile directory exists.
- `SOUL.md`, `policy.json`, and `manifest.json` exist.
- Manifest readiness: consent, integration-ready, SOP path.
- Required API-key/OAuth env names from the manifest are non-empty.
- Provider probes authenticate where supported: Stripe, HubSpot, Google Workspace, Microsoft 365, Xero, QuickBooks, Salesforce, Zoho, Pipedrive, monday.com, GoHighLevel, SendGrid.
- Guardrail executor allows an approved smoke draft in gate mode and blocks an unapproved send.
- Orgo plan/status: before paid Orgo this should show `waiting_for_paid_orgo`; after paid Orgo, the project/status should be reachable.

## Expected verdicts

- `READY` — client can be moved to gateway/startup subject to operational approval.
- `READY_EXCEPT_ORGO` / Orgo waiting marker — client-side access and policy are clear, but paid Orgo runtime is not available yet.
- `BLOCKED` — do not start live recovery; fix the listed blocker(s).

## Sandbox pattern

For a clean sandbox/faux client, keep the stack narrow so the gate tests exactly what you intend:

- Company name includes `— Faux Test`.
- Consent true, `integrationReady` true, SOP path present.
- Use a minimal provider set such as Stripe-only; do not include Salesforce/PostGrid/etc. unless the sandbox has valid credentials for those providers.
- Install credentials locally without printing values, then run the gate.
- If the only runtime blocker is Orgo free tier, report that honestly rather than calling it a full live recovery pass.

## Pitfalls learned

- `Email` must **not** imply physical mail/PostGrid. Letter detection should only trigger for explicit physical mail channels such as `Letter`, `Postal`, `Post`, `Physical mail`, or `Paper mail`.
- A smoke pass using a live-shaped Stripe key is not a pure Stripe sandbox. If the user asks for a fully isolated sandbox, require a `sk_test_...` key.
- Manually provisioned faux records can still appear `alreadyProcessed:false` to the onboarding watcher. Either let the watcher process them intentionally or baseline/mark them before relying on a quiet queue.
