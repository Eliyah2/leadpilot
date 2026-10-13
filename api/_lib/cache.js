/**
 * api/_lib/cache.js
 * Eén simpele cache-laag voor zoekresultaten en tellers.
 *
 * Standaard: geheugen (per serverless instance, dus kortlevend maar gratis).
 * Optioneel: Upstash Redis / Vercel KV via dezelfde functies, door alleen
 * UPSTASH_REDIS_REST_URL en UPSTASH_REDIS_REST_TOKEN te zetten. De rest van
 * de code merkt daar niets van.
 */
import { getConfig } from './config.js';

const memory = new Map();

async function redisCommand(args) {
  const { redisUrl, redisToken } = getConfig();
  const response = await fetch(redisUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redisToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`redis_${response.status}`);
  const data = await response.json();
  return data.result;
}

function memoryGet(key) {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

function memorySet(key, value, ttlSeconds) {
  memory.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
  // Voorkom dat het geheugen volloopt op een langlevende instance.
  if (memory.size > 500) {
    const oldest = memory.keys().next().value;
    memory.delete(oldest);
  }
}

/**
 * Cache-interface: get / set / del / incr.
 * Bij een KV-fout vallen we stil terug op geheugen, zodat een lead nooit
 * mislukt alleen omdat de cache het niet doet.
 */
export const cache = {
  get driver() {
    return getConfig().hasRedis ? 'kv' : 'memory';
  },

  async get(key) {
    if (getConfig().hasRedis) {
      try {
        const raw = await redisCommand(['GET', key]);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return memoryGet(key);
      }
    }
    return memoryGet(key);
  },

  async set(key, value, ttlSeconds = 86400) {
    const raw = JSON.stringify(value);
    if (getConfig().hasRedis) {
      try {
        await redisCommand(['SET', key, raw, 'EX', String(Math.max(1, Math.floor(ttlSeconds)))]);
        return true;
      } catch {
        memorySet(key, value, ttlSeconds);
        return false;
      }
    }
    memorySet(key, value, ttlSeconds);
    return true;
  },

  async del(key) {
    if (getConfig().hasRedis) {
      try {
        await redisCommand(['DEL', key]);
        return true;
      } catch {
        memory.delete(key);
        return false;
      }
    }
    memory.delete(key);
    return true;
  },

  /** Teller met vervaldatum, gebruikt voor daglimieten. */
  async incr(key, ttlSeconds) {
    if (getConfig().hasRedis) {
      try {
        const count = Number(await redisCommand(['INCR', key])) || 1;
        if (count === 1) await redisCommand(['EXPIRE', key, String(ttlSeconds)]);
        return count;
      } catch {
        /* val terug op geheugen */
      }
    }
    const current = Number(memoryGet(key) ?? 0) + 1;
    memorySet(key, current, ttlSeconds);
    return current;
  },

  /** Teller uitlezen zonder op te hogen. */
  async peek(key) {
    if (getConfig().hasRedis) {
      try {
        const raw = await redisCommand(['GET', key]);
        return raw ? Number(raw) : 0;
      } catch {
        /* val terug op geheugen */
      }
    }
    return Number(memoryGet(key) ?? 0);
  },
};

/** Tot middernacht UTC, daarna begint de daglimiet opnieuw. */
export function secondsUntilTomorrow() {
  const now = new Date();
  const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.floor((tomorrow - now.getTime()) / 1000));
}

/** Vandaag als YYYY-MM-DD (UTC), zodat cachesleutels per dag uniek zijn. */
export function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
