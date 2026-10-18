/**
 * Authentication & security middleware.
 *   - sessions: random token stored as HMAC in an httpOnly, SameSite=Lax cookie
 *   - CSRF: mutating requests must echo the session CSRF token in a header
 *   - rate limiting: in-memory sliding window per IP + bucket
 *   - security headers on every response
 */
import type { Request, Response, NextFunction } from 'express';
import { get, run } from '../db/index.js';
import { randomToken, hashToken } from '../lib/crypto.js';
import { id, now } from '../lib/util.js';
import { CONFIG } from '../config.js';
import { HttpError } from '../lib/validate.js';

export type AuthUser = { id: string; email: string; name: string; role: string; locale: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
      csrfToken?: string;
    }
  }
}

const COOKIE = 'sf_session';

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function createSession(userId: string, req: Request): { token: string; csrf: string; expiresAt: number } {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const expiresAt = now() + CONFIG.SESSION_TTL_DAYS * 86400000;
  run(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_token, ip, user_agent, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id('ses'),
    userId,
    hashToken(token),
    csrf,
    (req.ip ?? '').slice(0, 64),
    String(req.headers['user-agent'] ?? '').slice(0, 200),
    now(),
    expiresAt,
  );
  return { token, csrf, expiresAt };
}

export function setSessionCookie(res: Response, token: string, expiresAt: number): void {
  const maxAge = Math.max(0, expiresAt - now());
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAge / 1000)}${
      CONFIG.NODE_ENV === 'production' ? '; Secure' : ''
    }`,
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function destroySession(req: Request): void {
  const token = parseCookies(req)[COOKIE];
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', hashToken(token));
}

export function loadUser(req: Request): AuthUser | null {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const row = get<any>(
    `SELECT s.id session_id, s.csrf_token, s.expires_at, u.id, u.email, u.name, u.role, u.locale
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    hashToken(token),
  );
  if (!row) return null;
  if (row.expires_at < now()) {
    run('DELETE FROM sessions WHERE token_hash = ?', hashToken(token));
    return null;
  }
  req.sessionId = row.session_id;
  req.csrfToken = row.csrf_token;
  return { id: row.id, email: row.email, name: row.name, role: row.role, locale: row.locale };
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  req.user = loadUser(req) ?? undefined;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = loadUser(req);
  if (!user) {
    next(new HttpError(401, 'Authentication required'));
    return;
  }
  req.user = user;
  const method = req.method.toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const header = String(req.headers['x-sf-csrf'] ?? '');
    if (!header || header !== req.csrfToken) {
      next(new HttpError(403, 'Invalid or missing CSRF token'));
      return;
    }
  }
  next();
}

export function requireOwner(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(new HttpError(401, 'Authentication required'));
  if (req.user.role !== 'owner') return next(new HttpError(403, 'Owner access required'));
  next();
}

/* ---------------- rate limiting ---------------- */

type Bucket = { hits: number[] };
const buckets = new Map<string, Bucket>();

export function rateLimit(opts: { windowMs?: number; max?: number; bucket?: string; skip?: (req: Request) => boolean } = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 120;
  const bucketName = opts.bucket ?? 'api';
  return (req: Request, res: Response, next: NextFunction) => {
    if (opts.skip?.(req)) return next();
    const ip = (req.ip || req.socket.remoteAddress || 'unknown').toString();
    const key = `${bucketName}:${ip}`;
    const nowTs = Date.now();
    let b = buckets.get(key);
    if (!b) {
      b = { hits: [] };
      buckets.set(key, b);
    }
    b.hits = b.hits.filter((t) => nowTs - t < windowMs);
    if (b.hits.length >= max) {
      res.setHeader('Retry-After', String(Math.ceil((windowMs - (nowTs - b.hits[0]!)) / 1000)));
      next(new HttpError(429, 'Too many requests — please slow down.'));
      return;
    }
    b.hits.push(nowTs);
    next();
  };
}

/** Aggressive bucket for login/register. */
export const authRateLimit = () =>
  rateLimit({ windowMs: 10 * 60_000, max: 20, bucket: 'auth' });

// periodically drop stale buckets
setInterval(() => {
  const nowTs = Date.now();
  for (const [key, b] of buckets) {
    if (!b.hits.length || nowTs - b.hits[b.hits.length - 1]! > 15 * 60_000) buckets.delete(key);
  }
}, 60_000).unref?.();

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Powered-By', 'ShortForge');
  next();
}
