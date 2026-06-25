# Connector public docs and OAuth app reuse

Use this when adding or reviewing Revenue Recovery Desk integrations.

## Save public documentation locations

When a connector depends on OAuth/API behavior, save the authoritative public docs URL(s) in the relevant connector reference file before calling the connector "done". If the docs are not mirrored, at least store stable locations for:

- OAuth app/developer console setup;
- authorization and token endpoints;
- required scopes/permissions;
- refresh-token behavior;
- data-center/region behavior;
- API object references used for invoices, contacts, payments, or receivables.

Prefer provider docs over blog/forum sources. Verify URLs return 200 when practical. Keep docs links in `references/` alongside the connector, not just in chat, so future sessions can re-check upstream changes.

## OAuth app reuse stance

Decide app reuse by OAuth platform and allowed scopes, not by display name alone.

- Zoho Books and Zoho CRM both use Zoho Accounts OAuth. A single Zoho server-based app may be reused if it has the RRD callback URL and can request the required Books scopes.
- Even when one upstream app is reused, keep RRD provider ids and env keys separate, e.g. `ZOHOBOOKS_*` vs `ZOHO_*`, so readiness and token storage cannot confuse CRM authorization with accounting authorization.
- Create a separate provider app when the existing app cannot request the new scopes, has the wrong redirect/data-center configuration, or consent clarity is better with a dedicated app name.

## OAuth link smoke verification

After installing or reusing OAuth app credentials, run a safe authorize-link smoke test before calling the connector ready. The reusable probe is `scripts/oauth-authorize-smoke.mjs`; it builds provider authorize URLs with redacted output and checks for provider login/consent rather than immediate callback/client errors. See `references/oauth-link-verification.md` for current callback-base quirks and safe reporting rules.

Do not follow through login/consent during this test. A successful smoke test is reaching provider auth/login, not obtaining a token.

## Review pitfalls to test

- Region-aware providers may return an API domain that is not the token host. For Zoho, convert stored `zohoapis.*` API domains back to `accounts.zoho.*` before refresh.
- OAuth token endpoints using HTTP Basic auth should percent-encode client id and secret before Base64 encoding.
- Readiness checks should match OAuth providers by stable provider id, not fuzzy display-name matching such as first word (`Zoho`).

## Mapping boundary

Connector docs/access only establish how to authenticate and read. Client-specific mapping still requires client-provided or client-approved details for invoice location, open/overdue identification, contact fields, balances/dates/status, payment URLs, and dispute/payment-plan/do-not-contact/VIP flags.
