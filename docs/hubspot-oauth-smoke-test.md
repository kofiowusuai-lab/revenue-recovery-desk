# HubSpot OAuth connector smoke test notes

Use this reference when validating a Revenue Recovery Desk HubSpot OAuth connector before client go-live.

## What worked

1. Create/deploy the HubSpot app with OAuth auth and least-privilege read scopes:
   - `oauth`
   - `crm.objects.contacts.read`
   - `crm.objects.companies.read`
   - `crm.objects.deals.read`
2. Register redirect URI exactly:
   - `https://revenue-recovery-web-ivory.vercel.app/oauth-callback`
3. Install HubSpot OAuth app credentials locally only into `/Users/AIAgenterminal/.openclaw/.env`:
   - `HUBSPOT_OAUTH_CLIENT_ID`
   - `HUBSPOT_OAUTH_CLIENT_SECRET`
   - optionally mirror as `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET` for helper compatibility.
4. Generate a one-time connect link:
   - `/Users/AIAgenterminal/rrd-vault connect <submission-id> hubspot --hours 48`
5. Client/operator completes HubSpot authorization. Verify drop status becomes `deposited`:
   - `/Users/AIAgenterminal/rrd-vault status`
6. Approve locally; use "approve", not "claim/decrypt", in operator-facing wording:
   - `/Users/AIAgenterminal/rrd-vault approve <drop-id>`
7. Verify profile env has HubSpot tokens by checking key presence only, never printing values:
   - `HUBSPOT_ACCESS_TOKEN`
   - `HUBSPOT_REFRESH_TOKEN`
   - `HUBSPOT_TOKEN_EXPIRES_AT`
8. Run CRM read smoke tests using the client profile token:
   - `GET https://api.hubapi.com/crm/v3/objects/contacts?limit=3&properties=email,firstname,lastname,createdate,lastmodifieddate`
   - `GET https://api.hubapi.com/crm/v3/objects/companies?limit=3&properties=name,domain,createdate,lastmodifieddate`
   - `GET https://api.hubapi.com/crm/v3/objects/deals?limit=3&properties=dealname,amount,dealstage,closedate,createdate,lastmodifieddate`

## Testing an actually-overdue fixture

When the goal is to test overdue/recovery logic, do not stop at “deal read works.” Create or edit a HubSpot deal so the returned `closedate` is in the past, then verify the exact stored value via the API.

Recommended check after editing a fixture:

```bash
set -a; . /Users/AIAgenterminal/.hermes/profiles/<profile>/.env; set +a
node - <<'NODE'
const id = '<hubspot-deal-id>';
const token = process.env.HUBSPOT_ACCESS_TOKEN;
const props = 'dealname,amount,closedate,dealstage,pipeline';
const res = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${id}?properties=${props}`, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
});
const body = await res.json().catch(() => ({}));
console.log(JSON.stringify({
  ok: res.ok,
  status: res.status,
  deal: {
    id: body.id,
    dealname: body.properties?.dealname,
    amount: body.properties?.amount,
    closedate: body.properties?.closedate,
    dealstage: body.properties?.dealstage,
    pipeline: body.properties?.pipeline,
  }
}, null, 2));
NODE
```

If the API returns `401`, refresh the profile token before concluding the connector failed:

```bash
/Users/AIAgenterminal/rrd-vault refresh <profile> hubspot
```

UI pitfall: HubSpot’s close-date field may keep the visible date selected while the date picker remains open. Prefer using the date picker arrows and selecting the intended calendar day, then wait for HubSpot’s “Close Date changes saved” confirmation. The API result is authoritative; report the timestamp HubSpot returns, not the date you intended to click.

## Important pitfalls

- The HubSpot install can fail until the app developer account signs HubSpot's Acceptable Use Policy. This is a developer-account compliance step, not a vault/secret/redirect bug.
- HubSpot may show an "untrusted app" warning for private/dev apps. This is acceptable for testing, but production client onboarding should wait until connector apps are published/verified/reviewed where possible.
- The read-only OAuth app cannot create test deals through the API. HubSpot returns `MISSING_SCOPES` requiring deal write scopes. Keep the production connector read-only; create fixtures manually in the HubSpot UI or with a separate test-only/admin path, not by adding write scopes to the client-facing recovery app.
- HubSpot CRM access proves contacts/companies/deals access. It does not prove exact unpaid invoice truth unless the client stores invoices/receivables in HubSpot. For real unpaid invoices, test accounting/payment connectors too: Xero, QuickBooks, Stripe, Square, PayPal.
- When reporting email/OAuth status, distinguish technical success from provider trust/review state.

## Example read smoke test command shape

```bash
set -a; . /Users/AIAgenterminal/.hermes/profiles/<profile>/.env; set +a
node - <<'NODE'
const token = process.env.HUBSPOT_ACCESS_TOKEN;
if (!token) throw new Error('missing HUBSPOT_ACCESS_TOKEN');
for (const [name, url] of [
  ['contacts', 'https://api.hubapi.com/crm/v3/objects/contacts?limit=3&properties=email,firstname,lastname'],
  ['companies', 'https://api.hubapi.com/crm/v3/objects/companies?limit=3&properties=name,domain'],
  ['deals', 'https://api.hubapi.com/crm/v3/objects/deals?limit=3&properties=dealname,amount,dealstage,closedate'],
]) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  console.log(JSON.stringify({ endpoint: name, ok: res.ok, status: res.status, countReturned: (body.results || []).length }, null, 2));
}
NODE
```
