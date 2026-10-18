import crypto from 'node:crypto';
import { CONFIG } from '../config.js';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

/** Hash a password with scrypt (memory-hard, no external dependency). */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize('NFKC'), salt, 64, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

/** Verify a password against a stored hash (constant-time). */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64!, 'base64url');
    const expected = Buffer.from(hashB64!, 'base64url');
    const actual = crypto.scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

function key(): Buffer {
  return crypto.createHash('sha256').update(CONFIG.SECRET).digest();
}

/** AES-256-GCM encrypt (used for OAuth refresh tokens at rest). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64!, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64!, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64!, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Hash a token for storage (sessions) so raw tokens never sit in the DB. */
export function hashToken(token: string): string {
  return crypto.createHmac('sha256', key()).update(token).digest('base64url');
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('base64url');
}
