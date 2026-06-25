# New-client notification routing for RRD Operations

Use when noisy "New client just came in…" / recommendation messages appear in the main Revenue Recovery Desk chat.

## Source

The instant new-client notifier is separate from the onboarding AgentMail watcher:

- Wrapper: `/Users/AIAgenterminal/rrd-notify`
- Main script: `/Users/AIAgenterminal/rrd-notify.mjs`
- State: `/Users/AIAgenterminal/.rrd-notify-state.json`
- launchd: `/Users/AIAgenterminal/Library/LaunchAgents/com.openclaw.rrd-notify.plist`
- Interval: 60 seconds

It sends two messages per new onboarding submission:

1. deterministic "New client just came in…" summary
2. best-effort agent-drafted provisioning recommendation

## Routing rule

These notices should go to the dedicated **RRD Operations** bot/channel, not the main Hermes/recoverydesk chat.

The notifier should prefer:

- `RRD_OPS_BOT_TOKEN`
- `RRD_OPS_CHAT_ID`

and fall back to:

- `RRD_APPROVAL_TELEGRAM_BOT_TOKEN`
- `RRD_APPROVAL_TELEGRAM_CHAT_ID`

The wrapper must source `/Users/AIAgenterminal/.openclaw/.env` as well as `.env.local`; otherwise the script may not see the Ops/approval bot env and will fall back to `recoverydesk send --to telegram`, causing main-chat noise.

## Verification

Safe checks:

```bash
node --check /Users/AIAgenterminal/rrd-notify.mjs
/Users/AIAgenterminal/rrd-notify
```

A normal no-output run means there were no new rows since `.rrd-notify-state.json`. Do not reset `lastSeen` unless you intentionally want old rows re-announced.

Check env presence without printing values:

```bash
node - <<'NODE'
const fs=require('fs');
const env={};
for (const f of ['/Users/AIAgenterminal/.openclaw/.env']) {
  if (!fs.existsSync(f)) continue;
  for (const raw of fs.readFileSync(f,'utf8').split(/\r?\n/)) {
    const m=raw.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2]) env[m[1]]=true;
  }
}
for (const k of ['RRD_OPS_BOT_TOKEN','RRD_OPS_CHAT_ID','RRD_APPROVAL_TELEGRAM_BOT_TOKEN','RRD_APPROVAL_TELEGRAM_CHAT_ID']) {
  console.log(`${k}: ${env[k]?'present':'missing'}`);
}
NODE
```

## Pitfall

Do not confuse this notifier with cron job `RRD Onboarding AgentMail Automation Watcher`. The watcher provisions profiles and sends client emails; `rrd-notify` is only the operator-facing new-client ping/recommendation layer.
