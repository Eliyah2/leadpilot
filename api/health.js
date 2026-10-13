/**
 * api/health.js
 * Diagnose-endpoint. Vertelt welke onderdelen klaar zijn voor gebruik,
 * zonder ooit sleutels of wachtwoorden te tonen.
 *
 * Handig bij het instellen: open /api/health in je browser.
 */
import { authConfigured, checkAuth } from './_lib/auth.js';
import { getConfig } from './_lib/config.js';
import { cache } from './_lib/cache.js';
import { peekDaily } from './_lib/rate-limit.js';
import { sendOk } from './_lib/http.js';

export default async function handler(req, res) {
  const config = getConfig();
  const auth = checkAuth(req);

  return sendOk(res, {
    service: 'LeadPilot',
    version: '1.0.0',
    time: new Date().toISOString(),
    checks: {
      // Alleen ja/nee, nooit de waarde zelf.
      googlePlacesKey: config.hasPlacesKey ? 'ingesteld' : 'ontbreekt (demo-modus)',
      appPassword: authConfigured() ? 'ingesteld' : 'niet ingesteld (app is openbaar!)',
      cacheDriver: cache.driver,
      kvSync: config.hasRedis ? 'actief' : 'niet ingesteld (alleen localStorage)',
    },
    limits: {
      maxSearchesPerDay: config.maxSearchesPerDay,
      maxAuditsPerDay: config.maxAuditsPerDay,
      searchCacheTtlSeconds: config.searchCacheTtl,
    },
    usageToday: {
      searches: await peekDaily('searches'),
      audits: await peekDaily('audits'),
    },
    authenticated: auth.ok,
  });
}
