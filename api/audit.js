/**
 * api/audit.js
 * Haalt de website van een bedrijf server-side op en rapporteert wat er
 * technisch mis is (mobiel, HTTPS, snelheid, verouderde techniek, contact,
 * boekingen, SEO, publieke contactgegevens).
 *
 * Parameters (GET of POST):
 *   url   - de website-URL (verplicht)
 *   force - 1 om de cache te negeren
 *
 * Let op: we zoeken of raden NOOIT een e-mailadres. We geven alleen adressen
 * terug die openbaar op de website zelf staan.
 */
import crypto from 'node:crypto';
import { checkAuth } from './_lib/auth.js';
import { getConfig } from './_lib/config.js';
import { cache } from './_lib/cache.js';
import { checkBurst, checkDaily } from './_lib/rate-limit.js';
import { auditWebsite } from './_lib/audit-core.js';
import {
  getClientIp,
  isSameOrigin,
  methodNotAllowed,
  readJsonBody,
  sendError,
  sendOk,
} from './_lib/http.js';

const AUDIT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // een week: sites veranderen weinig

function hashKey(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
}

/** Zet een kale domeinnaam om naar een volledige URL. */
function normalizeUrl(value) {
  let url = String(value ?? '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.slice(0, 300);
}

async function collectParams(req) {
  const requestUrl = new URL(req.url ?? '/', 'https://leadpilot.local');
  const fromQuery = Object.fromEntries(requestUrl.searchParams.entries());
  let fromBody = {};
  if (req.method === 'POST') {
    try {
      fromBody = await readJsonBody(req, 16 * 1024);
    } catch {
      fromBody = {};
    }
  }
  const merged = { ...fromQuery, ...fromBody };
  return {
    url: normalizeUrl(merged.url),
    force: merged.force === '1' || merged.force === true,
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendOk(res, {});
  if (req.method !== 'GET' && req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST']);

  const auth = checkAuth(req);
  if (!auth.ok) return sendError(res, 401, 'unauthorized', auth.reason);
  if (req.method === 'POST' && !isSameOrigin(req)) {
    return sendError(res, 403, 'cross_origin', 'Deze aanvraag komt van een andere site en is geweigerd.');
  }

  const burst = checkBurst(`audit:${getClientIp(req)}`, 30, 60_000);
  if (!burst.allowed) {
    res.setHeader('Retry-After', String(burst.retryAfter));
    return sendError(res, 429, 'rate_limited', `Te veel analyses. Probeer het over ${burst.retryAfter} seconden opnieuw.`);
  }

  const { url, force } = await collectParams(req);
  if (!url) return sendError(res, 400, 'missing_url', 'Geef de website-URL mee die je wilt analyseren.');

  const config = getConfig();
  const key = `lp:audit:${hashKey(url)}`;

  if (!force) {
    const cached = await cache.get(key);
    if (cached) return sendOk(res, { audit: cached, cached: true, cacheDriver: cache.driver });
  }

  const daily = await checkDaily('audits', config.maxAuditsPerDay);
  if (!daily.allowed) {
    return sendError(
      res,
      429,
      'daily_limit',
      `De daglimiet van ${daily.limit} website-analyses is bereikt. Pas MAX_AUDITS_PER_DAY aan in Vercel als je meer wilt analyseren.`
    );
  }

  const audit = await auditWebsite(url);
  // Ook een mislukte analyse cachen, anders blijven we een dode site opvragen.
  await cache.set(key, audit, AUDIT_CACHE_TTL_SECONDS);

  return sendOk(res, {
    audit,
    cached: false,
    cacheDriver: cache.driver,
    quota: { auditsToday: daily.used, auditLimit: daily.limit },
  });
}
