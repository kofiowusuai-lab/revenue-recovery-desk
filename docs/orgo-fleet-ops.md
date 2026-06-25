# Orgo fleet ops for Revenue Recovery Desk

Use this when installing, verifying, or troubleshooting per-client Orgo cloud desktops for `rr-<company>` profiles.

## Intended model

- `rrd-provision <submission-id>` creates the per-client Hermes profile and should provision a persistent Orgo project for that profile.
- Orgo projects are persistent and cheap/free when stopped; desktops are booted only on demand with `rrd-orgo start <profile>` or `rrd-orgo run <profile> "<task>"`.
- Stop desktops after browser/computer-use work with `rrd-orgo stop <profile>` to avoid runtime cost.
- Do not install Telegram inside every client desktop by default. Telegram is the operator/control channel; Orgo desktops are for visual/browser tasks only.

## Install / verify Orgo SDK

The wrapper expects an Orgo venv and fleet script under the operator home, not the active Hermes profile home:

```bash
mkdir -p /Users/AIAgenterminal/.openclaw
cd /Users/AIAgenterminal/.openclaw
/opt/homebrew/bin/python3.12 -m venv orgo-venv
./orgo-venv/bin/python -m pip install --upgrade pip
./orgo-venv/bin/python -m pip install orgo
```

Verify:

```bash
/Users/AIAgenterminal/rrd-orgo plan
/Users/AIAgenterminal/rrd-orgo list
```

If existing clients need projects after install/upgrade:

```bash
/Users/AIAgenterminal/rrd-orgo provision rr-<company>
```

## Profile `$HOME` pitfall

Gateway/profile shells may set `$HOME` to `/Users/AIAgenterminal/.hermes/profiles/recoverydesk/home`. The Orgo API key, venv, fleet map, and `orgo-fleet.py` live under real operator home `/Users/AIAgenterminal`.

The `rrd-orgo` wrapper should therefore pin real operator paths, e.g.:

```bash
OPERATOR_HOME="${RRD_OPERATOR_HOME:-/Users/AIAgenterminal}"
if [ -f "$OPERATOR_HOME/.openclaw/.env" ]; then set -a; . "$OPERATOR_HOME/.openclaw/.env"; set +a; fi
VENV_PY="$OPERATOR_HOME/.openclaw/orgo-venv/bin/python"
export ORGO_FLEET_FILE="${ORGO_FLEET_FILE:-$OPERATOR_HOME/.openclaw/orgo-fleet.json}"
export HERMES_PROFILES_DIR="${HERMES_PROFILES_DIR:-$OPERATOR_HOME/.hermes/profiles}"
exec "$VENV_PY" "$OPERATOR_HOME/orgo-fleet.py" "$@"
```

This is a durable wrapper pattern, not a claim that Orgo is broken.

## Go-live checks

- `rrd-orgo plan` should report the expected account and whether the tier is paid.
- Project creation/list can work on free tiers; live desktop booting may require paid/pro tier.
- `ORGO_API_KEY` belongs in `/Users/AIAgenterminal/.openclaw/.env` as the single switch point.
- Client secrets never belong in Orgo fleet state; keep them in each Hermes profile `.env` and inject at run time.
