# Branded Revenue Recovery Desk `/revenue-recovery/*` rewrite runbook

Use this when branded Revenue Recovery links under `https://revenue-recovery-web-ivory.vercel.app/*` 404, lose the Revenue Recovery Desk theme, or do not reach the standalone `revenue-recovery-web` app.

## Architecture

Two apps are involved:

- Main Revenue Recovery Desk marketing site repo: `curtisboadum/rrd-platform`.
  - Local clone used in this session: `/Users/AIAgenterminal/rrd-platform`.
  - Owns `https://example.com` and the public `/revenue-recovery` marketing landing.
- Standalone RRD client pages app: `/Users/AIAgenterminal/revenue-recovery-web`.
  - Vercel alias: `https://revenue-recovery-web-ivory.vercel.app`.
  - Owns client-operation pages (`onboarding`, `vault`, `sop-review`, `readiness`, `mapping`, etc.) plus shared assets (`theme.css`, `logo.svg`, `vault-crypto.js`) and `/api/intake`.

## Correct routing model

Do **not** wildcard-proxy the bare `/revenue-recovery` path unless the landing should move back to the standalone app. The main Revenue Recovery Desk repo should own the bare landing page, while client-operation subroutes proxy to the standalone app.

Known-good `next.config.ts` shape in `rrd-platform`:

```ts
import type { NextConfig } from "next";

const revenueRecoveryDestination = "https://revenue-recovery-web-ivory.vercel.app";
// Bump this whenever deploying changed proxied pages/assets so the branded layer
// does not keep serving stale external-rewrite output.
const revenueRecoveryProxyVersion = "20260623-client-dashboard-loginfix";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/revenue-recovery/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
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
          "go-live",
          "client",
          "postal-portal",
        ].map((path) => ({
          "client",
          "postal-portal",
        ].map((path) => ({
          source: `/revenue-recovery/${path}`,
          destination: `${revenueRecoveryDestination}/${path}?rrd_proxy_v=${revenueRecoveryProxyVersion}`,
        })),
        ...["theme.css", "logo.svg", "vault-crypto.js"].map((asset) => ({
          source: `/revenue-recovery/${asset}`,
          destination: `${revenueRecoveryDestination}/${asset}?rrd_proxy_v=${revenueRecoveryProxyVersion}`,
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

## Pitfall: theme looks old/navy even when pages are 200

If pages load but look like the old Revenue Recovery theme, the HTML proxy is working but shared assets are not. The standalone pages link relative assets such as:

```html
<link rel="stylesheet" href="theme.css">
```

From the branded URL that becomes:

```text
https://revenue-recovery-web-ivory.vercel.app/theme.css
```

So the main Revenue Recovery Desk app must proxy at least:

- `/revenue-recovery/theme.css`
- `/revenue-recovery/logo.svg`
- `/revenue-recovery/vault-crypto.js`

If these are missing, the page falls back to inline old styles.

## Pitfall: Vercel caches old external rewrites

External rewrite responses can remain `HIT` with nonzero `age`. When changing destination pages/assets, add or bump a proxy-version query string in the destination and add a `Cache-Control: no-store, max-age=0` header for `/revenue-recovery/:path*` in the main site.

## Pitfall: deploying the wrong Vercel project

A successful `vercel --prod` from a local clone is not automatically a `example.com` deploy. If the directory is not linked to the existing branded Vercel project, the CLI may create/deploy a new project and alias only a generated/preview-looking domain such as `rrd-platform-*.vercel.app`. That does **not** update `example.com`.

Before reporting branded success:

- Verify the deployment target is the project/domain that owns `example.com`.
- Treat CLI output containing `Created .../rrd-platform` as a red flag: stop, link/target the correct project, and redeploy.
- Curl/browser-check `https://revenue-recovery-web-ivory.vercel.app/<route>` directly for 200 and expected markers.
- Say “deployed to ivory/source app” vs “deployed to branded Revenue Recovery Desk domain” precisely.

See `references/branded-domain-deploy-targeting.md` for the compact deployment-target checklist.

## Deployment discipline for the branded domain

The canonical standalone RRD app deploy (`revenue-recovery-web-ivory.vercel.app`) is **not** enough when the operator says the branded URL is broken. The branded route only changes after the main Revenue Recovery Desk repo deploys.

For `example.com/revenue-recovery/*` fixes from this machine:

1. Patch `/Users/AIAgenterminal/rrd-platform/next.config.ts`.
2. Run:

```bash
cd /Users/AIAgenterminal/rrd-platform
rm -rf .next   # only if typecheck references stale .next route types
npm run typecheck
npm run build
```

3. Commit and push to the real branded repo/branch so the existing Revenue Recovery Desk Vercel project deploys:

```bash
git fetch origin main
git rebase origin/main
git add next.config.ts
git commit -m "fix: proxy revenue recovery client routes"
git push origin main
```

4. Poll `https://revenue-recovery-web-ivory.vercel.app/<route>` until it returns the proxied page.

**Pitfall:** running `npx vercel --prod` from an unlinked clone can create/deploy a new Vercel project under the token (for example a `rrd-platform-*.vercel.app` preview/alias) without updating `example.com`. If the goal is the branded domain, prefer the repo push path unless the local clone is explicitly linked to the production project that owns `example.com`. Do not report the branded deployment as done until the `example.com` URL itself returns 200 with the expected page markers.

## Restore missing landing page

If the bare landing `https://revenue-recovery-web-ivory.vercel.app` is 404, restore/import the landing files from branch `origin/feat/revenue-recovery-page` in `curtisboadum/rrd-platform`:

```bash
git checkout origin/feat/revenue-recovery-page -- \
  src/app/revenue-recovery/page.tsx \
  src/components/revenue-recovery/revenue-recovery-content.tsx \
  src/components/revenue-recovery/revenue-recovery-copy.ts
```

Then run checks before pushing:

```bash
npm ci        # if dependencies are missing
npm run typecheck
npm run build
```

## Verification checklist

After push/deploy, verify all of these return 200 and correct markers:

```text
https://revenue-recovery-web-ivory.vercel.app
  title: Revenue Recovery Desk | Revenue Recovery Desk

https://revenue-recovery-web-ivory.vercel.app/sop-review
  title: Revenue Recovery Desk — SOP Review
  marker: Review your recovery SOP

https://revenue-recovery-web-ivory.vercel.app/readiness
  title: Revenue Recovery Desk — Readiness Details
  marker: Confirm go-live details

https://revenue-recovery-web-ivory.vercel.app/mapping
  title: Revenue Recovery Desk — Integration Mapping
  marker: Map your recovery data

https://revenue-recovery-web-ivory.vercel.app/theme.css
  marker: Revenue Recovery Desk house theme and --fa-bg

https://revenue-recovery-web-ivory.vercel.app/api/intake
  OPTIONS should return 204 and CORS headers
```

A browser visual check should show a cream background, rounded pill header, serif Revenue Recovery Desk wordmark, and espresso buttons/text — not the old dark navy header.