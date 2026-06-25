# Client dashboard agent harness + approval editor notes

Use this when the operator asks to make the FlowAudit client dashboard act like a live agent harness, merge approvals/portal flows, or fix an approval/edit button that appears inert.

## Desired dashboard model
- Treat the dashboard as the client-facing harness for a per-client recovery agent: the agent writes **secret-free**, submission-scoped `recovery_events` and `notifications`; the dashboard subscribes to those rows in realtime and keeps polling as fallback.
- The UI should make this visible with an **Agent harness**/live-feed card so the operator can see that the client agent is alive and feeding the dashboard.
- Keep the agent/backend responsibility separate from UI language: the dashboard displays events and queues approvals; the gated executor still owns actual sends.

## Approval/letter UX pattern
- If the user says “edit then approve does nothing,” do not stop at static tests. Browser-smoke the click and verify a modal/dialog actually appears.
- Email/SMS approvals belong in **Approvals**.
- Physical-letter approvals belong in **Letters**, because the signer/template context must stay with the letter preview.
- The letter editor should open a preview modal with:
  - editable subject/text fields;
  - a locked template/format preview;
  - explicit copy that only wording is editable here;
  - template/layout changes routed to Settings/Letter template.
- Do not send users back to a separate postal portal when the dashboard is meant to own approvals; merge the portal-style signing/preview experience into the dashboard tab.

## Recoveries list pattern
- Payment plans and settlements should manifest on the invoice/recovery row as resolution statuses, not disappear into generic activity.
- Useful statuses: `Paid`, `Payment plan`, `Settlement`, `Awaiting approval`, `In recovery`.
- Include the agreed terms/next action beside the status, e.g. payment schedule, next payment date, or settlement amount/deadline.

## Implementation pitfall
- Avoid using volatile generated timestamps in DOM data keys for demo/faux events. If the events are regenerated on rerender, `data-edit-key` can refer to a timestamp from the previous render and the modal lookup returns nothing. Prefer a stable id from the row, or derive keys from stable fields like invoice/channel/customer for faux data.

## Verification checklist
- Run JS syntax checks for inline dashboard script, then the dashboard tests.
- Browser-smoke the logged-in/rendered dashboard path, not just the login page or raw HTML.
- Click **Preview / edit letter** or **Edit then approve** and confirm the modal/dialog appears.
- Confirm the modal contains editable copy fields, locked-template wording, and a preview.
- Open **Recoveries** and confirm payment-plan/settlement statuses are visible with terms.