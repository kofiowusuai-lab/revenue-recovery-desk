#!/usr/bin/env bash
set -euo pipefail
PLIST="$HOME/Library/LaunchAgents/com.openclaw.rrd-provision-watch.plist"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.openclaw.rrd-provision-watch</string>
  <key>ProgramArguments</key><array><string>/usr/bin/env</string><string>node</string><string>/Users/AIAgenterminal/rrd-provision-watch.mjs</string></array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>WorkingDirectory</key><string>/Users/AIAgenterminal</string>
  <key>StandardOutPath</key><string>/Users/AIAgenterminal/.openclaw/rrd-provision-watch.out.log</string>
  <key>StandardErrorPath</key><string>/Users/AIAgenterminal/.openclaw/rrd-provision-watch.err.log</string>
</dict></plist>
PLIST
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "installed $PLIST"
