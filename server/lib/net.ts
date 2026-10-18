import { log } from './logger.js';
import { CONFIG } from '../config.js';

export type FetchOpts = {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string | Uint8Array;
  retries?: number;
  cacheSec?: number;
};

const cache = new Map<string, { expires: number; value: unknown }>();

/** Network calls are opt-in so offline/test runs stay deterministic. */
export function networkEnabled(): boolean {
  return CONFIG.ALLOW_NETWORK || CONFIG.NODE_ENV === 'production' || process.env.SF_DISABLE_NETWORK !== '1';
}

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const { timeoutMs = 12000, retries = 1, headers = {} } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: opts.method || 'GET',
        body: opts.body as BodyInit | undefined,
        headers: { 'User-Agent': 'ShortForge/1.0 (open-source Shorts tool)', ...headers },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export async function fetchJson<T = any>(url: string, opts: FetchOpts = {}): Promise<T> {
  const key = `${url}`;
  if (opts.cacheSec) {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;
  }
  const text = await fetchText(url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } });
  const parsed = JSON.parse(text) as T;
  if (opts.cacheSec) cache.set(key, { expires: Date.now() + opts.cacheSec * 1000, value: parsed });
  return parsed;
}

/** Best-effort fetch that resolves to null instead of throwing. */
export async function tryFetchJson<T = any>(url: string, opts: FetchOpts = {}): Promise<T | null> {
  try {
    return await fetchJson<T>(url, opts);
  } catch (err) {
    log.debug('fetch failed', { url, error: String(err) });
    return null;
  }
}

export function clearFetchCache(): void {
  cache.clear();
}
