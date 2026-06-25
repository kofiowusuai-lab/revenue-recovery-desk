# Client Letter Action Approval Artifacts

Use this when wiring Postal Portal / client-dashboard letter approvals or change requests. The client UI must not directly send physical mail; it should create a signed, auditable backend artifact that the gated executor can verify before dispatch.

## Pattern

- Add a server endpoint such as `/api/client-letter-action` for `approve` and `request_changes` actions.
- Authenticate the client session with the same bearer token/session path used by the dashboard.
- Resolve the authenticated client to its submission/profile and verify the target pending letter belongs to that client.
- Reject stale actions: if a matching `letter_approval` or `letter_change_requested` event already exists for the letter/source event, it should no longer count as pending.
- Require explicit signer fields for approval:
  - signer name
  - signer title/team/authority
  - signature image/body
- Never store the raw signature image as plaintext. Encrypt it server-side (AES-256-GCM or equivalent), store only encrypted payload + metadata, and include a non-secret hash for verification/deduping.
- Store the approval/change request as a `recovery_events` row rather than only mutating client-side state.

## Recommended event fields

For `letter_approval`:

- `letterKey`
- source letter/recovery event id
- signer name
- signer title/team/authority
- encrypted signature payload + IV/tag metadata
- signature hash
- preview/content hash, when available
- approving client user/account id
- timestamp
- send-gate status, e.g. `approved_for_executor_review`, not `sent`

For `letter_change_requested`:

- `letterKey`
- source letter/recovery event id
- requesting client user/account id
- change reason/details
- timestamp

## Pending-letter derivation

When rendering dashboard counts/lists, exclude letters that already have a terminal client action event:

- `letter_approval`
- `letter_change_requested`

This prevents a previously approved/rejected letter from staying in the pending count after refresh.

## Verification checklist

- Unit/API tests cover missing bearer token, missing signer fields, wrong client/letter ownership, duplicate terminal events, approval artifact creation, and change-request creation.
- Browser smoke covers the real Postal Portal/dashboard click path, not only static HTML string checks.
- Live verification includes both canonical ivory and branded FlowAudit routes when the operator expects branded URLs.
- A naked unauthenticated API request should return a JSON auth error (for example `Missing bearer token`) rather than HTML.

## Safety boundary

Creating `letter_approval` records is not the same as mailing the letter. Physical dispatch still belongs behind the RRD gated executor/PostGrid path, with the executor verifying approval artifacts and guardrails immediately before send.
