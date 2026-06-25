# ServiceM8 Composio scope selection

Use when setting up generic ServiceM8 support before a real client connects, especially in the Composio Auth Config UI.

## Default stance

Start least-privilege and read-only. ServiceM8/Composio may show a very broad default scope string (including publish/manage/vendor/staff scopes). Do not accept the full default set for RRD unless a later implementation proves a specific read is impossible without one of those scopes.

## Recommended initial scopes

Select exactly these for the first generic ServiceM8 Auth Config:

```txt
read_customers
read_customer_contacts
read_jobs
read_job_contacts
read_job_materials
read_job_notes
```

These support the usual RRD discovery needs: customer identity/contact details, jobs/work history, line items/materials, and job context/notes.

## Optional read scopes for later expansion

Only add after a real client smoke test proves they are needed:

```txt
read_tasks
read_schedule
read_locations
read_messages
read_job_attachments
read_assets
```

## Scopes to remove by default

Remove broad write/admin/publish/vendor/staff scopes such as:

```txt
manage_customers
manage_customer_contacts
manage_jobs
create_jobs
manage_job_contacts
manage_job_materials
publish_job_notes
publish_sms
publish_email
manage_locations
manage_staff
staff_activity
staff_locations
vendor
vendor_logo
vendor_email
manage_notifications
manage_templates
manage_badges
manage_assets
manage_inventory
manage_schedule
manage_tasks
```

## Operator workflow

- If the user asks what to select in Composio, lead with the exact recommended scope list above.
- If they create an Auth Config, treat its `ac_...` value as a reusable config reference, not a secret.
- Do not claim ServiceM8 is client-ready until a real client completes a connection and a read-only smoke check succeeds.
- Store any client-specific connected account later as a `ca_...`/connected-account value in the isolated client profile, not as the reusable Auth Config.
