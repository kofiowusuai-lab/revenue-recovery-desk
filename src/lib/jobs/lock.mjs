import crypto from 'node:crypto';

const DEFAULT_STALE_MS = 30 * 60 * 1000;

function nowMs(clock = Date) {
  return typeof clock.now === 'function' ? clock.now() : Date.now();
}

function iso(clock = Date) {
  return new Date(nowMs(clock)).toISOString();
}

export class MemoryJobLockStore {
  constructor({ clock = Date } = {}) {
    this.clock = clock;
    this.locks = new Map();
  }

  acquire(name, opts = {}) {
    const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
    const at = nowMs(this.clock);
    const existing = this.locks.get(name);
    if (existing && at - existing.acquiredAtMs <= staleMs) {
      return { acquired: false, reason: 'active', lock: { ...existing } };
    }
    const lock = {
      name,
      token: opts.token || crypto.randomUUID(),
      owner: opts.owner || `pid:${process.pid}`,
      acquiredAt: iso(this.clock),
      acquiredAtMs: at,
      staleMs,
    };
    this.locks.set(name, lock);
    return { acquired: true, lock: { ...lock } };
  }

  release(name, token) {
    const existing = this.locks.get(name);
    if (!existing || existing.token !== token) return false;
    this.locks.delete(name);
    return true;
  }

  get(name) {
    const lock = this.locks.get(name);
    return lock ? { ...lock } : null;
  }
}

export function createMemoryJobLockStore(opts) {
  return new MemoryJobLockStore(opts);
}

export function createJobLocker({ store = createMemoryJobLockStore(), clock = Date } = {}) {
  return {
    store,
    async acquire(name, opts = {}) {
      return store.acquire(name, { ...opts, clock });
    },
    async release(lockOrName, token) {
      const name = typeof lockOrName === 'string' ? lockOrName : lockOrName?.name;
      const tok = token || lockOrName?.token;
      if (!name || !tok) return false;
      return store.release(name, tok);
    },
    async withLock(name, fn, opts = {}) {
      const res = await store.acquire(name, opts);
      if (!res.acquired) return { skipped: true, reason: res.reason || 'lock-not-acquired', lock: res.lock };
      try {
        return await fn(res.lock);
      } finally {
        store.release(name, res.lock.token);
      }
    },
  };
}

export function buildAcquireJobLockSql({ table = 'job_locks' } = {}) {
  return {
    text: `insert into ${table} (lock_key, owner, locked_until, acquired_at, heartbeat_at, metadata)\nvalues ($1, $2, now() + ($3::bigint * interval '1 millisecond'), now(), now(), jsonb_build_object('token', $4::text))\non conflict (lock_key) do update\nset owner = excluded.owner, locked_until = excluded.locked_until, acquired_at = excluded.acquired_at, heartbeat_at = excluded.heartbeat_at, metadata = excluded.metadata\nwhere ${table}.locked_until < now()\nreturning lock_key, owner, locked_until, acquired_at, heartbeat_at, metadata->>'token' as token`,
    values: ['lock_key', 'owner', 'staleMs', 'token'],
  };
}

export function buildReleaseJobLockSql({ table = 'job_locks' } = {}) {
  return {
    text: `delete from ${table} where lock_key = $1 and metadata->>'token' = $2 returning lock_key`,
    values: ['lock_key', 'token'],
  };
}

export const DEFAULT_JOB_LOCK_STALE_MS = DEFAULT_STALE_MS;
