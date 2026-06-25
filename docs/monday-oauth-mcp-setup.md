# monday.com OAuth + MCP notes for Revenue Recovery Desk

Use this when adding or operating monday.com as a CRM/work-management connector.

## OAuth provider details

monday.com OAuth docs: `https://developer.monday.com/apps/docs/oauth`

Live FlowAudit callback to register in the monday Developer Center:

```text
https://flowaudit.co.uk/revenue-recovery/oauth-callback
```

RRD provider id:

```text
monday
```

Operator developer-app env vars:

```text
MONDAY_OAUTH_CLIENT_ID
MONDAY_OAUTH_CLIENT_SECRET
```

Per-client profile token key written after approval:

```text
MONDAY_ACCESS_TOKEN
```

monday OAuth endpoints:

```text
Authorize: https://auth.monday.com/oauth2/authorize
Token:     https://auth.monday.com/oauth2/token
```

monday OAuth tokens do **not** expire and monday does **not** issue refresh tokens. The token remains valid until the user uninstalls the app.

Current least-privilege read scopes for RRD discovery:

```text
me:read account:read workspaces:read boards:read users:read updates:read
```

Avoid write scopes (`boards:write`, `updates:write`, etc.) unless a future feature explicitly needs them and is guarded behind RRD approval controls.

## Onboarding form

The live onboarding form should include `monday.com` as a first-class CRM dropdown option in:

```text
/Users/AIAgenterminal/revenue-recovery-web/onboarding.html
```

## Local-only credential installer

A local installer exists for monday credentials:

```text
/Users/AIAgenterminal/rrd-monday-install.mjs
```

It writes to the real operator env:

```text
/Users/AIAgenterminal/.openclaw/.env
```

It can install:

```text
MONDAY_API_TOKEN
monday_token
MONDAY_OAUTH_CLIENT_ID
MONDAY_OAUTH_CLIENT_SECRET
MONDAY_CLIENT_ID
MONDAY_CLIENT_SECRET
```

Use it instead of asking the operator to paste monday tokens or client secrets in chat.

## MCP server probe

Official package:

```text
@mondaydotcomorg/monday-api-mcp
```

Apps mode command shape:

```json
{
  "mcpServers": {
    "monday-apps-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@mondaydotcomorg/monday-api-mcp@latest",
        "-t",
        "<monday API token>",
        "--mode",
        "apps"
      ]
    }
  }
}
```

Hermes MCP config equivalent goes under `mcp_servers` in the active profile config, but do not store a real monday token in chat. Use the local-only installer/env handoff if a real token is needed.

With a dummy token, the MCP server starts and lists tools, including:

- `monday_apps_get_all_apps`
- `monday_apps_create_app`
- `monday_apps_get_app_versions`
- `monday_apps_get_app_features`
- `monday_apps_get_app_feature_schema`
- `monday_apps_get_development_context`
- `monday_apps_set_environment_variable`
- storage export/search tools

Calls that hit monday APIs fail with 401 unless a real token is installed. The package is useful for creating/managing monday apps once the operator supplies a real token locally; it is not needed for the static RRD OAuth redirect/token exchange code.

## Verification commands

Provider smoke check:

```bash
cd /Users/AIAgenterminal
node --input-type=module - <<'NODE'
import { providerId, buildAuthorizeUrl, envKeysForProvider } from './rrd-oauth.mjs';
const u = new URL(buildAuthorizeUrl('monday.com', {clientId:'cid', redirectUri:'https://flowaudit.co.uk/revenue-recovery/oauth-callback', state:'state'}));
console.log('provider', providerId('monday.com'));
console.log('envKeys', envKeysForProvider('monday.com').join(','));
console.log('authorize', u.origin + u.pathname);
console.log('scope', u.searchParams.get('scope'));
NODE
```

Relevant tests:

```bash
cd /Users/AIAgenterminal
node --test test/rrd-oauth.test.mjs test/rrd-onboarding-form.test.mjs
```
