/**
 * rrd-guardrails.mjs — deterministic, dependency-free safety enforcement for
 * launched recovery agents. This is the CODE layer that backs the prompt-level
 * rules in SOUL.md: the same rules, but enforced in the send path so a steered
 * or jailbroken model cannot bypass them.
 *
 * Pure functions, no I/O, Node 18+. Import from the recovery skill's send path
 * and from any guardrail monitor. Fail-closed: when a limit can't be parsed we
 * choose the safest interpretation (no discount, approval required).
 */

/* ---------- parsing (client free-text guardrails -> structured policy) ---------- */
function parseIntOr(v, dflt) { const n = parseInt(String(v == null ? "" : v).replace(/[^0-9-]/g, ""), 10); return Number.isFinite(n) ? n : dflt; }

// "Acme Ltd, john@x.com; 555-1234\nbad-domain.com" -> normalized tokens
export function parseList(text) {
  return String(text || "")
    .split(/[,;\n]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    .filter((s) => !/^(none|n\/?a|nil|-)$/.test(s));
}

// "no discount" -> {type:"none"}; "10%" -> {type:"pct",value:10}; "$50"/"50" -> {type:"amount",value:50}
export function parseDiscount(text) {
  const s = String(text || "").trim().toLowerCase();
  if (!s || /\b(no|none|0)\b/.test(s) && !/\d/.test(s.replace(/0/g, ""))) return { type: "none", value: 0 };
  const pct = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) return { type: "pct", value: parseFloat(pct[1]) };
  const amt = s.match(/\$?\s*(\d+(?:\.\d+)?)/);
  if (amt) return { type: "amount", value: parseFloat(amt[1]) };
  return { type: "none", value: 0 }; // fail-closed: unparseable cap => no discount allowed
}

// "9-17" / "09:00-17:00" / "9am-5pm" -> {start:9,end:17}; unparseable -> null
export function parseHours(text) {
  const s = String(text || "").toLowerCase();
  const m = s.match(/(\d{1,2})(?::\d{2})?\s*(am|pm)?\s*[-–to]+\s*(\d{1,2})(?::\d{2})?\s*(am|pm)?/);
  if (!m) return null;
  const to24 = (h, ap) => { h = parseInt(h, 10); if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; return h; };
  const start = to24(m[1], m[2]), end = to24(m[3], m[4]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
}

/* ---------- policy: single structured source of truth, derived from the record ---------- */
export function buildPolicy(rec) {
  const g = rec.guardrails || {}, out = rec.outreach || {}, rp = rec.recoveryProcess || {};
  const allChannels = (out.channels && out.channels.length) ? out.channels : (rp.channels || []);
  return {
    company: rec.company || null,
    consent: !!rec.consent,
    allowedChannels: allChannels,
    autoSendChannels: (g.autoSendChannels || []).filter(Boolean),
    approvalModel: g.approvalModel || "approve every message",
    batchSize: parseIntOr(g.batchSize, null),
    doNotContact: parseList(g.doNotContact),
    discountCap: parseDiscount(g.maxDiscount),
    sendingHours: parseHours(out.businessHours),
    timezone: out.timezone || null,
    escalationTriggers: g.escalationTriggers || ""
  };
}

/* ---------- matchers ---------- */
function identifiers(to) {
  const t = to || {};
  const out = [];
  if (t.email) { const e = String(t.email).toLowerCase(); out.push(e); const at = e.split("@")[1]; if (at) out.push(at); }
  if (t.domain) out.push(String(t.domain).toLowerCase());
  if (t.name) out.push(String(t.name).toLowerCase());
  if (t.company) out.push(String(t.company).toLowerCase());
  if (t.phone) out.push(String(t.phone).replace(/[^0-9]/g, ""));
  return out.filter(Boolean);
}
export function matchesDoNotContact(to, dncTokens) {
  const ids = identifiers(to);
  return (dncTokens || []).some((tok) => {
    const tdigits = tok.replace(/[^0-9]/g, "");
    return ids.some((id) => {
      if (/^[0-9]+$/.test(id) && tdigits.length >= 7) return id.includes(tdigits) || tdigits.includes(id);
      return id === tok || id.includes(tok) || tok.includes(id);
    });
  });
}
function exceedsDiscount(discount, cap) {
  if (!discount) return false;
  const d = { type: discount.type || "amount", value: Number(discount.value) || 0 };
  if (cap.type === "none") return d.value > 0;
  if (cap.type === d.type) return d.value > cap.value;
  // mixed units (e.g. pct vs amount): can't compare safely -> fail-closed, require human
  return d.value > 0;
}
function withinHours(hour, win) {
  if (!win) return true;
  if (win.start <= win.end) return hour >= win.start && hour < win.end;
  return hour >= win.start || hour < win.end; // overnight window
}

/* ---------- the gate: evaluate one outbound action against the policy ---------- */
/**
 * action = {
 *   channel, to:{email,phone,name,company,domain},
 *   discount?:{type:"pct"|"amount",value}, approved?:bool,
 *   threadFlags?:{customerReplied,disputed,askedToStop,distressed},
 *   batchIndex?:number, atHour?:number    // atHour = 0..23 in the client's timezone
 * }
 */
export function evaluateSend(action, policy) {
  const v = [];
  const add = (code, msg) => v.push({ code, msg });
  const a = action || {};

  if (!policy.consent) add("NO_CONSENT", "client consent to contact customers is not on file");

  if (a.channel && policy.allowedChannels.length && !policy.allowedChannels.includes(a.channel))
    add("CHANNEL_NOT_ALLOWED", `channel "${a.channel}" is not one the client authorized (${policy.allowedChannels.join(", ") || "none"})`);

  const autoOk = policy.autoSendChannels.includes(a.channel);
  if (!autoOk && !a.approved)
    add("APPROVAL_REQUIRED", `channel "${a.channel || "?"}" is approval-gated; no human approval recorded`);

  const tf = a.threadFlags || {};
  if (tf.customerReplied || tf.disputed || tf.askedToStop || tf.distressed)
    add("STOP_AND_ESCALATE", "customer replied/disputed/asked-to-stop/distressed — stop the thread and escalate to a human");

  if (matchesDoNotContact(a.to, policy.doNotContact))
    add("DO_NOT_CONTACT", "recipient matches the client's do-not-contact list");

  if (a.discount && exceedsDiscount(a.discount, policy.discountCap))
    add("DISCOUNT_OVER_CAP", `offered discount exceeds the cap (${policy.discountCap.type}:${policy.discountCap.value})`);

  if (policy.sendingHours && a.atHour != null && !withinHours(a.atHour, policy.sendingHours))
    add("OUTSIDE_HOURS", `outside the client's sending hours (${policy.sendingHours.start}:00–${policy.sendingHours.end}:00)`);

  if (policy.batchSize != null && a.batchIndex != null && a.batchIndex >= policy.batchSize)
    add("BATCH_EXCEEDED", `batch size cap of ${policy.batchSize} exceeded`);

  const HUMAN = new Set(["STOP_AND_ESCALATE", "DO_NOT_CONTACT", "DISCOUNT_OVER_CAP", "NO_CONSENT"]);
  return { allowed: v.length === 0, violations: v, requiresHuman: v.some((x) => HUMAN.has(x.code)) };
}

/* ---------- spend / volume caps (enforced in code, per client) ---------- */
// usage/caps: { sendsToday, lettersToday, desktopMinutesToday, spendTodayUsd }
export function enforceCaps(usage, caps) {
  const u = usage || {}, c = caps || {};
  const v = [];
  const chk = (key, label) => { if (c[key] != null && (u[key] || 0) >= c[key]) v.push({ code: "CAP_" + key.toUpperCase(), msg: `${label} cap reached (${c[key]})` }); };
  chk("sendsToday", "daily sends");
  chk("lettersToday", "daily letters");
  chk("desktopMinutesToday", "daily desktop minutes");
  chk("spendTodayUsd", "daily spend");
  return { allowed: v.length === 0, violations: v };
}

/* ---------- tool allowlist (containment) ---------- */
export function actionAllowed(tool, allowlist) {
  if (!allowlist || !allowlist.length) return false; // fail-closed: no allowlist => nothing allowed
  return allowlist.includes(tool);
}

/* ---------- audit record (append-only; caller persists the returned object) ---------- */
export function auditEntry({ profile, actor, kind, action, decision, at }) {
  return {
    at: at || new Date().toISOString(),
    profile: profile || null,
    actor: actor || "agent",
    kind: kind || "send",
    channel: (action && action.channel) || null,
    to: action && action.to ? { email: action.to.email || null, name: action.to.name || null } : null,
    allowed: !!(decision && decision.allowed),
    requiresHuman: !!(decision && decision.requiresHuman),
    violations: (decision && decision.violations) ? decision.violations.map((x) => x.code) : []
  };
}

export const VIOLATION_CODES = [
  "NO_CONSENT", "CHANNEL_NOT_ALLOWED", "APPROVAL_REQUIRED", "STOP_AND_ESCALATE",
  "DO_NOT_CONTACT", "DISCOUNT_OVER_CAP", "OUTSIDE_HOURS", "BATCH_EXCEEDED"
];
