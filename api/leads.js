/**
 * api/leads.js
 * Zoekt echte bedrijven via de Google Places API (New).
 *
 * Werkt met GET (querystring) en POST (JSON-body).
 * Parameters:
 *   q        - zoekterm, bijv. "kapper Venlo" (verplicht)
 *   lat,lng  - middelpunt van het zoekgebied (optioneel)
 *   radius   - straal in meters (optioneel, 500-50000)
 *   lang     - taalcode voor de resultaten, bijv. nl / de
 *   country  - regiocode, bijv. NL / DE
 *   exclude  - place_id's die je al gezien hebt (array of kommagescheiden)
 *   want     - aantal leads dat je wilt ontvangen (standaard 10)
 *
 * Zonder GOOGLE_PLACES_API_KEY geeft dit endpoint een demo-antwoord met
 * Google Maps-zoeklinks, zodat de app nooit crasht of leeg blijft.
 */
import crypto from 'node:crypto';
import { checkAuth } from './_lib/auth.js';
import { getConfig } from './_lib/config.js';
import { cache } from './_lib/cache.js';
import { checkBurst, checkDaily, peekDaily } from './_lib/rate-limit.js';
import { searchPlaces, searchPlacesPaged } from './_lib/places.js';
import { resolveGeoapifyFilter, searchGeoapify } from './_lib/geoapify.js';
import {
  getClientIp,
  isSameOrigin,
  methodNotAllowed,
  readJsonBody,
  sendError,
  sendOk,
} from './_lib/http.js';

const MAX_LEADS_PER_REQUEST = 20;
const MAX_PAGES = 3;
const MAX_EXCLUDE = 500;

function hashKey(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
}

function cleanText(value, maxLength = 160) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function numbersFrom(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.split(',');
  return [];
}

/** Google Maps-zoeklinks voor de demo-modus (geen sleutel nodig, geen kosten). */
function demoLinks(query, lang, country) {
  const encoded = encodeURIComponent(query);
  const host = country === 'DE' ? 'https://www.google.de/maps/search/' : 'https://www.google.com/maps/search/';
  return [
    { label: 'Zoek op Google Maps', url: `${host}${encoded}` },
    { label: 'Zoek op Google', url: `https://www.google.com/search?q=${encoded}` },
    { label: 'Zoek op OpenStreetMap', url: `https://www.openstreetmap.org/search?query=${encoded}` },
  ];
}

async function collectParams(req) {
  const url = new URL(req.url ?? '/', 'https://leadpilot.local');
  const fromQuery = Object.fromEntries(url.searchParams.entries());
  let fromBody = {};
  if (req.method === 'POST') {
    try {
      fromBody = await readJsonBody(req, 64 * 1024);
    } catch {
      fromBody = {};
    }
  }
  const merged = { ...fromQuery, ...fromBody };
  return {
    q: cleanText(merged.q ?? merged.query ?? '', 160),
    city: cleanText(merged.city ?? '', 60),
    niche: cleanText(merged.niche ?? '', 60),
    nicheId: cleanText(merged.nicheId ?? '', 60),
    provider: merged.provider === 'geoapify' ? 'geoapify' : 'google',
    lat: Number.parseFloat(merged.lat) || null,
    lng: Number.parseFloat(merged.lng) || null,
    radius: Number.parseInt(merged.radius, 10) || null,
    lang: cleanText(merged.lang ?? 'nl', 5).toLowerCase(),
    country: cleanText(merged.country ?? 'NL', 2).toUpperCase(),
    want: Math.min(Math.max(Number.parseInt(merged.want, 10) || 10, 1), MAX_LEADS_PER_REQUEST),
    // Hoeveel pagina's mogen er maximaal opgehaald worden voor deze aanvraag?
    pages: Math.min(Math.max(Number.parseInt(merged.pages, 10) || 2, 1), MAX_PAGES),
    offset: Math.min(Math.max(Number.parseInt(merged.offset, 10) || 0, 0), 480),
    exclude: numbersFrom(merged.exclude).map((id) => cleanText(id, 120)).filter(Boolean).slice(0, MAX_EXCLUDE),
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

  const burst = checkBurst(`leads:${getClientIp(req)}`, 20, 60_000);
  if (!burst.allowed) {
    res.setHeader('Retry-After', String(burst.retryAfter));
    return sendError(res, 429, 'rate_limited', `Te veel zoekopdrachten. Probeer het over ${burst.retryAfter} seconden opnieuw.`);
  }

  const params = await collectParams(req);
  const query = params.q || [params.niche, params.city].filter(Boolean).join(' ');
  if (!query) {
    return sendError(res, 400, 'missing_query', 'Geef een niche en/of regio mee om op te zoeken.');
  }

  const config = getConfig();

  // ── Geoapify: onafhankelijke bron voor bedrijven uit OpenStreetMap ──────
  if (params.provider === 'geoapify') {
    if (!config.hasGeoapifyKey) {
      return sendOk(res, {
        mode: 'demo',
        provider: 'geoapify',
        leads: [],
        query,
        message: 'Geoapify is nog niet ingesteld. Voeg GEOAPIFY_API_KEY toe in Vercel; de sleutel is gratis aan te maken zonder bankpas.',
        searchLinks: [{ label: 'Gratis Geoapify-sleutel aanvragen (zonder bankpas)', url: 'https://myprojects.geoapify.com/' }],
        attribution: '© OpenStreetMap contributors',
      });
    }

    const dayLimitError = () => {
      const error = new Error(`De dagelijkse Geoapify-limiet van ${config.maxGeoapifyRequestsPerDay} aanvragen is bereikt.`);
      error.status = 429;
      error.code = 'geoapify_daily_limit';
      return error;
    };
    const beforeGeoapifyRequest = async () => {
      const daily = await checkDaily('geoapify_searches', config.maxGeoapifyRequestsPerDay);
      if (!daily.allowed) throw dayLimitError();
    };

    try {
      const filter = await resolveGeoapifyFilter({
        apiKey: config.geoapifyApiKey,
        city: params.city,
        country: params.country,
        lat: params.lat,
        lng: params.lng,
        radius: params.radius,
        beforeRequest: beforeGeoapifyRequest,
      });
      const exclude = new Set(params.exclude);
      const seenIds = new Set();
      const leads = [];
      let cacheHit = true;

      // Haal alleen extra pagina’s op als de eerste pagina te weinig nieuwe leads heeft.
      for (let offset = params.offset; offset <= 480 && offset < params.offset + params.pages * 20 && leads.length < params.want; offset += 20) {
        const pageKey = "lp:geoapify:" + hashKey({ nicheId: params.nicheId, niche: params.niche, filter, country: params.country, lang: params.lang, offset });
        let page = await cache.get(pageKey);
        if (!page) {
          cacheHit = false;
          page = await searchGeoapify({
            apiKey: config.geoapifyApiKey,
            nicheId: params.nicheId,
            nicheLabel: params.niche,
            filter,
            language: params.lang,
            offset,
            beforeRequest: beforeGeoapifyRequest,
          });
          await cache.set(pageKey, page, config.searchCacheTtl);
        }
        for (const lead of page) {
          if (exclude.has(lead.placeId) || seenIds.has(lead.placeId)) continue;
          seenIds.add(lead.placeId);
          leads.push(lead);
          if (leads.length >= params.want) break;
        }
        if (page.length < 20) break;
      }

      const searchesToday = await peekDaily('geoapify_searches');
      return sendOk(res, {
        mode: 'live',
        provider: 'geoapify',
        leads,
        query,
        exhausted: leads.length === 0,
        allSeen: params.exclude.length > 0 && leads.length === 0,
        quota: { searchesToday, searchLimit: config.maxGeoapifyRequestsPerDay },
        attribution: '© OpenStreetMap contributors',
        providerAttribution: true,
        meta: { cacheDriver: cache.driver, cacheHit, cacheTtlSeconds: config.searchCacheTtl },
      });
    } catch (error) {
      const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      const status = timeout ? 504 : error?.status === 429 ? 429 : 502;
      const message = error?.code === 'geoapify_daily_limit'
        ? error.message
        : error?.status === 429
          ? 'Geoapify laat op dit moment geen extra aanvragen toe. Wacht even en probeer opnieuw; controleer ook je dagelijkse tegoed bij Geoapify.'
        : timeout
          ? 'Geoapify reageerde niet op tijd. Probeer het later opnieuw.'
          : 'Zoeken via Geoapify is mislukt. Controleer de sleutel en probeer het opnieuw.';
      return sendError(res, status, error?.code ?? (timeout ? 'geoapify_timeout' : 'geoapify_error'), message);
    }
  }
  // ── Demo-modus: geen Google- of alternatieve API-sleutel ────────────────
  if (!config.hasPlacesKey) {
    return sendOk(res, {
      mode: 'demo',
      provider: 'google',
      leads: [],
      query,
      message:
        'Geen GOOGLE_PLACES_API_KEY ingesteld. Kies Geoapify in Instellingen, of gebruik de zoeklinks en CSV-import.',
      searchLinks: demoLinks(query, params.lang, params.country),
      cache: { driver: cache.driver, hit: false },
      quota: { searchesToday: 0, searchLimit: config.maxSearchesPerDay },
    });
  }

  // ── Daglimiet (kostenbeheersing) ────────────────────────────────────────
  // We controleren hier vooraf (voor een snelle, vriendelijke melding) én bij
  // elke echte Google-aanvraag hieronder, zodat de limiet het aantal échte
  // Google-zoekopdrachten telt en niet alleen het aantal API-aanvragen.
  // Let op: alleen LEZEN, niet ophogen. Het ophogen gebeurt bij elke echte
  // Google-aanvraag in cachedCall hieronder; anders zou één zoekopdracht
  // dubbel meetellen.
  const usedToday = await peekDaily('searches');
  if (usedToday >= config.maxSearchesPerDay) {
    return sendError(
      res,
      429,
      'daily_limit',
      `De daglimiet van ${config.maxSearchesPerDay} zoekopdrachten is bereikt. Pas MAX_SEARCHES_PER_DAY aan in Vercel als je meer wilt zoeken.`
    );
  }

  const exclude = new Set(params.exclude);

  // Eén Google-aanroep, met 24 uur cache eromheen.
  const cachedCall = async ({ query: callQuery, lat, lng, radius, pageToken }) => {
    const key = `lp:search:${hashKey({ callQuery, lat, lng, radius, lang: params.lang, country: params.country, pageToken: pageToken ?? '' })}`;
    const cached = await cache.get(key);
    if (cached) {
      // Een gecachte pagina kost geen nieuwe Google-aanvraag (en telt dus niet mee).
      return { ...cached, cached: true };
    }

    const daily = await checkDaily('searches', config.maxSearchesPerDay);
    if (!daily.allowed) {
      return {
        ok: false,
        error: {
          code: 'daily_limit',
          message: `De daglimiet van ${daily.limit} zoekopdrachten is bereikt. Pas MAX_SEARCHES_PER_DAY aan in Vercel als je meer wilt zoeken.`,
        },
      };
    }

    const result = await searchPlaces({
      apiKey: config.placesApiKey,
      query: callQuery,
      lat,
      lng,
      radius,
      pageToken,
      languageCode: params.lang,
      regionCode: params.country,
    });
    if (result.ok) {
      await cache.set(key, result, config.searchCacheTtl);
    }
    return { ...result, cached: false };
  };

  try {
    const result = await searchPlacesPaged({
      apiKey: config.placesApiKey,
      query,
      lat: params.lat,
      lng: params.lng,
      radius: params.radius,
      languageCode: params.lang,
      regionCode: params.country,
      exclude,
      wantCount: params.want,
      maxPages: params.pages,
      cachedCall,
    });

    if (!result.ok) {
      const statusByCode = { places_quota: 429, daily_limit: 429, places_permission_denied: 403 };
      const status = statusByCode[result.error.code] ?? 502;
      return sendError(res, status, result.error.code, result.error.message, { details: result.error.details });
    }

    return sendOk(res, {
      mode: 'live',
      leads: result.leads.slice(0, params.want),
      query,
      exhausted: result.exhausted,
      allSeen: result.onlyExcluded,
      meta: {
        pages: result.pages,
        excluded: exclude.size,
        cacheDriver: cache.driver,
        cacheTtlSeconds: config.searchCacheTtl,
      },
      // Na deze aanvraag: het werkelijke verbruik van vandaag.
      quota: { searchesToday: await peekDaily('searches'), searchLimit: config.maxSearchesPerDay },
    });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return sendError(
      res,
      timeout ? 504 : 500,
      timeout ? 'places_timeout' : 'leads_failed',
      timeout
        ? 'Google Places reageerde niet op tijd. Probeer het opnieuw.'
        : 'Zoeken naar leads is mislukt door een onverwachte fout.',
      { details: error?.message ?? String(error) }
    );
  }
}
