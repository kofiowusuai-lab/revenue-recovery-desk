# Intuit / QuickBooks developer app setup notes

Use this when setting up the QuickBooks Online / Intuit developer app for Revenue Recovery Desk.

## Current deployment URLs

Until the final live FlowAudit/Revenue Recovery domain is deployed, use the current production alias:

```text
https://revenue-recovery-web-ivory.vercel.app
```

OAuth callback / redirect URI:

```text
https://revenue-recovery-web-ivory.vercel.app/oauth-callback
```

When the final live domain is deployed, add the live-domain callback alongside the Vercel callback during transition, then verify/publish the app to reduce client-side unverified-app warnings.

## Intuit app URL fields

On Intuit screens asking for app URLs:

- **Host domain**: domain only, no protocol

```text
revenue-recovery-web-ivory.vercel.app
```

- **Launch URL**: customer-facing launch/home URL, must include `https://`

```text
https://revenue-recovery-web-ivory.vercel.app/
```

- **Disconnect URL**: use the homepage until a dedicated disconnect page exists, must include `https://`

```text
https://revenue-recovery-web-ivory.vercel.app/
```

- **Connect/Reconnect URL**: use the OAuth start route; generated one-time links are used for real client connections

```text
https://revenue-recovery-web-ivory.vercel.app/oauth-start
```

## Legal/compliance URLs

Intuit asks for public legal URLs:

- **End-user license agreement URL**

```text
https://revenue-recovery-web-ivory.vercel.app/terms
```

- **Privacy policy URL**

```text
https://revenue-recovery-web-ivory.vercel.app/privacy
```

These pages were written to be portable so they can later migrate to FlowAudit branding.

## Verification pattern

Before giving URLs to the operator, verify routes live with curl or equivalent. Expected current status:

- `/` → 200
- `/oauth-start` → 200
- `/oauth-callback` → 200
- `/terms` → 200
- `/privacy` → 200
- `/disconnect` may be 404 until a dedicated page is added; use `/` as the disconnect URL in the meantime.

## Pitfalls

- Intuit URL fields are strict about protocol: Host domain has no `https://`; Launch/Disconnect/Connect URLs include `https://`.
- Do not remove the Vercel callback immediately after deploying a final domain. Keep both during migration where the provider permits multiple redirect URIs.
- App verification/publishing is a separate step from OAuth functionality; do it after final live-domain deployment to reduce warning screens for clients.
