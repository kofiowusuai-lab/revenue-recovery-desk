#!/usr/bin/env bash
# rrd-daily-maintenance — runs daily (launchd com.openclaw.rrd-purge).
#  1. Purge offboarded-client records past their 6-year retention (+ their storage docs).
#  2. Reconcile the Orgo fleet: tear down cloud desktops for clients no longer active.
# Each step is independent; a failure in one does not block the other.
cd /Users/AIAgenterminal

echo "=== rrd-daily-maintenance $(date -u +%FT%TZ) ==="

echo "--- retention purge ---"
/Users/AIAgenterminal/rrd-harness purge || echo "purge step failed (non-fatal)"

echo "--- orgo fleet reconcile ---"
if [ -n "${ORGO_API_KEY:-}" ] || grep -q "ORGO_API_KEY=" "$HOME/.openclaw/.env" 2>/dev/null; then
  /Users/AIAgenterminal/rrd-orgo-reconcile || echo "orgo reconcile step failed (non-fatal)"
else
  echo "ORGO_API_KEY not set — skipping orgo reconcile"
fi

echo "=== done ==="
