# Operator bottlenecks and launch-readiness stance

Use this when the operator asks whether the Revenue Recovery Desk system is ready to ship, what still needs manual action, or where they are the bottleneck.

## Current operating model

The system is intended to minimize manual credential handling:

1. Client completes onboarding.
2. Operator provisions the profile.
3. System sends/prints separate welcome + integration-access flows.
4. Client deposits API keys through the secure vault and authorizes OAuth through connect links.
5. Operator approves the deposited drop locally with `rrd-vault approve <drop-id>`.
6. Keys/tokens land in that client's profile `.env`; values are never printed.
7. Run a readiness/gate test before live recovery.

User-facing language should be **approve**, not claim/decrypt. `claim` may remain a backward-compatible alias but should not be the primary operator instruction.

## Where the human operator remains the bottleneck

1. **OAuth developer apps + app credentials**
   - The operator must create developer apps and supply app-level client IDs/secrets for OAuth connectors.
   - Currently wired OAuth providers: Salesforce, HubSpot, Zoho CRM.
   - Future connectors needing build/wiring after app creation: QuickBooks Online, Xero, Google Workspace/Gmail, Microsoft 365/Outlook.

2. **Approving deposited credential/OAuth drops**
   - Required local action: `rrd-vault approve <drop-id>`.
   - This decrypts API-key drops or exchanges OAuth codes on the Mac, writes env key names into the client profile, and burns the drop.
   - This is intentional because private keys and OAuth app secrets live only on the operator Mac.

3. **Field mapping / readiness judgment**
   - API/OAuth access proves connectivity, not operational mapping.
   - Confirm where invoices, contacts, balance, due date, status, do-not-contact, VIP, dispute, payment-plan, and owner/escalation fields live.
   - Stripe-style data may be straightforward; Salesforce/HubSpot/custom CRM often needs mapping.

4. **First-send / go-live decision**
   - The executor enforces guardrails, but the operator decides the initial mode: dry-run, approval-gated batches, or authorized auto-send channels.

5. **Paid Orgo runtime decision**
   - The user does not want to pay for Orgo until client revenue comes in.
   - Use Orgo's one free computer for end-to-end testing; launch can be API-only/manual-supervised until a client pays.

6. **Sales assets before outreach**
   - Before heavy outreach, the operator still needs a winning VSL script and distribution mechanism.
   - Outreach comes after OAuth app setup + full faux-data readiness test.

## Not bottlenecks if already verified

- Landing page deployed at `/`.
- Onboarding form deployed at `/onboarding`.
- Internal dashboard at `/desk`.
- Per-client provisioning.
- Welcome pack and separate integration-access email.
- Secure vault link generation.
- Recovery guardrail gate.
- Support/cancellation inbox automation.
- Final-payment/offboarding watcher.

## Recommended answer shape

Lead with the direct answer, then separate:

- **Bottlenecks that require the operator**
- **Bottlenecks that require client action**
- **System pieces already automated/working**

Be precise: do not claim live recovery readiness if real client APIs/OAuth or field mapping are missing.
