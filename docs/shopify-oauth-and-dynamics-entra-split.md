# Shopify OAuth preference + Dynamics/Entra split

Use this when deciding whether a long-tail RRD connector should be vault/API, direct OAuth, or Composio-managed.

## Shopify

Although Shopify can be integrated through a per-client custom app/Admin API token, do **not** default to that route for RRD clients. Creating a Shopify custom app creates avoidable admin work for each client.

Current RRD stance:

- Prefer Shopify OAuth / Composio-style connection.
- Registry route: `auth:"composio", provider:"shopify"`.
- Expected profile key after install: `COMPOSIO_SHOPIFY_CONNECTED_ACCOUNT_ID`.
- Do not ask clients for `SHOPIFY_SHOP_DOMAIN` + `SHOPIFY_ADMIN_ACCESS_TOKEN` unless the operator explicitly chooses the custom-app fallback for a special case.

## Microsoft Entra vs Dynamics 365

RRD already has the reusable Microsoft OAuth base provider:

- Provider id: `microsoft`.
- Aliases include `Microsoft`, `Microsoft 365`, `Office 365`, `Outlook`, `Azure`, `Azure AD`, `Entra`, and `Microsoft Entra`.
- Operator creds: `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`.
- Existing scopes are Microsoft Graph/M365-oriented: `offline_access User.Read Mail.Read Files.Read`.

Do **not** treat that as a completed Dynamics 365 connector. Dynamics 365 can use Entra auth, but still needs Dynamics/Dataverse-specific scope/resource selection, endpoint/API mapping, and smoke testing before marking Dynamics operational.

### Operator links for Dynamics setup

When the operator is actively creating/checking the app and asks “what links do I go to,” give the links first, without a long explanation:

- Entra app registrations: `https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade`
- Power Platform environments: `https://admin.powerplatform.microsoft.com/environments`

Inside Entra, use **App registrations → Authentication** to add web callback URLs:

- `https://flowaudit.co.uk/revenue-recovery/oauth-callback`
- `https://revenue-recovery-web-ivory.vercel.app/oauth-callback`

Inside Entra, use **API permissions → Add a permission → Dynamics CRM → Delegated permissions → user_impersonation**. Admin consent may be required by the client tenant.

### Dynamics/Dataverse scopes

For a Dynamics 365 / Dataverse connector, the scope list should be exactly:

```txt
offline_access
https://ACTUAL-CLIENT-ENVIRONMENT.crm*.dynamics.com/user_impersonation
```

Replace the second line with the client’s real environment URL from Power Platform, with no trailing slash, for example:

```txt
offline_access
https://company.crm.dynamics.com/user_impersonation
```

or:

```txt
offline_access
https://company.crm11.dynamics.com/user_impersonation
```

Do **not** use Microsoft Graph scopes for the Dynamics connector (`User.Read`, `Mail.Read`, `Files.Read`); those belong to the separate Microsoft 365 / Outlook connector.

Composio pitfall: if a managed Dynamics config shows a placeholder scope such as:

```txt
https://{{subdomain}}.api.crm.dynamics.com/user_impersonation
```

ask/verify whether Composio will collect and substitute the real Dynamics subdomain/environment URL. If it cannot, remove the placeholder and use the actual environment URL scope above. Real Dataverse environments usually look like `*.crm.dynamics.com`, `*.crm4.dynamics.com`, `*.crm11.dynamics.com`, etc., not necessarily `*.api.crm.dynamics.com`.

### Future native RRD provider shape

Build Dynamics as a separate provider id such as `dynamics365`, not by reusing `microsoft`, so Graph/M365 tokens stay separate from Dataverse tokens. Expected env names should be separate too:

- `DYNAMICS365_OAUTH_CLIENT_ID`
- `DYNAMICS365_OAUTH_CLIENT_SECRET`
- `DYNAMICS365_ACCESS_TOKEN`
- `DYNAMICS365_REFRESH_TOKEN`
- `DYNAMICS365_TOKEN_EXPIRES_AT`
- `DYNAMICS365_RESOURCE_URL`
- optionally `DYNAMICS365_TENANT_ID`

Because the `user_impersonation` scope is resource-specific, the connector should collect/store the client’s Dynamics environment URL before generating the OAuth authorize link.

Short answer pattern for the operator:

- “Microsoft Entra base auth is already done.”
- “Dynamics 365-specific connector work is still needed.”
- “Use only `offline_access` plus the real Dataverse environment `.../user_impersonation` scope.”
