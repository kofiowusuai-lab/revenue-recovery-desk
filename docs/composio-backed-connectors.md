# Composio-backed connector fallback

Use this when a direct OAuth connector is burning time on provider-specific app setup, callback validation, or token handling. Composio can be used as an integration-access layer while RRD continues to own consent, field mapping, readiness, approval gates, audit logs, and recovery policy.

## Recommended stance

- Keep direct RRD OAuth/vault connectors for core providers that already work and are tested.
- Use Composio as a fallback/expansion layer for:
  - Pipedrive, if direct OAuth returns provider-side `401 unauthorized access` even from Pipedrive's own Share/install URL.
  - Long-tail CRMs/accounting/payment-adjacent tools not already in the RRD connector registry.
  - Fast feasibility checks before investing in a direct OAuth connector.
- Do not let Composio bypass RRD controls: every recovery action still flows through client consent, readiness, mapping, guardrails, and human approval.

## Local credential install

Use the local-only installer; never ask the user to paste Composio keys into chat:

```bash
RRD_OPERATOR_HOME=/Users/AIAgenterminal node /Users/AIAgenterminal/rrd-composio-install.mjs
open "$(cat /tmp/rrd-composio-install-url.txt)"
```

It writes only:

```text
COMPOSIO_API_KEY
```

to `/Users/AIAgenterminal/.openclaw/.env`, with a timestamped backup. Verify presence only; never print the key.

## Pipedrive direct-OAuth pitfall

If direct Pipedrive OAuth fails with:

```text
HTTP 401
{"success":false,"error":"unauthorized access","errorCode":401,"error_info":"Please check developers.pipedrive.com"}
```

and the same 401 happens with Pipedrive's own **Share app** URL, treat it as a Pipedrive Developer Hub/app state problem, not an RRD URL-generation problem. Rechecking callback URLs alone will not fix it.

Before abandoning direct OAuth, verify:

1. App type is **Private app**.
2. App status is **LIVE** or it is being tested via **Install & test** inside the sandbox/company.
3. The app has exactly one callback URL, normally `https://flowaudit.co.uk/revenue-recovery/oauth-callback` for Pipedrive if the app was created with that callback.
4. OAuth & access scopes are saved.
5. The installed local value is specifically **Client ID**, not app ID/slug/installation URL.

If those are true and 401 persists, switch to Composio for Pipedrive rather than continuing to churn on the direct OAuth path.

## Composio spike checklist

1. Install `COMPOSIO_API_KEY` locally via the installer above.
2. Create/connect a Composio Pipedrive connection for a test entity/account.
3. Verify read access for deals, persons/contacts, organizations, activities, users, and custom fields.
4. Map Composio Pipedrive output into the existing canonical recovery schema.
5. Add a connector mode such as `auth: composio` / `provider: pipedrive` without weakening RRD readiness or approval gates.
6. Only expand to other Composio-backed providers after Pipedrive proves end-to-end.
