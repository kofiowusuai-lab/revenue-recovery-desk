# SOP / readiness / mapping intake pages

Use this when working on the post-onboarding SOP review, go-live readiness, or integration/data mapping workflows.

## Pages

Canonical app host:

- `https://revenue-recovery-web-ivory.vercel.app/sop-review`
- `https://revenue-recovery-web-ivory.vercel.app/readiness`
- `https://revenue-recovery-web-ivory.vercel.app/mapping`

Branded host should be available when Revenue Recovery Desk's wildcard rewrite is healthy:

- `https://revenue-recovery-web-ivory.vercel.app/sop-review`
- `https://revenue-recovery-web-ivory.vercel.app/readiness`
- `https://revenue-recovery-web-ivory.vercel.app/mapping`

Locked page links include query parameters:

```text
?sid=<source-submission-id>&company=<urlencoded-company>&email=<urlencoded-billing-email>
```

## Important implementation pitfall

Do **not** submit these pages directly to Supabase from the browser with a pasted/truncated anon key. That caused real mobile client errors such as:

```text
Could not submit review: Invalid API key
```

Instead, submit to the server-side Vercel function:

```text
/api/intake
```

The Vercel function uses server-side `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env vars and creates special form rows in `submissions` with these catalysts:

- `SOP_REVIEW_WEB`
- `READINESS_DETAILS_WEB`
- `MAPPING_DETAILS_WEB`

Because `example.com/revenue-recovery/*` is a rewrite to the ivory app and may not forward API function paths reliably, page JS should post to the ivory API when served from `example.com`:

```js
const intakeUrl = () =>
  location.hostname === 'example.com'
    ? 'https://revenue-recovery-web-ivory.vercel.app/api/intake'
    : new URL('api/intake', location.href).toString();
```

## Mobile UI pitfall

Buttons using only `.btn` can appear as a dark blank pill under the Revenue Recovery Desk theme on mobile screenshots. Use explicit primary labeling/classes, e.g.:

```html
<button class="btn btn-primary" id="submitBtn" type="submit">Submit readiness details</button>
```

## Email/automation commands

`rrd-welcome-pack` supports these post-onboarding forms:

```bash
/Users/AIAgenterminal/rrd-welcome-pack sop <submission-id> --dry-run
/Users/AIAgenterminal/rrd-welcome-pack readiness <submission-id> --dry-run
/Users/AIAgenterminal/rrd-welcome-pack mapping <submission-id> --dry-run
```

The onboarding watcher should:

- send SOP review if the client has no SOP and asked Revenue Recovery Desk to build one;
- send readiness if critical operating fields are missing;
- send mapping if the stack needs field/source-of-truth mapping;
- treat the three catalyst rows as special form records, not new clients;
- notify the operator when each form response lands.

## Validation pattern

These pages are client-facing operational intake. Required operational fields must fail closed in two places:

1. Browser UI: add `required` attributes / explicit `setCustomValidity` or equivalent for every required field, and show a clear missing-fields message.
2. Server intake: `/api/intake` must reject blank or whitespace-only required fields with HTTP `400`. Do not rely on client-side validation alone because cached pages, scripts, or direct API calls can bypass it.

For SOP review specifically: if the client chooses `Request changes`, require non-blank change notes before submitting. Remove old/duplicate legacy browser submission scripts when replacing handlers, or a stale handler can bypass the new guard.

## Verification pattern

After changes:

1. Run syntax checks:

```bash
node --check /Users/AIAgenterminal/rrd-welcome-pack.mjs
node --check /Users/AIAgenterminal/rrd-onboarding-email-watch.mjs
node --check /Users/AIAgenterminal/revenue-recovery-web/api/intake.js
```

2. Deploy `revenue-recovery-web`.
3. Verify the ivory page/API first because it is the canonical app host.
4. Verify the branded Revenue Recovery Desk route separately; if it returns the main Revenue Recovery Desk 404, fix the Revenue Recovery Desk wildcard rewrite before claiming branded links are live.
5. For blank-submission fixes, POST intentionally blank payloads to both canonical and branded `/api/intake` endpoints and confirm `400` on each before reporting success.
6. For page-level validation fixes, fetch or inspect both canonical and branded pages and confirm the required-field JS/attributes are present after cache-busting.
7. If you create a test intake row, remove it from the live book immediately after verification.
