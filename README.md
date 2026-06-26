# Revenue Recovery Desk

Private source repository for the Revenue Recovery Desk control plane, client web portal, readiness checks, vault/OAuth helpers, approval-gated recovery execution, and tests.

## Safety rules

- Never commit real `.env` files, OAuth token stores, vault private keys, client secrets, or runtime state.
- Use `.env.example` for placeholders only.
- Client secrets must be entered through secure vault/OAuth flows or deployment secret managers.

## Completion roadmap

See [`docs/COMPLETION_BRIEF.md`](docs/COMPLETION_BRIEF.md) for the full build-out brief.

The most important rule: every outbound recovery action must go through the gated `rrd-recover` executor. No agent, cron job, route, or adapter may send directly.

## Test

```bash
npm install
npm test
```
