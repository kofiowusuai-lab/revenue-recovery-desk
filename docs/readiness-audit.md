# Revenue Recovery Desk readiness audit

Use when the operator asks whether the system is ready to onboard a signed client or actually recover revenue.

## Principle

Answer from live checks, not vibes. Distinguish:

- **System readiness** — intake/book, provisioning, vault/access emails, welcome pack, guardrails, support/offboarding automation, and dry-run recovery loop work.
- **Client go-live readiness** — that specific client's real API keys/OAuth connections are installed, policy is present, consent/SOP/guardrails are usable, and any required paid runtime (for Orgo VM execution) is available.

Do not collapse these. It is valid to say: "the operating system is ready; this client is not live-recovery-ready until APIs/OAuth are connected."

## Suggested live checks

Run the real commands and summarize outcomes. For GTM/readiness questions, lead with the split verdict: sales/onboarding readiness vs client-specific live recovery readiness.

For "are we ready to operate / could we serve a client tomorrow?" run the core control-tower checks first:

```bash
/Users/AIAgenterminal/rrd-technical-health-monitor --no-send --verbose
/Users/AIAgenterminal/rrd-orgo plan
/Users/AIAgenterminal/rrd-recovery-scheduler list
/Users/AIAgenterminal/rrd-harness stats
```

If FlowAudit internal recovery is in scope:

```bash
/Users/AIAgenterminal/rrd-ready check rr-flowaudit-internal --allow-no-orgo
node /Users/AIAgenterminal/rrd-flowaudit-due-reminders.mjs
```

Verify public routes before saying sales/onboarding is live:

```bash
for url in \
  https://flowaudit.co.uk/revenue-recovery \
  https://flowaudit.co.uk/revenue-recovery/onboarding \
  https://flowaudit.co.uk/revenue-recovery/terms \
  https://flowaudit.co.uk/revenue-recovery/privacy; do
  curl -L -s -o /tmp/rrd_route_body -w "%{http_code} %url_effective\n" "$url"
done
```

```bash
/Users/AIAgenterminal/rrd-harness stats
```

```bash
/Users/AIAgenterminal/rrd-harness query '{"limit":5,"fields":["id","company","email","integrationReady","consent","crm","paymentPlatforms","approxOutstanding","hasSop"]}'
```

Also verify the public GTM routes before saying the funnel is live:

```bash
python3 - <<'PY'
import urllib.request
for url in ['https://flowaudit.co.uk/revenue-recovery','https://flowaudit.co.uk/revenue-recovery/onboarding','https://flowaudit.co.uk/revenue-recovery/vault','https://flowaudit.co.uk/revenue-recovery/oauth-start','https://flowaudit.co.uk/revenue-recovery/offboard']:
    r = urllib.request.urlopen(url, timeout=15)
    print(url, r.status, r.geturl())
PY
```

For a representative or target client:

```bash
/Users/AIAgenterminal/rrd-provision --dry-run <submission-id>
```

```bash
/Users/AIAgenterminal/rrd-welcome-pack welcome <submission-id> --dry-run
```

```bash
/Users/AIAgenterminal/rrd-vault status
```

```bash
/Users/AIAgenterminal/rrd-recover gate rr-<profile> '{"channel":"Email","to":{"email":"customer@example.com"},"approved":true,"atHour":10}'
```

```bash
/Users/AIAgenterminal/rrd-brain cycle rr-<profile> --dry-run
```

```bash
/Users/AIAgenterminal/rrd-orgo plan
/Users/AIAgenterminal/rrd-orgo status rr-<profile>
```

Check scheduled automation with the cron job tool when available: support/cancellation inbox watcher, final-payment offboard watcher, sales retainer watcher, and daily operator summary.

## Tests worth running before claiming readiness

Use focused tests instead of the entire machine-wide suite. Include the recovery/payment-link path when the session touched Stripe or direct recovery emails:

```bash
node --test \
  /Users/AIAgenterminal/test/rrd-guardrails.test.mjs \
  /Users/AIAgenterminal/test/rrd-recover.test.mjs \
  /Users/AIAgenterminal/test/rrd-draft.test.mjs \
  /Users/AIAgenterminal/test/rrd-stripe.test.mjs \
  /Users/AIAgenterminal/test/rrd-collect.test.mjs \
  /Users/AIAgenterminal/test/rrd-cancellation-core.test.mjs \
  /Users/AIAgenterminal/test/rrd-oauth.test.mjs \
  /Users/AIAgenterminal/test/rrd-hermes-integrations.test.mjs
```

## Pitfalls

- If `rrd-recover gate` says `NO_POLICY`, re-provision the profile; the policy file may be missing/stale. Then rerun the gate check.
- If you generate a test vault link while auditing, expire that test drop before finishing so no unused live link remains.
- Do not treat `integrationReady:false` as a broken system. It usually means real client API/OAuth access has not been completed yet.
- Do not claim outbound email delivery unless the provider has delivery evidence. AgentMail send responses are "accepted for sending" with a message id.
- Keep welcome packs operational only. API setup instructions for PostGrid/Twilio/Stripe/etc. belong in the separate integration-access email, not the welcome pack.
- The offboarding form link should not be included in the welcome pack. Cancellation instructions there should route to the support inbox from the business email on file.

## Answer shape

Lead with the verdict and match the operator's wording:

- If they ask **"are we ready to operate fully?"** say whether the system is ready for sales/onboarding/control-tower operation, then name the remaining live-client gates.
- If they ask **"could we meaningfully serve a client tomorrow?"** answer: yes, if positioned as approval-gated managed recovery after contract/payment/access; do not imply fully autonomous scale from day one.
- If they ask **"if Orgo is paid and the client provides everything?"** answer: yes, ready for a real first client in controlled production after that client's readiness gate passes.
- "Yes — GTM-ready for sales/onboarding, but not client-live until APIs/OAuth and runtime are connected."
- "Yes — system-ready, but this client is not live-recovery-ready until APIs/OAuth are connected."
- "Partially — provisioning and messaging work, but guardrail/send path failed on X."
- "No — blocker: X."

Then give concise bullets: verified working, blockers/caveats, exact next commands. For GTM readiness, explicitly distinguish:

- **Sell/onboard now** — landing/onboarding/vault/OAuth routes, welcome/access automation, approvals, SOP fallback, support/offboarding, and tests are green.
- **Controlled pilot now** — dry-run, approval packet, and first approved live send after client credentials are installed.
- **Do not overpromise** — no fully hands-off live recovery until the specific client has connected real integrations, policy/approval routing are confirmed, and the approved runtime is available.

If Stripe is involved, state the nuance clearly: existing Stripe invoices can use `hosted_invoice_url` for the current amount remaining in approved recovery emails; creating a new arbitrary Stripe Payment Link is a separate write action that needs explicit authorization and suitable Stripe permissions.
