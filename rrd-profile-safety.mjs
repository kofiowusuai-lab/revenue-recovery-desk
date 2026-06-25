export const SAFE_PROFILE_RE = /^rr-[A-Za-z0-9_.-]+$/;

export function assertSafeProfile(profile, label = 'profile') {
  const value = String(profile || '').trim();
  if (!SAFE_PROFILE_RE.test(value) || value.includes('..') || value.includes('/') || value.includes('\\')) {
    throw new Error(`Unsafe ${label}: expected rr-[A-Za-z0-9_.-]+ without path separators`);
  }
  return value;
}

export function safeStateName(name, label = 'state name') {
  const value = String(name || '').trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(value) || value.includes('..') || value.includes('/') || value.includes('\\')) {
    throw new Error(`Unsafe ${label}: path separators are not allowed`);
  }
  return value;
}
