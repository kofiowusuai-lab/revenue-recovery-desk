import fs from 'node:fs';
import path from 'node:path';

export function quarantineCorruptFile(file) {
  const target = `${file}.corrupt.${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.renameSync(file, target);
  return target;
}

export function loadJsonState(file, fallback, label = 'state') {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e?.code === 'ENOENT') return typeof fallback === 'function' ? fallback() : structuredClone(fallback);
    const quarantine = quarantineCorruptFile(file);
    throw new Error(`${label} is corrupt at ${file}; quarantined to ${quarantine}. Side-effect run is blocked until reviewed.`);
  }
}

export function writeJsonState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  fs.chmodSync(file, 0o600);
}
