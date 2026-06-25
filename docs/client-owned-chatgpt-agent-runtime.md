# Client-funded ChatGPT runtime for per-client Hermes agents

Use this when adding or operating support for each RRD client to run their `rr-<company>` Hermes recovery agent on its own ChatGPT Plus/Pro subscription via Hermes' ChatGPT/Codex OAuth path, rather than sharing operator model billing.

## Locked architecture

- Each live client agent has an isolated Hermes profile: `rr-<company>`.
- The model runtime is profile-local, not global to the `recoverydesk` operator profile.
- Use Hermes' ChatGPT-account / OpenAI Codex OAuth path:
  - provider: `openai-codex`
  - API mode: `codex_responses`
  - auth store: profile-local `auth.json`
- Default RRD operating model is **FlowAudit-managed ChatGPT Plus/Pro account per live client agent**. The client funds it through the retainer; FlowAudit creates/assigns and signs into that account for the agent.
- Do **not** ask clients for an OpenAI API key.
- Do **not** collect or paste ChatGPT passwords, API tokens, OAuth access tokens, or refresh tokens in chat.
- OAuth tokens must live only in the target client profile's Hermes home, e.g. `/Users/AIAgenterminal/.hermes/profiles/rr-company/auth.json`.

## Implemented operator commands

RRD now uses a local helper:

```bash
/Users/AIAgenterminal/rrd-agent-llm init rr-company
/Users/AIAgenterminal/rrd-agent-llm assign rr-company --account-email rr-company-agent@flowaudit.co.uk
/Users/AIAgenterminal/rrd-agent-llm auth rr-company
/Users/AIAgenterminal/rrd-agent-llm status rr-company
```

Expected behavior:

- `init` writes/pins the profile's `config.yaml` to `model.provider: openai-codex` and the configured Codex model.
- `assign` is the operator input phase after payment/provisioning: it records only the FlowAudit-managed ChatGPT account email/label in profile-local `llm-runtime.json` (`0600`) and writes no passwords, OAuth tokens, API keys, or secrets.
- `auth` writes/pins config, then launches `hermes auth add openai-codex` with `HERMES_HOME` scoped to that client profile. Sign into the FlowAudit-managed ChatGPT account assigned to that client agent.
- `status` reports only safe booleans/metadata: profile exists, config exists, account assigned/email, provider pinned, auth exists/present, auth source, provider, model, runtime status. It must never print token values or raw `auth.json`.

## Provisioning requirements

Provisioned profiles should include `llmRuntime` metadata in `manifest.json`, for example:

```json
{
  "llmRuntime": {
    "mode": "flowaudit_managed_chatgpt",
    "provider": "openai-codex",
    "model": "gpt-5.1-codex-max",
    "accountOwner": "FlowAudit",
    "auth": "profile_local_oauth",
    "authProvider": "openai-codex",
    "authStore": "auth.json",
    "status": "pending_oauth",
    "billing": "funded from client retainer"
  }
}
```

Provisioning should also write client profile `config.yaml` with an RRD runtime block and next-step instructions that include:

1. Fill integration `.env` secrets / Composio connected account IDs securely.
2. Create or assign the FlowAudit-managed ChatGPT Plus/Pro account for this client agent.
3. Run `/Users/AIAgenterminal/rrd-agent-llm auth rr-company`.
4. Verify with `/Users/AIAgenterminal/rrd-agent-llm status rr-company`.
5. Run `/Users/AIAgenterminal/rrd-ready check rr-company --allow-no-orgo`.

Never overwrite an existing `.env` or `auth.json` without explicit operator direction. If `config.yaml` exists, back it up before replacing unless it is already correctly pinned.

## Readiness gate requirements

`rrd-ready check rr-<company> --allow-no-orgo` must not mark a live client ready until model runtime is ready.

Current readiness item:

```txt
llm:chatgpt-oauth
```

It should fail closed when:

- the profile is missing;
- `config.yaml` is not pinned to `openai-codex`;
- profile-local `auth.json` has no usable `openai-codex` singleton or credential-pool entry.

It should pass only when the target profile's local Hermes auth store has `openai-codex` credentials. Do not count operator/recoverydesk profile auth as satisfying a client profile.

The go-live readiness monitor/checklist should surface a visible **ChatGPT agent OAuth** item next to integrations, SOP, guardrails, and Orgo.

Readiness states to preserve conceptually:

- `pending_account` — ChatGPT account not created/assigned yet.
- `pending_oauth` — account exists but profile-local OAuth not completed.
- `connected` — profile-local auth exists and passes safe status/refresh check.
- `failed_refresh` — OAuth exists but refresh/status check fails; re-auth required.
- `waived_demo_only` — acceptable only for `rr-test`/demo/sandbox profiles, not live clients.

## Client/operator workflow

1. Client pays / setup is accepted.
2. Provision `rr-<company>` as usual.
3. Create or assign the dedicated FlowAudit-managed ChatGPT Plus/Pro account for that agent.
4. Record the account assignment metadata only:

```bash
/Users/AIAgenterminal/rrd-agent-llm assign rr-company --account-email rr-company-agent@flowaudit.co.uk
```

5. Run:

```bash
/Users/AIAgenterminal/rrd-agent-llm auth rr-company
```

6. Sign into the correct client-agent ChatGPT account in the OAuth browser/device flow.
7. Verify:

```bash
/Users/AIAgenterminal/rrd-agent-llm status rr-company
```

8. Run full minimum-ready gate:

```bash
/Users/AIAgenterminal/rrd-ready check rr-company --allow-no-orgo
```

8. Only then enable scheduler/gateway/live recovery.

## Tests / verification pattern

After changing this area, run targeted tests first:

```bash
node --test /Users/AIAgenterminal/test/rrd-agent-llm.test.mjs /Users/AIAgenterminal/test/rrd-ready.test.mjs /Users/AIAgenterminal/test/rrd-readiness-checklist.test.mjs /Users/AIAgenterminal/test/rrd-hermes-integrations.test.mjs
```

Then run the full local suite:

```bash
node --test /Users/AIAgenterminal/test/*.mjs
```

Expected current baseline after implementation was `333 passed, 0 failed, 1 skipped` (334 tests total). Treat counts as a moving baseline; real pass/fail matters more than the exact number.

## Codex re-review pattern

After implementation and tests, create a scrubbed snapshot for Codex/top-down review that excludes:

- `.env`, `.env.*`
- `auth.json`
- `hosts.yml`
- keys / PEMs
- local state DBs, logs, NDJSON ledgers
- build outputs and `node_modules`

Review objectives:

1. Secret safety: no token values in output, logs, or status.
2. Cross-client isolation: no use of operator/recoverydesk auth for a client profile.
3. Readiness: missing ChatGPT OAuth fails closed.
4. UX: operator commands are clear and hard to misuse.
5. Regression risk across provisioning, readiness, vault, scheduler, and web endpoints.

If Codex CLI returns `401 Unauthorized`, do not label the review complete. Fix Codex authentication first (e.g. `codex login` / configured provider auth), then rerun the review. Capture the setup fix, not a durable claim that Codex is broken.

## Pitfalls

- Do not accidentally authenticate the `recoverydesk`/operator profile instead of the client profile. Always scope the OAuth process by client profile/Hermes home.
- Do not store ChatGPT OAuth tokens in `.env`; Hermes uses profile-local `auth.json` / credential pool for OAuth credentials.
- Do not conflate model-runtime OAuth with client business-system OAuth such as Xero, HubSpot, Dynamics, ServiceM8, Google Workspace, or Microsoft 365. This is the agent's **model runtime** auth.
- Do not mark a live client ready just because their integrations are connected; the agent runtime must be connected too.
- Do not use API-key fallback for this feature unless the operator explicitly chooses a non-subscription billing model.
- Do not print or summarize raw `auth.json`; status must stay presence-only.
