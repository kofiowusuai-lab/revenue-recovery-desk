import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const WEB = path.resolve('revenue-recovery-web');
function html(name) { return fs.readFileSync(path.join(WEB, name), 'utf8'); }

test('post-onboarding forms use signed token instead of sid/company/email query fields', () => {
  for (const name of ['readiness.html', 'sop-review.html', 'mapping.html']) {
    const s = html(name);
    assert.match(s, /q\.get\('token'\)/, `${name} reads token`);
    assert.doesNotMatch(s, /q\.get\('sid'\)|q\.get\('company'\)|q\.get\('email'\)/, `${name} must not read unsigned locked params`);
    assert.doesNotMatch(s, /sourceSubmissionId:lock\.sid|lockedCompany:lock\.company|lockedBillingEmail:lock\.email/, `${name} must not submit unsigned lock fields`);
  }
});

test('readiness page has only one intake path and no stale direct Supabase insert script', () => {
  const s = html('readiness.html');
  assert.equal((s.match(/addEventListener\('submit'/g) || []).length, 1);
  assert.doesNotMatch(s, /SUPABASE_ANON_KEY|window\.supabase|sb\.from\('submissions'\)\.insert/);
});

test('offboarding page submits through api intake with token and no Supabase anon insert', () => {
  const s = html('offboard.html');
  assert.match(s, /PARAMS\.get\('token'\)/);
  assert.match(s, /fetch\(intakeUrl\(\)/);
  assert.match(s, /type:'offboarding'/);
  assert.doesNotMatch(s, /SUPABASE_ANON_KEY|window\.supabase|sb\.from\('submissions'\)\.insert/);
  assert.doesNotMatch(s, /PARAMS\.get\('sid'\)|PARAMS\.get\('company'\)|PARAMS\.get\('email'\)/);
});
