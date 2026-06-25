# HubSpot recovery end-to-end smoke test

Use this when validating a per-client recovery agent against HubSpot CRM data before real outreach. The goal is to prove: live HubSpot read -> overdue candidate classification -> draft generation -> approval gate -> fail-closed/controlled send path.

## Preconditions

- A per-client/test profile exists, e.g. `rr-test`.
- HubSpot OAuth tokens are installed in that profile `.env`.
- Operator HubSpot app credentials are present in the operator env so expired access tokens can be refreshed.
- Use only a test/internal recipient. Never send to a real debtor during a smoke test.

## Reliable sequence

1. Refresh HubSpot OAuth tokens if the API returns 401.
   - Use `rrd-oauth.mjs` `refreshTokens('hubspot', ...)` + `tokensToEnv('hubspot', ...)` and write only token key names back to the profile `.env`.
   - Do not print token values.
2. Fetch the known HubSpot deal via `GET /crm/v3/objects/deals/{id}?properties=dealname,amount,closedate,dealstage,pipeline`.
3. Classify overdue locally:
   - `candidate = amount > 0 && closedate < now`
   - `daysOverdue = floor((now - closedate) / 86400000)`
4. Draft the recovery message with `rrd-draft.mjs` using a placeholder invoice object:
   - `number = dealname`
   - `amount = amount`
   - `dueDate = closedate.slice(0,10)`
   - `customerEmail = internal/test address only`
   - `hostedInvoiceUrl = inert/safe URL unless a real payment test is explicitly intended`
5. Build the executor action with `tool:"send_via_executor"`, `channel:"Email"`, and a valid in-hours `atHour`.
6. Gate without approval:
   - `/Users/AIAgenterminal/rrd-recover gate rr-test '<unapproved-action-json>'`
   - Expected: blocked with `APPROVAL_REQUIRED`.
7. Gate with approval:
   - `/Users/AIAgenterminal/rrd-recover gate rr-test '<approved-action-json>'`
   - Expected: `wouldSend:true`, `allowed:true`.
8. Optional send-path rehearsal:
   - `/Users/AIAgenterminal/rrd-recover send rr-test '<approved-action-json>'`
   - If no email adapter is configured, expected safe result is `ADAPTER_ERROR: email adapter not configured` and `sent:false`.
   - Treat this as a pass for fail-closed behavior, not as a delivered email.

## Current one-command HubSpot path

`rrd-collect recover` now supports HubSpot deals directly and AgentMail as an email adapter. Prefer the one-command path for future smoke tests, while still keeping the explicit read/classify/gate sequence above available for debugging.

Safe dry-run against a known HubSpot deal:

```bash
set -a
[ -f /Users/AIAgenterminal/.hermes/profiles/recoverydesk/.env ] && . /Users/AIAgenterminal/.hermes/profiles/recoverydesk/.env
[ -f /Users/AIAgenterminal/.hermes/profiles/rr-test/.env ] && . /Users/AIAgenterminal/.hermes/profiles/rr-test/.env
set +a
node /Users/AIAgenterminal/rrd-collect.mjs recover rr-test \
  --source hubspot \
  --deal-id <hubspot-deal-id> \
  --test-email <internal-test-address> \
  --dry-run \
  --approved \
  --json
```

Expected dry-run shape: `found: 1`, `summary.byOutcome.would_send: 1`, target email equals the supplied `--test-email`, and no blocked reasons.

Controlled live test send, only after the dry-run is clean and the operator explicitly requested a test email:

```bash
node /Users/AIAgenterminal/rrd-collect.mjs recover rr-test \
  --source hubspot \
  --deal-id <hubspot-deal-id> \
  --test-email <internal-test-address> \
  --send \
  --approved \
  --from flowaudit-support@agentmail.to \
  --json
```

If `AGENTMAIL_API_KEY` is present, the email adapter auto-detects `agentmail` and sends via `POST /v0/inboxes/{inbox_id}/messages/send` with a string `to`. Report the returned provider/message id as provider acceptance / send handoff, not human inbox delivery.

## Known pitfalls

- Older copies of `rrd-collect` were Stripe-first. If a system still shows a Stripe 401 while trying a HubSpot-only smoke test, check whether the `--source hubspot` implementation/CLI flags are present before diagnosing HubSpot credentials.
- HubSpot deals usually do not have a hosted invoice URL; the smoke-test draft may have `paymentUrl: null`. That is acceptable for proving CRM read -> draft -> gate -> send path, but not sufficient for a real debtor recovery flow unless payment-link generation is separately wired.
- Use `--test-email` for every smoke test. Never let a HubSpot contact/deal email receive an unreviewed test recovery email.

## Pass/fail interpretation

A successful pre-send smoke test should report:

- HubSpot read succeeded.
- The target deal is an overdue candidate.
- A deterministic draft was produced.
- Unapproved action was blocked.
- Approved dry-run gate would send.
- Live send either goes only to a controlled test inbox, or fails closed because no adapter is configured.

Do not report external delivery unless an authenticated provider returns acceptance/delivery evidence.