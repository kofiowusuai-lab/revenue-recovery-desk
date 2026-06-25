# RRD security hardening and review runbook

Use this when the operator asks to harden, review, or complete a security checklist for the Revenue Recovery Desk codebase. This captures the recurring patterns from the signed-token/profile-safety/state-locking review work.

## Required operating pattern

1. Start one task monitor for the whole hardening job, using `--lane recovery_desk`; keep updating the same bubble until finish.
2. Establish a baseline before changing code:
   - run the current targeted test(s) if a failing/checklist area is known;
   - run broader `node --test test/*.mjs` when feasible;
   - capture current failures as baseline, not as newly introduced regressions.
3. Work checklist-first. Maintain explicit buckets: baseline, tokens/forms, profile/path safety, locks/state fail-closed, approval origin, credential destruction, verification/re-review.
4. After each patch cluster, run the narrow relevant tests before moving to the next cluster.
5. Do not claim deploy-ready until the full suite and at least one independent/security re-review have run successfully, or the operator explicitly waives them.

## Signed client-action token pattern

For special client forms and one-shot client actions (readiness, SOP review, mapping confirmation, offboarding):

- Generate expiring signed tokens server-side; avoid trusting browser query params such as `sid`, `company`, or `email` as authorization.
- Browser pages should read only `?token=...` and submit the token to the server intake endpoint.
- Server-side intake should verify the token, derive the locked submission/client identity from the verified token, and fail closed if invalid/expired/mismatched.
- Offboarding forms must not insert directly through the Supabase anon client; route through server-side `/api/intake` or the equivalent privileged verifier.
- Add tests that assert pages do not read unsigned identity params and that stale duplicate direct-Supabase submit handlers are absent.

## Profile/path traversal hardening pattern

For any module building paths under Hermes profiles, `.openclaw` state dirs, audit ledgers, usage caps, collections ledgers, vault private keys, or profile `.env` files:

- Use one central helper (for example `assertSafeProfile`) rather than ad-hoc string replacement.
- Valid profile names should be explicitly shaped, normally `rr-...`, with a small safe character set.
- Reject path separators, `..`, empty strings, and non-`rr-` names for profile-specific paths.
- For non-profile state names that intentionally are not `rr-*`, use a separate helper (for example `safeStateName`) that still rejects separators/traversal.
- Prefer rejection over silently sanitizing path names; silent replacement can hide a bug and read/write the wrong client state.
- Add tests that attempt traversal through every exported path helper and sensitive module entrypoint.

## Fail-closed state handling

For state files that suppress duplicate side effects or enforce caps (usage, collections, approval queues, scheduler/watch dedupe):

- Corrupt JSON must not reset to an empty/fresh state if that would reopen caps or duplicate outreach.
- On parse failure, quarantine/rename the corrupt file with a `.corrupt.<timestamp>` suffix and block the side-effecting run with a clear operator-review error.
- Apply this beyond usage/collections to watcher and poller dedupe files: onboarding email, vault watch, due reminders, sales retainers, cancellation/offboarding, support inbox, and new-client notifier state.
- Keep missing-file fallback separate from corrupt-file fallback: missing state may initialize safely; corrupt state means review required.
- State writes should create parent directories, write mode `0600`, and preferably use a temp-file/rename or shared state helper.
- Tests should create corrupt files and verify both the thrown/blocking error and the quarantine file.

## Job locking pattern

For side-effect cron/watch jobs (onboarding email watcher, vault watcher, recovery scheduler, due reminders, retainer automation, cancellation/offboarding, support inbox, vault cleanup, notifier jobs):

- Add a shared lock helper so overlapping cron ticks cannot double-send, double-approve, double-offboard, or double-clean.
- Scope locks per job and, where useful, per profile/client.
- Use atomic lock creation (`open`/`wx` semantics), store owner metadata (`pid`, host, token, startedAt), and release only when the token matches.
- Make stale-lock handling explicit and conservative; do not unlock blindly without age/owner metadata. Use longer stale windows for long-running schedulers than for short pollers.
- Validate lock names with the same safe-state/profile naming discipline used for other filesystem paths; reject separators/traversal.
- Keep lock acquisition/release, stale replacement, and throw-path release covered by tests or deterministic dry-run probes.

## Telegram approval origin enforcement

Approval callback/poller code should verify origin before mutating approval state:

- Enforce configured Telegram chat ID and, when configured, allowed user/admin IDs.
- Unknown chats/users must be ignored or denied without marking the approval item approved/denied.
- Manual CLI approval remains available as an operator fallback, but final guardrails still run immediately before dispatch.

## Credential destruction cleanup

Offboarding and emergency credential purge should cover all local credential variants without printing values:

- Primary profile `.env` and expected backup variants such as `.env.bak-*`.
- Vault private key material for the profile.
- Supabase vault drop ciphertext/nulling/burn state for that profile.
- Any documented alternate backup locations under configured vault/profile roots.
- Report only file/key names and actions, never secret contents.

## Verification exit criteria

Before reporting completion:

- Targeted tests for every changed hardening area pass.
- Full `node --test test/*.mjs` has been run and any failures are classified as pre-existing, fixed, or blockers.
- Re-run the external reviewer/security reviewer (for example Codex) on a scrubbed snapshot or diff if it was used to generate the checklist.
- Final answer should lead with checklist status: complete / incomplete, passed tests, remaining blockers, and deploy-readiness stance.
