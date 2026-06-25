# Live domain migration + provider app verification

Use this after Revenue Recovery Desk moves from a temporary Vercel domain to the live Revenue Recovery Desk domain, or when the operator asks which provider portals need callback/privacy updates.

## Current live Revenue Recovery base

```text
https://revenue-recovery-web-ivory.vercel.app
```

Key routes:

```text
Landing/home:     https://revenue-recovery-web-ivory.vercel.app
Onboarding:       https://revenue-recovery-web-ivory.vercel.app/onboarding
Vault:            https://revenue-recovery-web-ivory.vercel.app/vault
OAuth start:      https://revenue-recovery-web-ivory.vercel.app/oauth-start
OAuth callback:   https://revenue-recovery-web-ivory.vercel.app/oauth-callback
Terms / EULA:     https://revenue-recovery-web-ivory.vercel.app/terms
Privacy policy:   https://revenue-recovery-web-ivory.vercel.app/privacy
Offboarding:      https://revenue-recovery-web-ivory.vercel.app/offboard
```

Operator env keys that should point at the live base:

```text
RRD_WEB_BASE=https://revenue-recovery-web-ivory.vercel.app
RRD_VAULT_BASE=https://revenue-recovery-web-ivory.vercel.app
RRD_OFFBOARD_BASE=https://revenue-recovery-web-ivory.vercel.app/offboard
PUBLIC_BASE_URL=https://revenue-recovery-web-ivory.vercel.app
NEXT_PUBLIC_BASE_URL=https://revenue-recovery-web-ivory.vercel.app
```

## Provider portals to update

Use these values in every OAuth/developer app:

- Homepage / launch URL: `https://revenue-recovery-web-ivory.vercel.app`
- OAuth callback / redirect URI: `https://revenue-recovery-web-ivory.vercel.app/oauth-callback`
- Connect / reconnect URL: `https://revenue-recovery-web-ivory.vercel.app/oauth-start`
- Disconnect/offboarding URL: `https://revenue-recovery-web-ivory.vercel.app/offboard`
- Terms/EULA: `https://revenue-recovery-web-ivory.vercel.app/terms`
- Privacy policy: `https://revenue-recovery-web-ivory.vercel.app/privacy`

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
  https://revenue-recovery-web-ivory.vercel.app \
  https://revenue-recovery-web-ivory.vercel.app/onboarding \
  https://revenue-recovery-web-ivory.vercel.app/vault \
  https://revenue-recovery-web-ivory.vercel.app/oauth-start \
  https://revenue-recovery-web-ivory.vercel.app/oauth-callback \
  https://revenue-recovery-web-ivory.vercel.app/terms \
  https://revenue-recovery-web-ivory.vercel.app/privacy \
  https://revenue-recovery-web-ivory.vercel.app/offboard; do
  printf '%s -> ' "$u"
  curl -L -s -o /tmp/rrd_page.html -w '%{http_code} %{url_effective}\n' "$u"
done
```

Then verify OAuth URL generation uses the Revenue Recovery Desk callback for every installed provider. The expected callback is:

```text
https://revenue-recovery-web-ivory.vercel.app/oauth-callback
```

Run a real one-provider smoke test: generate a fresh `rrd-vault connect <submission-id> <provider>` link, complete provider auth in the browser, confirm the callback lands on Revenue Recovery Desk, then `approve <drop-id>` and verify token key names were written. Do not reuse stale pre-migration links.

## Warning removal / app verification

Once callback/legal URLs are updated in provider portals, proceed through each provider's app verification/publishing flow to reduce client-side warnings. Prioritize stricter/more visible warning surfaces first: Google consent screen, Intuit production review, Salesforce app policies, Xero app details, HubSpot app status, Zoho app details, Pipedrive if moving beyond private/manual use.
