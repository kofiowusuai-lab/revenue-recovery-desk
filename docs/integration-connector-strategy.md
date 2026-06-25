# Integration connector strategy

Use this when explaining how a client's Jeremy / revenue-recovery Hermes agent will connect to third-party systems.

## Composio fallback / expansion layer

If a direct OAuth provider flow is brittle or the platform is outside the core connector set, use Composio as the integration access layer rather than spending a whole session on native OAuth plumbing. Pipedrive is the current proven example: native Pipedrive OAuth returned 401 from the provider, while Composio Pipedrive with custom OAuth credentials and a connected-account subdomain produced an ACTIVE connection and successful read-only smoke calls.

Use Composio for:

- long-tail CRMs/accounting tools not already wired directly;
- platforms where provider app setup is blocking progress;
- rapid "can we support this?" read-only probes.

Do not move recovery policy into Composio. RRD still owns consent, client-approved mapping, do-not-contact/VIP/dispute/payment-plan flags, approval-gated sending, audit logs, readiness, and offboarding. See `references/composio-connectors.md` and `/Users/AIAgenterminal/rrd-composio`.

## Classify each system first

Before asking for credentials, classify the platform:

1. **API-key / token systems** — use the encrypted vault link per client.
   - Examples: Stripe restricted keys, Square access token, PayPal client ID/secret, Twilio, SendGrid, Postmark, Mailgun, Lob/PostGrid.
   - Flow: generate `rrd-vault new <submission-id>`, client submits once, operator claims with `rrd-vault claim <drop-id>`, keys land in that client's profile `.env`.

2. **OAuth systems** — do not ask for raw secrets through the vault. Use a reusable "Connect <platform>" authorization flow.
   - Examples: Salesforce, HubSpot, Zoho CRM, QuickBooks Online, Xero, Google Workspace/Gmail, Microsoft 365/Outlook, and Pipedrive.
   - QuickBooks Online / Intuit is an OAuth accounting connector. The OAuth layer uses Intuit's broad accounting scope, so enforce read-only behavior through RRD policy/guardrails unless explicit write actions are approved later.
   - Pipedrive is an OAuth CRM connector for launch; its OAuth URL does not carry a scope parameter because permissions are controlled in the Pipedrive app settings. Configure read-oriented permissions for discovery/mapping first.
   - Xero is specifically an OAuth accounting connector, not a pasted API key. Use `rrd-vault connect <submission-id> xero` after installing the Xero developer app credentials locally; see `references/xero-oauth-setup.md`.
   - Sage is an OAuth accounting connector for launch. Use `rrd-vault connect <submission-id> sage` after installing `SAGE_OAUTH_CLIENT_ID` / `SAGE_OAUTH_CLIENT_SECRET` locally. The RRD connector uses Sage Accounting OAuth (`full_access` + `filter=apiv3.1`) and keeps the recovery agent read-only through policy/guardrails; confirm whether the client is on Sage Accounting vs Sage Intacct/Sage 200 during field mapping.
   - FreshBooks is an OAuth accounting connector for launch. Use `rrd-vault connect <submission-id> freshbooks` after installing `FRESHBOOKS_OAUTH_CLIENT_ID` / `FRESHBOOKS_OAUTH_CLIENT_SECRET`; request profile/client/invoice read scopes and treat as connected-but-not-operational until invoice/customer field mapping is approved.
   - Wave / Wave Invoicing is an OAuth accounting connector for launch. Use `rrd-vault connect <submission-id> wave` after installing `WAVE_OAUTH_CLIENT_ID` / `WAVE_OAUTH_CLIENT_SECRET`; request business/customer/invoice read scopes and require mapping before recovery.
   - Zoho Books is an OAuth accounting connector for launch. Use `rrd-vault connect <submission-id> zohobooks` after installing `ZOHOBOOKS_OAUTH_CLIENT_ID` / `ZOHOBOOKS_OAUTH_CLIENT_SECRET`; request invoice/contact/settings read scopes and keep it distinct from Zoho CRM.
   - FreeAgent is an OAuth accounting connector for launch. Use `rrd-vault connect <submission-id> freeagent` after installing `FREEAGENT_OAUTH_CLIENT_ID` / `FREEAGENT_OAUTH_CLIENT_SECRET`; FreeAgent uses Basic auth at token exchange.
   - Authorize.net is already a secure vault/API-key payment connector using `AUTHNET_API_LOGIN_ID` / `AUTHNET_TRANSACTION_KEY`; do not ask for an Authorize.net username/password.
   - Bill.com can appear as either payment platform or accounting/invoicing system for launch. Treat it as a secure vault/API-key connector using `BILLCOM_API_KEY` for now; do not ask for a Bill.com login password.
   - NetSuite is specifically a vault/token accounting connector for launch, not OAuth: collect the NetSuite token/integration values through `rrd-vault new <submission-id>` and keep it connected-but-not-operational until field mapping is confirmed.
   - For the long-tail expansion list, prefer native API/vault over Composio whenever a client can supply a scoped API token/key: Whop, Maxio, Paystack, Razorpay, Lemon Squeezy, MoonClerk, Clientary, Moneybird, Sevdesk, Lexoffice, Quaderno, Elorus, Coupa tenant client credentials, Odoo API key, Capsule CRM, Attio, Kommo, Nutshell, Salesflare, Salesmate, noCRM.io, ActiveCampaign, and RepairShopr. Shopify intentionally uses the OAuth/Composio route instead of asking each client to create a custom app first. Keep Chaser and AccuLynx as Composio-managed until a stable client-token route is confirmed.
   - Flow: create the platform app/connected app once, generate a client-specific connect URL, client logs into the vendor directly, callback exchanges auth code for tokens, tokens are stored in that client's Hermes profile.
   - Xero-specific note: create a Web app with callback `https://flowaudit.co.uk/revenue-recovery/oauth-callback`, install `XERO_OAUTH_CLIENT_ID` / `XERO_OAUTH_CLIENT_SECRET` locally, then generate links with `rrd-vault connect <submission-id> xero`. See `references/xero-oauth-setup.md`.

3. **Browser-only/admin portal systems** — do not ask for passwords. Require either a documented integration route, an approved API/OAuth path, or explicit browser automation setup with human supervision.

## NetSuite launch stance

For early GTM, NetSuite is a **secure vault / token-based accounting connector**, not a generic OAuth connect-link provider. A client NetSuite admin should create a read-oriented integration/token role and deposit only the following values through the encrypted vault:

- `NETSUITE_ACCOUNT_ID`
- `NETSUITE_CONSUMER_KEY`
- `NETSUITE_CONSUMER_SECRET`
- `NETSUITE_TOKEN_ID`
- `NETSUITE_TOKEN_SECRET`
- `NETSUITE_RESTLET_URL` (optional when using a RESTlet-based data endpoint)
- `NETSUITE_SUITEQL_ENABLED` (flag/context for SuiteQL availability)

Do not ask for a NetSuite username/password. Treat a deposited NetSuite token set as **connected but not operational** until field mapping is confirmed: invoice object/source, customer/contact joins, balance/due date/status fields, dispute/payment-plan/do-not-contact flags, and payment link/source-of-truth behavior.

## Provider swaps without re-onboarding

The product goal is: client completes onboarding once, then only reconnects/re-approves changed systems when providers change. Keep these concepts separate:

1. **Recovery policy** — tone, guardrails, do-not-contact logic, escalation rules, approval model, channels. This should survive provider changes.
2. **Integration manifest** — active CRM/accounting/payment/email providers and previous/archived providers.
3. **Field map** — provider-specific mapping from canonical recovery fields to provider objects/fields.

Use a canonical schema in agent reasoning, then translate through provider maps. Example canonical fields:

```text
invoice.id
invoice.number
invoice.balance
invoice.dueDate
invoice.status
customer.id
customer.name
customer.email
owner.email
doNotContact
disputeFlag
paymentPlanFlag
vipFlag
recoveryNotes
```

If a client switches Salesforce → HubSpot or Xero → QuickBooks, do not ask them to redo onboarding. Run a short change-provider flow: old provider, new provider, authorizer, data-location notes, whether to keep old access read-only for history. Generate a new OAuth/vault link, run discovery, propose a mapping diff, and ask for approval only on the changed map.

## Salesforce pattern

Salesforce is handled with a Connected App + OAuth, not a vault key.

One-time platform setup:
- Create a Salesforce Connected App from a Salesforce org / Developer Edition org.
- Configure callback URL for the Revenue Recovery Desk OAuth callback endpoint.
- Scopes usually include `api` and `refresh_token` / `offline_access`; add identity scopes only if needed.
- Store app-level `SALESFORCE_CLIENT_ID` / `SALESFORCE_CLIENT_SECRET` in the operator connector environment, not in client chat.

Per-client setup:
- Send a client-specific "Connect Salesforce" link.
- Client admin/user authorizes inside their own Salesforce org.
- Store `SALESFORCE_INSTANCE_URL`, access token, refresh token, and connection metadata in that client's Hermes profile.
- Run a read-only connection test before going live: refresh token works, instance URL is valid, required objects/fields are accessible.

Important distinction:
- The Connected App is normally created once and reused across clients.
- Each client still authorizes separately, producing tokens scoped only to their own Salesforce org.
- Some enterprise orgs may require admin approval/pre-authorization of the Connected App.

## QuickBooks Online and Pipedrive launch stance

For GTM, QuickBooks Online / Intuit and Pipedrive are treated as OAuth/connect-link providers, not manual-only loose ends.

- QuickBooks Online: use `rrd-vault connect <submission-id> quickbooks`. Intuit uses the broad OAuth scope `com.intuit.quickbooks.accounting`; keep the RRD agent read-only by policy/guardrails unless write actions are explicitly approved. Preserve Intuit callback `realmId` into `QUICKBOOKS_REALM_ID`.
- Pipedrive: use `rrd-vault connect <submission-id> pipedrive`. Do not send a `scope` query param; Pipedrive app permissions are selected in the developer UI. For launch, configure read/discovery permissions only (basic info, deals, contacts, activities, users, custom deal/contact fields as needed).
- Close and GoHighLevel remain API-key/token vault providers unless/until OAuth is explicitly added.

See `references/quickbooks-pipedrive-oauth-launch.md` for exact env keys, token fields, and verification commands.

## Field mapping is separate from connection

OAuth/API credentials only prove access. For operational readiness, collect/verify field mapping across every system that may hold recovery-critical data, not just Salesforce.

Mapping buckets to cover during access/onboarding:

1. **Accounting / invoice systems** — Xero, QuickBooks Online, Sage, FreshBooks, FreeAgent, NetSuite, etc.
   - where open/overdue invoices live;
   - invoice number/reference;
   - customer/account relationship;
   - amount due, amount paid, balance remaining, currency;
   - invoice date, due date, payment terms, status/paid status;
   - payment link / hosted invoice URL;
   - credit notes, partial payments, write-offs, payment-plan markers, tax/VAT fields if relevant.
2. **Payment platforms** — Stripe, Square, PayPal, Adyen/Braintree/Shopify payments, etc.
   - charges/invoices/subscriptions or retainer records;
   - payment links, failed payments, disputes, refunds;
   - customer identifier used to match back to CRM/accounting;
   - product/price/retainer labels that must not be changed.
3. **CRM / customer systems** — Salesforce, HubSpot, Zoho, Pipedrive, monday.com, GoHighLevel/HighLevel, Close, Airtable, etc.
   - customers/accounts, contacts, deals/opportunities/jobs, owners;
   - email, phone, mailing address, preferred contact;
   - owner/account manager/escalation owner;
   - do-not-contact, dispute, payment-plan, VIP/strategic account, legal/collections, vulnerable/sensitive-account flags;
   - last contacted, next follow-up, recovery notes/history;
   - where to write back activity: task, note, call log, email log, deal update, case/ticket, or custom object.
4. **Email/comms systems** — Google Workspace, Microsoft 365, SendGrid/Postmark/Mailgun/Twilio, etc.
   - sender identity, reply handling, suppression/opt-out lists, templates, DNS owner, and logging destination.

The access email (`rrd-welcome-pack access`) now includes a generic **Field mapping / data-location check** section for accounting, payment, and CRM platforms. Clients can reply with field names, screenshots, report names, or a short Loom. Tell them not to email credentials or customer-sensitive exports. If mapping is missing, report the client as connected but not operational.

### Salesforce access + field-mapping process

When a client selects Salesforce during onboarding, the access step should collect both authorization and mapping context:

1. Send the client-specific Salesforce OAuth connect link; never ask for their Salesforce password.
2. Include short mapping questions in the access email:
   - Where do overdue invoices / receivables live? Options: Opportunities, Accounts, Contacts, Cases, custom object such as `Invoice__c` / `Payment__c` / `AR__c`, integrated accounting/payment system, or not sure.
   - Ask for known field labels/API names for: invoice object, invoice number, customer/account, contact/email, amount due, amount paid, balance remaining, due date, status, payment link, owner/account manager, last contacted, do-not-contact, dispute flag, payment-plan flag, VIP/strategic flag, notes/recovery history.
   - Tell clients plain-English descriptions, screenshots, or exports are acceptable if they do not know API names.
3. After `approve <drop-id>`, run a read-only metadata discovery pass before live recovery:
   - Inspect standard objects (`Account`, `Contact`, `Opportunity`, `Task`, `Event`, `Case`) and custom objects ending in `__c`.
   - Pull field labels, API names, types, and relationships.
   - Look for likely recovery fields containing amount, balance, due date, invoice, status, payment, overdue, dispute, do-not-contact, owner, or VIP.
4. Produce a proposed mapping for operator/client approval.
5. Only after mapping approval run dry-run recovery classification, then approval-gated outreach.

Recommended access-email copy:

```text
Salesforce users: after you connect Salesforce, please reply with any known field names or screenshots showing where overdue invoices, balances, due dates, customer contact details, payment status, disputes, payment plans, and do-not-contact/VIP flags live.

If you are not sure, that is fine — we will run a read-only metadata scan and send you a proposed field map for approval before any recovery activity starts.
```

## Recommended connector roadmap

Prioritize connectors by likely Revenue Recovery Desk usage:
1. Salesforce OAuth — CRM records, tasks, notes, escalation logging.
2. HubSpot OAuth — common SMB CRM.
3. QuickBooks Online OAuth — invoices/accounting; use `rrd-vault connect <submission-id> quickbooks` once the Intuit app credentials are installed.
4. Xero OAuth — accounting; use `rrd-vault connect <submission-id> xero`.
5. Sage OAuth — accounting; use `rrd-vault connect <submission-id> sage` once the Sage app credentials are installed, then verify exact Sage product/API + field mapping.
6. FreshBooks OAuth — accounting/invoicing; use `rrd-vault connect <submission-id> freshbooks` once FreshBooks app credentials are installed.
7. Wave OAuth — accounting/invoicing; use `rrd-vault connect <submission-id> wave` once Wave app credentials are installed.
8. Zoho Books OAuth — accounting/invoicing; use `rrd-vault connect <submission-id> zohobooks` once Zoho Books app credentials are installed.
9. FreeAgent OAuth — accounting/invoicing; use `rrd-vault connect <submission-id> freeagent` once FreeAgent app credentials are installed.
10. NetSuite vault-token connector — accounting/invoicing; use `rrd-vault new <submission-id>` and collect the NetSuite token values, then require field mapping before operational readiness.
11. Google Workspace OAuth — Gmail/Drive metadata; Google warnings require consent verification for sensitive scopes.
12. Microsoft 365 OAuth — Outlook sending/logging.
13. Pipedrive OAuth — CRM records; private app is acceptable for early GTM, permissions are controlled in the Pipedrive app settings rather than URL scope params.
14. Stripe/Square/PayPal/Braintree/GoCardless/Bill.com/Authorize.net/Twilio via vault — payment/SMS infrastructure.
15. Lob/PostGrid via vault — physical letters.
8. Lob/PostGrid via vault — physical letters.

## Current launch classification updates

For launch, QuickBooks Online and Pipedrive should be treated as OAuth/connect-link providers, not as manual-only or pasted-token providers:

- **QuickBooks Online / Intuit**: client-facing OAuth connect link. Store `QUICKBOOKS_ACCESS_TOKEN`, `QUICKBOOKS_REFRESH_TOKEN`, `QUICKBOOKS_TOKEN_EXPIRES_AT`, and `QUICKBOOKS_REALM_ID`. Intuit's accounting scope is broad, so keep agent behavior read-only by RRD guardrail/policy unless write actions are explicitly approved.
- **Pipedrive**: client-facing OAuth connect link. Store `PIPEDRIVE_ACCESS_TOKEN`, `PIPEDRIVE_REFRESH_TOKEN`, `PIPEDRIVE_TOKEN_EXPIRES_AT`, and `PIPEDRIVE_API_DOMAIN`. Pipedrive permissions are controlled by developer app settings rather than a `scope` query parameter; configure read-only discovery permissions for initial GTM.

Close and GoHighLevel remain API-key/token providers through the secure vault unless a future OAuth connector is explicitly built.

QuickBooks and Pipedrive should be treated as client-facing OAuth/connect-link integrations for launch, not unresolved manual-only items. Close and GoHighLevel remain API-key/token vault paths unless OAuth support is explicitly added later.

## User-facing explanation pattern

Keep the answer direct:
- "Create the app/connector once; each client authorizes their own account separately."
- "Vault is for API keys. OAuth/connect links are for Salesforce/HubSpot/QuickBooks/Xero/Gmail/Outlook."
- "After connection, we still need field mapping before the agent can reliably navigate the client's system."
