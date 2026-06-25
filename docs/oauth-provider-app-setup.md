# OAuth provider app setup notes

Use this when standing up reusable OAuth apps for Revenue Recovery Desk providers before minting per-client `rrd-vault connect` links.

## Shared rules
- Register this redirect URI exactly for every provider:
  `https://revenue-recovery-web-ivory.vercel.app/oauth-callback`
- Never paste OAuth client secrets, personal access keys, or provider tokens into chat.
- Install operator-side app credentials into `/Users/AIAgenterminal/.openclaw/.env`, not into a client profile and not Vercel.
- In recoverydesk/profile shells, `$HOME` may point at the Hermes profile sandbox. Wrappers that read machine-level secrets should pin the real operator home (`/Users/AIAgenterminal`) via a wrapper env such as `RRD_VAULT_HOME`.
- After app credentials are installed, mint a provider link with:
  `/Users/AIAgenterminal/rrd-vault connect <submission-id> <provider>`

## Google Workspace / Gmail
- Google provider id in RRD: `google`.
- OAuth app type: Web application.
- Authorized JavaScript origin: `https://revenue-recovery-web-ivory.vercel.app`
- Authorized redirect URI: `https://revenue-recovery-web-ivory.vercel.app/oauth-callback`
- Store app credentials locally as:
  - `GOOGLE_OAUTH_CLIENT_ID`
  - `GOOGLE_OAUTH_CLIENT_SECRET`
- RRD writes client authorization tokens into profiles as:
  - `GOOGLE_ACCESS_TOKEN`
  - `GOOGLE_REFRESH_TOKEN`
  - `GOOGLE_TOKEN_EXPIRES_AT`
- Scopes should stay read-only unless explicitly expanded: Gmail readonly and Drive metadata readonly.

## HubSpot modern app path
- HubSpot legacy public app creation may be blocked with “New legacy public app creation is disabled.” If so, use the HubSpot CLI project flow rather than the legacy browser modal.
- First configure HubSpot CLI auth for the developer account. The CLI expects a HubSpot Personal Access Key; collect/install it through a local-only page or other local secure path, never through chat.
- If `hs init --auth-type oauth2` prompts for an existing OAuth2 client id/secret, stop using that command for bootstrap; it is for connecting an existing OAuth app, not creating the reusable app from scratch.
- Then create the app project with a command shaped like:
  `hs project create --name revenue-recovery-desk --dest /Users/AIAgenterminal/hubspot-projects --project-base app --distribution marketplace --auth oauth --account <hubspot-account-id>`
- Expected durable identifiers from a successful setup should be recorded in local notes/status only, not as secrets: HubSpot account id, project id, app id, app UID, build number, and config path.
- Deploy with the HubSpot project CLI and verify the build succeeded before saying the app is usable. A successful deploy should show the app component as `DONE` and HubSpot should show the latest build as succeeded.
- Do **not** assume a guessed browser route for the app component is valid. If the UI says `Component not found`, go back to the project overview and open the app card from there instead of treating the app as missing.
- After deploy, verify OAuth metadata from HubSpot/API/CLI: redirect URL, support email, allowed fetch URL, and the exact scopes HubSpot accepted. If the metadata omits an intended scope such as `crm.objects.contacts.read`, report that scope gap and re-check project config before calling HubSpot fully ready.
- RRD HubSpot provider id: `hubspot`.
- Store app credentials locally as:
  - `HUBSPOT_OAUTH_CLIENT_ID`
  - `HUBSPOT_OAUTH_CLIENT_SECRET`
- Required read-only scopes in RRD: `oauth crm.objects.contacts.read crm.objects.companies.read crm.objects.deals.read`.
- Retrieve/install the HubSpot OAuth client id and client secret through the HubSpot app UI or a supported local-only helper. Never print the values; use the local credential install pattern and then verify `rrd-vault connect <submission-id> hubspot` can mint a pending OAuth drop.

## Verification pattern
1. Add/patch tests before implementation for provider id mapping, authorize URL params, token endpoint, token-to-env mapping, and onboarding integration classification.
2. Run targeted tests, then full `node --test test/*.test.mjs` where practical.
3. Mint a real `rrd-vault connect` link and verify `rrd-vault status` shows a pending `oauth:<provider>` drop.
4. Report link/drop id/status only; never report secrets or token values.
