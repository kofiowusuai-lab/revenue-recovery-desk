# Supported-stack/logo marquee smoke + review workflow

Use this when changing the public `flowaudit.co.uk/revenue-recovery` supported-stack/logo strip or when the operator asks to “smoke test every system then code review.”

## Scope

This is a production-facing marketing claim and connector-confidence check. Verify both:

1. The RRD connector registry still classifies each supported system correctly.
2. The live branded page renders the supported-stack strip without privacy/security regressions.

## Connector smoke

Run the full RRD test suite from the operator home:

```bash
node --test /Users/AIAgenterminal/test/rrd-*.test.mjs
```

Then run an exhaustive registry smoke over `INTEGRATIONS` in `/Users/AIAgenterminal/rrd-hermes.mjs`:

```bash
cd /Users/AIAgenterminal
node --input-type=module <<'NODE'
import { INTEGRATIONS, envKeysFor, oauthConnectionsFor, composioConnectionsFor, composioEnvKeysFor } from './rrd-hermes.mjs';
let count = 0;
for (const [category, systems] of Object.entries(INTEGRATIONS)) {
  for (const [name, cfg] of Object.entries(systems)) {
    count++;
    const rec = { company: 'SmokeCo', paymentPlatforms: [], paymentStack: {}, outreach: {}, crmData: {} };
    if (category === 'payment') rec.paymentPlatforms = [name];
    if (category === 'accounting') rec.paymentStack.accounting = name;
    if (category === 'crm') rec.crm = name;
    if (category === 'email') rec.outreach.emailProvider = name;
    if (category === 'sms') rec.outreach.smsProvider = name;
    if (category === 'mail') rec.outreach.channels = ['Letter'];
    const apikey = envKeysFor(rec);
    const oauth = oauthConnectionsFor(rec);
    const composio = composioConnectionsFor(rec);
    const composioKeys = composioEnvKeysFor(rec);
    if (cfg.auth === 'apikey' && apikey.length < 1) throw new Error(`${category}/${name}: expected vault keys`);
    if (cfg.auth === 'oauth' && !oauth.includes(cfg.oauthName || name)) throw new Error(`${category}/${name}: expected OAuth connection`);
    if (cfg.auth === 'composio' && (!composio.includes(name) || composioKeys.length < 1)) throw new Error(`${category}/${name}: expected Composio connected account key`);
    if (cfg.auth !== 'apikey' && apikey.some(k => k.includes('SECRET') || k.includes('TOKEN') || k.includes('KEY'))) throw new Error(`${category}/${name}: non-vault provider produced secret key ${apikey.join(',')}`);
  }
}
console.log(JSON.stringify({ ok: true, systems: count }, null, 2));
NODE
```

Shopify should resolve as Composio/OAuth-style, not vault/API-key:

- `auth: "composio"`
- `provider: "shopify"`
- expected key: `COMPOSIO_SHOPIFY_CONNECTED_ACCOUNT_ID`

## Web build checks

In `/Users/AIAgenterminal/flowaudit-platform`:

```bash
npm run typecheck
npm run build
```

If `npm test` reports no configured test files, record it as “no web tests configured,” not as a connector failure. The RRD Node suite is the authoritative connector smoke.

## Code-review pitfall: do not hotlink logos

Do not render public marketing-page logos by calling third-party favicon/logo endpoints client-side, e.g.:

- `https://www.google.com/s2/favicons?...`
- Clearbit logo endpoints
- SimpleIcons CDN URLs

Those leak visitor request metadata and can violate privacy/CSP expectations. For the public supported-stack strip, cache approved logo assets under the app’s `public/assets/...` tree and render them locally, preferably through `next/image` with explicit width/height.

Accessibility checklist:

- The duplicated marquee copy should be `aria-hidden` so screen readers do not read the list twice.
- `prefers-reduced-motion: reduce` should disable animation and avoid showing duplicate copies.
- The logo image itself can be decorative (`alt=""`) if the visible text label names the system.

## Live verification

After deploy, verify the branded page, not only the Vercel preview/source URL:

```bash
python3 - <<'PY'
import urllib.request, html as htmlmod, json, sys
url='https://flowaudit.co.uk/revenue-recovery?smoke=stack-final'
page=urllib.request.urlopen(url, timeout=30).read().decode('utf-8','replace')
unescaped=htmlmod.unescape(page)
checks = {
  'heading': 'Connects to the tools your team already uses' in page,
  'shopify': 'Shopify' in page,
  'local_shopify_asset_via_next_image': '/_next/image?url=%2Fassets%2Frevenue-recovery%2Flogos%2Fshopify.png' in unescaped,
  'no_google_favicon_call': 'google.com/s2/favicons' not in page,
  'marquee_class': 'rrd-stack-marquee-track' in page,
}
print(json.dumps({'url': url, 'bytes': len(page), 'checks': checks}, indent=2))
if not all(checks.values()): sys.exit(1)
PY
```

Also do a visual browser check that the strip sits between the hero and the stats/problem section and the logo tiles render.