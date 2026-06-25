# Approval callback + credential-destruction hardening

Session-derived checklist for finishing or reviewing RRD approval/offboarding hardening.

## Telegram approval callback hardening

Threat model: Telegram callback data can be stale, forwarded, or clicked by a non-operator in the configured chat. The callback handler must validate origin before mutating approval state.

Required checks before calling `approve()` / `deny()`:

1. Validate approval IDs before using them as filesystem path segments.
   - Use a strict pattern such as `^appr_[A-Za-z0-9_]+$`.
   - Resolve `itemPath()` and assert it remains under the approval `items/` directory.
2. Load the pending item, then validate callback origin.
3. Require callback chat to match `RRD_APPROVAL_TELEGRAM_CHAT_ID`.
4. Require an explicit user policy before accepting Telegram callbacks.
   - `RRD_APPROVAL_TELEGRAM_ALLOWED_USER_IDS`
   - `RRD_APPROVAL_TELEGRAM_ADMIN_IDS`
   - If neither is configured, fail closed; do not treat "configured chat" alone as enough to approve/deny.
5. If the approval item has `telegram.messageId`, require the callback `message.message_id` to exactly match. Missing `message_id` must fail closed.
6. If the approval item has `telegram.chatId`, require it to match the callback chat.
7. Require the loaded item's internal `id` to match the requested approval ID / filename. A file named `appr_origin_001.json` containing `id: appr_other_001` must be rejected before mutation.
8. Mutate the exact already-loaded and validated packet. Do not re-read by ID after validation, because a replacement file could be swapped between validation and mutation.
9. Unauthorized callbacks must not mutate approval state **or the approval message UI**.
   - Answer the callback if possible.
   - Do **not** remove inline buttons or post confusing channel messages for unauthorized callbacks.

Target tests:

- unknown chat leaves item `pending`
- non-allowlisted user leaves item `pending`
- no allowlist/admin policy leaves item `pending`
- missing / mismatched callback message ID leaves item `pending`
- invalid approval ID / traversal is rejected
- mismatched internal packet `id` is rejected before mutation
- authorized callback can approve an `approvalOnly` packet
- unauthorized callback does not call `editMessageReplyMarkup`

## Credential-destruction hardening

Threat model: offboarding must remove local credential artifacts without leaking values or following attacker-controlled symlinks.

Credential files to include for profile `rr-<client>`:

- profile `.env`
- profile `.env.bak`
- profile `.env.bak-*`
- profile `.env.bakNNNN...` numeric/undelimited backups
- profile `.env.backup*`
- profile `.env.old`
- profile `.env.orig`
- profile `.env.save`
- profile `.env~`
- vault private key `~/.hermes/vault/keys/<profile>.pem`
- private-key backup variants `<profile>.pem.*`
- vault public key `~/.hermes/vault/keys/<profile>.pub.pem`
- public-key backup variants `<profile>.pub.pem.*`

Safety rules:

1. Validate profile names with `assertSafeProfile()` before path construction.
2. Validate every parent path component with `lstatSync()` before enumerating or deleting; reject symlinked parent directories instead of traversing through them.
3. Use `lstatSync()` rather than `statSync()` for deletion targets.
4. If a final target is a symlink, unlink the symlink without opening or overwriting the symlink target. This must also handle dangling symlinks; do not pre-filter with `existsSync()`.
5. For regular-file overwrite-before-unlink, open with `O_NOFOLLOW` and verify `fstat()` device/inode against the `lstat()` result before writing. If the inode check fails, close and return a hard failure without unlinking.
6. Credential-destruction failures must make `purgeCredentials` / offboard commands fail visibly (non-success result / thrown error). Do not print a failed JSON object and exit 0.
7. Do not include secret file contents in return objects, logs, or test assertions.
8. Supabase `vault_drops` cleanup should null `ciphertext` and mark drops consumed; report counts/key names only.

Target tests:

- backup/key variant discovery includes only the intended profile
- traversal profile names are rejected
- parent-component symlinks are rejected at enumeration and deletion time
- unlink result does not contain secret values
- symlink named like `.env.bak-*` is removed without modifying its target
- dangling symlink credential artifact is removed
- final-file symlink is unlinked without target overwrite
- TOCTOU/inode mismatch fails hard and does not unlink the swapped target
- local deletion failure makes purge/offboard command fail rather than claiming success

## Verification sequence

After patching:

```bash
node --check rrd-approval
node --check rrd-agent.mjs
node --test test/rrd-approval-origin.test.mjs test/rrd-credential-destruction.test.mjs
node --test test/*.mjs
```

For a second-pass security review, use a scrubbed snapshot pattern rather than handing the live working tree to a reviewer:

1. Create a fresh temp dir.
2. Copy only the relevant source and tests, for example:
   - `rrd-approval`
   - `rrd-agent.mjs`
   - helper modules required by those files
   - `test/rrd-approval-origin.test.mjs`
   - `test/rrd-credential-destruction.test.mjs`
3. Exclude `.env`, auth files, local state, `.vercel`, `.git`, build outputs, and `node_modules`.
4. Initialize a disposable git repo in the temp dir so code-review tools can inspect diffs/history without seeing the real repo metadata.
5. Ask the reviewer specifically to look for mutation-before-auth, callback/UI side effects on unauthorized requests, approval-id/path traversal, symlink/path traversal, TOCTOU, hard-fail behavior, and brittle tests.
6. Treat each reviewer finding as a loop: patch → run targeted tests → run full tests → make a new scrubbed snapshot → re-review until no blocking issues remain.

Do not report this class of security hardening as complete until both local tests and the final scrubbed re-review have passed, or until you clearly state the remaining review as unfinished.