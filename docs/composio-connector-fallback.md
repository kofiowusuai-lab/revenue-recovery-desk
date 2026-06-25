# Composio connector fallback for RRD

Use this when a native OAuth provider flow is slow, brittle, or blocked by marketplace/developer-app quirks. Composio can act as an integration access layer while RRD keeps ownership of consent, mapping, readiness, approval gates, audit, and recovery policy.

## When to use

- Native OAuth keeps failing after callback/app credentials are verified.
- Long-tail CRM/accounting platforms are requested and building a bespoke OAuth connector is not worth the first pass.
- You need a quick spike to confirm whether a platform exposes the needed read data before committing to a first-party connector.

Do **not** treat Composio as replacing RRD guardrails. It only brokers connections/tool calls; RRD still owns mapping, DNC/VIP/dispute/payment-plan flags, approval-gated outreach, audit logs, Orgo isolation, and client reporting.

## Local credential install

- Composio API key installer: `/Users/AIAgenterminal/rrd-composio-install.mjs`
- Writes locally to `/Users/AIAgenterminal/.openclaw/.env`:
  - `COMPOSIO_API_KEY`

Never ask for the Composio key in chat. Open the installer, have the operator paste it locally, then verify presence only.

## Pipedrive-specific finding

Pipedrive native OAuth can return `401 unauthorized access — Please check developers.pipedrive.com` even when the app is LIVE/private and the local client id/secret match the share URL. If Pipedrive's own Share URL fails with the same 401, the failure is inside Pipedrive Developer Hub/app setup, not RRD URL generation.

Composio does **not** provide managed Pipedrive OAuth credentials by default. A custom Composio auth config is required using the operator's Pipedrive client id/secret.

Composio reports the Pipedrive OAuth redirect URI to register in the Pipedrive app as:

```text
https://backend.composio.dev/api/v1/auth-apps/add
```

Pipedrive allows one callback URL per app. For a Composio-backed Pipedrive app, set the callback to the Composio backend URL above, not the FlowAudit/ivory callback.

## Python SDK spike commands

Use Python 3.11+; macOS system Python 3.9 may fail because older `typing` lacks `TypeAlias`.

```bash
/Users/AIAgenterminal/.hermes/hermes-agent/venv/bin/python -m pip install composio==0.15.0
```

Basic inspection pattern, with secret values loaded but never printed:

```python
from composio import Composio
c = Composio(api_key=os.environ['COMPOSIO_API_KEY'])
print(c.toolkits.get('PIPEDRIVE').slug)
print(c.toolkits.get_auth_config_creation_fields('PIPEDRIVE', 'OAUTH2'))
```

To create a Pipedrive Composio auth config, use custom auth, not managed auth:

```python
cfg = c.auth_configs.create('PIPEDRIVE', {
    'type': 'use_custom_auth',
    'authScheme': 'OAUTH2',
    'name': 'RRD Pipedrive OAuth',
    'credentials': {
        'client_id': os.environ['PIPEDRIVE_OAUTH_CLIENT_ID'],
        'client_secret': os.environ['PIPEDRIVE_OAUTH_CLIENT_SECRET'],
        'oauth_redirect_uri': 'https://backend.composio.dev/api/v1/auth-apps/add',
        'scopes': 'deals:read,contacts:read,activities:read,products:read',
    },
})
print(cfg.id)  # safe to print; not a secret
```

Then create a connect link:

```python
req = c.connected_accounts.link(
    'rrd-pipedrive-test',
    cfg.id,
    callback_url='https://revenue-recovery-web-ivory.vercel.app/oauth-callback',
)
print(req.id)           # connected account id, safe
print(req.redirect_url) # send/open for operator authorization
```

Save non-secret IDs locally for future verification:

- `COMPOSIO_PIPEDRIVE_AUTH_CONFIG_ID`
- `COMPOSIO_PIPEDRIVE_TEST_CONNECTED_ACCOUNT_ID`

## Verification after operator authorizes

After the operator finishes the Composio connect page:

1. Check the connected account status via `c.connected_accounts.get(<id>)` or `wait_for_connection(<id>)`.
2. Run one read-only Pipedrive tool call through Composio (for example list/get deals, persons, organizations, fields) using the connected account id.
3. Map the result into RRD's canonical recovery schema only after confirming fields available for invoice/deal amount, status, person/org email, due/close dates, and custom flags.

If the Composio flow fails before authorization, first verify the Pipedrive app callback is exactly `https://backend.composio.dev/api/v1/auth-apps/add` and that the app is live/private with read scopes saved.