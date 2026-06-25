# One-time onboarding and provider-swap operating model

Use when discussing how clients complete onboarding once, or how to handle a later CRM/accounting/payment/email provider change without forcing full re-onboarding.

## Product standard

The client should complete onboarding once, connect systems once, approve the initial field map once, then not touch onboarding again unless their business rules change. Integration changes should be handled as a narrow provider-swap flow.

Separate these layers:

1. **Business/recovery policy** — stable: tone, approvals, do-not-contact rules, escalation ladder, compliance constraints, settlement limits, channels, sending authority.
2. **Integration connections** — replaceable: Salesforce/HubSpot/Pipedrive/Zoho, Xero/QuickBooks, Google/Microsoft, Stripe/Square/PayPal, etc.
3. **Field map** — provider-specific translation from a stable recovery schema to provider objects/fields.

Agents should reason against canonical recovery fields, not raw provider-specific field names.

## Canonical recovery schema examples

```text
invoice.id
invoice.number
invoice.amountDue
invoice.amountPaid
invoice.balanceRemaining
invoice.dueDate
invoice.status
invoice.paymentLink
customer.id
customer.name
customer.email
account.owner
flags.doNotContact
flags.disputed
flags.paymentPlan
flags.vip
history.lastContactedAt
history.recoveryNotes
```

## Provider field map examples

```json
{
  "accounting": {
    "provider": "quickbooks",
    "map": {
      "invoice.id": "Invoice.Id",
      "invoice.number": "Invoice.DocNumber",
      "invoice.balanceRemaining": "Invoice.Balance",
      "invoice.dueDate": "Invoice.DueDate",
      "customer.id": "Invoice.CustomerRef.value",
      "customer.email": "Customer.PrimaryEmailAddr.Address"
    }
  },
  "crm": {
    "provider": "salesforce",
    "map": {
      "account.id": "Account.Id",
      "contact.email": "Contact.Email",
      "flags.doNotContact": "Account.Do_Not_Contact__c",
      "flags.disputed": "Case.Status = Open OR Invoice__c.Disputed__c"
    }
  }
}
```

## One-time Salesforce/custom CRM mapping in access flow

When onboarding says Salesforce or another custom-mapping CRM, the integration-access email should include field-mapping questions and reassure the client that plain English/screenshots are acceptable. Ask where receivables live and for fields such as invoice object, invoice number, account/contact/email, amount due/paid/balance, due date, status, payment link, owner, last contacted, do-not-contact, dispute, payment plan, VIP, and notes/recovery history.

After OAuth approval, run read-only metadata discovery, propose a field map, and get approval before live recovery. Store the approved map in the client profile/policy so future cycles do not ask again.

## Provider swap flow

If a client changes provider, do **not** send them back through full onboarding. Ask only:

- Which system changed? CRM/accounting/payment/email/SMS/mail?
- Old provider
- New provider
- Who can authorize/connect the new system?
- Did data location/field names change?
- Effective switch date
- Keep old provider read-only for history, or revoke immediately?

Then:

1. Generate the new provider vault/OAuth link.
2. Operator runs `approve <drop-id>` after deposit/authorization.
3. Mark the old provider `archived_readonly` unless immediate credential destruction is requested.
4. Run metadata discovery for the new provider.
5. Produce a mapping diff: automatically mapped fields vs fields needing confirmation.
6. Store the approved new map.
7. Run dry-run recovery classification before any live send.

## Client-facing promise

Use this wording pattern:

> If you change CRM, accounting, payment, or email providers, you do not need to redo onboarding. Tell us what changed, connect the new provider, and we’ll migrate the field map. Your recovery rules, tone, approval settings, and compliance preferences stay in place.
