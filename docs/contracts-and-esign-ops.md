# RRD contracts, PDFs, and e-sign ops

Use when the operator asks to create/review/send Revenue Recovery Desk client agreements.

## Contracting entity stance from session
- Interim basis selected by user: **`[FOUNDER LEGAL NAME] trading as FlowAudit`** until a corporate entity exists.
- Do not sign as bare `FlowAudit`; it is a brand/trading style, not automatically a legal entity.
- Keep assignment/novation wording so agreements can transfer into a future company/entity once formed.
- Flag solicitor review because founder/sole-trader signing can create personal liability.

## Contract pack shape
Maintain a class-level pack rather than one-off docs:
- `README-contract-pack.md`
- `01-master-services-agreement.md`
- `02-data-processing-agreement.md`
- `03-order-form-template.md`
- `04-recovery-authority-and-guardrails-schedule.md`
- `05-solicitor-review-checklist.md`

Useful coverage areas:
- B2B commercial invoice recovery only by default.
- No legal/tax/accounting/regulated-debt advice.
- Client warrants debt validity/data accuracy/lawful basis.
- Provider is a limited operational agent, not a debt purchaser/solicitor/enforcement agent.
- Approval gates for risky communication, legal threats, discounts, payment plans, and escalation.
- Payments route directly to client/client processor; FlowAudit should not hold client money without legal review.
- UK GDPR DPA with client as controller and provider as processor for debtor/customer data.
- AI/automation limitations and human approval where required.
- Credential/OAuth/vault handling, offboarding, and live credential destruction.
- Liability cap, indemnities, confidentiality, retention, and fair-communications stop conditions.

## PDF generation workflow
When the user wants PDFs for manual e-sign:
1. Render a combined signing/review pack first: `00-flowaudit-revenue-recovery-contract-pack.pdf`.
2. Also render individual PDFs for MSA, DPA, order form, and guardrails schedule.
3. Verify with `pdfinfo` page counts and `pdftotext` text extraction.
4. Package a zip for convenience.
5. Send the combined PDF plus zip.

Chrome headless print can be flaky/hang on macOS. Durable fallback: render PDFs from markdown with Python `reportlab`, then merge with `pypdf`. Capture the *fallback pattern*, not the transient Chrome failure.

## E-sign MCP note
Foxit eSign has an npm MCP package: `foxit-esign-mcp`. Configure Hermes via an MCP wrapper that loads Foxit credentials from local env without printing secrets. Required credentials are either:
- `FOXIT_CLIENT_ID` + `FOXIT_CLIENT_SECRET`, or
- `FOXIT_BEARER_TOKEN`.

Default base URL used in setup: `https://na1.foxitesign.foxit.com/api`.

If credentials are missing, the MCP can be configured but will not connect until keys are filled securely and Hermes/gateway is restarted. If the operator says they will send e-sign manually, park the MCP as non-blocking infrastructure and produce verified PDFs instead.
