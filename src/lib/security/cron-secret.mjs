import crypto from 'node:crypto';

function buf(v) {
  return Buffer.from(String(v || ''), 'utf8');
}

export function verifyCronSecret({ provided, env = process.env, secretEnvName = 'RRD_CRON_SECRET' } = {}) {
  const expected = env[secretEnvName];
  if (!expected) return { ok: false, reason: 'missing-expected-secret' };
  if (!provided) return { ok: false, reason: 'missing-provided-secret' };
  const a = buf(expected);
  const b = buf(provided);
  if (a.length !== b.length) return { ok: false, reason: 'secret-mismatch' };
  return { ok: crypto.timingSafeEqual(a, b), reason: crypto.timingSafeEqual(a, b) ? null : 'secret-mismatch' };
}

export function assertCronSecret(args = {}) {
  const result = verifyCronSecret(args);
  if (!result.ok) {
    const err = new Error(`Cron secret check failed: ${result.reason}`);
    err.code = 'RRD_CRON_SECRET_FAILED';
    err.reason = result.reason;
    throw err;
  }
  return true;
}

export function providedCronSecretFromRequest(req) {
  if (!req) return null;
  if (req.headers?.get) return req.headers.get('x-rrd-cron-secret') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || null;
  const h = req.headers || {};
  return h['x-rrd-cron-secret'] || h['X-RRD-Cron-Secret'] || String(h.authorization || '').replace(/^Bearer\s+/i, '') || null;
}
