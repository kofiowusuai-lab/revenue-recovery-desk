# FlowAudit / Revenue Recovery legal page consolidation

Use this when the operator asks to merge or simplify FlowAudit legal pages, Google reviewer legal URLs, or Revenue Recovery legal routes.

## Canonical legal-page stance

- Keep **one canonical Privacy Policy** at `https://flowaudit.co.uk/privacy`.
- Keep **one canonical Terms page** at `https://flowaudit.co.uk/terms`.
- Fold Revenue Recovery Desk-specific clauses into those root pages under clearly labeled sections instead of maintaining separate duplicate pages.
- Legacy Revenue Recovery legal routes should redirect:
  - `/revenue-recovery/privacy` -> `/privacy`
  - `/revenue-recovery/terms` -> `/terms`

## Content requirements

Root Privacy/Terms should retain main FlowAudit language and add Revenue Recovery-specific coverage, including:

- Revenue Recovery Desk service description and client responsibilities.
- Integration/OAuth connector data handling, especially Google Workspace/Gmail/Drive readonly explanations where relevant to app review.
- Approval-gated recovery workflow and physical-letter/postal handling.
- Billing/retainer, pass-through costs, support/offboarding, and client authorization boundaries.
- No secrets, internal support links, or one-off reviewer instructions embedded into public legal pages.

## Homepage / reviewer UI pitfall

If Google reviewer instructions were temporarily placed on the public Revenue Recovery landing page, remove public reviewer cards/buttons once the reviewer has been emailed instructions. Do not leave cards such as "OAuth app verification", "Google reviewer access", "Reach the consent screen", or duplicate legal links on the sales page. A normal **Client Login** header button is acceptable and should route to the client portal/login path.

## Implementation notes

For the FlowAudit marketing repo (`flowaudit-platform`):

- Update the root legal page components/content (`/privacy`, `/terms`) to include both main FlowAudit and Revenue Recovery sections.
- Add route redirects in the Next/Vercel routing layer for the old `/revenue-recovery/privacy` and `/revenue-recovery/terms` paths.
- Remove temporary reviewer cards from the Revenue Recovery landing page while preserving standard navigation/Client Login.
- Use a PR, run typecheck/build, wait for Vercel/GitGuardian checks, merge, then verify the branded domain, not just preview or the ivory Revenue Recovery app.

## Verification checklist

Run live branded checks after deploy/merge:

- `https://flowaudit.co.uk/revenue-recovery` returns 200 and contains `Client Login`.
- The Revenue Recovery landing page does **not** contain reviewer-only copy such as `OAuth app verification` or old `/revenue-recovery/privacy` legal links.
- `https://flowaudit.co.uk/privacy` returns 200 and contains both `Revenue Recovery Desk` and relevant connector/Google Workspace privacy language.
- `https://flowaudit.co.uk/terms` returns 200 and contains both `Revenue Recovery Desk` and relevant connector/Google Workspace/service terms language.
- `/revenue-recovery/privacy` redirects to `/privacy`.
- `/revenue-recovery/terms` redirects to `/terms`.

Report only verified branded-domain results.