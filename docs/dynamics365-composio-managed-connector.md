# Dynamics 365 via Composio-managed connector

Use this when RRD needs to advertise/support Dynamics 365 CRM before there is a real client tenant/environment available.

## Key lesson

Entra/Microsoft 365 base OAuth is not the same thing as a Dynamics 365 / Dataverse connector. Treat Dynamics 365 as its own connector path and do not mix its tokens or readiness status with the generic Microsoft 365/Outlook connector.

## When no real client exists yet

Do **not** ask the operator to invent a fake Dataverse environment URL such as `https://company.crm11.dynamics.com`. For a generic support-ready setup in Composio, keep the Composio placeholder scope so the real client/environment can be supplied at connection time.

Recommended generic Composio scopes:

```txt
offline_access
https://{{subdomain}}.api.crm.dynamics.com/user_impersonation
```

Remove fake placeholders such as:

```txt
https://YOUR-DYNAMICS-ENVIRONMENT-URL/user_impersonation
```

## When a real client exists

Confirm the client's actual Dynamics/Dataverse environment URL before completing the connection. Real Dataverse URLs often look like:

```txt
https://client.crm.dynamics.com
https://client.crm4.dynamics.com
https://client.crm11.dynamics.com
```

If building native OAuth later, use a per-client environment/resource URL and request:

```txt
offline_access
https://<actual-environment-host>/user_impersonation
```

## RRD implementation stance

For now, Dynamics 365 should be represented as a Composio-managed connector if the Auth Config was created in Composio. Store the connected account separately from Microsoft Graph/Outlook tokens, e.g.:

```txt
COMPOSIO_DYNAMICS365_CONNECTED_ACCOUNT_ID=...
```

Do not mark a client ready-to-serve for Dynamics until a real connected account exists and a read-only smoke check succeeds against their tenant.

## Operator guidance

Useful pages:

- Entra app registrations: `https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade`
- Power Platform environments: `https://admin.powerplatform.microsoft.com/environments`
- Composio auth configs: `https://app.composio.dev/auth-configs`

If the user asks for “what links do I go to,” lead with the URLs first, then brief steps. If they ask “open a page,” open the relevant app page directly instead of explaining.