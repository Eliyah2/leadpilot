/**
 * api/_lib/geoapify.js
 * Geoapify Places-adapter. De API-sleutel blijft server-side.
 */

export const GEOAPIFY_CATEGORIES = Object.freeze({
  kapper: ['service.beauty.hairdresser'],
  barbershop: ['service.beauty.hairdresser'],
  nagelstudio: ['service.beauty'],
  schoonheidssalon: ['service.beauty'],
  restaurant: ['catering.restaurant'],
  cafe: ['catering.cafe'],
  horeca: ['catering'],
  bakkerij: ['commercial.food_and_drink.bakery'],
  bouwbedrijf: ['commercial.trade'],
  schilder: ['commercial.trade'],
  loodgieter: ['commercial.trade'],
  elektricien: ['service.electrician'],
  dakdekker: ['commercial.trade'],
  schoonmaakbedrijf: ['service.cleaning'],
  tandarts: ['healthcare.dentist'],
  fysiotherapeut: ['healthcare.clinic_or_praxis'],
  autogarage: ['service.vehicle.repair.car'],
  taxi: ['service.taxi'],
  fotograaf: ['service.photographer'],
  'personal-trainer': ['sport.fitness'],
  sportschool: ['sport.fitness.gym'],
  dierenarts: ['pet.veterinary'],
});

const PLACES_ENDPOINT = 'https://api.geoapify.com/v2/places';
const GEOCODE_ENDPOINT = 'https://api.geoapify.com/v1/geocode/search';
const RESULT_LIMIT = 20;

function safeUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function text(value, max = 200) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function contactValue(properties, names) {
  const contact = properties.contact ?? {};
  const raw = properties.datasource?.raw ?? {};
  for (const name of names) {
    const value = contact[name] ?? raw[name] ?? properties[name];
    if (typeof value === 'string' && value.trim()) return text(value, 160);
  }
  return '';
}

function contactPhone(properties) {
  return contactValue(properties, ['phone', 'phone:main', 'telephone', 'contact:phone']);
}

/** Zet één GeoJSON-resultaat om naar het bestaande LeadPilot lead-formaat. */
export function normalizeGeoapifyFeature(feature, { nicheLabel = '' } = {}) {
  const properties = feature?.properties ?? {};
  const [lng, lat] = feature?.geometry?.coordinates ?? [];
  const city = properties.city ?? properties.town ?? properties.village ?? properties.municipality ?? properties.locality ?? '';
  const placeId = text(properties.place_id, 2048);
  const mapUrl = Number.isFinite(lat) && Number.isFinite(lng)
    ? `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lng)}#map=17/${encodeURIComponent(lat)}/${encodeURIComponent(lng)}`
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(properties.formatted ?? properties.name ?? '')}`;

  return {
    placeId,
    name: text(properties.name ?? properties.address_line1, 160),
    category: nicheLabel || text(properties.categories?.[0] ?? '', 100),
    street: text([properties.street ?? properties.road, properties.housenumber ?? properties.house_number].filter(Boolean).join(' '), 160),
    city: text(city, 100),
    country: text(properties.country_code ?? properties.country ?? '', 3).toUpperCase(),
    address: text(properties.formatted ?? [properties.address_line1, properties.address_line2].filter(Boolean).join(', '), 300),
    phone: contactPhone(properties),
    phoneInternational: contactPhone(properties),
    publicEmails: [contactValue(properties, ['email', 'contact:email'])].filter(Boolean),
    website: safeUrl(properties.website),
    mapsUrl: mapUrl,
    rating: null,
    reviews: null,
    businessStatus: '',
    primaryType: text(properties.categories?.[0] ?? '', 120),
    openingHours: [],
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    source: 'Geoapify / OpenStreetMap',
    sourceUrl: mapUrl,
  };
}

async function geoapifyJson(url, beforeRequest) {
  await beforeRequest?.();
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message ?? payload?.error?.message ?? `HTTP ${response.status}`;
    const error = new Error(text(message, 300));
    error.status = response.status;
    throw error;
  }
  return payload;
}

/** Bouw een Geoapify-ruimtelijke filter; user-typed places are geocoded, not interpolated. */
export function resolveGeoapifyFilter({ apiKey, lat, lng, radius, city, country, beforeRequest }) {
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const meters = Math.min(Math.max(Number(radius) || 10_000, 500), 50_000);
    return `circle:${lng},${lat},${meters}`;
  }
  if (city && /^(heel nederland|nederland|deutschland|ganz deutschland)$/i.test(city.trim())) {
    return `countrycode:${String(country || 'NL').toLowerCase()}`;
  }
  if (!city) return `countrycode:${String(country || 'NL').toLowerCase()}`;

  const placeName = city.replace(/^(heel|ganz)\s+/i, '').trim();
  const geocode = new URL(GEOCODE_ENDPOINT);
  geocode.searchParams.set('text', `${placeName}, ${country === 'DE' ? 'Germany' : 'Netherlands'}`);
  geocode.searchParams.set('format', 'json');
  geocode.searchParams.set('limit', '1');
  geocode.searchParams.set('apiKey', apiKey);
  return geoapifyJson(geocode, beforeRequest).then((result) => {
    const placeId = result.results?.[0]?.place_id;
    if (!placeId) throw new Error(`Geoapify kon de regio "${text(placeName, 60)}" niet vinden.`);
    return `place:${placeId}`;
  });
}

/** Haal maximaal twintig bedrijven van één resultaatpagina op. */
export async function searchGeoapify({ apiKey, nicheId, nicheLabel, filter, language = 'nl', offset = 0, beforeRequest }) {
  const categories = GEOAPIFY_CATEGORIES[nicheId] ?? ['commercial'];
  const url = new URL(PLACES_ENDPOINT);
  url.searchParams.set('categories', categories.join(','));
  url.searchParams.set('filter', filter);
  url.searchParams.set('limit', String(RESULT_LIMIT));
  url.searchParams.set('offset', String(Math.max(0, Number(offset) || 0)));
  url.searchParams.set('lang', language === 'de' ? 'de' : 'nl');
  url.searchParams.set('apiKey', apiKey);
  if (!GEOAPIFY_CATEGORIES[nicheId] && nicheLabel) url.searchParams.set('name', text(nicheLabel, 60));

  const payload = await geoapifyJson(url, beforeRequest);
  const features = Array.isArray(payload.features) ? payload.features : [];
  return features
    .map((feature) => normalizeGeoapifyFeature(feature, { nicheLabel }))
    .filter((lead) => lead.placeId && lead.name);
}
