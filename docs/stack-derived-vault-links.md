# Stack-derived vault links

Use this when generating or reviewing a Revenue Recovery Desk secure vault link after onboarding.

## Rule
The vault form must match the exact tech stack the client told us during onboarding. Do not send generic credential catch-all links.

Derive requested fields from:
- payment platforms
- accounting system
- CRM name
- CRM API-access answer
- email provider
- SMS provider
- physical letter/mail channel

If a credential is already installed in the client profile `.env`, fresh links should ask only for the missing fields.

## Spreadsheet accounting
If `paymentStack.accounting` is `Spreadsheets`, the vault link should request spreadsheet access details, not an API key:

- `SPREADSHEET_SOURCE_URL` — Google Sheets / Excel Online / SharePoint link, or secure export location.
- `SPREADSHEET_ACCESS_INSTRUCTIONS` — how access is granted, tab names, and column mapping.
- `SPREADSHEET_REFRESH_CADENCE` — live shared sheet, daily export, weekly export, or manual upload before each batch.

Column mapping should cover customer/business name, invoice/reference, amount due, due date, paid/disputed/do-not-contact status, contact name, email, phone, and notes.

Reliable access preference order:
1. Live Google Sheet / Excel Online shared read-only with the recovery access identity.
2. SharePoint/OneDrive or Google Workspace OAuth/connect flow when needed.
3. Recurring CSV/export to a secure folder.
4. Manual CSV upload before each recovery batch, treated as stale unless refreshed.

## Custom / own CRM
If the CRM is custom/own/internal/proprietary/bespoke and `crmData.apiAccess` is `Yes`, request:

- `CUSTOM_CRM_API_BASE_URL`
- `CUSTOM_CRM_API_KEY`
- `CUSTOM_CRM_API_DOCS_URL`

Language should ask for a restricted/read-only API key or bearer token, not a user password. Minimum read access: customers/accounts, contact details, invoices/balances, payment status, due dates, and account notes. Add write/activity-log access only with explicit approval.

If there are no docs, route to a mapping call or CSV/export workflow rather than pretending the integration is ready.

## Verification pattern
Before sharing a link:
1. Run the harness/pack path for the submission.
2. Compare requested fields against the onboarding stack.
3. Confirm the output names the intended company/profile.
4. If you generated a bad/incomplete pending link, expire it and generate a corrected one before sharing.

Example for a client with Stripe + Spreadsheets + Own CRM with API access + Letters:

```text
STRIPE_API_KEY
SPREADSHEET_SOURCE_URL
SPREADSHEET_ACCESS_INSTRUCTIONS
SPREADSHEET_REFRESH_CADENCE
CUSTOM_CRM_API_BASE_URL
CUSTOM_CRM_API_KEY
CUSTOM_CRM_API_DOCS_URL
POSTGRID_API_KEY
```

If Stripe/PostGrid are already installed, a fresh link should request only the missing spreadsheet/custom CRM fields.