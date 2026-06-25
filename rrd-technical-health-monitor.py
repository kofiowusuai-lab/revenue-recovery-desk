#!/usr/bin/env python3
"""RRD technical health monitor.

Alerts RRD Operations when technical infrastructure for client recovery agents is
broken. It intentionally avoids business-state alerts such as unpaid invoices,
approval-required, missing SOP, or normal client readiness blockers.
"""
from __future__ import annotations
import argparse, hashlib, json, os, re, subprocess, sys, time, urllib.parse, urllib.request
from pathlib import Path

OP = Path(os.environ.get("RRD_OPERATOR_HOME", "/Users/AIAgenterminal"))
PROFILES = Path(os.environ.get("HERMES_PROFILES_DIR", str(OP / ".hermes" / "profiles")))
STATE_FILE = OP / ".openclaw" / "rrd-technical-health-monitor.json"
SCHED_DIR = OP / ".openclaw" / "rrd-schedules"
COLLECTIONS_DIR = Path(os.environ.get("RRD_COLLECTIONS_DIR", str(OP / ".openclaw" / "rrd-collections")))
LANE = "recovery_desk"

TECH_PATTERNS = re.compile(r"(Traceback|SyntaxError|TypeError|ReferenceError|MODULE_NOT_FOUND|ENOENT|EACCES|permission denied|command not found|cannot find module|invalid JSON|JSON\.parse|timed out|timeout|ECONNREFUSED|ENOTFOUND|fetch failed|adapter error|ADAPTER_ERROR|NO_POLICY|TOOL_NOT_ALLOWED|no policy\.json|missing profile|orgo .*failed|desktop.*failed|rrd-brain .*failed)", re.I)
BUSINESS_PATTERNS = re.compile(r"(APPROVAL_REQUIRED|NO_CONSENT|DO_NOT_CONTACT|OUTSIDE_HOURS|BATCH_EXCEEDED|DISCOUNT|waiting_for_paid_orgo|client.*todo|SOP|consent|approval model)", re.I)


def load_env_file(path: Path) -> dict[str, str]:
    env = {}
    try:
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line: continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            env[k.strip()] = v
    except Exception:
        pass
    return env


def merged_env() -> dict[str, str]:
    env = dict(os.environ)
    for p in [OP / ".openclaw" / ".env", OP / ".hermes" / "profiles" / "recoverydesk" / ".env"]:
        for k, v in load_env_file(p).items(): env.setdefault(k, v)
    return env


def run(cmd, timeout=30):
    try:
        p = subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired as e:
        return 124, ((e.stdout or "") if isinstance(e.stdout, str) else "") + "\nTIMEOUT"
    except Exception as e:
        return 127, str(e)


def issue(sev, key, title, detail=""):
    return {"severity": sev, "key": key, "title": title, "detail": detail.strip()[:1200]}


def profile_dirs():
    if not PROFILES.exists(): return []
    return sorted([p for p in PROFILES.iterdir() if p.is_dir() and p.name.startswith("rr-") and (p / "manifest.json").exists()])


def load_json(path: Path):
    return json.loads(path.read_text())


def enabled_schedules():
    out = {}
    if SCHED_DIR.exists():
        for f in SCHED_DIR.glob("*.json"):
            try:
                j = load_json(f)
                if j.get("enabled"): out[j.get("profile") or f.stem] = j
            except Exception:
                out[f.stem] = {"enabled": True, "parseError": True, "path": str(f)}
    return out


def check_globals(issues):
    for cmd in ["rrd-ready", "rrd-brain", "rrd-recovery-scheduler", "rrd-collections-state.mjs", "rrd-collect.mjs"]:
        p = OP / cmd
        if not p.exists(): issues.append(issue("critical", f"global:missing:{cmd}", f"Missing required RRD technical file: {cmd}", str(p)))
    for cmd in ["rrd-ready", "rrd-brain", "rrd-recovery-scheduler"]:
        p = OP / cmd
        if p.exists() and not os.access(p, os.X_OK): issues.append(issue("critical", f"global:not-executable:{cmd}", f"RRD command is not executable: {cmd}", str(p)))
    code, out = run(["launchctl", "list"], timeout=20)
    if code != 0: issues.append(issue("warning", "global:launchctl", "Could not inspect launchd services", out))
    elif "ai.hermes.gateway-recoverydesk" not in out: issues.append(issue("critical", "global:gateway-down", "Recoverydesk gateway is not running", "launchctl list missing ai.hermes.gateway-recoverydesk"))
    script = OP / ".hermes" / "profiles" / "recoverydesk" / "scripts" / "rrd-recovery-scheduler-watch.sh"
    if not script.exists(): issues.append(issue("critical", "global:scheduler-script-missing", "4-hour recovery scheduler script is missing", str(script)))
    elif not os.access(script, os.X_OK): issues.append(issue("critical", "global:scheduler-script-not-executable", "4-hour recovery scheduler script is not executable", str(script)))


def is_technical_ready_failure(text):
    return bool(TECH_PATTERNS.search(text)) and not (BUSINESS_PATTERNS.search(text) and not TECH_PATTERNS.search(text))


def check_profile(p: Path, schedules, issues):
    profile = p.name
    # Required brain files and parseability
    for fname in ["SOUL.md", "policy.json", "manifest.json"]:
        f = p / fname
        if not f.exists(): issues.append(issue("critical", f"{profile}:missing:{fname}", f"{profile}: missing required profile file {fname}", str(f)))
    for fname in ["policy.json", "manifest.json"]:
        f = p / fname
        if f.exists():
            try: load_json(f)
            except Exception as e: issues.append(issue("critical", f"{profile}:invalid-json:{fname}", f"{profile}: invalid JSON in {fname}", str(e)))
    try: manifest = load_json(p / "manifest.json")
    except Exception: manifest = {}
    allow = manifest.get("toolAllowlist") or []
    if "send_via_executor" not in allow: issues.append(issue("critical", f"{profile}:allowlist:executor", f"{profile}: send executor not in tool allowlist", f"toolAllowlist={allow}"))

    cfg = schedules.get(profile)
    enabled = bool(cfg)
    if enabled:
        if cfg.get("parseError"): issues.append(issue("critical", f"{profile}:schedule-json", f"{profile}: scheduler config is not valid JSON", cfg.get("path", "")))
        if not cfg.get("reportTo") and not any((p / ".env").exists() and k in (p / ".env").read_text(errors="ignore") for k in ["RRD_REPORT_TO_EMAIL", "CLIENT_REPORT_EMAIL", "PRIMARY_CONTACT_EMAIL"]):
            issues.append(issue("warning", f"{profile}:no-report-contact", f"{profile}: automatic recovery enabled but no report contact configured", "Set --report-to or profile env RRD_REPORT_TO_EMAIL/CLIENT_REPORT_EMAIL/PRIMARY_CONTACT_EMAIL."))
        # Stale successful scheduler run means cron may be broken or profile failing before cfg update.
        last = cfg.get("lastRunAt")
        if last:
            try:
                # ISO Z/simple parse
                ts = time.mktime(time.strptime(last[:19], "%Y-%m-%dT%H:%M:%S"))
                if time.time() - ts > 6 * 3600: issues.append(issue("critical", f"{profile}:scheduler-stale", f"{profile}: automatic scheduler has not updated in >6 hours", f"lastRunAt={last}"))
            except Exception: pass
        lr = json.dumps(cfg.get("lastResult", {}))
        if TECH_PATTERNS.search(lr): issues.append(issue("critical", f"{profile}:last-result-tech-error", f"{profile}: last recovery scheduler result contains a technical error", lr[:1200]))

        # Enabled clients get a technical readiness smoke check; business blockers are ignored here.
        code, out = run([str(OP / "rrd-ready"), "check", profile, "--allow-no-orgo"], timeout=90)
        if code != 0 and is_technical_ready_failure(out):
            issues.append(issue("critical", f"{profile}:ready-tech", f"{profile}: readiness smoke check has a technical failure", out))

    # Collections ledger must parse if present; corruption breaks duplicate suppression.
    cfile = COLLECTIONS_DIR / f"{profile}.json"
    if cfile.exists():
        try: load_json(cfile)
        except Exception as e: issues.append(issue("critical", f"{profile}:collections-json", f"{profile}: collections ledger is corrupt", str(e)))


def resolve_route(env):
    sys.path.insert(0, str(OP / ".openclaw" / "scripts"))
    try:
        from lane_route import resolve
        return resolve(LANE, env)
    except Exception:
        return {"token": env.get("RRD_OPS_BOT_TOKEN") or env.get("RRD_APPROVAL_TELEGRAM_BOT_TOKEN"), "chat": env.get("RRD_OPS_CHAT_ID") or env.get("RRD_APPROVAL_TELEGRAM_CHAT_ID") or "5426093479", "name": "RRD Operations"}


def send_telegram(text):
    env = merged_env(); route = resolve_route(env)
    token, chat = route.get("token"), route.get("chat")
    if not token or not chat: return False, "missing RRD Ops Telegram route"
    data = urllib.parse.urlencode({"chat_id": chat, "text": text, "disable_web_page_preview": "true"}).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=data)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return True, r.read().decode()[:200]
    except Exception as e:
        return False, str(e)


def render(issues):
    crit = [i for i in issues if i["severity"] == "critical"]
    warn = [i for i in issues if i["severity"] != "critical"]
    lines = ["🚨 RRD technical health alert", "", f"Critical: {len(crit)}  Warning: {len(warn)}", ""]
    for i in issues[:20]:
        icon = "❌" if i["severity"] == "critical" else "⚠️"
        lines.append(f"{icon} {i['title']}")
        if i.get("detail"): lines.append(f"   {i['detail'].replace(chr(10), chr(10)+'   ')[:700]}")
    if len(issues) > 20: lines.append(f"…and {len(issues)-20} more.")
    lines.append("")
    lines.append("This monitor only reports technical/platform failures, not business collection status.")
    return "\n".join(lines)[:3900]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--no-send", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    issues = []
    check_globals(issues)
    schedules = enabled_schedules()
    for p in profile_dirs(): check_profile(p, schedules, issues)
    payload = json.dumps(sorted([(i["severity"], i["key"], i["title"]) for i in issues]), sort_keys=True)
    digest = hashlib.sha256(payload.encode()).hexdigest()
    prev = {}
    try: prev = json.loads(STATE_FILE.read_text())
    except Exception: pass
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"lastDigest": digest, "lastCheckedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "issueCount": len(issues)}, indent=2))
    if args.verbose:
        print(json.dumps({"ok": not issues, "issues": issues}, indent=2))
    if not issues:
        if prev.get("issueCount", 0) and not args.no_send:
            send_telegram("✅ RRD technical health recovered — no technical client-agent issues currently detected.")
        return 0
    if args.no_send:
        print(render(issues)); return 2
    if args.force or digest != prev.get("lastDigest"):
        ok, info = send_telegram(render(issues))
        if args.verbose: print(json.dumps({"sent": ok, "info": info}))
    return 2 if any(i["severity"] == "critical" for i in issues) else 0

if __name__ == "__main__":
    raise SystemExit(main())
