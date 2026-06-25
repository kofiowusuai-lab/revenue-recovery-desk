#!/usr/bin/env node
/**
 * rrd-agent-llm.mjs — manage the profile-local ChatGPT/Codex OAuth runtime
 * for a Revenue Recovery client agent.
 *
 * SAFETY: never prints tokens, refresh tokens, auth.json contents, or secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assertSafeProfile } from "./rrd-profile-safety.mjs";

const OPERATOR_HOME = process.env.RRD_OPERATOR_HOME || "/Users/AIAgenterminal";
const DEFAULT_MODEL = process.env.RRD_AGENT_LLM_MODEL || "gpt-5.1-codex-max";

function profilesDir() { return process.env.HERMES_PROFILES_DIR || path.join(OPERATOR_HOME, ".hermes", "profiles"); }
function profileDir(profile) { return path.join(profilesDir(), assertSafeProfile(profile)); }
function authPath(profile) { return path.join(profileDir(profile), "auth.json"); }
function configPath(profile) { return path.join(profileDir(profile), "config.yaml"); }
function runtimeAssignmentPath(profile) { return path.join(profileDir(profile), "llm-runtime.json"); }
function exists(file) { return fs.existsSync(file); }

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return null; }
}

function assertSafeModelName(model) {
  model = String(model || DEFAULT_MODEL).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,120}$/.test(model) || /[\r\n#]/.test(model)) {
    throw new Error("Unsafe model name for runtime config");
  }
  return model;
}

function hasUsableTokenEntry(entry = {}) {
  const tokens = entry.tokens || entry;
  return !!(tokens.access_token || tokens.refresh_token);
}

function assertSafeAccountEmail(email) {
  email = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Use --account-email with the FlowAudit-managed ChatGPT account email for this client agent");
  if (/(password|passwd|secret|token|refresh|access[_-]?token)/i.test(email)) throw new Error("Do not paste passwords, tokens, or secrets; assign only the account email");
  return email;
}

function parseFlag(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  const value = args[idx + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

export function readRuntimeAssignment(profile) {
  profile = assertSafeProfile(profile);
  const file = runtimeAssignmentPath(profile);
  const data = exists(file) ? readJsonSafe(file) : null;
  if (!data || typeof data !== "object") return null;
  return {
    accountEmail: data.accountEmail || null,
    accountLabel: data.accountLabel || null,
    assignedAt: data.assignedAt || null,
    provider: data.provider || "openai-codex",
    model: data.model || DEFAULT_MODEL,
    authStore: "auth.json",
  };
}

export function assignRuntimeAccount(profile, { accountEmail, accountLabel = null, model = DEFAULT_MODEL } = {}) {
  profile = assertSafeProfile(profile);
  const pdir = profileDir(profile);
  if (!exists(pdir)) throw new Error(`Profile not found: ${profile}`);
  const email = assertSafeAccountEmail(accountEmail);
  model = assertSafeModelName(model);
  const state = {
    version: 1,
    profile,
    mode: "flowaudit_managed_chatgpt",
    provider: "openai-codex",
    model,
    accountOwner: "FlowAudit",
    accountEmail: email,
    accountLabel: accountLabel ? String(accountLabel).trim().slice(0, 120) : null,
    auth: "profile_local_oauth",
    authStore: "auth.json",
    status: "pending_oauth",
    assignedAt: new Date().toISOString(),
    safety: "Passwords, OAuth tokens, and API keys are never stored here. Run rrd-agent-llm auth to complete browser OAuth.",
  };
  fs.writeFileSync(runtimeAssignmentPath(profile), JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  writeRuntimeConfig(profile, { model });
  return state;
}

export function codexAuthStatus(profile) {
  profile = assertSafeProfile(profile);
  const pdir = profileDir(profile);
  const authFile = authPath(profile);
  const cfgFile = configPath(profile);
  const out = {
    profile,
    profileDir: pdir,
    profileExists: exists(pdir),
    configExists: exists(cfgFile),
    configProviderPinned: false,
    accountAssigned: false,
    accountEmail: null,
    accountLabel: null,
    assignedAt: null,
    runtimeStatus: "pending_account",
    authExists: exists(authFile),
    authPresent: false,
    authSource: null,
    provider: "openai-codex",
    model: DEFAULT_MODEL,
    ok: false,
  };
  if (out.configExists) {
    const cfg = fs.readFileSync(cfgFile, "utf8");
    out.configProviderPinned = /provider:\s*openai-codex/.test(cfg);
    const modelMatch = cfg.match(/default:\s*([^\n#]+)/);
    if (modelMatch) out.model = modelMatch[1].trim();
  }
  const assignment = readRuntimeAssignment(profile);
  if (assignment?.accountEmail) {
    out.accountAssigned = true;
    out.accountEmail = assignment.accountEmail;
    out.accountLabel = assignment.accountLabel;
    out.assignedAt = assignment.assignedAt;
  }
  const auth = out.authExists ? readJsonSafe(authFile) : null;
  if (auth) {
    const singleton = auth.providers?.["openai-codex"];
    if (singleton && hasUsableTokenEntry(singleton)) {
      out.authPresent = true;
      out.authSource = "providers.openai-codex";
    }
    const pool = auth.credential_pool?.["openai-codex"];
    if (!out.authPresent && Array.isArray(pool) && pool.some(hasUsableTokenEntry)) {
      out.authPresent = true;
      out.authSource = "credential_pool.openai-codex";
    }
  }
  out.ok = !!(out.profileExists && out.configProviderPinned && out.accountAssigned && out.authPresent);
  out.runtimeStatus = out.ok ? "connected" : (out.accountAssigned ? "pending_oauth" : "pending_account");
  return out;
}

export function writeRuntimeConfig(profile, { model = DEFAULT_MODEL } = {}) {
  profile = assertSafeProfile(profile);
  model = assertSafeModelName(model);
  const pdir = profileDir(profile);
  if (!exists(pdir)) throw new Error(`Profile not found: ${profile}`);
  const file = configPath(profile);
  const body = [
    "# Generated by rrd-agent-llm for a client-isolated Revenue Recovery agent.",
    "# OAuth tokens are profile-local in auth.json and must never be copied into chat.",
    "model:",
    "  provider: openai-codex",
    `  default: ${model}`,
    "  openai_runtime: auto",
    "agent:",
    "  max_turns: 90",
    "terminal:",
    "  cwd: /Users/AIAgenterminal",
    "rrd:",
    "  llm_runtime:",
    "    mode: flowaudit_managed_chatgpt",
    "    provider: openai-codex",
    `    model: ${model}`,
    "    account_owner: FlowAudit",
    "    auth_store: auth.json",
    "    status: pending_oauth",
    "",
  ].join("\n");
  if (exists(file)) {
    const existing = fs.readFileSync(file, "utf8");
    if (existing !== body) fs.copyFileSync(file, file + ".bak");
  }
  fs.writeFileSync(file, body, "utf8");
  return file;
}

function printStatus(st) {
  console.log(JSON.stringify({
    ok: st.ok,
    profile: st.profile,
    provider: st.provider,
    model: st.model,
    accountAssigned: st.accountAssigned,
    accountEmail: st.accountEmail,
    accountLabel: st.accountLabel,
    assignedAt: st.assignedAt,
    runtimeStatus: st.runtimeStatus,
    profileExists: st.profileExists,
    configExists: st.configExists,
    configProviderPinned: st.configProviderPinned,
    authExists: st.authExists,
    authPresent: st.authPresent,
    authSource: st.authSource,
  }, null, 2));
}

function usage() {
  console.error(`Usage: rrd-agent-llm <command> <profile> [options]\n\nCommands:\n  init <profile>                         Write/pin config.yaml to openai-codex runtime\n  assign <profile> --account-email EMAIL Assign the FlowAudit-managed ChatGPT account email; stores no password/token\n  auth <profile>                         Run Hermes OAuth login in that profile only\n  status <profile>                       Safe status check; never prints tokens\n`);
}

async function main() {
  const [cmd, rawProfile, ...args] = process.argv.slice(2);
  if (!cmd || !rawProfile || !["init", "assign", "auth", "status"].includes(cmd)) { usage(); process.exit(1); }
  const profile = assertSafeProfile(rawProfile);
  if (cmd === "init") {
    const file = writeRuntimeConfig(profile);
    console.log(JSON.stringify({ ok: true, profile, wrote: file, provider: "openai-codex", model: DEFAULT_MODEL }, null, 2));
    return;
  }
  if (cmd === "status") {
    const st = codexAuthStatus(profile);
    printStatus(st);
    process.exit(st.ok ? 0 : 2);
  }
  if (cmd === "assign") {
    const accountEmail = parseFlag(args, "--account-email");
    const accountLabel = parseFlag(args, "--account-label") || null;
    const state = assignRuntimeAccount(profile, { accountEmail, accountLabel });
    console.log(JSON.stringify({
      ok: true,
      profile,
      accountEmail: state.accountEmail,
      accountLabel: state.accountLabel,
      provider: state.provider,
      model: state.model,
      runtimeStatus: state.status,
      next: `/Users/AIAgenterminal/rrd-agent-llm auth ${profile}`,
      safety: "No password/token stored. Complete OAuth in the browser/device flow for this profile.",
    }, null, 2));
    return;
  }
  if (cmd === "auth") {
    writeRuntimeConfig(profile);
    console.log(`Opening Hermes ChatGPT/Codex OAuth for ${profile}. Sign into the FlowAudit-managed ChatGPT account assigned to this client agent.`);
    const env = { ...process.env, HERMES_HOME: profileDir(profile), HOME: OPERATOR_HOME };
    const r = spawnSync("hermes", ["auth", "add", "openai-codex"], { stdio: "inherit", env });
    if (r.error) throw r.error;
    if (r.status !== 0) process.exit(r.status || 1);
    const st = codexAuthStatus(profile);
    printStatus(st);
    process.exit(st.ok ? 0 : 2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error("Error: " + (e && e.message || e)); process.exit(1); });
