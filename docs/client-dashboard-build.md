# FlowAudit Client Dashboard Build Notes

Use this when building or extending `revenue-recovery-web/client.html`, client accounts, approval hub, activity/notifications, dashboard settings, or recovery-event ingestion.

## Live deploy / migration pitfalls learned

- **Do not treat Supabase SQL Editor “Success. No rows returned” as proof of migration.** It can also mean only comments/no-op SQL ran. Always run a read-only verification query for required tables/columns after applying schema changes, and report migration status separately from verification status.
- **If an existing table pre-dates the migration, make the migration adaptive/idempotent.** For the client dashboard, `notifications` may already exist with a different shape. Prefer `create table if not exists` for the minimal shell, then `alter table ... add column if not exists`, then add constraints in a guarded `do $$ begin if not exists (...) then alter table ... end if; end $$;` block.
- **Client dashboard auth must not rely only on `auth.user.app_metadata.submission_id`.** After sign-in, fall back to `public.client_accounts` by `user_id` and use its `submission_id`. If no mapping exists, render a visible support/mapping error card instead of an empty shell stuck at “Loading”.
- **Scope realtime/event reads by `submission_id`.** Queries for `recovery_events` and `notifications` should filter to the signed-in client’s submission id before ordering/limiting.
- **Responsive dashboard layout at 100% zoom:** avoid `260px 1fr` plus `width:100%` plus padding, which can push the main area off-screen. Use `box-sizing:border-box`, `grid-template-columns:260px minmax(0,1fr)`, `min-width:0` on main/cards/grids, auto-fit stat cards, and wrapping topbar actions.
- **Deployment report discipline:** say “migration applied” only after the SQL ran; say “verified” only after the table/column checks pass. Users will screenshot/check results, so avoid optimistic completion language.

## Product rules
- The dashboard is the client approval hub: email/SMS drafts queue here in Draft mode; Auto mode lets email/SMS send automatically but still records/announces each send.
- Physical letters are always signer-gated. Never allow `Letter` in `guardrails.autoSendChannels`.
- One login per client for now: the welcome-email recipient. Process owners are editable routing data, not separate logins.
- No secrets in dashboard rows or client-readable tables. Re-auth must route through the existing vault/OAuth connect flow.
- Client data access must be pinned to the session user's server-set `app_metadata.submission_id`; never trust a body/query `submission_id` for client writes.

## Recommended build shape
- Frontend: `revenue-recovery-web/client.html` as a light-only vanilla JS SPA using `theme.css` and the same Supabase JS stack as `desk.html`.
- API routes under `revenue-recovery-web/api/`:
  - `client-auth.js`: forced reset completion; update Supabase Auth password and clear `must_reset`.
  - `admin-reset-password.js`: staff-only reset; verify bearer token server-side against `public.staff`; generate temp password; email via AgentMail.
  - `client-settings.js`: session-authenticated, read-modify-write whitelist only; enqueue reprovision; reject Letter auto-send.
  - `client-vault-link.js`: own-client vault/OAuth reconnect links only; no secret values.
- Shared deterministic helpers are best kept in a node module (e.g. password generation, event normalization, settings merge) so tests can cover them without browser/API setup.

## Database/RLS model
- Tables: `client_accounts`, `recovery_events`, `notifications`, `provision_jobs`.
- Helper: `client_submission_id()` reads `auth.jwt()->app_metadata->submission_id`.
- RLS: staff full access via `is_staff()`; clients read only their own submission/events/notifications; no direct client update on `submissions`; `provision_jobs` default-deny for clients.
- Storage: private `letter-templates` bucket with object path prefix `<submission_id>/...` and prefix-scoped RLS.
- Realtime: enable on `recovery_events` and `notifications`; browser should also have 30s polling fallback.

## Event pipeline
- `rrd-collect.mjs` can append normalized event rows to `~/.openclaw/rrd-events/<profile>.ndjson` when event emission is enabled.
- Event rows should be idempotent with deterministic SHA-1 `dedupe_key`, and carry no secrets.
- `rrd-events-ship.mjs` tails NDJSON with a saved offset, inserts with `Prefer: resolution=ignore-duplicates`, and only advances offset after success.
- Create notifications for: collection paid, payment agreement, approval needed, action blocked, reprovision/settings applied.

## Reprovision pipeline
- Settings writes enqueue `provision_jobs` rather than shelling out from the dashboard.
- A Mac/control-plane watcher claims queued jobs, runs `node hermes-provision.mjs --force <submission-id>`, then emits a `reprovisioned` event and `setting_applied` notification.
- Debounce/coalesce multiple queued jobs for the same submission when possible.

## Welcome/reset lifecycle
- Welcome-pack live sends should create/update a Supabase Auth user, insert/upsert `client_accounts`, generate a strong 25-character temp password, and email dashboard URL + login email + temp password.
- Dry-runs must not create users or passwords.
- `must_reset` belongs in both `client_accounts` and server-only `auth.users.app_metadata` so the dashboard can block first login until reset.

## Tests to add/keep green
- Password generator: 25 chars, allowed charset, excludes ambiguous chars, no obvious repeats.
- Event normalizer: maps `results[]` to secret-free rows with stable dedupe keys.
- `rrd-collect` event emit: writes NDJSON queue rows when enabled.
- Settings merge: whitelist enforcement, sibling JSON preservation, Letter auto-send rejection, template path prefix enforcement.
- Client page static regression: all nav pages exist; login/reset/realtime/settings/vault/template upload plumbing present.
- Full `node --test test/*.test.mjs` before reporting done.

## Safe deployment order
When the operator asks for the client dashboard to go live, use this order and stop rather than skipping ahead:
1. Apply the Supabase schema/RLS migration first.
2. Verify the live REST API can see the required tables before deploying: `client_accounts`, `recovery_events`, `notifications`, and `provision_jobs`. A `404/PGRST205` table-missing response means migration is not complete.
3. Deploy `revenue-recovery-web` to the ivory Vercel project using the real operator home so Vercel sees the right auth store (`HOME=/Users/AIAgenterminal npx vercel --prod`).
4. Browser-smoke `/client` live: route loads, assets/theme load, unauthenticated users see only login, and there are no first-load console errors.
5. Only after live route smoke, install/start the event shipper and provision watcher, then run a test client login/reset lifecycle.

If the migration cannot be applied because no DB connection string, Supabase PAT/linked project, or SQL-exec RPC is available, mark the migration stage blocked and do **not** deploy the frontend ahead of the database when the user requested the safe order. Ask for the Supabase DB connection string/password or for the user to run the migration SQL in the Supabase SQL editor.

### Supabase SQL Editor fallback
When the operator has the Supabase SQL Editor open and asks you to do it via the browser, use computer use rather than making them hand-copy SQL:
- Extract only the client-dashboard migration block bounded by `-- Client Dashboard: accounts, events, notifications, provision queue` and `-- After running this:`; do **not** paste the whole historical `schema.sql`.
- Copy the extracted block to the clipboard immediately before pasting, replace the editor contents, run it, and treat Supabase's `Success. No rows returned` as only migration execution status.
- Prefer clicking the SQL Editor's accessible `Run ⌘↵` / `Run query` buttons by AX element when available. Raw coordinates can hit the wrong window/tab when macOS focus jumps back to Telegram.
- If the first migration fails because an existing table has an older/different shape, keep the same monitor and switch to an idempotent adaptive migration: for existing tables such as `notifications`, use `alter table ... add column if not exists` for dashboard columns (`submission_id`, `event_id`, `kind`, `title`, `body`, `amount_usd`, `read_at`, `created_at`) rather than relying on `create table if not exists` to add missing columns.
- Immediately replace the editor with a read-only verification query such as `select table_name, to_regclass('public.' || table_name) is not null as exists from (values ('client_accounts'), ('recovery_events'), ('notifications'), ('provision_jobs')) as required(table_name);`.
- Report migration complete only when all four rows return `exists = true`; otherwise keep the deploy stage blocked. If a tool limit or interruption stops before verification, say exactly that: migration may have run, but completion is not verified.

### Vercel production deploy and smoke
After database verification passes:
- Run the full local suite from `/Users/AIAgenterminal` with `node --test test/*.test.mjs` before production deploy, not just the targeted dashboard tests, unless the user explicitly asks for a narrower check.
- Deploy the live ivory project from `/Users/AIAgenterminal/revenue-recovery-web` with the real operator home: `HOME=/Users/AIAgenterminal npx vercel --prod --yes`.
- Smoke the canonical ivory URLs with HTTP checks and a browser load: `/client`, `/theme.css`, and any page touched in the same release such as `/postal-portal?demo=1`.
- Browser-smoke `/client` for the unauthenticated login state and first-load console errors. A static 200 is necessary but not sufficient.
- For an authenticated dashboard release, do not call the deploy done from an unauthenticated login smoke alone. Verify one of these live states after sign-in: (a) the real client dashboard renders visible page content and nav, or (b) the page shows a clear actionable in-app error card. A shell with badges/buttons and a blank main area is a failure even if HTTP 200 and console smoke pass.
- If the dashboard depends on `auth.users.app_metadata.submission_id`, also support/fall back to `client_accounts.user_id -> submission_id`; welcome/reset flows and older users can otherwise sign in but get stuck in a blank Loading shell. If neither mapping exists, render a visible support/mapping error instead of leaving `#pages` empty.
- When checking Vercel envs, do not treat key presence alone as proof: `vercel env pull --environment=production` can return empty quoted values for sensitive envs in local output. Check nonzero value length if you need to know whether server routes will actually have `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, and report this caveat separately from static page deploy success.

## Pitfalls
- Do not count a local API route or static page as complete until the schema/RLS migration has also been applied and the live `/client` route has been browser-smoked.
- Do not make `/client` live before the required client-dashboard tables/RLS exist if the user asked for safe order; a live-but-broken login is worse than holding deploy.
- If tests fail from a missing local dependency (e.g. PyMuPDF/`fitz` for letter-style tests), fix the dependency and rerun the full suite; do not encode the transient missing dependency as a durable limitation.
- Keep AgentMail wording precise: provider acceptance/message id is not human delivery.
- Postal Portal preview controls should avoid duplicate buttons that perform the same action. Keep a single obvious primary action plus one clearly distinct close/back affordance.
- In scrollable letter previews, keep the modal/banner/header layer from overlaying the top of the letter content; verify by scrolling down and back up, not just by checking the initial viewport.
- Signature previews must include user-facing size guidance and normalize rendering so the signature fills the field naturally relative to body text instead of appearing tiny in a large signing box.
