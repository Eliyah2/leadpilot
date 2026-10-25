/**
 * api/_lib/rate-limit.js
 * Twee soorten limieten om API-kosten te beheersen:
 *
 *  1. Burst-limiet  - max N aanvragen per minuut per IP (tegen misbruik).
 *  2. Daglimiet     - max N aanvragen per dag voor de hele app
 *                     (MAX_SEARCHES_PER_DAY / MAX_AUDITS_PER_DAY).
 *
 * De tellers leven in de cache-laag: geheugen zonder KV, Redis met KV.
 */
import { cache, secondsUntilTomorrow, todayKey } from './cache.js';

const buckets = new Map(); // key -> { count, resetAt }  (alleen voor burst)

/**
 * @param {string} key      bijv. `leads:${ip}`
 * @param {number} limit    aantal toegestane aanvragen
 * @param {number} windowMs venster in milliseconden
 */
export function checkBurst(key, limit, windowMs = 60_000) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, remaining: limit - bucket.count, retryAfter: 0 };
}

/**
 * Verhoog en controleer de daglimiet.
 * @returns {{ allowed: boolean, used: number, limit: number }}
 */
export async function checkDaily(bucketName, limit) {
  const key = `lp:daily:${bucketName}:${todayKey()}`;
  const used = await cache.incr(key, secondsUntilTomorrow());
  return { allowed: used <= limit, used: Math.min(used, limit), limit };
}

/** Alleen lezen, voor het health-endpoint en de UI. */
export async function peekDaily(bucketName) {
  return cache.peek(`lp:daily:${bucketName}:${todayKey()}`);
}
