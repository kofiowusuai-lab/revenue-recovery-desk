import test from 'node:test';
import assert from 'node:assert/strict';
import { signClientActionToken, verifyClientActionToken, signedClientActionUrl } from '../rrd-client-action-token.mjs';

test('client action token round-trips and normalizes action/email', () => {
  const env = { RRD_CLIENT_ACTION_TOKEN_SECRET: 'unit-test-secret' };
  const token = signClientActionToken({ sid: 'sub_123', email: 'BILLING@Example.COM', company: 'Acme', action: 'Readiness', now: 1_700_000_000_000 }, env);
  const payload = verifyClientActionToken(token, { action: 'readiness', now: 1_700_000_001_000 }, env);
  assert.equal(payload.sid, 'sub_123');
  assert.equal(payload.email, 'billing@example.com');
  assert.equal(payload.company, 'Acme');
  assert.equal(payload.action, 'readiness');
});

test('client action token rejects tampering, wrong action, and expiry', () => {
  const env = { RRD_CLIENT_ACTION_TOKEN_SECRET: 'unit-test-secret' };
  const token = signClientActionToken({ sid: 'sub_123', email: 'billing@example.com', action: 'offboard', exp: 100 }, env);
  assert.throws(() => verifyClientActionToken(token.replace(/.$/, 'x'), { action: 'offboard', now: 1_000 }, env), /Invalid or expired/);
  assert.throws(() => verifyClientActionToken(token, { action: 'readiness', now: 1_000 }, env), /not valid/);
  assert.throws(() => verifyClientActionToken(token, { action: 'offboard', now: 101_000 }, env), /expired/);
});

test('signedClientActionUrl emits token-only client links', () => {
  const env = { RRD_CLIENT_ACTION_TOKEN_SECRET: 'unit-test-secret' };
  const url = signedClientActionUrl('readiness', { id: 'sub_123', email: 'billing@example.com', company: 'Acme' }, 'readiness', { base: 'https://example.test/revenue-recovery', env, now: 1_700_000_000_000 });
  const u = new URL(url);
  assert.equal(u.pathname, '/revenue-recovery/readiness');
  assert.ok(u.searchParams.get('token'));
  assert.equal(u.searchParams.get('sid'), null);
  assert.equal(u.searchParams.get('email'), null);
});
