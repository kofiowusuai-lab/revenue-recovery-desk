# Client dashboard account mapping + forced login

Use this when `/client` signs a user in automatically but shows `This login is missing its client account mapping`, or when the operator says the portal did not let them log in because an existing browser session auto-loaded.

## Durable diagnosis

A signed-in Supabase Auth user is not enough for the client dashboard. The dashboard needs either:

- `auth.users.app_metadata.submission_id`, or
- a `public.client_accounts` row where `user_id = auth.uid()` and `submission_id` points to the client submission.

If both are missing, the dashboard should show a clear support/mapping error, not an empty portal.

## Fix pattern

1. Find the Auth user by email using the Supabase service role key. Do not print keys or `.env` contents.
2. Find or create the intended `submissions` row. For faux/demo accounts, use obviously fake company/customer/contact details and set `consent`, `integration_ready`, and `has_sop` only when the operator explicitly wants a ready-looking faux account.
3. Upsert `public.client_accounts` with:
   - `user_id`
   - `submission_id`
   - `email`
   - `company`
   - `must_reset` appropriate to the requested UX (`false` for an already usable operator demo account).
4. Patch Auth `app_metadata` to include the same `submission_id` and preserve existing provider metadata. Clear `must_reset` only when appropriate.
5. Add or preserve a force-login path in `client.html`: `?login=1` / `?signout=1` should call `sb.auth.signOut()`, remove the query from history, and show the login form. This prevents a stale browser session from bypassing login during demos.
6. On the mapping-error card, include a distinct `Sign in with a different account` action that signs out and redirects to `?login=1`.

## Verification checklist

- Query `client_accounts` and confirm the target email maps to the expected company/submission and `must_reset` value.
- Confirm production HTML contains the force-login helper and alternate-account button.
- Browser-smoke `/client?login=1`; it should show the login form even if the browser had a previous session.
- Browser-smoke the logged-in render path or inject safe in-page state to verify Settings displays business information and faux/demo data without runtime errors.
- Run dashboard page/core tests after code changes.

## Pitfalls

- Do not treat an Auth user existing as proof the client dashboard is usable. Missing `client_accounts`/`submission_id` is the common failure.
- Do not seed fake/demo data into a real client record unless the operator explicitly says it is a faux account.
- Do not report “login fixed” from a static HTML check alone; verify the DB mapping and at least one browser-rendered dashboard state.
