# ChatGPT agent account assignment in paid-client onboarding

Use this when the operator asks where to enter or assign the FlowAudit-managed ChatGPT/Codex account for a newly paid RRD client.

## Current assignment model

There is currently no public client-facing input field for this. The assignment is an internal operator step after payment and profile provisioning.

- The client does **not** provide a ChatGPT password, OpenAI API key, or OAuth token.
- FlowAudit creates or assigns a managed ChatGPT Plus/Pro account for that client's agent.
- Store only non-secret assignment metadata in internal/readiness notes, for example:
  - profile: `rr-acme`
  - assigned account email: `acme.agent@flowaudit.co.uk`
  - status: `pending_account`, `pending_oauth`, `connected`, or `failed_refresh`
- The password belongs in the operator's account/password manager, not RRD `.env`, Supabase client rows, vault drops, Telegram, or the readiness card.

## Where the actual runtime auth lives

The usable ChatGPT/Codex OAuth credentials are created by Hermes and stored profile-locally after the auth flow:

```txt
/Users/AIAgenterminal/.hermes/profiles/rr-company/auth.json
```

Never print or summarize raw `auth.json` contents. Status checks should report presence/provider/model only.

## Operator flow after payment

1. Payment accepted.
2. Provision the profile as usual, e.g. `rr-acme`.
3. Create/assign the FlowAudit-managed ChatGPT account for that client agent.
4. Record the non-secret assigned email in internal notes/readiness metadata if available.
5. Run:

```bash
/Users/AIAgenterminal/rrd-agent-llm auth rr-acme
```

6. In the browser/device flow, sign into the assigned ChatGPT account for that client.
7. Verify:

```bash
/Users/AIAgenterminal/rrd-agent-llm status rr-acme
/Users/AIAgenterminal/rrd-ready check rr-acme --allow-no-orgo
```

## User-facing answer pattern

When the operator asks “where do I put the assigned ChatGPT account?” answer directly:

- Today: bring the profile name + assigned account email to the operator agent, or run `rrd-agent-llm auth <profile>` yourself.
- The account email may be recorded as non-secret internal metadata/readiness notes.
- The password is never entered into RRD; the OAuth flow writes profile-local `auth.json`.
- The next product improvement should be an internal “Assign ChatGPT agent account” readiness step, not a public client onboarding field.

## Future automation target

Add a first-class internal readiness item:

```txt
ChatGPT agent runtime
Assigned account: acme.agent@flowaudit.co.uk
Status: pending OAuth
Next step: rrd-agent-llm auth rr-acme
```

This item should turn green only after profile-local `openai-codex` auth is present and `rrd-ready` passes the `llm:chatgpt-oauth` check.
