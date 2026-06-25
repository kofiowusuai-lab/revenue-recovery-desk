# Onboarding AgentMail automation watcher

Use this when checking or maintaining the post-onboarding email flow.

## What is installed

- Cron job: `1878d7b1b9d9`
- Name: `RRD Onboarding AgentMail Automation Watcher`
- Schedule: every 5 minutes
- Cron script: `/Users/AIAgenterminal/.hermes/profiles/recoverydesk/scripts/rrd-onboarding-email-watch.sh`
- Wrapper: `/Users/AIAgenterminal/rrd-onboarding-email-watch`
- Main script: `/Users/AIAgenterminal/rrd-onboarding-email-watch.mjs`
- State/dedupe: `/Users/AIAgenterminal/.openclaw/rrd-onboarding-email-watch.json`

## Behavior

For each new Supabase onboarding submission, the watcher should:

1. Provision the per-client recovery profile with `/Users/AIAgenterminal/rrd-provision <submission-id>`.
2. Create a secure API-key vault link with `/Users/AIAgenterminal/rrd-vault new <submission-id>` when API-key integrations are detected.
3. Create OAuth connect links with `/Users/AIAgenterminal/rrd-vault connect <submission-id> <provider>` for supported OAuth providers when app credentials are configured.
4. Send the operational welcome email through AgentMail using `rrd-welcome-pack welcome`.
5. Send the separate secure integration-access email through AgentMail using `rrd-welcome-pack access` and the generated vault/OAuth URLs.
6. If the client has no SOP and asked FlowAudit to build one, send `rrd-welcome-pack sop` with a `/sop-review` link. The page shows the FlowAudit Default Recovery SOP and lets the client accept it or request changes. Declines notify the operator and trigger a follow-up email with the booking link.
7. If critical go-live details are missing, send `rrd-welcome-pack readiness` with a `/readiness` link. The page collects approval routing, sender identity, SMS/letter setup, do-not-contact/settlement/escalation rules, and spreadsheet/CRM mapping details.

For each newly deposited vault/OAuth drop, the watcher sends the client a receipt email confirming the secure integration form was received.

## Safety boundaries

- The onboarding watcher does **not** itself decrypt credentials; vault auto-install is handled separately by `rrd-vault-watch` when its fail-closed auto-approval guard passes.
- Never print secret values. Report only key names and provider/message IDs.
- AgentMail send responses are **accepted for sending**, not guaranteed human delivery.
- Existing submissions/drops were baselined at install time to avoid surprise legacy/test emails.

## Verification

Safe dry run:

```bash
/Users/AIAgenterminal/rrd-onboarding-email-watch --dry-run
```

Silent success on a normal run means nothing new was processed:

```bash
/Users/AIAgenterminal/rrd-onboarding-email-watch
```

Inspect schedule:

```bash
hermes cron list
```

If asked whether a new client will receive email automatically, verify both:

1. The cron job above is enabled.
2. The onboarding page still writes to the expected Supabase `submissions` table.

Answer pattern after verification: "New future onboarding submissions should receive AgentMail welcome/access emails within ~5 minutes." Do not overclaim inbox delivery; say AgentMail/provider message IDs mean accepted for sending. A dry run with existing rows marked `alreadyProcessed: true` confirms the watcher can read state/Supabase, but it does not prove a fresh email was delivered.
