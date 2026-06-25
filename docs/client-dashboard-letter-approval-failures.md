# Client dashboard Postal Portal approval failures

Use this when a client reports `Failed to fetch`, missing signer/signature in preview, or failed `Approve signature and queue letter` behavior in the authenticated dashboard Postal Portal.

## Distinguish the two Postal Portal surfaces

There are two related but separate paths:

- Standalone portal: `revenue-recovery-web/postal-portal.html`
- Authenticated dashboard page: `revenue-recovery-web/client.html` (`Postal Portal` nav/page)

A fix in the standalone page does **not** prove the authenticated dashboard path is fixed. If the user reports the issue while logged into the dashboard, inspect and test `client.html` specifically.

## Signer/signature missing from preview

Known failure mode: the dashboard preview handler clears state before opening preview:

```js
state.portalSignature = null;
render();
setTimeout(openPortalPreview, 0);
```

This rerenders signer inputs from defaults and drops the uploaded signature before `openPortalPreview()` reads them.

Fix pattern:

1. Preserve signer/signature draft state per selected letter, e.g. `state.portalDrafts[key] = { signerName, signerTitle, signatureData }`.
2. Read signer inputs from live DOM first, then draft fallback.
3. Store uploaded signature into the current letter draft in the `FileReader.onload` handler.
4. Do not clear `state.portalSignature` on preview click for the already-selected letter.
5. If switching letters, only reset to that letter's saved draft or a deliberate empty state.
6. Add static regressions in `test/rrd-client-dashboard-page.test.mjs` that reject the destructive preview pattern and assert draft/signature fallback exists.

The standalone `postal-portal.html` should avoid rerendering signer fields on every keystroke. If preview is open, update only the modal or read current values when opening.

## `Failed to fetch` on letter approval

Known production failure mode: `flowaudit.co.uk/revenue-recovery/client` serves the dashboard from the branded/vanity origin, while API endpoints live on the canonical ivory app. If CORS does not allow the branded origin, the browser shows generic `Failed to fetch` even though the API exists.

Fix/check pattern:

1. In `revenue-recovery-web/api/client-dashboard-common.js`, allow both branded origins:

```txt
https://flowaudit.co.uk
https://www.flowaudit.co.uk
```

2. In `client.html`, ensure `API_BASE` routes both branded hosts to the ivory backend:

```js
const API_BASE=(location.hostname==='flowaudit.co.uk'||location.hostname==='www.flowaudit.co.uk')
  ? 'https://revenue-recovery-web-ivory.vercel.app'
  : '';
```

3. Test CORS with OPTIONS from the branded origin:

```bash
curl -sS -i -X OPTIONS \
  'https://revenue-recovery-web-ivory.vercel.app/api/client-letter-action' \
  -H 'Origin: https://flowaudit.co.uk' \
  -H 'Access-Control-Request-Method: POST'
```

Expected headers include:

```txt
access-control-allow-origin: https://flowaudit.co.uk
vary: Origin
```

4. Test POST without bearer to prove the browser will receive JSON instead of a network-level failure:

```bash
curl -sS -i -X POST \
  'https://revenue-recovery-web-ivory.vercel.app/api/client-letter-action' \
  -H 'Origin: https://flowaudit.co.uk' \
  -H 'Content-Type: application/json' \
  --data '{"action":"approve"}'
```

Expected result is a normal JSON auth error, not an HTML/CORS/network failure:

```json
{"ok":false,"error":"Missing bearer token."}
```

## Deploy and route notes

For direct `revenue-recovery-web` deploys, use the real operator home so Vercel finds the Mac auth store:

```bash
cd /Users/AIAgenterminal/revenue-recovery-web
env -u VERCEL_TOKEN HOME=/Users/AIAgenterminal npx --yes vercel@54.16.0 --prod --yes
```

`vercel` may not be on PATH in every shell; `npx --yes vercel@54.16.0` with `HOME=/Users/AIAgenterminal` worked. If `VERCEL_TOKEN` is stale/invalid in the environment, unset it for the deploy rather than reusing it.

Verify canonical client route after deploy:

```bash
curl -sSL 'https://revenue-recovery-web-ivory.vercel.app/client' | grep 'const API_BASE='
```

For branded client route, use:

```txt
https://flowaudit.co.uk/revenue-recovery/client
```

Do **not** tell clients to use `/client.html` on the branded vanity layer; that path can 404 while `/client` works.

## Required tests

Run targeted tests after dashboard Postal Portal/CORS changes:

```bash
node --check /Users/AIAgenterminal/revenue-recovery-web/api/client-dashboard-common.js
node --check /Users/AIAgenterminal/revenue-recovery-web/api/client-letter-action.js
node --test \
  /Users/AIAgenterminal/test/rrd-client-dashboard-cors.test.mjs \
  /Users/AIAgenterminal/test/rrd-client-dashboard-page.test.mjs \
  /Users/AIAgenterminal/test/rrd-postal-portal.test.mjs
```

Then run the full suite:

```bash
node --test /Users/AIAgenterminal/test/*.mjs
```

Do not report this class of client-facing fix as done until production deploy + live CORS verification pass.
