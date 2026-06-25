# RRD runtime/readiness review hardening notes

Use this when reviewing or changing RRD per-client runtime assignment, readiness cards, onboarding watcher logic, or provider smoke probes.

## Durable findings from review

- **Provider probe hosts must be allowlisted before sending tokens.** Readiness smoke probes that build URLs from profile `.env` values must validate `https`, reject embedded credentials, and allowlist expected vendor hostnames before attaching OAuth/API tokens. This matters for Salesforce instance URLs, Zoho API domains, Pipedrive API domains, and any future dynamic base URL.
- **Readiness form matching must use exact source ids.** Do not use broad `JSON.stringify(row).includes(submissionId)` checks to decide whether SOP/readiness/mapping forms belong to a client. Match exact `sourceSubmissionId` / `submissionId` fields so one client cannot satisfy another client's checklist by substring or note text.
- **Composio integrations count in mapping gates.** Any logic that asks `needsMapping(...)` must include both `manifest.oauthConnectionsNeeded` and `manifest.composioConnectionsNeeded`; otherwise Composio-only clients can skip required mapping follow-up.
- **ChatGPT runtime readiness requires assignment plus OAuth.** The light readiness card and full `rrd-ready` gate should agree: `ChatGPT agent OAuth` is done only when the profile is pinned to `openai-codex`, a FlowAudit-managed account email is assigned in `llm-runtime.json`, and profile-local OAuth is present. Existing `auth.json` alone is not enough.
- **Validate runtime config values before writing YAML.** Model/provider strings that are written into profile config must reject newlines, comments, and unusual characters to prevent config injection.

## Review commands used

Targeted runtime/readiness tests:

```bash
node --test /Users/AIAgenterminal/test/rrd-agent-llm.test.mjs \
  /Users/AIAgenterminal/test/rrd-ready.test.mjs \
  /Users/AIAgenterminal/test/rrd-readiness-checklist.test.mjs
```

Full RRD suite:

```bash
node --test /Users/AIAgenterminal/test/rrd-*.test.mjs
```

## Tests to keep around these risks

- unsafe dynamic provider host refuses to make the network request before a token is attached
- special forms only count when exact source submission id matches
- `rrd-agent-llm` rejects unsafe model names before writing config
- light readiness does not mark ChatGPT OAuth done unless account assignment metadata exists
- mapping gates include Composio connectors as well as native OAuth connectors
