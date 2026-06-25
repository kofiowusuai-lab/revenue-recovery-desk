# RRD email deliverability and client sender identity

Use this when wiring client recovery outreach, welcome/access packs, or diagnosing junk-folder placement.

## Production rule

For real client outreach, prefer the client’s authenticated email identity instead of a shared RRD/AgentMail sender. Use either:

- An existing recognizable billing/accounts mailbox, if it can be authenticated and safely connected; or
- A delegated sending subdomain such as `recover.clientdomain.com` or `ar.clientdomain.com`.

Suggested sender examples:

- `accounts@recover.clientdomain.com`
- `billing@ar.clientdomain.com`
- `receivables@recover.clientdomain.com`

## What to request in the integration-access email

Ask the client to confirm:

- Preferred From name customers should see.
- Preferred sender address or sending subdomain.
- DNS/admin contact who can add provider records.
- Reply handling preference: replies to the client, RRD, or both.

Also state not to email mailbox passwords or private credentials.

## DNS/authentication checklist

The email provider should supply records for:

- SPF alignment/authorization.
- DKIM signing.
- DMARC/subdomain policy.
- Return-path / bounce domain, when supported.

If the root domain has strict DMARC/SPF (for example SPF `-all`, DMARC `p=reject`, strict alignment), do not spoof that domain before the provider-specific DNS records are live.

## Deliverability guidance

- Shared/default sender domains are acceptable for internal tests only; production should use client-domain identity.
- Start with a low-volume warm-up and real expected recipients.
- Avoid aggressive first-touch spam triggers like “final notice”, “pay now”, threatening wording, many links, heavy HTML, or link shorteners.
- Keep HTML simple and include matching plain text.
- Report provider acceptance/message IDs accurately; do not claim inbox delivery unless a provider delivery event confirms it.

## Copy snippet for access packs

```text
Recovery email sending setup
For best inbox placement, recovery messages should come from your company’s email identity, not a shared Revenue Recovery Desk address. Please confirm:
- Preferred From name customers should see, e.g. Acme Accounts Team
- Preferred sender address or sending subdomain, e.g. accounts@recover.yourdomain.com or billing@ar.yourdomain.com
- Who on your team can add DNS records if needed
- Reply handling preference: replies go to your team, Revenue Recovery Desk, or both

Recommended setup:
- Sender: accounts@recover.yourdomain.com
- DNS: SPF, DKIM, DMARC, and return-path records supplied by the email provider

If you already use a billing/accounts mailbox customers recognize, reply with that address and who manages it. Do not send mailbox passwords or private credentials by email.
```
