import crypto from 'node:crypto';

function stable(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stable);
  return Object.keys(value).sort().reduce((out, key) => {
    const v = value[key];
    if (v !== undefined) out[key] = stable(v);
    return out;
  }, {});
}

export function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

export function actionKey(input, { prefix = 'rrd', length = 32 } = {}) {
  const payload = canonicalJson(input || {});
  const digest = crypto.createHash('sha256').update(payload).digest('hex');
  return `${prefix}_${digest.slice(0, length)}`;
}

export function recoveryActionKey({ profile, invoiceId, customerId, channel, rung, dueDate, amount, currency, action = 'recover' } = {}, opts = {}) {
  return actionKey({ profile, invoiceId, customerId, channel, rung, dueDate, amount, currency, action }, opts);
}

export function idempotencyRecord(key, extra = {}) {
  return { key, createdAt: new Date().toISOString(), ...extra };
}
