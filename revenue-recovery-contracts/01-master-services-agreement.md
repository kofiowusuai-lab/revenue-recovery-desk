# Revenue Recovery Desk Master Services Agreement

**Solicitor-review draft — not legal advice**

This Master Services Agreement is made between:

1. **Provider:** `[FOUNDER LEGAL NAME] trading as FlowAudit`, whose principal place of business is `[ADDRESS]` (`Provider`, `we`, `us`); and
2. **Client:** the business named in the applicable Order Form (`Client`, `you`).

The interim contracting basis is founder/sole-trader style: `[FOUNDER LEGAL NAME] trading as FlowAudit`. “FlowAudit” alone is a brand/trading style and is not a separate legal entity unless incorporated. This should be reviewed by a solicitor because it can create personal liability for the founder until a company or other entity takes over.

## 1. Agreement structure
1.1 This Agreement consists of this MSA, the Order Form, the Data Processing Agreement, the Recovery Authority and Guardrails Schedule, and any signed Statement of Work.

1.2 If there is a conflict, the order of priority is: signed Order Form, signed SOW, DPA for data-processing matters, Recovery Authority for operational authority, then this MSA.

## 2. Services
2.1 The Provider supplies a software-assisted revenue recovery and payment reminder service for B2B clients, which may include reviewing connected invoice/accounting/CRM/payment/email/document metadata; identifying overdue or due-soon invoices; drafting and, where approved, sending payment reminders and recovery messages; preparing reports and audit trails; operating client-specific workflows, guardrails and approval queues; and creating or using approved payment links where authorised.

2.2 The exact scope is set out in the Order Form and Recovery Authority.

2.3 The Provider does **not** provide legal, tax, accounting, insolvency, credit-reporting, debt counselling, debt-adjusting, litigation, regulated consumer-credit, or solicitor services. No solicitor-client relationship is created.

2.4 The Provider does not guarantee any recovery amount, payment timing, debtor response, customer retention, or commercial outcome.

## 3. Appointment and limited authority
3.1 The Client appoints the Provider as a limited operational agent solely to perform the authorised Services.

3.2 The Provider may contact customers/debtors only within the channels, templates, thresholds and guardrails approved in the Recovery Authority.

3.3 The Provider must obtain explicit written approval before offering discounts/write-offs/settlements/payment plans outside approved limits; threatening or commencing legal action; referring a debt to a solicitor, debt collection agency, credit bureau or enforcement provider; contacting any person flagged as do-not-contact, vulnerable, legally represented, disputed, insolvent, or outside agreed debtor categories; or making statements about legal consequences, credit impact, account suspension or service termination unless pre-approved.

3.4 Payments should be made directly to the Client or the Client’s payment processor. The Provider must not hold client money unless separately agreed in writing after legal/regulatory review.

## 4. Client responsibilities and warranties
4.1 The Client warrants that it has authority to enter this Agreement; invoices supplied to the Service are genuine, accurate, due and payable unless clearly marked otherwise; customer/debtor contact details, balances, due dates, VAT, PO references and payment terms are accurate to the best of its knowledge; it has a lawful basis to share relevant customer/debtor personal data with the Provider; it has the right to connect the systems and accounts it authorises; it will promptly flag disputes, complaints, insolvency notices, legal proceedings, vulnerability indicators, consumer/regulated-credit indicators, and do-not-contact instructions; and it will not use the Service for fraudulent, harassing, misleading, unlawful or abusive recovery activity.

4.2 The Client remains responsible for its customer relationships, debt validity/enforceability, commercial decisions about settlement/discounts/write-offs/escalation, its contracts/privacy notices/accounting/compliance obligations, and reviewing outputs where approval is required.

## 5. Fair communications and acceptable use
5.1 The Provider may suspend or refuse any workflow that appears unlawful, unsafe, abusive, misleading, reputationally risky, or outside approved scope.

5.2 Neither party may use the Service to harass, threaten, impersonate, mislead, spam, contact at unreasonable frequency, make false legal threats, or pursue a debt known to be disputed without an agreed dispute-handling process.

5.3 Consumer debts, sole traders, individual guarantors, regulated credit agreements and vulnerable individuals require prior disclosure and separate written approval before any recovery activity.

## 6. Approvals, authorised contacts and audit logs
6.1 The Client must maintain an up-to-date list of authorised contacts.

6.2 The Provider may rely on approvals and instructions from authorised contacts by email, in-platform approval, signed form, or another agreed channel.

6.3 The Provider will keep reasonable audit records of recovery rules, approvals, messages, decisions and operational events.

6.4 If the Client does not respond to an approval request, the Provider may pause the workflow. No deemed approval applies unless expressly stated in the Order Form.

## 7. Integrations, credentials and security
7.1 The Client will provide only the access reasonably needed for the Services, preferably via OAuth or the Provider’s secure vault. Secrets must not be sent by email, SMS, chat or unapproved channels.

7.2 The Provider will use reasonable administrative, technical and organisational safeguards including least-privilege access, per-client isolation, secure credential handling, audit logs and credential destruction on verified offboarding.

7.3 The Client is responsible for its own systems, provider accounts, MFA, domain/DNS settings, sender reputation, and revoking access when no longer required.

7.4 Either party must notify the other promptly of a suspected security incident relevant to the Services.

## 8. AI-assisted processing
8.1 The Service may use AI/LLM tools to classify invoices, summarise records, draft communications and suggest next actions.

8.2 AI-assisted outputs may be inaccurate, incomplete or unsuitable without human review. The Provider applies guardrails, but the Client remains responsible for approvals and commercial decisions.

8.3 AI outputs are not legal, accounting, tax, insolvency or regulated advice.

## 9. Fees and payment
9.1 Fees are set out in the Order Form and may include setup fees, retainers, usage fees, success fees or other charges.

9.2 Unless otherwise stated, fees are exclusive of VAT and payable through Stripe or another approved payment method.

9.3 If success fees apply, the Order Form must define “Recovered Revenue” precisely, including cash received, payment plans, partial payments, offsets, credits, prior commitments, timing windows and exclusions.

9.4 Late payment may result in suspension of Services and interest/recovery costs under the Late Payment of Commercial Debts regime or the rate stated in the Order Form.

9.5 If physical letters are enabled, the Client may provide its own PostGrid API key through the secure vault or opt out of physical letters when asked for access. If the Client does not provide its own PostGrid API key, does not opt out, and later approves or authorises physical letters, the Provider may pass through and invoice at month-end any postage, print, processing, certified-mail or related letter costs incurred, in addition to the maintenance/retainer fee and any other agreed fees. The current per-piece estimate is $1.219 per letter plus 20p per page, plus any certified-mail or provider pass-through extras, unless the Order Form states different pricing.

## 10. Confidentiality
10.1 Each party must keep the other’s confidential information confidential and use it only for this Agreement.

10.2 Confidential information includes debtor/customer lists, pricing, recovery performance, credentials, workflows, reports, business processes, platform know-how and non-public technical information.

10.3 Disclosure is allowed to employees, contractors, subprocessors, professional advisers, regulators, courts, or as required by law, provided confidentiality is protected where appropriate.

## 11. Data protection
11.1 The parties will comply with applicable data protection law, including the UK GDPR and Data Protection Act 2018.

11.2 For customer/debtor personal data processed in recovery workflows, the Client is normally controller and the Provider is processor. The DPA applies.

11.3 For Provider account administration, billing, security, audit, support and compliance records, the Provider may act as an independent controller.

## 12. Third-party services
12.1 The Service depends on third-party platforms including hosting, databases, payment processors, email providers, letter providers, AI providers and the Client’s connected systems.

12.2 The Provider is not responsible for third-party outages, provider policy changes, account suspensions, rate limits, incorrect data from connected systems, or client-side access failures.

## 13. Intellectual property
13.1 The Provider owns the Service, platform, software, workflows, templates, prompts, automations, know-how, documentation and improvements.

13.2 The Client owns its pre-existing data and materials.

13.3 The Client grants the Provider a limited licence to use Client data and materials to provide, secure, support, improve and evidence the Services, subject to confidentiality and data protection terms.

13.4 Reports produced specifically for the Client may be used by the Client internally, but the Provider retains underlying platform IP and generic methodologies.

## 14. Indemnities
14.1 The Client will indemnify the Provider against losses, claims, fines, costs and expenses arising from inaccurate, invalid, unlawful or misleading invoice/debtor data; Client instructions/templates/content; disputed/fraudulent/consumer/regulated/legally sensitive debts not properly disclosed; the Client’s failure to provide privacy notices, lawful basis or authority; or Client breach of law, third-party terms or this Agreement.

14.2 The Provider will indemnify the Client against third-party claims that the Provider’s platform infringes intellectual property rights, subject to prompt notice, cooperation, Provider control of defence/settlement, and the liability caps.

## 15. Liability
15.1 Nothing limits liability for death or personal injury caused by negligence, fraud, fraudulent misrepresentation, or anything else that cannot lawfully be limited.

15.2 Subject to clause 15.1, neither party is liable for indirect, consequential, special or punitive loss, loss of profit, loss of revenue, loss of goodwill, loss of opportunity, loss of anticipated savings, or loss arising from unrecovered debts.

15.3 Subject to clause 15.1, the Provider’s total aggregate liability arising from this Agreement is limited to the fees paid by the Client in the 12 months before the event giving rise to the claim, unless the Order Form states a different solicitor-approved cap.

15.4 A separate higher cap for data protection/security claims may be agreed in the Order Form if commercially required.

## 16. Suspension and termination
16.1 Either party may terminate according to the Order Form.

16.2 The Provider may suspend Services immediately for non-payment, suspected unlawful use, compromised credentials, abusive communications, excessive complaints, security risk, breach of acceptable use, or regulatory/reputational risk.

16.3 Either party may terminate for material breach not remedied within 14 days of notice, insolvency, or unlawful performance.

## 17. Offboarding, retention and deletion
17.1 On verified offboarding, the Provider will stop active workflows, revoke/destroy live credentials where technically possible, archive required records, and confirm completion.

17.2 The Provider may retain limited records for legal, accounting, audit, security and dispute-resolution purposes, normally up to six years unless a longer period is required.

17.3 The Provider will not retain live integration secrets after offboarding unless legally required or expressly agreed.

## 18. Assignment / future entity transfer
18.1 The Provider may assign or novate this Agreement to a successor company, group company, incorporated operating entity, or purchaser of substantially all relevant business/assets, provided the successor assumes the Provider’s obligations and the Client’s rights are not materially reduced.

18.2 If required by law or client procurement rules, the Client will not unreasonably withhold consent to such assignment/novation.

18.3 This clause is especially important if the initial contracting party is a founder/sole trader or trading style before a dedicated company is formed.

## 19. Disputes
19.1 The parties will first escalate disputes to senior contacts and attempt good-faith resolution.

19.2 The Provider may pause recovery on accounts affected by a dispute or complaint until clarified.

## 20. Governing law
20.1 This Agreement is governed by the laws of England and Wales.

20.2 The courts of England and Wales have exclusive jurisdiction.

## Signing block

**Provider:** `[FOUNDER LEGAL NAME] trading as FlowAudit`  
Signature: ____________________  
Name: ____________________  
Title/capacity: Founder / Sole Trader  
Date: ____________________

**Client:** `[CLIENT LEGAL ENTITY]`  
Signature: ____________________  
Name: ____________________  
Title/capacity: ____________________  
Date: ____________________
