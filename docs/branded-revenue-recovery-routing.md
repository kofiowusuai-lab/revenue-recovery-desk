# Branded Revenue Recovery routing runbook

Use when `https://flowaudit.co.uk/revenue-recovery/*` returns the FlowAudit marketing app 404 while the standalone Revenue Recovery web app works on `https://revenue-recovery-web-ivory.vercel.app/*`.

## Architecture

Two apps are involved:

- Main FlowAudit marketing site: GitHub repo `curtisboadum/flowaudit-platform`, owns `https://flowaudit.co.uk`.
- Standalone client operations app: local project `/Users/AIAgenterminal/revenue-recovery-web`, Vercel alias `https://revenue-recovery-web-ivory.vercel.app`.

The main site must preserve the sales landing page at `/revenue-recovery` while proxying operational subroutes to the standalone app.

## Access discovery

1. Check GitHub auth in the active Hermes profile shell, not only `/Users/AIAgenterminal/.config/gh`:

```bash
gh auth status
gh api user --jq '.login'
```

2. List collaborator/org repos as well as owned repos; `gh repo list` alone may omit the project:

```bash
gh api 'user/repos?per_page=100&affiliation=owner,collaborator,organization_member&sort=updated' --paginate \
  --jq '.[] | select((.full_name|test("(?i)(flowaudit|flow-audit|revenue|recovery)")) or ((.description // "")|test("(?i)(flowaudit|revenue|recovery)"))) | "\(.updated_at) \(.full_name) private=\(.private) \(.html_url)"'
```

Expected repo: `curtisboadum/flowaudit-platform`.

## Fix pattern

In `next.config.ts` of `flowaudit-platform`, add/keep explicit `afterFiles` rewrites for operational pages only. Do **not** use a catch-all rewrite that shadows the `/revenue-recovery` marketing landing page.

Known-good shape:

```ts
import type { NextConfig } from "next";

const revenueRecoveryDestination = "https://revenue-recovery-web-ivory.vercel.app";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      afterFiles: [
        ...[
          "onboarding",
          "desk",
          "vault",
          "oauth-start",
          "oauth-callback",
          "terms",
          "privacy",
          "offboard",
          "offboarded",
          "sop-review",
          "readiness",
          "mapping",
        ].map((path) => ({
          source: `/revenue-recovery/${path}`,
          destination: `${revenueRecoveryDestination}/${path}`,
        })),
        {
          source: "/revenue-recovery/api/:path*",
          destination: `${revenueRecoveryDestination}/api/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
```

If `src/app/revenue-recovery/page.tsx` is missing from `main`, restore it from the existing branch before deploying:

```bash
git checkout origin/feat/revenue-recovery-page -- \
  src/app/revenue-recovery/page.tsx \
  src/components/revenue-recovery/revenue-recovery-content.tsx \
  src/components/revenue-recovery/revenue-recovery-copy.ts
```

## Validation

Run before deploy/push:

```bash
npm ci   # only if deps are missing
npm run typecheck
npm run build
```

After deploy, verify the branded routes:

```bash
python3 - <<'PY'
import urllib.request, re
urls=[
 'https://flowaudit.co.uk/revenue-recovery',
 'https://flowaudit.co.uk/revenue-recovery/sop-review',
 'https://flowaudit.co.uk/revenue-recovery/readiness',
 'https://flowaudit.co.uk/revenue-recovery/mapping',
]
for u in urls:
    with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent':'Mozilla/5.0'}), timeout=20) as r:
        body=r.read(4000).decode('utf-8','ignore')
        title=re.search(r'<title>(.*?)</title>', body, re.I|re.S)
        print(u, r.status, title.group(1).strip() if title else 'none')
PY
```

Expected titles:

- `/revenue-recovery` → `Revenue Recovery Desk | FlowAudit`
- `/sop-review` → `Revenue Recovery Desk — SOP Review`
- `/readiness` → `Revenue Recovery Desk — Readiness Details`
- `/mapping` → `Revenue Recovery Desk — Integration Mapping`

Also verify the API proxy without inserting a row:

```bash
python3 - <<'PY'
import urllib.request
u='https://flowaudit.co.uk/revenue-recovery/api/intake'
req=urllib.request.Request(u, method='OPTIONS')
with urllib.request.urlopen(req, timeout=20) as r:
    print(r.status, r.headers.get('Access-Control-Allow-Origin'))
PY
```

Expected: `204 *`.

## Pitfalls

- `revenue-recovery-web` deployments do not fix `flowaudit.co.uk` 404s; the rewrite lives in the main FlowAudit site.
- Vercel project listing may show only the standalone app; use GitHub collaborator repo discovery when Vercel cannot identify the domain project.
- `gh repo list` may show only owned repos. Use `user/repos?affiliation=owner,collaborator,organization_member` to find shared repos.
- Report email/API statuses precisely: Vercel/API route returning 200 means form intake accepted, not client inbox delivery.
