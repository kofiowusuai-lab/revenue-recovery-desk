# Client dashboard demo/faux data + Settings business info

Use this when the operator says the client portal looks bare, asks to see their business information in the portal, or wants a faux/demo account populated so the dashboard feels real.

## Durable pattern

- The client dashboard SPA is `~/revenue-recovery-web/client.html`; the canonical live app is the ivory Vercel project (`https://revenue-recovery-web-ivory.vercel.app`).
- Business/company details belong in the **Settings** tab, not only in Overview metrics. Show a clearly labeled `Business information` section with company, industry, size, website, primary/billing contact, phone, customer profile, payment/accounting/CRM stack, contacts, and recovery policy.
- Faux/demo accounts must not look empty. For demo/faux/sandbox/standup accounts, synthesize safe fake display data only in the UI layer when live `recovery_events` are empty: recovered amount, target, outstanding overdue, recent wins, dispatch counts, approval waiting, named fake customers, CRM/accounting stack, outreach and guardrail policy.
- Mark synthetic UI data with a visible `Faux demo data` badge so it is never confused with live client results.
- Prefer non-real customer names and clearly fake contact emails/domains. Never seed fake data into a real client as if it were production truth unless the operator explicitly asks for a sandbox/faux record update.

## Verification checklist

1. Extract/check the inline script from `client.html` with `node --check` (do not rely only on HTML grep).
2. Run the dashboard tests, especially `test/rrd-client-dashboard-page.test.mjs` and `test/rrd-client-dashboard-core.test.mjs`.
3. Deploy the ivory Vercel project with the operator token loaded from the real operator env when needed; do not print token values.
4. Verify production HTML contains the new strings (`Business information`, `Faux demo data`, representative fake customer names, helper functions).
5. Do a browser render smoke, not just a curl/static check. If auth blocks normal navigation, inject a safe in-page faux `state.submission` / empty `state.events`, call `show('app'); render();`, and inspect `document.body.innerText` for rendered Settings and Overview. This catches runtime errors that static tests miss (e.g. a missing helper such as `live()`).

## Pitfalls

- A login screen proving the HTML loaded is not enough; the logged-in dashboard render path can still throw.
- Do not leave Overview at all zeroes for a faux account; the point is to show the operator/client what an active recovery portal will look like.
- Do not hide company details in form inputs only. The Settings tab should read as an account profile first, then editable controls second.
