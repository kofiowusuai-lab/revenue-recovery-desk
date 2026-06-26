import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_STATUSES,
  APPROVAL_STATUSES,
  CLIENT_STATUSES,
  INTEGRATION_STATUSES,
  INVOICE_STATUSES,
  REPLY_CLASSIFICATIONS,
  THREAD_STAGES,
  THREAD_STATUSES,
  assertTransition,
  assertValidStatus,
  canTransition,
  getAllowedValues,
  isValidStatus,
} from '../src/lib/client-state/rrd-status.mjs';

const expectedGroups = {
  client: CLIENT_STATUSES,
  integration: INTEGRATION_STATUSES,
  invoice: INVOICE_STATUSES,
  thread: THREAD_STATUSES,
  threadStage: THREAD_STAGES,
  action: ACTION_STATUSES,
  approval: APPROVAL_STATUSES,
  replyClassification: REPLY_CLASSIFICATIONS,
};

test('RRD state constants expose required values', () => {
  assert.deepEqual(CLIENT_STATUSES, ['submitted', 'provisioning', 'awaiting_client', 'readiness_blocked', 'ready', 'live', 'paused', 'offboarding', 'offboarded']);
  assert.ok(INTEGRATION_STATUSES.includes('revoked'));
  assert.ok(INVOICE_STATUSES.includes('do_not_contact'));
  assert.ok(THREAD_STATUSES.includes('awaiting_approval'));
  assert.ok(THREAD_STAGES.includes('final_notice'));
  assert.ok(ACTION_STATUSES.includes('queued_for_approval'));
  assert.ok(APPROVAL_STATUSES.includes('edited'));
  assert.ok(REPLY_CLASSIFICATIONS.includes('stop_contact'));
});

test('status validation accepts only canonical values', () => {
  for (const [group, values] of Object.entries(expectedGroups)) {
    for (const value of values) {
      assert.equal(isValidStatus(group, value), true, `${group}:${value}`);
      assert.equal(assertValidStatus(group, value), value);
    }
    assert.deepEqual(getAllowedValues(group), [...values]);
    assert.equal(isValidStatus(group, 'sent_directly_without_gate'), false);
    assert.throws(() => assertValidStatus(group, 'sent_directly_without_gate'), /Invalid/);
  }
  assert.throws(() => getAllowedValues('missing'), /Unknown/);
});

test('client transitions support onboarding/live/offboarding paths and reject unsafe jumps', () => {
  assert.equal(canTransition('client', 'submitted', 'provisioning'), true);
  assert.equal(canTransition('client', 'ready', 'live'), true);
  assert.equal(canTransition('client', 'live', 'paused'), true);
  assert.equal(canTransition('client', 'offboarding', 'offboarded'), true);
  assert.equal(canTransition('client', 'submitted', 'live'), false);
  assert.equal(canTransition('client', 'offboarded', 'live'), false);
  assert.throws(() => assertTransition('client', 'submitted', 'live'), /Invalid client transition/);
});

test('integration and invoice transitions model recovery safety stops', () => {
  assert.equal(canTransition('integration', 'needed', 'link_sent'), true);
  assert.equal(canTransition('integration', 'authorized', 'installed'), true);
  assert.equal(canTransition('integration', 'installed', 'revoked'), true);
  assert.equal(canTransition('integration', 'revoked', 'installed'), false);

  assert.equal(canTransition('invoice', 'overdue', 'in_recovery'), true);
  assert.equal(canTransition('invoice', 'in_recovery', 'disputed'), true);
  assert.equal(canTransition('invoice', 'in_recovery', 'do_not_contact'), true);
  assert.equal(canTransition('invoice', 'in_recovery', 'paid'), true);
  assert.equal(canTransition('invoice', 'paid', 'in_recovery'), false);
});

test('thread/action/approval transitions prevent post-terminal sends', () => {
  assert.equal(canTransition('thread', 'new', 'drafting'), true);
  assert.equal(canTransition('thread', 'awaiting_approval', 'scheduled'), true);
  assert.equal(canTransition('thread', 'sent', 'replied'), true);
  assert.equal(canTransition('thread', 'paid', 'scheduled'), false);
  assert.equal(canTransition('thread', 'closed', 'scheduled'), false);

  assert.equal(canTransition('action', 'drafted', 'queued_for_approval'), true);
  assert.equal(canTransition('action', 'approved', 'scheduled'), true);
  assert.equal(canTransition('action', 'scheduled', 'sent'), true);
  assert.equal(canTransition('action', 'sent', 'scheduled'), false);
  assert.equal(canTransition('action', 'rejected', 'scheduled'), false);

  assert.equal(canTransition('approval', 'pending', 'edited'), true);
  assert.equal(canTransition('approval', 'edited', 'approved'), true);
  assert.equal(canTransition('approval', 'approved', 'pending'), false);
});
