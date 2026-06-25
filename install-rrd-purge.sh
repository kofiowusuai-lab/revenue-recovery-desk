#!/usr/bin/env bash
# Install the daily offboarded-client purge timer (launchd).
# This is the fallback/companion to the in-database pg_cron job
# 'rrd-purge-expired-offboarded'. It additionally deletes the Storage
# documents of expired records before hard-deleting the rows.
set -euo pipefail

PLIST="com.openclaw.rrd-purge.plist"
SRC="/Users/AIAgenterminal/${PLIST}"
DST="${HOME}/Library/LaunchAgents/${PLIST}"

[ -f "$SRC" ] || { echo "missing $SRC"; exit 1; }
cp "$SRC" "$DST"

# reload cleanly
launchctl unload "$DST" 2>/dev/null || true
launchctl load "$DST"

echo "Installed and loaded $PLIST"
echo "Runs daily at 09:20 local. Logs: ~/.rrd-purge.log / ~/.rrd-purge.err"
echo "Run once now:  ./rrd-harness purge"
echo "Preview only:  ./rrd-harness purge --dry-run"
