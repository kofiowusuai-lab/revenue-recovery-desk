import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { signClientActionToken } = require('../revenue-recovery-web/api/client-action-token.js');
const intake = require('../revenue-recovery-web/api/intake.js');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    end() { return this; },
  };
}

function installFetch({ source = { id: 'sub_123', company: 'Acme Ltd', email: 'billing@example.com' } } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('id=eq.sub_123')) return { ok: true, text: async () => JSON.stringify([source]) };
    if (String(url).includes('/rest/v1/submissions') && init.method === 'POST') return { ok: true, text: async () => JSON.stringify([{ id: 'inserted_1' }]) };
    return { ok: false, status: 404, text: async () => JSON.stringify({ message: 'not found' }) };
  };
  return calls;
}

test('intake rejects forged special form without signed token', async () => {
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-secret';
  process.env.RRD_CLIENT_ACTION_TOKEN_SECRET = 'token-secret';
  installFetch();
  const res = mockRes();
  await intake({ method: 'POST', body: { type: 'readiness_details', payload: { sourceSubmissionId: 'sub_123', lockedCompany: 'Acme Ltd', lockedBillingEmail: 'billing@example.com' } } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /signed/);
});

test('intake accepts signed readiness token and server-locks company/email from source row', async () => {
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-secret';
  process.env.RRD_CLIENT_ACTION_TOKEN_SECRET = 'token-secret';
  const calls = installFetch();
  const token = signClientActionToken({ sid: 'sub_123', email: 'billing@example.com', company: 'Acme Ltd', action: 'readiness_details' });
  const res = mockRes();
  await intake({ method: 'POST', body: { type: 'readiness_details', payload: { token, lockedCompany: 'Mallory Co', lockedBillingEmail: 'mallory@example.com', outreach: { timezone: 'UTC' } } } }, res);
  assert.equal(res.statusCode, 200);
  const post = calls.find(c => c.init.method === 'POST');
  const row = JSON.parse(post.init.body);
  assert.equal(row.company, 'Acme Ltd');
  assert.equal(row.email, 'billing@example.com');
  assert.equal(row.business_profile.sourceSubmissionId, 'sub_123');
});

test('intake rejects signed token whose email does not match source row', async () => {
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-secret';
  process.env.RRD_CLIENT_ACTION_TOKEN_SECRET = 'token-secret';
  installFetch();
  const token = signClientActionToken({ sid: 'sub_123', email: 'wrong@example.com', company: 'Acme Ltd', action: 'mapping_details' });
  const res = mockRes();
  await intake({ method: 'POST', body: { type: 'mapping_details', payload: { token } } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /does not match/);
});
