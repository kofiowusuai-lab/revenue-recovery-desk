# HubSpot project OAuth setup session notes

Use this as a compact replay/verification checklist for the modern HubSpot project path when legacy public app creation is unavailable.

## Known-good shape from live setup
- HubSpot CLI can be configured with a Personal Access Key for the developer account; collect it through a local-only page or secure local prompt, not chat.
- Project directory used in the live run: `/Users/AIAgenterminal/hubspot-projects`.
- Project name: `revenue-recovery-desk`.
- App display name: `Revenue Recovery Desk`.
- App UID shape: `revenue_recovery_desk_app`.
- App auth type: OAuth.
- Distribution: Marketplace.
- Redirect URL: `https://revenue-recovery-web-ivory.vercel.app/oauth-callback`.
- Support email: `flowaudit-support@agentmail.to`.

## Verification checklist
1. Confirm HubSpot CLI config points at the intended developer account.
2. Deploy the project and require a successful build (`Build #N succeeded` plus component deploy `DONE`).
3. Verify app metadata after deploy:
   - app id/name match the RRD app,
   - redirect URL is exactly the RRD callback,
   - support email is the AgentMail support inbox,
   - allowed fetch URL includes HubSpot API if required,
   - OAuth client id exists, but do not print it,
   - accepted scopes include every intended read-only scope.
4. If accepted scopes differ from the intended list, call that out as incomplete. In one live run, HubSpot metadata showed only `oauth`, `crm.objects.companies.read`, and `crm.objects.deals.read`; `crm.objects.contacts.read` still needed re-checking.
5. Retrieve/install `HUBSPOT_OAUTH_CLIENT_ID` and `HUBSPOT_OAUTH_CLIENT_SECRET` only through HubSpot UI/API plus local-only install flow. Do not paste or echo them in chat.
6. Final readiness proof is a full OAuth round trip, not just app creation:
   - mint a real pending OAuth drop with `/Users/AIAgenterminal/rrd-vault connect <submission-id> hubspot`,
   - confirm the public `/oauth-start?...` URL returns HTTP 200,
   - have the operator/client authorize the app in HubSpot,
   - verify `rrd-vault status` changes the drop from `pending` to `deposited`,
   - run `/Users/AIAgenterminal/rrd-vault approve <drop-id>` promptly,
   - confirm only key names are present in the target profile `.env` (`HUBSPOT_ACCESS_TOKEN`, `HUBSPOT_REFRESH_TOKEN`, `HUBSPOT_TOKEN_EXPIRES_AT`), and report that the drop burned/consumed. Never print token values.

## UI / compliance pitfalls

A guessed direct component URL can show `Component not found` even after the project/app exists and build succeeded. Treat that as a navigation-route problem first: return to the project overview and open the app card from the HubSpot UI instead of assuming the component was not deployed.

If the HubSpot install page says the app cannot be installed because the developer has not signed the Acceptable Use Policy, the OAuth URL and client credentials are already reaching HubSpot; the blocker is the developer-account compliance agreement. Have the app owner sign/accept HubSpot's Acceptable Use Policy from the developer account that owns the app, then retry the same connect link if it is still pending/not expired, or mint a fresh `rrd-vault connect ... hubspot` link.
