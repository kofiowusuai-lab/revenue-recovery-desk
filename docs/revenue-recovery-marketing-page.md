# Revenue Recovery marketing page updates

Use this when the operator asks to change the public Revenue Recovery sales/marketing page at `https://flowaudit.co.uk/revenue-recovery`.

## Source of truth

The public branded landing page is in the main FlowAudit marketing repo, not the standalone dashboard app:

```text
/Users/AIAgenterminal/flowaudit-platform
```

The standalone `revenue-recovery-web` app handles client-operation subroutes (client dashboard, vault, OAuth, etc.). Do not edit only `revenue-recovery-web` for landing-page hero/social-proof/marketing changes and then report branded success.

## Required workflow

1. Start/update the task monitor with `--lane recovery_desk` for multi-step web changes.
2. Make the landing-page change in `/Users/AIAgenterminal/flowaudit-platform`.
3. Validate locally before deploy:

```bash
npm run typecheck -- --noEmit || npx tsc --noEmit
npm run build || npx next build
```

Use the project’s actual scripts if they differ, but run a typecheck and production build equivalent.

4. Deploy the FlowAudit marketing project, not just the ivory/source Revenue Recovery app.
5. Verify the branded URL itself:

```bash
curl -L -s https://flowaudit.co.uk/revenue-recovery -o /tmp/rrd_landing.html
python3 - <<'PY'
from pathlib import Path
s = Path('/tmp/rrd_landing.html').read_text(errors='ignore')
for needle in [
  'Connects to the tools your team already uses',
  'Google Workspace',
  'HubSpot',
  'Stripe',
  'rrd-stack-marquee-track',
]:
    print(needle, needle in s)
PY
```

6. Browser-smoke the live branded page visually when the change is layout/animation-sensitive.

## Supported-stack logo marquee pattern

For operator requests like “show all the real company logos/tools we support so visitors can see their stack,” add an early-page horizontally scrolling supported-stack strip between the hero and the stats/problem section.

Good behavior:

- Use real supported providers only; do not add aspirational or made-up logos unless the operator explicitly says to advertise them.
- Include the common recognizable stack first: Google Workspace, HubSpot, Whop, Stripe, Microsoft 365, Salesforce, Zoho, Xero, QuickBooks, Pipedrive, monday.com, Shopify, PayPal, Square, Twilio, FreshBooks, GoHighLevel.
- Keep copy benefit-led, e.g. `Connects to the tools your team already uses`.
- Animation should be smooth, horizontally scrolling, and duplicate the list for seamless looping.
- Pause on hover for readability.
- Respect `prefers-reduced-motion`: disable the marquee animation and let the logo pills wrap.
- Keep it near the top of the page so Revenue Recovery visitors see compatibility before scrolling into detailed proof/problem sections.

## Completion criteria

Do not stop at a source-app deploy or a static string check. Report done only after:

- typecheck/build pass,
- production deploy succeeds,
- `https://flowaudit.co.uk/revenue-recovery` returns the new content, and
- a browser/visual check confirms the strip appears in the intended position.
