import { all, get, run } from '../db/index.js';
import { now } from '../lib/util.js';

/** Settings are stored as JSON strings; keys are dotted namespaces. */
export function getSetting<T = any>(key: string, fallback?: T): T {
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  if (!row) return fallback as T;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback as T;
  }
}

export function setSetting(key: string, value: unknown): void {
  const json = JSON.stringify(value ?? null);
  const existing = get('SELECT key FROM settings WHERE key = ?', key);
  if (existing) run('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?', json, now(), key);
  else run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', key, json, now());
}

export function getAllSettings(): Record<string, unknown> {
  const rows = all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out;
}

/** Keys whose values must never leave the server (API secrets). */
const SECRET_KEYS = ['llm.apiKey', 'youtube.clientSecret', 'youtube.accessToken', 'youtube.refreshToken'];

/** The presence mask returned to clients; writing it back must be a no-op. */
export const SECRET_MASK = '••••••••';

export function isSecretSetting(key: string): boolean {
  return SECRET_KEYS.includes(key);
}

/** Settings payload for the client — secrets replaced with a presence mask. */
export function publicSettings(): Record<string, unknown> {
  const all = getAllSettings();
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(all)) {
    out[k] = isSecretSetting(k) ? (typeof val === 'string' && val ? '••••••••' : '') : val;
  }
  return out;
}
