import crypto from 'node:crypto';

export const CLIENT_ACTION_TOKEN_TTL_SECONDS=60 * 60 * 24 * 30;

export function tokenSecret(env = process.env) {
  return env.RRD_CLIENT_ACTION_TOKEN_SECRET || env.RRD_GO_LIVE_TOKEN_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY || '';
}

export function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function cleanAction(action) {
  const a = String(action || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,80}$/.test(a)) throw new Error('Invalid client action.');
  return a;
}

function cleanEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function signClientActionToken({ sid, email, company = '', action, exp = null, now = Date.now() } = {}, env = process.env) {
  const secret = tokenSecret(env);
  if (!secret) throw new Error('Missing client action token signing secret.');
  const payload = {
    sid: String(sid || '').trim(),
    email: cleanEmail(email),
    company: String(company || '').trim(),
    action: cleanAction(action),
    exp: Number(exp || Math.floor(now / 1000) + CLIENT_ACTION_TOKEN_TTL_SECONDS),
  };
  if (!payload.sid || !payload.email) throw new Error('Missing client action token subject.');
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifyClientActionToken(token, { action = null, now = Date.now() } = {}, env = process.env) {
  const secret = tokenSecret(env);
  if (!secret) throw new Error('Server is missing token configuration.');
  const [payloadB64, sig] = String(token || '').split('.');
  if (!payloadB64 || !sig) throw new Error('Invalid or expired link.');
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  if (Buffer.byteLength(sig) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('Invalid or expired link.');
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')); }
  catch { throw new Error('Invalid or expired link.'); }
  if (!payload.sid || !payload.email || !payload.action) throw new Error('Invalid client action link.');
  if (Number(payload.exp || 0) && now > Number(payload.exp) * 1000) throw new Error('This client action link has expired. Please ask support for a fresh link.');
  if (action && cleanAction(action) !== String(payload.action || '').toLowerCase()) throw new Error('This link is not valid for that action.');
  return { ...payload, email: cleanEmail(payload.email), action: cleanAction(payload.action) };
}

export function signedClientActionUrl(path, client, action, { base = '', now = Date.now(), env = process.env } = {}) {
  const cleanPath = String(path || '').replace(/^\//, '');
  const root = String(base || '').replace(/\/+$/, '');
  if (!root) throw new Error('Missing public web base for client action URL.');
  const token = signClientActionToken({ sid: client?.id, email: client?.email, company: client?.company, action, now }, env);
  return `${root}/${cleanPath}?token=${encodeURIComponent(token)}`;
}
