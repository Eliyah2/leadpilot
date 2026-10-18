import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Project root (parent of /server). */
export const ROOT = path.resolve(import.meta.dirname, '..');

/** Load .env (without overriding real env vars). */
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (!m) continue;
    const key = m[1];
    let val = m[2].replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

const STORAGE = path.resolve(ROOT, process.env.STORAGE_DIR || 'storage');

function ensure(p: string) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/** Persistent server secret used for session/OAuth token encryption. */
function loadSecret(): string {
  if (process.env.SF_SECRET && process.env.SF_SECRET.length >= 16) {
    return process.env.SF_SECRET;
  }
  const file = path.join(STORAGE, '.secret');
  if (fs.existsSync(file)) {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 16) return s;
  }
  const s = crypto.randomBytes(32).toString('base64url');
  ensure(STORAGE);
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

export const CONFIG = {
  ROOT,
  STORAGE,
  DB_FILE: path.join(STORAGE, process.env.DB_FILE || 'shortforge.db'),
  DIRS: {
    assets: ensure(path.join(STORAGE, 'assets')),
    audio: ensure(path.join(STORAGE, 'audio')),
    video: ensure(path.join(STORAGE, 'video')),
    covers: ensure(path.join(STORAGE, 'covers')),
    subs: ensure(path.join(STORAGE, 'subs')),
    exports: ensure(path.join(STORAGE, 'exports')),
    tmp: ensure(path.join(STORAGE, 'tmp')),
    fonts: ensure(path.join(STORAGE, 'fonts')),
    cache: ensure(path.join(STORAGE, 'cache')),
    logs: ensure(path.join(STORAGE, 'logs')),
  },
  PORT: resolvePort(),
  HOST: process.env.HOST || '127.0.0.1',
  NODE_ENV: process.env.NODE_ENV || 'development',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  SECRET: loadSecret(),
  SESSION_TTL_DAYS: Number(process.env.SESSION_TTL_DAYS || 30),
  MAX_UPLOAD_BYTES: Number(process.env.MAX_UPLOAD_BYTES || 80 * 1024 * 1024),
  JOB_CONCURRENCY: Number(process.env.JOB_CONCURRENCY || 2),
  PUBLIC_URL: process.env.PUBLIC_URL || '',
  /** Set to "1" to allow tests to run external network calls. */
  ALLOW_NETWORK: process.env.SF_ALLOW_NETWORK === '1',
};

export type Config = typeof CONFIG;

/**
 * Port resolution: SF_PORT wins; PORT is only honoured when it is a real
 * positive port (hosting shells sometimes export PORT=0).
 */
function resolvePort(): number {
  const sf = Number(process.env.SF_PORT);
  if (Number.isInteger(sf) && sf > 0 && sf < 65536) return sf;
  const fromEnv = Number(process.env.PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536) return fromEnv;
  return 4400;
}
