# Live domain migration + provider app verification

Use this after Revenue Recovery Desk moves from a temporary Vercel domain to the live FlowAudit domain, or when the operator asks which provider portals need callback/privacy updates.

## Current live Revenue Recovery base

```text
https://flowaudit.co.uk/revenue-recovery
```

Key routes:

```text
Landing/home:     https://flowaudit.co.uk/revenue-recovery
Onboarding:       https://flowaudit.co.uk/revenue-recovery/onboarding
Vault:            https://flowaudit.co.uk/revenue-recovery/vault
OAuth start:      https://flowaudit.co.uk/revenue-recovery/oauth-start
OAuth callback:   https://flowaudit.co.uk/revenue-recovery/oauth-callback
Terms / EULA:     https://flowaudit.co.uk/revenue-recovery/terms
Privacy policy:   https://flowaudit.co.uk/revenue-recovery/privacy
Offboarding:      https://flowaudit.co.uk/revenue-recovery/offboard
```

Operator env keys that should point at the live base:

```text
RRD_WEB_BASE=https://flowaudit.co.uk/revenue-recovery
RRD_VAULT_BASE=https://flowaudit.co.uk/revenue-recovery
RRD_OFFBOARD_BASE=https://flowaudit.co.uk/revenue-recovery/offboard
PUBLIC_BASE_URL=https://flowaudit.co.uk/revenue-recovery
NEXT_PUBLIC_BASE_URL=https://flowaudit.co.uk/revenue-recovery
```

## Provider portals to update

Use these values in every OAuth/developer app:

- Homepage / launch URL: `https://flowaudit.co.uk/revenue-recovery`
- OAuth callback / redirect URI: `https://flowaudit.co.uk/revenue-recovery/oauth-callback`
- Connect / reconnect URL: `https://flowaudit.co.uk/revenue-recovery/oauth-start`
- Disconnect/offboarding URL: `https://flowaudit.co.uk/revenue-recovery/offboard`
- Terms/EULA: `https://flowaudit.co.uk/revenue-recovery/terms`
- Privacy policy: `https://flowaudit.co.uk/revenue-recovery/privacy`

Update these portals after domain migration:

1. Salesforce External Client App / Connected App
2. Intuit / QuickBooks Developer Portal
3. Google Cloud OAuth client + OAuth consent screen
4. Xero Developer App
5. Zoho API Console Server-based Application
6. HubSpot Developer App
7. Pipedrive Developer App

## Live smoke test pattern

Before saying migration is done, verify:

```bash
for u in \
  https://flowaudit.co.uk/revenue-recovery \
  https://flowaudit.co.uk/revenue-recovery/onboarding \
  https://flowaudit.co.uk/revenue-recovery/vault \
  https://flowaudit.co.uk/revenue-recovery/oauth-start \
  https://flowaudit.co.uk/revenue-recovery/oauth-callback \
  https://flowaudit.co.uk/revenue-recovery/terms \
  https://flowaudit.co.uk/revenue-recovery/privacy \
  https://flowaudit.co.uk/revenue-recovery/offboard; do
  printf '%s -> ' "$u"
  curl -L -s -o /tmp/flowaudit_page.html -w '%{http_code} %{url_effective}\n' "$u"
done
```

Then verify OAuth URL generation uses the FlowAudit callback for every installed provider. The expected callback is:

```text
https://flowaudit.co.uk/revenue-recovery/oauth-callback
```

Run a real one-provider smoke test: generate a fresh `rrd-vault connect <submission-id> <provider>` link, complete provider auth in the browser, confirm the callback lands on FlowAudit, then `approve <drop-id>` and verify token key names were written. Do not reuse stale pre-migration links.

## Warning removal / app verification

Once callback/legal URLs are updated in provider portals, proceed through each provider's app verification/publishing flow to reduce client-side warnings. Prioritize stricter/more visible warning surfaces first: Google consent screen, Intuit production review, Salesforce app policies, Xero app details, HubSpot app status, Zoho app details, Pipedrive if moving beyond private/manual use.
