# Dynamics 365 via Composio Auth Config

Use this reference when the operator is setting up generic Dynamics 365 CRM support before a real client exists.

## Key distinction

- `ac_...` = Composio Auth Config ID. Reusable connector authentication configuration. Safe to handle as a config reference; not a client secret.
- `ca_...` = Composio Connected Account ID. Client-specific account created only after a real client authorizes Dynamics 365. Store per client/profile, not globally.

## Generic pre-client setup

When there is no real Dynamics client yet, do **not** invent a fake Dynamics environment URL such as `https://company.crm11.dynamics.com`.

For Composio-managed Dynamics 365, keep the dynamic Composio scope pattern:

```txt
offline_access
https://{{subdomain}}.api.crm.dynamics.com/user_impersonation
```

Remove placeholder/example scopes like:

```txt
https://YOUR-DYNAMICS-ENVIRONMENT-URL/user_impersonation
https://company.crm11.dynamics.com/user_impersonation
```

The real environment-specific scope should only be used once an actual client environment is known and verified.

## Operator input pattern

If the operator does not want to paste the `ac_...` value in chat, serve a localhost-only form that writes to the real operator env:

```txt
/Users/AIAgenterminal/.openclaw/.env
```

Recommended env key:

```txt
COMPOSIO_DYNAMICS365_AUTH_CONFIG_ID=ac_...
```

Use real operator home explicitly; recoverydesk shells can sandbox `$HOME`:

```bash
HOME=/Users/AIAgenterminal node /Users/AIAgenterminal/rrd-dynamics365-composio-install.mjs
```

Verify only presence, never print the stored value.

## RRD wiring guidance

Treat Dynamics 365 as Composio-managed unless/until Composio proves insufficient:

```js
"Dynamics 365": { auth: "composio", provider: "dynamics365" }
```

Do not mix it with the existing Microsoft 365 / Outlook Graph OAuth connector. Graph scopes like `User.Read`, `Mail.Read`, and `Files.Read` are for the Microsoft 365 connector, not Dynamics CRM.

## Real-client flow later

1. Client says they use Dynamics 365 CRM.
2. Use the stored `COMPOSIO_DYNAMICS365_AUTH_CONFIG_ID` to generate a connection flow.
3. Client authorizes Microsoft/Dynamics.
4. Composio returns a `ca_...` Connected Account ID.
5. Store the client-specific connected account in that client's recovery profile, e.g.:

```txt
COMPOSIO_DYNAMICS365_CONNECTED_ACCOUNT_ID=ca_...
```

6. Run a read-only smoke check before marking the client ready to serve.
