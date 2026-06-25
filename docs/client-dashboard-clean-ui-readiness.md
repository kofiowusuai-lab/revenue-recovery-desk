# Client dashboard clean UI + completed-readiness handling

Session-derived UX rules for `revenue-recovery-web/client.html` when polishing the client dashboard after onboarding.

## Trigger
Use this when the operator says the dashboard looks cluttered, onboarding/readiness is already complete, Settings is cramped, or client-facing copy exposes implementation details.

## Rules
- Once `live()` / readiness is 100%, hide readiness chrome from the normal client experience:
  - do not show a `Readiness: Complete` top badge;
  - remove the `Readiness` nav/sidebar item from the visible page list;
  - if the user somehow lands on the Readiness page after completion, route back to `Overview` or another normal page.
- Keep readiness visible only while there are incomplete onboarding/go-live steps. Completed clients are “good to go”; the UI should feel operational, not onboarding/checklist-oriented.
- Keep top status labels distinct when visible: `Outreach: Draft/Auto` is policy mode; `Readiness: N steps left` is onboarding state. Do not put unlabeled `Live` beside `Draft mode`.
- Avoid client-facing implementation language such as “embedded portal”, “iframe”, “new tab”, or “MVP” unless explicitly relevant to an internal/operator view.

## Settings layout cleanup
- Business information should be compact and readable. Do not leave a large dead vertical gap between `Business information` and the company card/title.
- Use structured layout classes rather than inline one-off spacing where practical:
  - `settings-layout` for the main two-column settings grid;
  - `business-card` / `compact-info-grid` / `compact-item` for tighter business/profile/contact panels;
  - `settings-form`, `form-section`, `field-stack`, and `save-row` for Settings form spacing;
  - `integration-actions` for wrapping integration buttons with consistent gaps;
  - `account-tools` to separate password input from `Change password`.
- Buttons should not be glued to the field above them. Add explicit vertical spacing before `Save settings` and `Change password`.
- Integration buttons should have visible gaps and wrap cleanly instead of appearing as a crowded row.
- Contacts/info cards should not be oversized compared with their content.

## Verification checklist
- Run the dashboard tests, then assert the production HTML contains the clean-layout markers and does not contain the removed bad strings.
- Useful static assertions:
  - present: `visiblePageNames`, `topbar-readiness-complete`, `pageNames.filter(p=>p!=='Readiness')`, `settings-layout`, `business-card`, `field-stack`, `save-row`, `integration-actions`, `account-tools`;
  - absent: `Readiness: Complete`, `Bad response`, raw `Draft mode` topbar text, `Embedded Postal Portal`, `Open in new tab`.
- Deploy `revenue-recovery-web` with real operator HOME and no stale Vercel token:
  - `env -u VERCEL_TOKEN HOME=/Users/AIAgenterminal npx vercel --prod --yes`
- Verify both source and branded URLs with cache-busting query params:
  - `https://revenue-recovery-web-ivory.vercel.app/client?login=1&v=<tag>`
  - `https://flowaudit.co.uk/revenue-recovery/client?login=1&v=<tag>`
