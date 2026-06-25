# Revenue Recovery web routes + deploy notes

Use this when the operator asks for Revenue Recovery Desk links or asks to deploy/update the web app.

## Current production app

Production base:

- `https://flowaudit.co.uk/revenue-recovery`

Important: branded URLs are split across two apps. The bare `/revenue-recovery` landing is served by the main FlowAudit site (`curtisboadum/flowaudit-platform`; local path `/Users/AIAgenterminal/flowaudit-platform`), while client-operation subroutes are proxied to the standalone `revenue-recovery-web` app. For public landing-page hero/social-proof/marketing updates, use `references/revenue-recovery-marketing-page.md` and verify the live branded page after deploy. If branded subroutes 404 or lose the FlowAudit theme, use `references/branded-flowaudit-rewrite.md` before changing the standalone app.

Routes:

- Landing page: `/`
- Client onboarding form: `/onboarding`
- Internal dashboard: `/desk`
- Secure vault page: `/vault` (bare page only; clients should receive generated one-time links)
- OAuth start page: `/oauth-start` (bare page only; clients should receive generated one-time links)
- OAuth callback / redirect URI: `/oauth-callback`
- Terms of Service / EULA: `/terms`
- Privacy Policy: `/privacy`
- Offboarding form: `/offboard`
- SOP review page: `/sop-review`
- Go-live readiness page: `/readiness`
- Integration/data mapping page: `/mapping`

For SOP/readiness/mapping implementation details, especially the server-side intake API and branded-route pitfall, see `references/sop-readiness-mapping-intake.md`, `references/branded-route-and-form-intake.md`, and `references/branded-revenue-recovery-routing.md`.

Full OAuth callback URL to register in provider apps:

```text
https://flowaudit.co.uk/revenue-recovery/oauth-callback
```

## Local project layout

Project directory:

```text
/Users/AIAgenterminal/revenue-recovery-web
```

Important files:

- `index.html` — public landing page
- `onboarding.html` — client onboarding form
- `desk.html` — internal dashboard
- `vault.html` — secure API-key deposit page
- `oauth-start.html` — OAuth connect landing page
- `oauth-callback.html` — OAuth callback/deposit page
- `terms.html` — Terms of Service / EULA page used by Intuit and other app-review forms; written so it can later migrate to FlowAudit branding
- `privacy.html` — Privacy Policy page used by Intuit and other app-review forms; written so it can later migrate to FlowAudit branding
- `vercel.json` — clean URLs + security headers
- `privacy.html` — Privacy Policy page for developer app compliance fields
- `vercel.json` — clean URLs + security headers

## Deployment pattern

The Vercel CLI may not be installed globally. If `vercel` is missing, use `npx --yes vercel ...`.

A Vercel token may live in the operator env (`/Users/AIAgenterminal/.openclaw/.env`) as `VERCEL_TOKEN`; source it without printing the value.

Deploy command:

```bash
cd /Users/AIAgenterminal/revenue-recovery-web
set -a && . /Users/AIAgenterminal/.openclaw/.env && set +a
npx --yes vercel deploy --prod --yes --token "$VERCEL_TOKEN"
```

## Verification after deploy

Verify the canonical ivory app first, including pages that are served by the `revenue-recovery-web` deployment:

```bash
for u in \
  https://revenue-recovery-web-ivory.vercel.app/sop-review \
  https://revenue-recovery-web-ivory.vercel.app/readiness \
  https://revenue-recovery-web-ivory.vercel.app/mapping; do
  printf '%s ' "$u"
  curl -L -s -o /tmp/rrd_page.html -w '%{http_code} %{url_effective}\n' "$u"
done
```

Then verify the branded FlowAudit rewrite separately. If a branded subpage returns the main FlowAudit 404, do not claim the branded URL is live; fix the FlowAudit wildcard rewrite first.

Verify root is the landing page and onboarding remains separate:

```bash
for u in \
  https://flowaudit.co.uk/revenue-recovery \
  https://flowaudit.co.uk/revenue-recovery/onboarding \
  https://flowaudit.co.uk/revenue-recovery/desk \
  https://flowaudit.co.uk/revenue-recovery/terms \
  https://flowaudit.co.uk/revenue-recovery/privacy \
  https://flowaudit.co.uk/revenue-recovery/offboard; do
  printf '%s ' "$u"
  curl -L -s -o /tmp/rrd_page.html -w '%{http_code} %{url_effective}\n' "$u"
  python3 - <<'PY'
from pathlib import Path
import re
s=Path('/tmp/rrd_page.html').read_text(errors='ignore')
m=re.search(r'<title>(.*?)</title>',s,re.I|re.S)
print('  title:', (m.group(1).strip() if m else 'none'))
print('  has landing hero:', 'Your Clients Owe You' in s)
print('  has onboarding submit:', 'Submit onboarding' in s)
PY
done
```

Expected:

- `/` title `Revenue Recovery Desk`, contains `Your Clients Owe You`, does **not** contain `Submit onboarding`.
- `/onboarding` title `Revenue Recovery Desk — Client Onboarding`, contains `Submit onboarding`.
- `/desk` title `Revenue Recovery Desk — Internal`.

## Pitfalls

- Do not call the root URL the onboarding form anymore. The root is intended to be the sales/landing page; the onboarding form lives at `/onboarding`.
- Because FlowAudit hosts Revenue Recovery under `/revenue-recovery`, OAuth callback pages must preserve the path prefix when depositing the authorization payload. The callback page should use the exact current clean path (`location.origin + location.pathname` without a trailing slash) as `redirect_uri`, not `location.origin + "/oauth-callback"`; otherwise token exchange fails with provider errors like Salesforce `redirect_uri must match configuration`.
