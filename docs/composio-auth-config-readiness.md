# Composio Auth Config Readiness — Dynamics 365 and ServiceM8

Session-derived operating notes for generic, pre-client Composio connector setup.

## Key distinction

- `ac_...` = Composio Auth Config ID. This is reusable provider setup and can exist before any real client.
- `ca_...` = Composio Connected Account ID. This is client-specific and only exists after the client authorizes the provider.

Do not mark a real client ready from an `ac_...` alone. Readiness requires the client-specific `ca_...` plus a read-only smoke check.

## Dynamics 365

When no real Dynamics client exists yet, do not invent or hardcode a fake Dynamics environment URL. Use Composio's dynamic placeholder scope in the managed auth config:

```txt
offline_access
https://{{subdomain}}.api.crm.dynamics.com/user_impersonation
```

For a real client, expect the connection flow to require their Dynamics/Dataverse environment/subdomain. A future native connector should use the actual environment URL form, e.g. `https://company.crm11.dynamics.com/user_impersonation`, but generic Composio pre-setup should stay dynamic.

Operator-level installed key:

```txt
COMPOSIO_DYNAMICS365_AUTH_CONFIG_ID=ac_...
```

Future per-client key:

```txt
COMPOSIO_DYNAMICS365_CONNECTED_ACCOUNT_ID=ca_...
```

## ServiceM8

Use a least-privilege read-only ServiceM8 scope set when creating the Composio Auth Config:

```txt
read_customers
read_customer_contacts
read_jobs
read_job_contacts
read_job_materials
read_job_notes
```

Avoid broad write/admin/publish scopes unless a later reviewed workflow explicitly needs them, e.g. `publish_sms`, `publish_email`, `manage_*`, `staff_activity`, `vendor_*`.

Operator-level installed key:

```txt
COMPOSIO_SERVICEM8_AUTH_CONFIG_ID=ac_...
```

Future per-client key:

```txt
COMPOSIO_SERVICEM8_CONNECTED_ACCOUNT_ID=ca_...
```

## Local input handling

When the operator has an `ac_...` and asks for a page to input it, use a local localhost installer page or equivalent local-only helper. It is not a secret like a client secret, but local input keeps the workflow consistent. Verify presence/format only; do not print stored values.

## Workflow for future clients

1. Client identifies the provider in onboarding/secure access.
2. Generate a Composio connection link using the provider's `COMPOSIO_*_AUTH_CONFIG_ID`.
3. Client authorizes with the provider.
4. Composio returns a client-specific `ca_...` connected account.
5. Store the `ca_...` in that client's isolated recovery profile.
6. Run a read-only smoke check before marking the integration ready.

## Deferred connectors

Chaser and AccuLynx can remain deferred unless a client needs them. Shopify sits in the Composio/OAuth bucket unless native Shopify OAuth is intentionally built and reviewed later.
