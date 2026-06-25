# Supported-stack logo marquee verification and privacy review

Use this when updating the public `flowaudit.co.uk/revenue-recovery` page to show supported client systems/logos.

## Durable lesson from the review loop

Do not ship a client-side logo marquee that calls third-party favicon/logo endpoints at page view time, e.g.:

```txt
https://www.google.com/s2/favicons?domain=...
```

That can leak visitor IP/user-agent/referrer/page context to the third party and may conflict with CSP/privacy expectations.

## Preferred pattern

- Use a curated list of genuinely supported systems from the RRD integration registry/readiness docs.
- Cache approved logo/favicon assets under the site `public/` tree, e.g.:

```txt
public/assets/revenue-recovery/logos/<provider>.png
```

- Render through local static paths / Next Image rather than runtime third-party image URLs.
- Include width/height to prevent layout shift.
- If the visual marquee duplicates the list for seamless scrolling, mark the duplicate group `aria-hidden="true"`.
- Respect `prefers-reduced-motion` by disabling animation and hiding/deduplicating the copy.

## Verification checklist

Before reporting done:

1. Run the RRD connector smoke/registry tests if claims about supported systems changed.
2. Run web typecheck/build.
3. Run a static scan or grep to ensure no runtime third-party favicon/logo endpoints remain in rendered source/code.
4. Deploy the actual branded FlowAudit project, not only an ivory/source app.
5. Verify live branded page contains:
   - the stack heading,
   - key systems such as Shopify if advertised,
   - local/Next image asset references,
   - no `google.com/s2/favicons` or equivalent runtime logo calls.
6. Browser/visual-check the live page so the logo strip is visible between the hero and the stats/problem section.

## Review pitfall

A first code review may pass functionality but still miss privacy/CSP issues. Treat external logo fetching as a security/privacy review item, not just a performance nit.
