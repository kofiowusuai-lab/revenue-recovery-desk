# Revenue Recovery Desk client contract pack

Use when the operator asks to draft, review, or prepare client contracts / terms for RRD.

**Status:** operational/commercial drafting aid, not legal advice. Always tell the user the pack needs qualified solicitor review before being sent or signed.

## Recommended document set

1. **Master Services Agreement** — main B2B terms for RRD.
2. **Data Processing Agreement** — UK GDPR Article 28 processor terms.
3. **Order Form / SOW** — client-specific commercial terms, integrations, fees, reporting, cancellation.
4. **Recovery Authority and Guardrails Schedule** — exact authority to contact debtors/customers, channels, cadence, templates, approval gates, and stop conditions.
5. **Solicitor Review Checklist** — legal questions, sources, and blanks to fill before first signature.

## Highest-priority issue: contracting entity

Do not let the agreement name only a brand/trading style like “FlowAudit” unless it is attached to a real legal person/entity. Use one of:

- `[Legal Company Name] Ltd trading as FlowAudit`, with company number and registered office;
- `[Founder Legal Name] trading as FlowAudit` as a temporary pre-incorporation route, clearly warning this may create personal liability;
- a newly formed operating company before the first paid client signs;
- assignment/novation wording allowing transfer to a future company or group entity, subject to client consent where appropriate.

Research note: Companies Act 2006 s51 creates personal-liability risk for pre-incorporation contracts if a person purports to contract for a company that does not yet exist.

## Clauses to include for RRD

- B2B commercial invoice recovery only by default.
- No legal, tax, accounting, insolvency, credit-reporting, regulated consumer-credit, or solicitor services.
- Limited operational agency: RRD may act only within approved channels/templates/thresholds.
- Explicit approval before legal threats, discounts, write-offs, settlements, payment plans outside limits, formal demands, referrals, or contacting flagged accounts.
- Payments route directly to client/client payment processor; RRD should not hold client money without separate legal/regulatory review.
- Client warranties: debts are genuine/accurate/due; data is accurate; client has lawful basis and authority to connect systems; client will flag disputes, vulnerable/consumer indicators, insolvency/legal notices, do-not-contact instructions.
- Fair communications: no harassment, misleading statements, false legal threats, unreasonable frequency, impersonation, or pursuing known disputes without a dispute process.
- Approval mechanics and authorised contacts; audit logs of approvals/messages/actions.
- OAuth/secure vault credential handling; no secrets by email/chat.
- AI-assisted output disclaimers and human approval for sensitive actions.
- Fees/payment terms; if success fees apply, define “Recovered Revenue” tightly, including attribution window, exclusions, chargebacks/refunds, VAT, pre-existing commitments, offsets/credits.
- UK GDPR DPA: client normally controller for debtor/customer AR data; RRD normally processor for recovery workflow; RRD may be independent controller for billing/security/audit/support records.
- Subprocessors: hosting, database/storage, payment processor, email provider, letter provider, cloud runtime, AI/LLM providers, and client-connected systems.
- Confidentiality, IP ownership, third-party-service dependency disclaimers.
- Liability cap, with solicitor review for UCTA reasonableness; no exclusion for fraud/death/personal injury or non-excludable liability.
- Client indemnity for inaccurate/unlawful debt data, client instructions/templates, undisclosed consumer/regulated/disputed debts, privacy/lawful-basis failures, third-party terms breaches.
- Suspension rights for non-payment, compromised credentials, unlawful/unsafe use, complaints, reputational/regulatory risk.
- Offboarding: stop workflows, revoke/destroy live credentials, archive limited records, retention normally up to six years for UK legal/accounting/audit/dispute purposes.

## Useful solicitor sources

- Companies Act 2006 s51: https://www.legislation.gov.uk/ukpga/2006/46/section/51
- Companies trading disclosures: https://www.legislation.gov.uk/uksi/2008/495/contents
- ICO controller/processor contracts: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/contracts-and-liabilities-between-controllers-and-processors-multi/
- Data Protection Act 2018: https://www.legislation.gov.uk/ukpga/2018/12/contents
- UK GDPR text: https://www.legislation.gov.uk/eur/2016/679/contents
- ICO PECR/direct marketing guidance: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/
- Late Payment of Commercial Debts Act: https://www.legislation.gov.uk/ukpga/1998/20/contents
- GOV.UK late commercial payments guidance: https://www.gov.uk/late-commercial-payments-interest-debt-recovery
- Unfair Contract Terms Act 1977: https://www.legislation.gov.uk/ukpga/1977/50/contents
- Protection from Harassment Act 1997: https://www.legislation.gov.uk/ukpga/1997/40/contents
- Administration of Justice Act 1970 s40: https://www.legislation.gov.uk/ukpga/1970/31/section/40
- FCA CONC: https://www.handbook.fca.org.uk/handbook/CONC/
- SRA reserved legal activities overview: https://www.sra.org.uk/consumers/choosing/legal-work-reserved/

## Practical workflow

1. Start a task monitor with `--lane recovery_desk` for contract-pack drafting.
2. Make clear this is a solicitor-review draft, not legal advice.
3. Draft a pack, not only one long terms document: MSA + DPA + Order Form + Recovery Authority/Guardrails + solicitor checklist.
4. Put entity placeholders at the top and flag the entity decision as the first gating item.
5. Package drafts as editable markdown/doc files and give the user the path/attachment.
6. Do not publish or send contracts to clients until the operator confirms solicitor review / final entity details.