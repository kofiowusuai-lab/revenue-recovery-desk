# Local Orgo-equivalent demo sandbox

Use this when there is no paid Orgo account but the operator needs to demo the same per-client recovery-agent lifecycle locally.

## Purpose

The local sandbox mirrors the Orgo model on the operator Mac:

```text
boot isolated environment
load client profile
use profile credentials by key name only
run read-only/dry-run recovery task
produce drafts / gate decisions / audit artifacts
wipe temp runtime state
stop sandbox
```

Client-facing framing:

```text
This is the local demo harness. In production, the same lifecycle runs inside a dedicated Orgo desktop per client. The local sandbox mirrors the isolation, audit, approval gate, and read-only connector checks without requiring Orgo before revenue.
```

Do not claim this is a separate cloud VM. It is a local demo harness on the Mac.

## Command

```bash
/Users/AIAgenterminal/rrd-local-sandbox
```

Common commands:

```bash
/Users/AIAgenterminal/rrd-local-sandbox provision rr-<company>
/Users/AIAgenterminal/rrd-local-sandbox start rr-<company>
/Users/AIAgenterminal/rrd-local-sandbox stop rr-<company>
/Users/AIAgenterminal/rrd-local-sandbox status rr-<company>
/Users/AIAgenterminal/rrd-local-sandbox list
/Users/AIAgenterminal/rrd-local-sandbox destroy rr-<company>
/Users/AIAgenterminal/rrd-local-sandbox demo rr-test --fake
/Users/AIAgenterminal/rrd-local-sandbox demo rr-test --live-readonly
```

## Sandbox layout

Per profile:

```text
/Users/AIAgenterminal/.openclaw/local-sandboxes/rr-<company>/
  workspace/
  downloads/
  audit/
  outputs/
  tmp/
  browser-profile/
  sandbox.json
```

`browser-profile/` is reserved for future dedicated local browser sessions. `tmp/` is wiped on stop. `outputs/` stores JSON and Markdown demo artifacts.

## Demo modes

### Fake demo

```bash
/Users/AIAgenterminal/rrd-local-sandbox demo rr-test --fake
```

Properties:

- deterministic fake invoices only;
- no external API calls;
- no sends;
- exercises draft generation and `rrd-recover` gate;
- includes an approval-gate probe that should block with `APPROVAL_REQUIRED` when approval is omitted.

Use this for client/prospect demos.

### Live-readonly demo

```bash
/Users/AIAgenterminal/rrd-local-sandbox demo rr-test --live-readonly
```

Properties:

- external API calls are read-only only;
- no sends;
- never prints token values;
- lists installed key names only;
- probes currently installed connectors such as Microsoft, monday.com, and HubSpot when their access tokens exist;
- runs a gate-only approved probe to prove the policy executor works without dispatch.

If HubSpot returns token-expired, refresh first:

```bash
/Users/AIAgenterminal/rrd-vault refresh rr-test hubspot
```

Then rerun the live-readonly demo.

## Safety rules

- Never use `--send` in a demo sandbox.
- Never print `.env` contents or token values; report key names only.
- Use `--fake` for external/client demos unless the operator explicitly asks for live-readonly.
- When explaining results, distinguish `would_send` / gate-passed from actually sent.
- If a live connector probe fails from an expired access token, refresh via `rrd-vault refresh <profile> <provider>` rather than asking the client to reconnect immediately.
