# Branded FlowAudit domain deploy targeting

Use this when changing any Revenue Recovery route that must be visible under `https://flowaudit.co.uk/revenue-recovery/*`.

## Lesson from client dashboard route fix

Deploying `/Users/AIAgenterminal/revenue-recovery-web` updates only the standalone source app / ivory alias:

- `https://revenue-recovery-web-ivory.vercel.app/...`

It does **not** prove the branded route is live. The branded domain is served by the main FlowAudit marketing app (`flowaudit-platform`) and must proxy each client-operation subroute from its `next.config.ts`.

## Required sequence

1. Patch and deploy the standalone `revenue-recovery-web` app if the underlying page changed.
2. Patch the branded FlowAudit app if the route is new/missing in `flowaudit-platform/next.config.ts`.
   - Include the route in the operation subroute list, e.g. `client`, `postal-portal`.
   - Bump the `revenueRecoveryProxyVersion` query value to defeat stale external rewrite cache.
3. Before deploying the branded app, verify the local directory is linked to the **actual Vercel project that owns `flowaudit.co.uk`**.
   - A Vercel CLI deploy that says `Created .../flowaudit-platform` or aliases only a preview-like/generated domain (for example `flowaudit-platform-*.vercel.app`) is **not** a branded-domain deploy.
   - Stop and inspect/link the correct project instead of claiming `flowaudit.co.uk` is updated.
4. After deploy, verify the branded URL itself, not only ivory:
   - `https://flowaudit.co.uk/revenue-recovery/client`
   - touched assets such as `/revenue-recovery/theme.css`
   - any touched secondary route such as `/revenue-recovery/postal-portal`

## Reporting rule

Be explicit in final status:

- “deployed to ivory source app” means only `revenue-recovery-web-ivory.vercel.app` is updated.
- “deployed to branded FlowAudit domain” requires a successful deployment to the project/domain serving `flowaudit.co.uk` plus a live 200/marker check on the branded URL.

Do not collapse these two deployment targets in user-facing language.