# Client dashboard UI/security preferences (2026-06-24)

Session learnings from iterative fixes to `revenue-recovery-web/client.html`.

## Client-facing integration/vault controls
- Do **not** expose client-side buttons that create vault links or reconnect integrations (`Create secure vault link`, `Reconnect GoHighLevel`, `Reconnect monday.com`).
- For API/vault/CRM/accounting connection changes, the dashboard should route clients to `support@flowaudit.co.uk` or ask them to schedule a meeting.
- Rationale: integration changes can break the recovery system; identity should be verified first, ideally live on a call, then the operator sends the specific link while with the client.

## Business information editing
- Business details should be editable **in place** inside the existing **Business information** card via an `Edit` button.
- Avoid creating a separate large `Edit business details` section/card; it duplicates the information hierarchy and looks clunky.
- Editable fields should persist to Supabase `submissions` so the internal desk sees the same phone/email/business details as the client dashboard:
  - `company`, `industry`, `size`, `website`, `primary_contact`, `phone`
  - business/trading address can live under `business_profile.address` unless/until a first-class column exists.
- Keep process-owner/contact edits in `contacts`.

## Readiness UI after onboarding
- Once readiness is complete / 100%, hide readiness indicators from the client dashboard:
  - no `Readiness: Complete` pill
  - no `Readiness` sidebar/nav item
- Completed readiness is an onboarding concern; onboarded clients should see active service controls, not launch checklists.

## Copy and visual tone
- Do not expose implementation language to clients (e.g. `embedded postal portal`). Name the product area directly (`Postal Portal`).
- Avoid excessive em dashes in dashboard copy. Prefer commas, colons, or sentence breaks unless the dash is grammatically/structurally necessary.
- Info-row labels can be normal/medium weight; values should be slightly smaller and softer than heavy bold (e.g. ~0.93rem, weight ~600) to reduce visual harshness.

## Layout/mobile expectations
- Keep related cards close together; do not leave large dead vertical gaps.
- `Secure access changes` belongs close to Business information, not floating at the bottom.
- Optimize Settings for iPhone: single-column layout, horizontal scroll nav, compact padding, full-width action buttons where needed.

## Nav badges and alerts
- Do not put `Notifications` in the sidebar; notifications belong in the top toolbar only.
- When there are unread notifications, the top toolbar Notifications button should show both the existing count and a red circular `!` alert dot.
- When physical letters are pending approval, the `Postal Portal` sidebar item should show:
  - a red circular `!` at the top-right of the nav pill
  - the pending-letter count on the right side of the same nav item.
- Source the Postal Portal count from pending letter approvals (currently `letterItems().length`) so the badge reflects the actual review queue.

## Postal Portal letter list UX
- Do not show ornamental status pills like `Secure approval gate` inside the Postal Portal hero unless they add real information. If the operator flags one as visual noise, remove it rather than explaining it.
- Avoid duplicating selected-letter information in both the pending-list card and a separate right-side card. The pending letter itself should carry the actionable controls.
- Multiple pending letters need an explicit selection affordance; do not rely on “click the card” as hidden behavior. Each pending-letter card should have a visible `Select` button, a clear selected state/highlight, and selected-state copy such as `Selected`.
- Put a `Preview letter` button directly on each pending-letter row/card. Clicking it should select that letter and open the full preview, instead of forcing the user to select a row and then use a second duplicate preview card.
- Keep the right side focused on signer/signature/approval controls, with only a compact selected-letter reference if needed.

## Verification pattern
- For dashboard/client-facing fixes, verify both canonical and branded routes:
  - `https://revenue-recovery-web-ivory.vercel.app/client?...`
  - `https://flowaudit.co.uk/revenue-recovery/client?...`
- Use tests/static checks to assert forbidden strings are absent (e.g. vault/reconnect buttons, `Bad response`, standalone edit section) and required UI markers are present.
