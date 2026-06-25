# Branded Revenue Recovery routes + form-intake troubleshooting

Use this when SOP/readiness/mapping/vault/OAuth pages work on the `revenue-recovery-web` Vercel app but fail under `https://revenue-recovery-web-ivory.vercel.app/*`, or when client forms show browser-side Supabase errors.

## Current architecture

- Client pages/API live in the `revenue-recovery-web` Vercel project.
- Canonical direct app alias: `https://revenue-recovery-web-ivory.vercel.app`.
- Desired branded base: `https://revenue-recovery-web-ivory.vercel.app`.
- The main Revenue Recovery Desk site must rewrite `/revenue-recovery/:path*` to the ivory app. The bare `/revenue-recovery` landing may stay owned by the Revenue Recovery Desk marketing site; only subpaths are forwarded.

## Correct Next.js rewrite in the main Revenue Recovery Desk site

Add/merge this in the Revenue Recovery Desk site repo `next.config.js|mjs|ts`:

```js
async rewrites() {
  return {
    afterFiles: [
      {
        source: '/revenue-recovery/:path*',
        destination: 'https://revenue-recovery-web-ivory.vercel.app/:path*',
      },
    ],
  };
}
```

Use `afterFiles` so the main site's own `/revenue-recovery` landing is not shadowed.

## Access/deploy workflow when repo is on GitHub

If the user says access was added but `gh auth status` is not logged in, ask them to run:

```bash
gh auth login
```

Choose GitHub.com, HTTPS, browser login, using the GitHub account added to the Revenue Recovery Desk repo. Then clone/list repos and patch the Revenue Recovery Desk site config. If they provide the repo URL, clone directly after auth.

## Form-intake pitfall: invalid browser Supabase key

SOP/readiness/mapping pages should not rely on a browser-side service key or stale placeholder anon key. If a form shows `Invalid API key`, move the insert behind a server-side Vercel API endpoint in `revenue-recovery-web/api/intake.js` and keep Supabase credentials as Vercel env vars.

Server-side env vars required in the `revenue-recovery-web` project:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Never print values. Verify presence/installation by name only.

## Client-side API URL nuance

Because the Revenue Recovery Desk branded route may be a rewrite/proxy, form pages can post directly to the ivory API when hosted on `example.com`:

```js
const intakeUrl = () =>
  location.hostname === 'example.com'
    ? 'https://revenue-recovery-web-ivory.vercel.app/api/intake'
    : new URL('api/intake', location.href).toString();
```

This keeps form submission working even if `/revenue-recovery/api/intake` is not forwarded yet, as long as the page itself is reachable.

## Verification checklist

After deploy, verify all three layers:

1. Direct app pages return the expected content:
   - `https://revenue-recovery-web-ivory.vercel.app/sop-review`
   - `https://revenue-recovery-web-ivory.vercel.app/readiness`
   - `https://revenue-recovery-web-ivory.vercel.app/mapping`
2. Direct intake API accepts a synthetic test POST and returns `{ ok: true, id: ... }`; remove the synthetic row immediately with `rrd-harness remove '"<id>"'`.
3. Branded routes return the expected pages, not the main Revenue Recovery Desk 404:
   - `https://revenue-recovery-web-ivory.vercel.app/sop-review`
   - `https://revenue-recovery-web-ivory.vercel.app/readiness`
   - `https://revenue-recovery-web-ivory.vercel.app/mapping`

If step 1 works but step 3 returns Revenue Recovery Desk 404, the blocker is the main Revenue Recovery Desk site's rewrite, not the `revenue-recovery-web` app.
