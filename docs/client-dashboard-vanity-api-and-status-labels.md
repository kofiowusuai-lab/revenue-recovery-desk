# Client dashboard vanity API + status-label pitfall

When editing the Revenue Recovery client dashboard (`revenue-recovery-web/client.html`), remember that it can be served from two origins:

- Source app: `https://revenue-recovery-web-ivory.vercel.app/client...`
- Branded vanity path: `https://flowaudit.co.uk/revenue-recovery/client...`

The branded FlowAudit site only rewrites `/revenue-recovery/*` page paths to the ivory app. It does **not** necessarily proxy `/api/*`. If the dashboard JavaScript calls a relative API path such as `/api/client-settings` while loaded from `flowaudit.co.uk`, the browser posts to `https://flowaudit.co.uk/api/client-settings`, which can return a branded-site 404 HTML page. If the client code then blindly does `r.json().catch(... 'Bad response')`, the user sees an unhelpful `Bad response` after pressing Save.

## Durable fix pattern

In client-facing revenue-recovery pages that use API routes owned by `revenue-recovery-web`, compute an API base at runtime:

```js
const API_BASE = location.hostname === 'flowaudit.co.uk'
  ? 'https://revenue-recovery-web-ivory.vercel.app'
  : '';

async function api(path, body) {
  const sess = (await sb.auth.getSession()).data.session;
  if (!sess) throw new Error('Please sign in again.');
  const url = (path.startsWith('/api/') ? API_BASE : '') + path;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + sess.access_token },
    body: JSON.stringify(body || {})
  });
  const text = await r.text();
  let j;
  try { j = text ? JSON.parse(text) : {}; }
  catch {
    j = { ok: false, error: r.status === 404
      ? 'Dashboard API unavailable on this domain. Please refresh and try again.'
      : 'Unexpected server response. Please refresh and try again.' };
  }
  if (!r.ok || !j.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
```

Do not treat the branded 404 as proof the API is broken. Probe the ivory API directly; it should return JSON such as `{"ok":false,"error":"Missing bearer token."}` when unauthenticated.

## Client-facing label rule

Avoid adjacent ambiguous badges like `Live ✓` and `Draft mode`. In this dashboard:

- `Readiness` is whether setup/go-live checklist is complete.
- `Outreach` is whether email/SMS is draft/approval-gated or auto-send.

Label them explicitly:

- `Outreach: Draft` / `Outreach: Auto`
- `Readiness: Complete` / `Readiness: N steps left`

This prevents the user/client reading `Live` + `Draft mode` as a contradiction.

## Verification checklist

After deploy, verify both source and branded HTML, not just local tests:

```bash
curl -L -sS 'https://revenue-recovery-web-ivory.vercel.app/client?login=1&v=mode-fix' | grep -E "API_BASE|Outreach: Draft|Readiness: Complete"
curl -L -sS 'https://flowaudit.co.uk/revenue-recovery/client?login=1&v=mode-fix' | grep -E "API_BASE|Outreach: Draft|Readiness: Complete"
```

Also assert the deployed HTML does **not** contain:

- `Bad response`
- bare `Draft mode` / `Auto mode` badges without the `Outreach:` prefix
- bare `Live ✓` without the `Readiness:` prefix
