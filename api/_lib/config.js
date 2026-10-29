/**
 * api/_lib/config.js
 * Alle environment variables op één plek, met veilige standaardwaarden.
 * Zo hoef je nooit door de code te zoeken naar process.env.
 */

function intFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getConfig() {
  const redisUrl = (process.env.UPSTASH_REDIS_REST_URL ?? '').trim();
  const redisToken = (process.env.UPSTASH_REDIS_REST_TOKEN ?? '').trim();

  return {
    placesApiKey: (process.env.GOOGLE_PLACES_API_KEY ?? '').trim(),
    hasPlacesKey: Boolean((process.env.GOOGLE_PLACES_API_KEY ?? '').trim()),
    geoapifyApiKey: (process.env.GEOAPIFY_API_KEY ?? '').trim(),
    hasGeoapifyKey: Boolean((process.env.GEOAPIFY_API_KEY ?? '').trim()),
    maxGeoapifyRequestsPerDay: intFromEnv('MAX_GEOAPIFY_REQUESTS_PER_DAY', 50),
    maxSearchesPerDay: intFromEnv('MAX_SEARCHES_PER_DAY', 100),
    maxAuditsPerDay: intFromEnv('MAX_AUDITS_PER_DAY', 200),
    searchCacheTtl: intFromEnv('SEARCH_CACHE_TTL_SECONDS', 86400),
    redisUrl,
    redisToken,
    hasRedis: Boolean(redisUrl && redisToken),
  };
}
