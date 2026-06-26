import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const promptsDir = path.join(repoRoot, "agents", "prompts");
const workflowsDir = path.join(repoRoot, "agents", "workflows");

const requiredPrompts = [
  "recoverydesk-manager.md",
  "onboarding-agent.md",
  "provisioning-agent.md",
  "integration-agent.md",
  "mapping-agent.md",
  "invoice-sync-agent.md",
  "contact-match-agent.md",
  "recovery-planner-agent.md",
  "message-drafting-agent.md",
  "approval-agent.md",
  "dispatch-agent.md",
  "reply-triage-agent.md",
  "payment-reconciliation-agent.md",
  "escalation-agent.md",
  "client-success-agent.md",
  "health-watch-agent.md",
  "compliance-qa-agent.md",
];

const requiredSections = ["## Mission", "## Inputs", "## Outputs", "## Forbidden actions", "## Safety boundary"];
const requiredSafetyPhrases = [
  /No direct send/i,
  /rrd-recover/i,
  /rrd-recover send/i,
  /gated executor/i,
  /Do not print secrets/i,
  /Do not bypass/i,
];

test("all completion brief specialist prompt files exist", () => {
  for (const file of requiredPrompts) {
    assert.equal(fs.existsSync(path.join(promptsDir, file)), true, `${file} should exist`);
  }
});

test("specialist prompts contain required structure and safety boundaries", () => {
  for (const file of requiredPrompts) {
    const body = fs.readFileSync(path.join(promptsDir, file), "utf8");
    for (const section of requiredSections) {
      assert.match(body, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${file} missing ${section}`);
    }
    for (const phrase of requiredSafetyPhrases) {
      assert.match(body, phrase, `${file} missing safety phrase ${phrase}`);
    }
    assert.doesNotMatch(body, /directly send|send directly to provider|provider\.send\(/i, `${file} should not authorize direct sends`);
  }
});

test("workflow manifest maps cron jobs to roles and preserves rrd-recover send gate", () => {
  const manifestPath = path.join(workflowsDir, "cron-role-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.match(manifest.invariant, /rrd-recover gate\/send/i);
  const jobs = new Map(manifest.jobs.map((entry) => [entry.job, entry]));
  for (const job of [
    "cron:send-dispatcher",
    "cron:reply-monitor",
    "cron:health-watch",
    "cron:readiness-watch",
    "cron:approval-reminder",
    "cron:invoice-sync",
    "cron:payment-reconcile",
    "cron:orgo-idle-stop",
    "cron:recovery-planner",
    "cron:escalation-review",
    "cron:weekly-report",
  ]) {
    assert.equal(jobs.has(job), true, `${job} should be mapped`);
    assert.ok(Array.isArray(jobs.get(job).roles) && jobs.get(job).roles.length > 0, `${job} should have roles`);
    assert.match(jobs.get(job).gate, /no direct send|rrd-recover|no send|customer-facing send|draft\/queue|do not send/i, `${job} should declare a gate rule`);
  }
  assert.match(jobs.get("cron:send-dispatcher").gate, /rrd-recover.*rrd-recover send/i);
});

test("operations docs exist and reference the completion brief safety model", () => {
  for (const file of ["ARCHITECTURE.md", "OPERATIONS.md", "SECURITY.md", "CLIENT_EXPERIENCE.md", "RECOVERY_POLICY.md"]) {
    const body = fs.readFileSync(path.join(repoRoot, "docs", file), "utf8");
    assert.match(body, /COMPLETION_BRIEF\.md/, `${file} should reference completion brief`);
    assert.match(body, /rrd-recover|gated executor/i, `${file} should mention gate`);
  }
});
