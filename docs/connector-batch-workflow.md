# RRD connector batch workflow and mapping stance

Use this when the user asks to add multiple accounting, invoicing, CRM, or payment providers to Revenue Recovery Desk.

## Batch before review

When the user has named several platforms, add the full selected batch first, then run one code review, full tests, and one deploy. Do not review after each provider if more connector changes are already planned; the user explicitly prefers avoiding duplicate reviews over the same connector surface.

Recommended sequence:

1. Start a task monitor with `--lane recovery_desk`.
2. Classify every requested platform as:
   - OAuth app/connect flow;
   - secure vault/API-key flow;
   - manual/import or unsupported.
3. Add RED tests for all providers in the batch.
4. Implement provider registry, Hermes manifest, web desk mirror, go-live/readiness mirror, OAuth-start labels, and docs in one pass.
5. Run syntax + focused tests.
6. Run full suite.
7. Run one independent code review over the whole batch.
8. Fix high/medium findings, rerun tests, then deploy once.

## Mapping stance

Connector/access support does not equal operational readiness. Access only proves we can authenticate or collect keys. Recovery readiness still needs client-provided or client-approved mapping for:

- where invoices/open receivables live;
- how overdue/open status is identified;
- customer/contact email fields;
- balance, due date, status, currency, and amount fields;
- hosted invoice/payment URL behavior;
- dispute, payment-plan, do-not-contact, VIP, sensitive, and escalation flags.

The client can provide field names, reports, screenshots, exports with secrets removed, or a walkthrough. If the API permits read-only discovery, use it to propose a map, but require client approval before treating the map as ready. Do not hard-code global assumptions about a client's invoice layout.

## API/OAuth documentation stance

Platform docs are necessary for connector setup and maintenance:

- app creation and redirect URI rules;
- authorize/token URLs;
- scopes and least-privilege limits;
- refresh-token behavior and region/data-center behavior;
- token exchange style (form body, JSON body, Basic auth);
- API-key names and safe collection wording.

Docs are not a substitute for client-specific mapping. Treat docs as the source for how to connect; treat the client/map review as the source for what to read and how to interpret it.

## Review checklist for connector batches

- OAuth provider ids are canonical and exact; avoid fuzzy matching that can confuse products like `zoho` vs `zohobooks`.
- Refresh-token paths use the correct token host, especially for region-aware providers.
- Basic-auth token exchange follows OAuth encoding rules for client id/secret.
- CLI help and error copy list all supported provider ids.
- Onboarding/dropdowns include any newly supported first-class provider.
- Go-live/readiness mirrors match Hermes/vault mirrors.
- Tests cover provider aliases, authorize URL, token exchange endpoint/body/auth, env-key mapping, Hermes manifest classification, and readiness matching.
