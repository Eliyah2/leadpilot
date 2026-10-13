/**
 * api/state.js
 * Optionele synchronisatie van instellingen + pipeline tussen apparaten.
 *
 * Werkt alleen als UPSTASH_REDIS_REST_URL en UPSTASH_REDIS_REST_TOKEN zijn
 * ingesteld. Zonder KV geeft dit endpoint 501 en blijft de frontend gewoon
 * localStorage gebruiken - de app is dus nooit afhankelijk van KV.
 *
 * GET  /api/state?key=leads        -> { value }
 * PUT  /api/state  { key, value }  -> { saved: true }
 * DELETE /api/state?key=leads      -> { deleted: true }
 */
import { checkAuth } from './_lib/auth.js';
import { getConfig } from './_lib/config.js';
import { cache } from './_lib/cache.js';
import { getClientIp, isSameOrigin, methodNotAllowed, readJsonBody, sendError, sendOk } from './_lib/http.js';
import { checkBurst } from './_lib/rate-limit.js';

const MAX_VALUE_BYTES = 512 * 1024; // 512 kB JSON per onderdeel
const ALLOWED_KEYS = new Set(['settings', 'leads', 'stats', 'seen']);

function storageKey(key) {
  return `lp:state:${key}`;
}

export default async function handler(req, res) {
  const auth = checkAuth(req);
  if (!auth.ok) return sendError(res, 401, 'unauthorized', auth.reason);

  const config = getConfig();
  if (!config.hasRedis) {
    return sendError(
      res,
      501,
      'kv_not_configured',
      'Synchroniseren tussen apparaten is niet ingesteld. Voeg UPSTASH_REDIS_REST_URL en UPSTASH_REDIS_REST_TOKEN toe in Vercel om dit aan te zetten.'
    );
  }

  const burst = checkBurst(`state:${getClientIp(req)}`, 120, 60_000);
  if (!burst.allowed) {
    res.setHeader('Retry-After', String(burst.retryAfter));
    return sendError(res, 429, 'rate_limited', 'Te veel verzoeken. Probeer het zo opnieuw.');
  }

  const url = new URL(req.url ?? '/', 'https://leadpilot.local');
  const key = String(url.searchParams.get('key') ?? '');

  if (req.method === 'GET') {
    if (!ALLOWED_KEYS.has(key)) return sendError(res, 400, 'invalid_key', 'Onbekende sleutel.');
    const value = await cache.get(storageKey(key));
    return sendOk(res, { key, value: value ?? null });
  }

  if (req.method === 'DELETE') {
    if (!ALLOWED_KEYS.has(key)) return sendError(res, 400, 'invalid_key', 'Onbekende sleutel.');
    await cache.del(storageKey(key));
    return sendOk(res, { key, deleted: true });
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    if (!isSameOrigin(req)) {
      return sendError(res, 403, 'cross_origin', 'Deze aanvraag komt van een andere site en is geweigerd.');
    }
    let body = {};
    try {
      body = await readJsonBody(req, MAX_VALUE_BYTES + 8192);
    } catch {
      return sendError(res, 400, 'invalid_body', 'De aanvraag kon niet gelezen worden.');
    }
    const bodyKey = String(body.key ?? key);
    if (!ALLOWED_KEYS.has(bodyKey)) return sendError(res, 400, 'invalid_key', 'Onbekende sleutel.');
    const serialized = JSON.stringify(body.value ?? null);
    if (serialized.length > MAX_VALUE_BYTES) {
      return sendError(res, 413, 'value_too_large', 'Deze gegevens zijn te groot om te synchroniseren.');
    }
    // Geen vervaldatum: jouw pipeline mag niet verdwijnen.
    await cache.set(storageKey(bodyKey), body.value ?? null, 0);
    return sendOk(res, { key: bodyKey, saved: true });
  }

  return methodNotAllowed(res, ['GET', 'PUT', 'DELETE']);
}
