# Microsoft 365 / Outlook OAuth setup for Revenue Recovery Desk

Use this for Microsoft Entra / Azure app registration and RRD connect-link testing.

## Provider identity

RRD provider id:

```text
microsoft
```

Common aliases:

```text
Microsoft
Microsoft 365
Office 365
Outlook
Azure
Azure AD
Entra
Microsoft Entra
```

Operator app credentials in `/Users/AIAgenterminal/.openclaw/.env`:

```text
MICROSOFT_OAUTH_CLIENT_ID
MICROSOFT_OAUTH_CLIENT_SECRET
```

Per-client profile keys written after approve:

```text
MICROSOFT_ACCESS_TOKEN
MICROSOFT_REFRESH_TOKEN
MICROSOFT_TOKEN_EXPIRES_AT
```

OAuth endpoints:

```text
Authorize: https://login.microsoftonline.com/common/oauth2/v2.0/authorize
Token:     https://login.microsoftonline.com/common/oauth2/v2.0/token
```

Live redirect URI:

```text
https://flowaudit.co.uk/revenue-recovery/oauth-callback
```

Scopes currently used:

```text
offline_access User.Read Mail.Read Files.Read
```

These are delegated, read-oriented Microsoft Graph scopes for sign-in/profile, Outlook mail read, OneDrive file read, and refresh tokens. Avoid write scopes unless a future feature explicitly needs them and guardrails are updated.

## Azure CLI setup pattern

The operator may log in under the real user Azure config. Gateway/profile shells can have a sandbox `$HOME`, so use:

```bash
export AZURE_CONFIG_DIR=/Users/AIAgenterminal/.azure
```

Verify login:

```bash
AZURE_CONFIG_DIR=/Users/AIAgenterminal/.azure az account show --output table
```

Create a reusable app:

```bash
AZURE_CONFIG_DIR=/Users/AIAgenterminal/.azure az ad app create \
  --display-name "Revenue Recovery Desk" \
  --sign-in-audience AzureADMultipleOrgs \
  --web-redirect-uris "https://flowaudit.co.uk/revenue-recovery/oauth-callback"
```

If personal Outlook/Hotmail accounts are needed, switch to:

```text
AzureADandPersonalMicrosoftAccount
```

Pitfall: Microsoft requires v2 access tokens before changing to personal+org audience. If `az ad app update --sign-in-audience AzureADandPersonalMicrosoftAccount` fails with `Application must accept Access Token Version 2`, patch via Microsoft Graph first:

```bash
APP_ID="<app-client-id>"
OBJ_ID=$(AZURE_CONFIG_DIR=/Users/AIAgenterminal/.azure az ad app show --id "$APP_ID" --query id -o tsv)
AZURE_CONFIG_DIR=/Users/AIAgenterminal/.azure az rest \
  --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/$OBJ_ID" \
  --headers 'Content-Type=application/json' \
  --body '{"api":{"requestedAccessTokenVersion":2}}' \
  --output none
AZURE_CONFIG_DIR=/Users/AIAgenterminal/.azure az ad app update \
  --id "$APP_ID" \
  --sign-in-audience AzureADandPersonalMicrosoftAccount
```

Add Microsoft Graph delegated permissions by permission IDs:

```text
Microsoft Graph app id: 00000003-0000-0000-c000-000000000000
User.Read:       e1fe6dd8-ba31-4d61-89e7-88639da4683d
Mail.Read:       570282fd-fa5c-430d-a7fd-fc8dc98a9dca
Files.Read:      10465720-29dd-4523-a11a-6a75c743c9d9
offline_access: 7427e0e9-2fba-42fe-b0c0-848c9e6a8182
```

Use `az ad app permission add --api-permissions <id>=Scope` for each permission.

Create a client secret with `az ad app credential reset`, then install only into `/Users/AIAgenterminal/.openclaw/.env`. Do not print the secret in chat.

## Verification

Safe provider smoke check:

```bash
cd /Users/AIAgenterminal
node --input-type=module - <<'NODE'
import fs from 'node:fs';
import { appCreds, buildAuthorizeUrl, envKeysForProvider } from './rrd-oauth.mjs';
const text = fs.readFileSync('/Users/AIAgenterminal/.openclaw/.env','utf8');
const env = {};
for (const line of text.split(/\r?\n/)) {
  if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
  const i = line.indexOf('=');
  env[line.slice(0,i)] = line.slice(i+1).trim().replace(/^["']|["']$/g,'');
}
const creds = appCreds('microsoft', env);
const u = new URL(buildAuthorizeUrl('microsoft', {
  clientId: creds.clientId,
  redirectUri: 'https://flowaudit.co.uk/revenue-recovery/oauth-callback',
  state: 'test-state'
}));
console.log('microsoft app creds: present');
console.log('profile token keys:', envKeysForProvider('microsoft').join(','));
console.log('authorize host:', u.origin + u.pathname);
console.log('redirect_uri:', u.searchParams.get('redirect_uri'));
console.log('scope:', u.searchParams.get('scope'));
NODE
```

Generate a test connect link:

```bash
/Users/AIAgenterminal/rrd-vault connect <submission-id> microsoft --base https://flowaudit.co.uk/revenue-recovery
```

After the client/operator authorizes, approve promptly:

```text
approve <drop-id>
```

Expected approve output writes key names only:

```text
MICROSOFT_ACCESS_TOKEN
MICROSOFT_REFRESH_TOKEN
MICROSOFT_TOKEN_EXPIRES_AT
```

## Known-good app state from setup

The Revenue Recovery Desk Microsoft app was created with:

```text
Sign-in audience: AzureADandPersonalMicrosoftAccount
Access token version: 2
Redirect URI: https://flowaudit.co.uk/revenue-recovery/oauth-callback
```

The `rr-test` profile successfully authorized and installed Microsoft tokens via the standard `approve <drop-id>` workflow.
