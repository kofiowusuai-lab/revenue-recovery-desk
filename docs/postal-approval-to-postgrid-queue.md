# Postal Portal approval → gated PostGrid queue

Use this when wiring or debugging the physical-letter path after a client clicks **Approve signature and queue letter** in the authenticated client dashboard / Postal Portal.

## Durable architecture

The client browser must never call PostGrid directly. The safe flow is:

1. Client signs/approves the letter preview in the dashboard.
2. `/api/client-letter-action` authenticates the bearer session, verifies the letter belongs to that client, encrypts the uploaded signature, and writes a `recovery_events` row with `event_type: "letter_approval"`.
3. The approval event carries queue metadata:
   - `meta.sendGate: "approved_for_executor_review"`
   - `meta.postgridQueueStatus: "queued_for_gated_executor"`
   - `meta.sourceEventId`
   - `meta.letterKey`
   - `meta.signerName`
   - `meta.signerTitle`
   - encrypted `meta.signature`
   - `meta.signatureHash`
   - `meta.previewHash`
4. The operator-side queue worker processes approvals:
   - `/Users/AIAgenterminal/rrd-letter-queue run --limit N`
   - wrapper sources `/Users/AIAgenterminal/.env.local` for Supabase service config and `.openclaw/.env` for operator runtime config.
5. The worker verifies the source letter event, signer metadata, encrypted signature, hash match, recipient mailing address, and sender/from mailing address. Recipient address resolution should try, in order: explicit PostGrid/send-action fields, connected-system contact/customer/debtor objects from the source event, matching contacts by customer email/name, and the rendered letter text/address block. If none of those produce a valid PostGrid address, fail closed with `letter_postgrid_blocked`.
6. Only then it builds a `channel:"Letter"`, `approved:true`, `tool:"send_via_executor"` action and calls `rrd-recover send` / `execute(..., send:true)`.
7. `rrd-recover` still enforces policy, approval, allowlist, daily caps, PostGrid opt-out, client-vs-shared key selection, styling, audit, and usage ledger.
8. The worker writes one terminal event:
   - `letter_postgrid_sent` when PostGrid accepts the letter, including provider id/status in meta.
   - `letter_postgrid_blocked` when required send fields are missing or the executor blocks; this is a safe operator-fix state, not a silent failure.

## Queue automation

Script-only cron is the right shape: quiet when empty, noisy only when approvals are processed/blocked/errored.

Current pattern:

```bash
/Users/AIAgenterminal/.hermes/profiles/recoverydesk/scripts/rrd-letter-queue-watch.sh
```

It runs:

```bash
/Users/AIAgenterminal/rrd-letter-queue run --limit "${RRD_LETTER_QUEUE_LIMIT:-10}"
```

and prints a concise summary only when `scanned > 0`.

## Common pitfalls

- Do not query nonexistent `submissions.profile` in `/api/client-letter-action`; use the authenticated account/submission and existing event `profile` fields instead.
- Do not mark client approval as `sent`; it is only queued for the gated executor.
- Do not send if the worker cannot resolve a valid PostGrid recipient address from explicit send fields, connected-system contacts/customer/debtor objects, matching contacts, or the rendered letter/address block. Write `letter_postgrid_blocked` with the missing-field reason.
- Do not require users to manually re-enter an address that the agent already has from the connected system or that is visibly present on the approved letter. Add/maintain tests for both contact-derived address and letter-text-derived address before changing this path.
- Do not treat a branded-browser `Failed to fetch` as a PostGrid issue. First check the live API/CORS path from `flowaudit.co.uk` to the ivory backend.
- Do not call low-level `rrd-letter send` from the client-action endpoint; always go through `rrd-recover` so guardrails and ledgers run.
- Keep the queue idempotent by ignoring approvals that already have terminal `letter_postgrid_sent` or `letter_postgrid_blocked` events referencing `meta.approvalEventId`.

## Verification checklist

Targeted checks:

```bash
node --check /Users/AIAgenterminal/rrd-letter-queue.mjs
node --check /Users/AIAgenterminal/revenue-recovery-web/api/client-letter-action.js
bash -n /Users/AIAgenterminal/rrd-letter-queue
node --test \
  /Users/AIAgenterminal/test/rrd-letter-queue.test.mjs \
  /Users/AIAgenterminal/test/rrd-recover.test.mjs \
  /Users/AIAgenterminal/test/rrd-web-api-security.test.mjs
```

Full suite from the operator home (important for web-form path assumptions):

```bash
cd /Users/AIAgenterminal
node --test test/*.mjs
```

Live smoke after deploy:

```bash
curl -sS -i -X POST 'https://revenue-recovery-web-ivory.vercel.app/api/client-letter-action' \
  -H 'Origin: https://flowaudit.co.uk' \
  -H 'Content-Type: application/json' \
  --data '{"action":"approve"}'
```

Expected unauthenticated shape: JSON `Missing bearer token` plus `access-control-allow-origin: https://flowaudit.co.uk`; not HTML, schema errors, or browser-level CORS failure.

Queue dry-run:

```bash
/Users/AIAgenterminal/rrd-letter-queue run --dry-run --limit 5
```

If no approvals are queued, expect:

```json
{"ok":true,"dryRun":true,"scanned":0,"results":[]}
```

## Client-facing answer pattern

If asked whether the button sends to PostGrid, answer:

- It queues a signed approval first; the browser does not call PostGrid.
- A backend worker verifies the signed approval and source letter, then sends through the existing gated executor.
- Missing addresses or guardrail failures block safely and create an operator-visible event instead of sending a bad letter.
