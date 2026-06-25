#!/usr/bin/env bash
# Install the Orgo account/plan monitor (launchd, every 5 min).
# Detects an upgraded plan or a different key and auto-provisions active clients.
set -euo pipefail
PLIST="com.openclaw.rrd-orgo-monitor.plist"
SRC="/Users/AIAgenterminal/${PLIST}"
DST="${HOME}/Library/LaunchAgents/${PLIST}"
[ -f "$SRC" ] || { echo "missing $SRC"; exit 1; }
cp "$SRC" "$DST"
launchctl unload "$DST" 2>/dev/null || true
launchctl load "$DST"
echo "Installed and loaded $PLIST (every 5 min)."
echo "Logs: ~/.rrd-orgo-monitor.log / ~/.rrd-orgo-monitor.err"
echo "Manual check: ./rrd-orgo plan    |    ./rrd-orgo-monitor"
echo "Dry-run the upgrade path: ORGO_MONITOR_FAKE_PLAN='{\"paid\":true,\"ownerTier\":\"pro\",\"email\":\"x\",\"userId\":\"y\"}' ./rrd-orgo-monitor"
