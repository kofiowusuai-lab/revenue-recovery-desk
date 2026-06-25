#!/usr/bin/env node
/**
 * rrd-recover.mjs — the gated recovery executor for a per-client agent.
 *
 * The agent never contacts a customer directly. It calls this executor, which is
 * the SINGLE choke point: it runs the deterministic guardrail gate, the daily
 * caps, and the tool allowlist BEFORE any adapter is touched, records usage, and
 * writes an append-only audit row for every decision (allowed or blocked).
 *
 *   ~/rrd-recover gate  <profile> '<action-json>'   # check only, sends nothing
 *   ~/rrd-recover send  <profile> '<action-json>'   # gate, then dispatch if allowed
 *
 * action = { channel:"Email"|"SMS"|"Letter", to:{email,phone,name,...}, approved?:bool,
 *            atHour?:0-23, discount?:{type,value}, threadFlags?:{...}, batchIndex?:number,
 *            tool?:string, html?, pdfUrl?, from?, mailingClass?, certified?, costUsd? }
 *
 * Policy comes from the frozen <profile>/policy.json written at provision time.
 * Fail-closed everywhere: missing policy, unknown channel, or no approval => blocked.
 */
import { buildPolicy, evaluateSend, auditEntry, actionAllowed } from "./rrd-guardrails.mjs";
import { bumpUsage, checkCaps } from "./rrd-usage.mjs";
import { audit } from "./rrd-audit.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { assertSafeProfile } from "./rrd-profile-safety.mjs";

const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || "/Users/AIAgenterminal";
const PROFILES_DIR = process.env.HERMES_PROFILES_DIR || path.join(OPERATOR_HOME, ".hermes", "profiles");
const DEFAULT_CAPS = {
  sendsToday: intEnv("RRD_CAP_SENDS", 200),
  lettersToday: intEnv("RRD_CAP_LETTERS", 50),
  spendTodayUsd: intEnv("RRD_CAP_SPEND_USD", 500),
  desktopMinutesToday: intEnv("RRD_CAP_DESKTOP_MIN", 240)
};
function intEnv(k, d) { const n = parseInt(process.env[k] || "", 10); return Number.isFinite(n) ? n : d; }

function parseEnvFile(file) {
  const out = {};
  if (!file || !fs.existsSync(file)) return out;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [k, ...rest] = line.split("=");
    let v = rest.join("=").trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k.trim()] = v;
  }
  return out;
}

function truthy(v) {
  return /^(1|true|yes|y|on)$/i.test(String(v || "").trim());
}

export function resolvePostGridCredential(profile, { env = process.env, profilesDir = PROFILES_DIR, operatorEnvPath = path.join(OPERATOR_HOME, ".openclaw", ".env") } = {}) {
  profile = assertSafeProfile(profile);
  const profileEnv = parseEnvFile(path.join(profilesDir, profile, ".env"));
  if (truthy(profileEnv.POSTGRID_LETTERS_OPT_OUT) || truthy(env.POSTGRID_LETTERS_OPT_OUT)) {
    throw new Error("PostGrid letters are opted out for this profile");
  }
  if (profileEnv.POSTGRID_API_KEY) {
    return { apiKey: profileEnv.POSTGRID_API_KEY, source: "client", envName: "POSTGRID_API_KEY", billTo: "client_postgrid_account", billableToClient: false };
  }

  // Shared fallback lives in the operator env, not the per-client profile env.
  // Prefer explicit shared names; accept operator POSTGRID_API_KEY for the current
  // deployment where the FlowAudit/shared key is stored there.
  const operatorEnv = parseEnvFile(operatorEnvPath);
  const sharedCandidates = [
    ["RRD_SHARED_POSTGRID_API_KEY", env.RRD_SHARED_POSTGRID_API_KEY || operatorEnv.RRD_SHARED_POSTGRID_API_KEY],
    ["FLOWAUDIT_POSTGRID_API_KEY", env.FLOWAUDIT_POSTGRID_API_KEY || operatorEnv.FLOWAUDIT_POSTGRID_API_KEY],
    ["POSTGRID_API_KEY", operatorEnv.POSTGRID_API_KEY]
  ];
  for (const [envName, apiKey] of sharedCandidates) {
    if (apiKey) return { apiKey, source: "shared", envName, billTo: profile, billableToClient: true };
  }
  throw new Error("Missing PostGrid config. Add client POSTGRID_API_KEY to the profile, or configure shared RRD_SHARED_POSTGRID_API_KEY / FLOWAUDIT_POSTGRID_API_KEY in operator env.");
}

function recordPostGridUsage(profile, action, result, billing, { usageDir = path.join(OPERATOR_HOME, ".openclaw", "rrd-postgrid-usage") } = {}) {
  if (!billing) return;
  profile = assertSafeProfile(profile);
  fs.mkdirSync(usageDir, { recursive: true });
  const to = action.to || {};
  const row = {
    ts: new Date().toISOString(),
    profile,
    company: action.rrdCompany || action.company || null,
    postgridKeySource: billing.source,
    postgridKeyEnvName: billing.envName,
    billableToClient: !!billing.billableToClient,
    billTo: billing.billTo || null,
    letterId: result && result.id || null,
    providerStatus: result && result.status || null,
    invoiceId: action.invoiceId || null,
    rung: action.rung || null,
    certified: !!action.certified,
    mailingClass: action.mailingClass || "first_class",
    costUsd: Number(action.costUsd) || 0,
    recipientCompany: to.companyName || null,
    recipientCountry: to.country || null,
    metadata: action.metadata && typeof action.metadata === "object" ? action.metadata : undefined
  };
  fs.appendFileSync(path.join(usageDir, `${profile}.ndjson`), JSON.stringify(row) + "\n", { mode: 0o600 });
}

export function loadPolicy(profile) {
  profile = assertSafeProfile(profile);
  const f = path.join(PROFILES_DIR, profile, "policy.json");
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
}
export function loadAllowlist(profile) {
  profile = assertSafeProfile(profile);
  const f = path.join(PROFILES_DIR, profile, "manifest.json");
  try { return (JSON.parse(fs.readFileSync(f, "utf8")).toolAllowlist) || []; } catch { return []; }
}

export function channelKind(channel) {
  const c = String(channel || "").toLowerCase();
  if (/e-?mail/.test(c)) return "email";          // before letter/mail ("email" contains "mail")
  if (/sms|text/.test(c)) return "sms";
  if (/phone|call/.test(c)) return "phone";
  if (/letter|postal|post|mail/.test(c)) return "letter";
  return "unknown";
}

// real adapters. Only "letter" is live today (PostGrid via client key or shared fallback); the
// others throw until their providers are wired — fail-closed, never a silent no-op.
function realAdapters(profile, deps = {}) {
  profile = assertSafeProfile(profile);
  return {
    letter: async (action) => {
      const { sendLetter } = await import("./rrd-letter.mjs");
      const postgrid = resolvePostGridCredential(profile, deps);
      const metadata = {
        ...(action.metadata || {}),
        rrd_profile: profile,
        rrd_company: action.rrdCompany || action.company || profile,
        rrd_postgrid_key_source: postgrid.source,
        rrd_billable_to_client: String(!!postgrid.billableToClient)
      };
      let html = action.html;
      if (html && !action.pdfUrl && !action.pdf) {
        const { styleLetterHtmlForProfile } = await import("./rrd-letter-style.mjs");
        html = await styleLetterHtmlForProfile(profile, html);
      }
      const result = await sendLetter({
        apiKey: postgrid.apiKey,
        to: action.to, from: action.from, html, pdfUrl: action.pdfUrl,
        mailingClass: action.mailingClass || "first_class", certified: !!action.certified,
        mergeVariables: action.mergeVariables, description: action.description, metadata
      });
      return { ...result, postgridBilling: { source: postgrid.source, envName: postgrid.envName, billTo: postgrid.billTo, billableToClient: postgrid.billableToClient } };
    },
    email: async (action) => {
      const { sendEmail } = await import("./rrd-email.mjs");
      const to = action.to && (action.to.email || (typeof action.to === "string" ? action.to : null));
      return sendEmail({ to: to ? { email: to, name: action.to && action.to.name } : null, from: action.from, subject: action.subject, text: action.text, html: action.html });
    },
    sms: async (action) => {
      const { sendSms } = await import("./rrd-sms.mjs");
      const to = action.to && (action.to.phone || (typeof action.to === "string" ? action.to : null));
      return sendSms({ to, body: action.text || action.body, from: action.from });
    },
    phone: async () => { throw new Error("phone is a human channel — escalate, do not auto-dial"); }
  };
}

/**
 * The gate + dispatch. Pure-ish: all side-effecting deps are injectable for tests.
 * deps = { policy, allowlist, caps, adapters, usageBump, auditWrite }
 */
export async function execute(profile, action, { send = false, deps = {} } = {}) {
  profile = assertSafeProfile(profile);
  const policy = deps.policy || loadPolicy(profile);
  const allowlist = deps.allowlist || loadAllowlist(profile);
  const caps = deps.caps || DEFAULT_CAPS;
  const adapters = deps.adapters || realAdapters(profile, deps);
  const usageBump = deps.usageBump || ((p, d) => bumpUsage(p, d));
  const auditWrite = deps.auditWrite || ((p, e) => audit(p, e));
  const capCheckFn = deps.capCheck || ((p, c) => checkCaps(p, c));

  const finish = (decision, extra = {}) => {
    const entry = auditEntry({ profile, kind: "send", action, decision });
    auditWrite(profile, entry);
    return { profile, sent: false, decision, ...extra };
  };

  if (!policy) {
    const decision = { allowed: false, violations: [{ code: "NO_POLICY", msg: "no policy.json for this profile — re-provision" }], requiresHuman: true };
    return finish(decision);
  }

  // containment: the action's tool must be on the allowlist (deny-by-default)
  const tool = action.tool || "send_via_executor";
  if (!actionAllowed(tool, allowlist)) {
    return finish({ allowed: false, violations: [{ code: "TOOL_NOT_ALLOWED", msg: `tool "${tool}" not in allowlist` }], requiresHuman: true });
  }

  // daily caps
  const capCheck = capCheckFn(profile, caps);
  if (!capCheck.allowed) {
    return finish({ allowed: false, violations: capCheck.violations, requiresHuman: false });
  }

  // the deterministic gate
  const decision = evaluateSend(action, policy);
  if (!decision.allowed) return finish(decision);

  if (!send) return { profile, sent: false, wouldSend: true, decision, ...auditAndReturn(auditWrite, profile, action, decision) };

  // dispatch
  const kind = channelKind(action.channel);
  const adapter = adapters[kind];
  if (!adapter) return finish({ allowed: false, violations: [{ code: "NO_ADAPTER", msg: `no adapter for channel "${action.channel}"` }], requiresHuman: true });

  let result;
  try {
    const dispatchAction = kind === "letter" ? { ...action, rrdCompany: policy.company || profile } : action;
    result = await adapter(dispatchAction);
  } catch (e) {
    const decision2 = { allowed: false, violations: [{ code: "ADAPTER_ERROR", msg: e && e.message || String(e) }], requiresHuman: true };
    return finish(decision2);
  }

  // success: record usage + audit
  const delta = { sends: 1, spendUsd: Number(action.costUsd) || 0 };
  if (kind === "letter") delta.letters = 1;
  usageBump(profile, delta);
  if (kind === "letter") {
    const postgridUsageWrite = deps.postgridUsageWrite || ((p, a, r, b) => recordPostGridUsage(p, a, r, b, deps));
    postgridUsageWrite(profile, { ...action, rrdCompany: policy.company || profile }, result, result && result.postgridBilling);
  }
  auditWrite(profile, auditEntry({ profile, kind: "send", action, decision }));
  return { profile, sent: true, result, decision };
}

function auditAndReturn(auditWrite, profile, action, decision) {
  auditWrite(profile, auditEntry({ profile, kind: "gate", action, decision }));
  return {};
}

/* ---------------- CLI ---------------- */
function usage() {
  console.error(`rrd-recover — gated recovery executor

  rrd-recover gate <profile> '<action-json>'   check only (sends nothing)
  rrd-recover send <profile> '<action-json>'   gate, then send if allowed

action: {channel,to,approved?,atHour?,discount?,threadFlags?,batchIndex?,tool?,html?,pdfUrl?,from?,mailingClass?,certified?,costUsd?}`);
}
async function main() {
  const [, , cmd, profile, rawAction] = process.argv;
  if (!cmd || ["-h", "--help", "help"].includes(cmd)) { usage(); process.exit(cmd ? 0 : 1); }
  if (!["gate", "send"].includes(cmd)) { console.error("unknown command: " + cmd + "\n"); usage(); process.exit(1); }
  if (!profile) { console.error(cmd + " needs a profile (e.g. rr-acme)"); process.exit(1); }
  let action = {};
  if (rawAction) { try { action = JSON.parse(rawAction); } catch (e) { console.error("invalid action JSON: " + e.message); process.exit(1); } }
  const res = await execute(profile, action, { send: cmd === "send" });
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.sent || res.wouldSend || (res.decision && res.decision.allowed) ? 0 : 2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
}
