# RRD approval + onboarding automation readiness

Use this when asked whether onboarding is end-to-end automatic, where approvals go, or what the operator still needs to do.

## Current automation shape

New onboarding is handled by the cron job:

```bash
1878d7b1b9d9  RRD Onboarding AgentMail Automation Watcher  every 5m
```

The watcher script is:

```bash
/Users/AIAgenterminal/.hermes/profiles/recoverydesk/scripts/rrd-onboarding-email-watch.sh
```

It calls:

```bash
/Users/AIAgenterminal/rrd-onboarding-email-watch
```

For future submissions it should:

1. provision the per-client Hermes profile via `rrd-provision`;
2. create profile files (`SOUL.md`, `manifest.json`, `policy.json`, memories, empty `.env` placeholders);
3. create vault/API-key links where needed;
4. create OAuth connect links where the provider app credentials exist;
5. send the operational welcome email via AgentMail;
6. send the separate secure integration-access email via AgentMail;
7. resolve runtime mode from `/Users/AIAgenterminal/.openclaw/rrd-runtime-policy.json`;
8. for `rr-test`/explicit demo profiles only: create/start the local Orgo-equivalent sandbox via `rrd-local-sandbox` and run fake + live-readonly smoke tests;
9. for real clients by default: keep local sandbox disabled, verify/provision the Orgo project, and wait for explicit operator approval / Orgo availability before launching a computer;
10. send the operator a Telegram runtime-ready packet;
11. watch deposited vault/OAuth drops;
12. send the client an integration-access-received acknowledgement.

Phrase AgentMail results as **accepted for sending** with message id, not guaranteed delivered. Runtime-ready Telegram packets are operator/control-plane notifications, not client emails. State fields include `runtime.mode`, `runtime.localSandboxUsed`, `runtimeReadySentAt`, `runtimeTelegram`, and for demo profiles only `sandbox.fake` / `sandbox.liveReadonly`. Use `/Users/AIAgenterminal/rrd-runtime status [profile]` to see which runtime will be selected; default real-client mode is `orgo`.

## Operator approval points

The operator is still needed for two gates:

- credential/OAuth installation:

```text
approve <drop-id>
```

- outbound draft approval:

```text
Telegram Approve / Deny button
```

Do not tell the user credentials are auto-decrypted or auto-installed. Deposited drops remain encrypted until the operator approves them.

## Telegram approval bot

Approval queue command:

```bash
/Users/AIAgenterminal/rrd-approval
```

Config/status:

```bash
/Users/AIAgenterminal/rrd-approval config
```

Queue/demo examples:

```bash
/Users/AIAgenterminal/rrd-approval queue <profile> '<action-json>' --send-telegram
/Users/AIAgenterminal/rrd-approval demo rr-test --send-telegram
```

Button poller cron:

```bash
42156c0a9c4b  RRD Approval Telegram Button Poller  every 1m
```

Direct bot DM is acceptable for the internal operator workflow. For clients, position approval routing as configurable to their existing workflow: email, Teams, Slack, CRM task, shared inbox, Telegram channel, or another process. Do not imply Telegram is mandatory for clients. The live onboarding form now captures approval routing in Step 6: approvers (`f_approvalContacts`), preferred channel (`f_approvalChannel`), expected turnaround (`f_approvalSla`), and workflow notes (`f_approvalNotes`). These are stored under `guardrails.approvalRouting`, surfaced in the generated SOUL/MEMORY/USER/manifest, and should be used to decide where draft approval packets go. If approval routing is blank, fall back to the primary contact.

On approval, `rrd-approval` sets `approved:true` and calls `rrd-recover send` unless the item was queued with `--approval-only` or approved with `--record-only`. The final deterministic guardrail gate still runs immediately before dispatch.

## Readiness wording

When asked “is it wired end-to-end?”, verify and distinguish these states:

- automated: new onboarding watcher, profile provisioning, welcome/access emails, vault/connect link creation where credentials exist, deposited-drop acknowledgements, runtime-mode resolution, Orgo project verification/provisioning for real clients, local sandbox smoke tests only for `rr-test`/explicit demo profiles, operator Telegram runtime-ready packet, Telegram draft approval routing;
- operator-gated: `approve <drop-id>` for deposited credentials/OAuth, Telegram approve/deny for outbound drafts, and launching/booting a real Orgo computer for a client run;
- provider-dependent: OAuth connect links require installed reusable provider app credentials;
- runtime-dependent: live Orgo VM runs require a paid/available Orgo plan; local sandbox demos must not be used for real clients unless K explicitly overrides the runtime policy;

Safe answer pattern:

```text
Yes for provisioning/email/link/approval/sandbox plumbing: onboarding now provisions the profile, runs local fake + live-readonly smoke tests, and sends the operator a Telegram sandbox-ready packet. You are still needed for approve <drop-id> and draft approval buttons. Live Orgo VM execution is separate and still depends on a paid/available Orgo runtime.
```

## Verification commands

Use real commands before answering readiness questions:

```bash
/Users/AIAgenterminal/rrd-harness stats
/Users/AIAgenterminal/rrd-onboarding-email-watch --dry-run
/Users/AIAgenterminal/rrd-approval config
/Users/AIAgenterminal/rrd-local-sandbox status rr-test
/Users/AIAgenterminal/rrd-orgo plan
```

Also list cron jobs and check:

- `1878d7b1b9d9` enabled for onboarding AgentMail automation;
- `42156c0a9c4b` enabled for Telegram approval buttons.

## Durable pitfall: dotenv shell sourcing

Do not shell-source RRD `.env` files from bash wrappers when values may contain spaces. Use the Node watcher’s safe dotenv parser instead. A shell wrapper that does `. /path/.env` can break on values such as voice names with spaces. The wrapper should set PATH/cwd and execute the Node script; the Node script loads env files safely.

This is a durable pattern for RRD automation wrappers: keep shell wrappers minimal and let Node parse `.env` files.