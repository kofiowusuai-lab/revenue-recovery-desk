# OAuth CLI login runbook for Revenue Recovery Desk

Use this reference when the operator says they will sign into each provider while you prepare reusable OAuth apps/connectors. This captures durable workflow lessons; verify current auth/project state with live commands before making claims.

## Shared rules

- Never type, request, print, or store provider passwords, OAuth secrets, PATs, device codes, or API tokens in chat.
- If the operator pastes a provider token/PAT/API key into chat, treat it as exposed: do not use it, do not repeat it, and tell them to revoke/rotate it. Continue with browser/device-code login or a secure local prompt where the operator enters the new secret themselves.
- Use browser/device-code login flows where the operator completes authentication themselves.
- Report login state as verified only after a real CLI/provider command confirms the account/project/app; otherwise say it is in progress or blocked.
- Continue with independent providers when one account blocks. Do not let Salesforce/Microsoft/HubSpot stall Google/Zoho/QuickBooks/Xero setup.
- Register the RRD callback URL in every web OAuth app:

```text
https://revenue-recovery-web-ivory.vercel.app/oauth-callback
```

## Google Cloud / Workspace

Good CLI path:

```bash
gcloud auth login
gcloud config set project <project-id>
gcloud projects list
```

For this RRD operator environment, a previously verified Google account/project was:

```text
info@wussworldwide.io
freedom-495303
```

Treat that as a hint, not proof: re-run `gcloud auth list`, `gcloud config get-value project`, and/or `gcloud projects list` before answering current-state questions.

Next setup step after login is the OAuth consent screen and OAuth client in Google Cloud Console using the shared callback URL.

## HubSpot

Do **not** use this as the first bootstrap path for a new reusable app:

```bash
hs init --auth-type oauth2
```

That command expects an existing OAuth2 client ID/secret and therefore is not how to create the first reusable multi-client RRD OAuth app from zero.

If the HubSpot UI says new legacy public app creation is disabled, switch to the HubSpot project/public-app workflow (`hs project create` / current HubSpot CLI docs) or create the app in the current developer project UI, then write only the resulting env var names to the operator checklist:

```text
HUBSPOT_OAUTH_CLIENT_ID
HUBSPOT_OAUTH_CLIENT_SECRET
```

Private apps/tokens are one-account credentials and are not the intended reusable multi-client connector. If a Personal Access Key is needed only to authenticate the HubSpot CLI/project tooling, have the operator enter a fresh key through the CLI/browser prompt themselves; never accept or reuse a PAT pasted into chat.

## Microsoft / Azure

For Microsoft 365/Outlook connectors, the durable requirement is an Entra app registration with the shared callback URL. A personal Microsoft login with no Azure/Entra tenant can authenticate but still be unable to create/manage app registrations through CLI.

Preferred sequence:

```bash
az login --use-device-code
az account show
```

If the account has no subscriptions/tenant context, do not keep retrying blindly. Ask the operator to use an Azure/Entra-capable account or create/select a tenant, or continue by browser in the Entra portal once the operator is signed in.

Env names expected once the app exists:

```text
MICROSOFT_OAUTH_CLIENT_ID
MICROSOFT_OAUTH_CLIENT_SECRET
```

## Salesforce

Good operator-assisted path:

```bash
sf org login web --alias rrd-salesforce --set-default-dev-hub
```

Let the operator complete the browser login. If the CLI shows telemetry/acknowledgement prompts, handle only non-secret yes/no choices; never handle login/password/2FA. Verify with Salesforce CLI org listing before claiming login success.

Env names expected once the Connected App exists:

```text
SALESFORCE_OAUTH_CLIENT_ID
SALESFORCE_OAUTH_CLIENT_SECRET
```
