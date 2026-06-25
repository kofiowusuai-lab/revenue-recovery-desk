# Postal Portal as a dashboard section

Session-derived UX correction: when the operator asks to "move/embed the Postal Portal into Letters" or says clients should not press a link/open a tab, do **not** implement a visible iframe/link wrapper labelled "embedded portal." Make the client-facing dashboard section itself become the Postal Portal.

## Expected UX

- Rename the dashboard navigation item from `Letters` to `Postal Portal` when the operator wants the portal moved into the dashboard.
- Keep the normal dashboard sidebar/top controls around it, so the user still has Overview, Approvals, Activity, Recoveries, Notifications, Readiness, Settings, etc.
- The page heading should be `Postal Portal` (not `Letters`, not `Embedded Postal Portal`).
- Avoid implementation-language copy such as:
  - "embedded postal portal"
  - "the full Postal Portal is embedded here"
  - "use the portal below exactly as the standalone Postal Portal"
  - primary "Open in new tab" calls to action
- Use client-facing task language instead: pending letters, signer name/title, signature upload, preview letter, approve, request changes.

## Implementation pattern

For the current static SPA (`revenue-recovery-web/client.html`):

- Change `pageNames` to include `Postal Portal` instead of `Letters`.
- Map `'Postal Portal': letters()` (or rename the function later) in the page renderer.
- Keep the existing postal-portal primitives (`portalEvents`, `selectedPortalEvent`, `openPortalPreview`, `renderPortalLetterPreview`, `portalSignatureUpload`) but make their containing dashboard page first-class.
- Do not rely on an iframe. The operator specifically dislikes a bolted-on embed/link experience when the portal already exists.

## Verification checklist

After changes and deploy, verify both ivory and branded routes when applicable:

- HTML contains: `Postal Portal`, `Secure approval gate`, `Pending letters`, `Signature upload`, `Preview letter`, `Approve signature and queue letter`.
- HTML does **not** contain: `Embedded Postal Portal`, `The Postal Portal is embedded here`, `Open in new tab`, `iframe title="Revenue Recovery Postal Portal"`, or `embedded here`.
- Browser-smoke the real dashboard route; a static string check alone is not enough when the change is meant to fix user-facing layout/copy.

## Communication lesson

If the operator is frustrated that a page says "embedded postal portal," acknowledge the UX issue directly and fix it. Do not explain why embedding is hard or keep implementation labels in client-facing copy. The deliverable is a portal page that feels native to the dashboard.
