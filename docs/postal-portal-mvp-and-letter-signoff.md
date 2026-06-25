# Postal Portal MVP + Letter Sign-off Gate

Use this when building or extending client-facing physical-letter approval flows for the Revenue Recovery Desk.

## Product direction

- The Postal Portal is the foundation for the broader client dashboard.
- It should be linked from the client welcome email, not treated as one email per letter.
- The client sees pending physical letters in one private portal, clicks a letter, previews it, adds signer details/signature, then approves or rejects.
- Hard rule: **No portal signature approval, no physical letter.**
- The portal is a final authorization layer before PostGrid/letter dispatch, separate from internal operator approval.

## MVP shape built in-session

Route:
- `/postal-portal`
- Direct ivory base: `https://revenue-recovery-web-ivory.vercel.app/postal-portal`
- Branded path when rewrite is live: `https://flowaudit.co.uk/revenue-recovery/postal-portal`

Page behavior:
- FlowAudit-themed UI using `theme.css`, Instrument Serif/Inter, cream/espresso palette, pill buttons, card surfaces.
- Token/demo-gated portal page.
- Pending letter list.
- Letter preview panel.
- Signer controls:
  - signer name
  - signer title/team
  - signature image upload
- Live preview with signature/name inserted.
- Actions:
  - `Approve signature and queue this letter`
  - `Reject / request changes`
- Explicit MVP disclaimer: page does not send live letters until backend audit/hash/PostGrid wiring exists.

Welcome pack update:
- Include a secure FlowAudit Postal Portal link alongside the go-live tracker.
- Copy should say pending physical letters appear there for final review, signer name/team entry, signature upload, approval, or rejection.
- Copy should explicitly say no physical letter is sent without portal sign-off.

## Security headers / privacy posture

For `/postal-portal`, set noindex/no-referrer/frame denial and a restrictive CSP:
- `X-Frame-Options: DENY`
- `X-Robots-Tag: noindex, nofollow`
- `Referrer-Policy: no-referrer`
- CSP should allow only same-origin inline MVP script/style, Google fonts, and `img-src self data: blob:` for signature preview uploads.

Privacy note:
- MVP is secure portal/sign-off UX, not true zero-knowledge storage.
- If the user repeats “even FlowAudit owners cannot see letters,” explain the architecture split:
  1. MVP: server-side/private access controls + approval gate.
  2. Strong privacy: encrypted-at-rest draft blobs with browser-side preview/signing and plaintext forwarded ephemerally to PostGrid only on approval.
  3. Full zero-knowledge send is harder because PostGrid credentials cannot be exposed in browser; a trusted backend or client-owned postal provider is required.

## Backend integration requirements before live sending

The live executor should fail closed unless all are true:
- letter exists and belongs to the client token/session
- signer name is present
- signer title/team is present
- signature asset is present, or an explicitly allowed no-signature path exists
- signed preview hash matches the outgoing PDF/body/template
- timestamped portal approval record exists
- normal RRD guardrails pass
- PostGrid opt-out is false
- letter spend/caps pass

Audit artifact should include:
- profile/client id
- letter id
- signer name/title/team
- signature asset reference, not raw secrets
- approval timestamp
- IP/user-agent if available
- signed preview hash
- resulting PostGrid send id after dispatch

## Preview/layout requirements

User preference from portal build/review:
- Postal Portal pages must stay on-theme with the rest of FlowAudit: existing `theme.css`, Instrument Serif/Inter, cream/espresso palette, rounded cards, and existing dark pill/button treatment.
- Letter previews in the Postal Portal should mirror the secure access/vault preview proportions, not use a separate squashed/narrow mock-letter layout.
- For MVP/static previews, use a fixed letter-page shell with true page proportions (`aspect-ratio: 8.5 / 11`, e.g. `max-width:420px`) and scale an internal page (`850x1100` style) inside it. Avoid free-height layouts such as `min-height:720px` that can visually squash the page or make text overflow/crop.
- Keep signer controls beside the preview when space allows, but widen the content shell if necessary so the preview is not squeezed. Browser-verify the actual element ratios, not just screenshots.

## Testing checklist

Add/maintain tests for:
- route/page exists and uses `theme.css`
- FlowAudit wordmark/theme text appears
- pending letters list renders
- signing workspace opens
- signer name/title fields exist
- signature upload exists
- approve/reject controls exist
- hard-gate copy is present
- welcome-pack includes signed Postal Portal URL and no-send-without-signoff copy
- Vercel headers include noindex, no-referrer, frame denial, and restrictive CSP
- portal preview uses a secure-access-style wrapper (`secure-access-preview-shell` or equivalent), true `8.5 / 11` aspect ratio, scaled internal page, and does **not** regress to the old squashed `min-height:720px` letter card

## Letter-preview typography pitfalls from same session

When refining portal/vault letter previews:
- Do not draw new text over old PDF text. Cover/remove the old text regions first.
- Replacement body text must span the original text width, not sit in a narrow centered column.
- If the template has a date, cover the template date fully and redraw the system date in the exact original position.
- The replacement date should match the template/body typography; do not let it appear a few sizes larger or lower than the original.
- Recipient block lines (`Accounts Payable Team`, `Customer Account`, `Billing Address`) should match the main body text size, not look like headings.
