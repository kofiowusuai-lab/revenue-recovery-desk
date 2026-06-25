# Client dashboard secure Settings pattern

Session-derived UI/security rule for FlowAudit/RRD client dashboard Settings.

## Trigger
Use this when changing `revenue-recovery-web/client.html`, `/api/client-settings`, or any client-facing Settings/Integrations/Vault controls.

## Rules
- Do **not** expose client-facing controls that generate vault links or reconnect integrations from the dashboard (`Create secure vault link`, `Reconnect GoHighLevel`, `Reconnect monday.com`, `data-vault`, `data-provider`, `/api/client-vault-link`).
- For API/vault/CRM/accounting changes, show a support/meeting path instead: email `support@flowaudit.co.uk`, ask to schedule a meeting, verify identity, then send the specific link live during the meeting.
- Clients may edit ordinary business/contact details themselves: business name, industry, size, website, primary contact, phone, process owner/contact email, and business/trading address.
- Business edits must persist to Supabase `submissions` so the internal desk sees the same values, not just local/client-side state.
- Store address in `business_profile.address` unless/until a first-class address column exists.
- Emit an audit/reprovision reason such as `business_info_changed` from `/api/client-settings` when these values change.

## Implementation checklist
- UI: replace Integrations controls with a `Secure access changes` card and support/meeting copy.
- Client payload: include `businessInfo:{ company, industry, size, website, primaryContact, phone, address }` in the `/api/client-settings` POST body.
- API: whitelist and sanitize those fields in `mergeClientSettings`; patch top-level `company`, `industry`, `size`, `website`, `primary_contact`, `phone`; patch `business_profile.address`.
- Tests: assert integration buttons/routes are absent, support copy is present, mobile CSS exists, and core merge writes the expected `business_info_changed` patch/reason.
- Mobile: add iPhone-friendly CSS — stacked app layout, horizontal nav, one-column business edit grid, full-width primary actions, compact cards.

## Verification
- Run page and core tests, plus JS syntax checks for the extracted dashboard script and `api/client-dashboard-common.js`.
- Deploy `revenue-recovery-web` with real operator HOME and unset stale `VERCEL_TOKEN` if needed:
  `env -u VERCEL_TOKEN HOME=/Users/AIAgenterminal npx vercel --prod --yes`
- Verify both ivory and branded URLs contain the business edit/support copy and do not contain the removed integration controls.
