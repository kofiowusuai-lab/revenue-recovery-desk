#!/usr/bin/env bash
# Install the agent-guardrail DRIFT MONITOR (launchd, every hour).
# Watches each rr-* recovery agent's audit log and pings recoverydesk on drift.
set -euo pipefail
PLIST="com.openclaw.rrd-guardrail-monitor.plist"
SRC="/Users/AIAgenterminal/${PLIST}"
DST="${HOME}/Library/LaunchAgents/${PLIST}"
[ -f "$SRC" ] || { echo "missing $SRC"; exit 1; }
cp "$SRC" "$DST"
launchctl unload "$DST" 2>/dev/null || true
launchctl load "$DST"
echo "Installed and loaded $PLIST (every hour)."
echo "Logs: ~/.rrd-guardrail-monitor.log / ~/.rrd-guardrail-monitor.err"
echo "Manual run: ./rrd-guardrail-monitor"
echo "Tune thresholds via env, e.g.:"
echo "  DRIFT_MAX_ACTIONS_PER_HOUR=300 GUARDRAIL_DRIFT_MIN_BLOCKED=1 ./rrd-guardrail-monitor"
echo "Enable the optional LLM mandate judge: GUARDRAIL_LLM_JUDGE=1 ./rrd-guardrail-monitor"
