/**
 * api/_lib/places.js
 * Dunne laag rond de Google Places API (New) -> places:searchText.
 *
 * Belangrijk voor de kosten: we vragen met een field mask ALLEEN de velden
 * op die de app echt gebruikt. Meer velden = duurder per zoekopdracht.
 */

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

/** Alleen deze velden, niet meer. */
export const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  // primaryType is de machinaal leesbare branche (bijv. 'hair_salon').
  // Dit zit in hetzelfde tarief als displayName, dus het kost niets extra.
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.regularOpeningHours.weekdayDescriptions',
  'places.location',
  'nextPageToken',
].join(',');

/** Foutmeldingen van Google vertalen naar iets wat je in de UI kunt tonen. */
function mapGoogleError(status, payload) {
  const apiMessage = payload?.error?.message ?? '';
  const apiStatus = payload?.error?.status ?? '';
  const denied = apiStatus === 'PERMISSION_DENIED' || status === 403;
  const quota = apiStatus === 'RESOURCE_EXHAUSTED' || status === 429;

  if (denied) {
    return {
      code: 'places_permission_denied',
      message:
        'Google weigert de aanvraag. Controleer of de Places API (New) aan staat, of de sleutel goed is en of er geen HTTP-referrer-beperking op de sleutel zit.',
      details: apiMessage || apiStatus,
    };
  }
  if (quota) {
    return {
      code: 'places_quota',
      message: 'De Google-quota is bereikt. Probeer het later opnieuw of verhoog je limiet in Google Cloud.',
      details: apiMessage || apiStatus,
    };
  }
  return {
    code: 'places_error',
    message: 'Zoeken bij Google Places is mislukt.',
    details: apiMessage || `HTTP ${status}`,
  };
}

/** Eén pagina met zoekresultaten ophalen. */
export async function searchPlaces({
  apiKey,
  query,
  lat,
  lng,
  radius,
  pageToken,
  languageCode = 'nl',
  regionCode = 'NL',
  maxResults = 20,
}) {
  const body = {
    textQuery: query,
    languageCode,
    regionCode,
    // Google raadt pageSize aan; maxResultCount is verouderd. Maximaal 20.
    pageSize: Math.min(Math.max(maxResults, 1), 20),
  };
  // openNow alleen meesturen als we er echt op willen filteren: een filter dat
  // niets toevoegt kan bij sommige zoekopdrachten juist resultaten weghalen.
  // locationBias (geen locationRestriction): beïnvloedt de volgorde, maar sluit
  // bedrijven net buiten de cirkel niet uit. De straal moet van Google tussen
  // 0 en 50.000 meter liggen.
  if (lat && lng) {
    body.locationBias = {
      circle: {
        center: { latitude: Number(lat), longitude: Number(lng) },
        radius: Math.min(Math.max(Number(radius) || 10000, 500), 50_000),
      },
    };
  }
  if (pageToken) body.pageToken = pageToken;

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: mapGoogleError(response.status, payload) };
  }
  return {
    ok: true,
    places: Array.isArray(payload.places) ? payload.places : [],
    nextPageToken: payload.nextPageToken || null,
  };
}

/** Zoek adresdelen (stad, land) uit de addressComponents van Google. */
function pickAddressPart(components, types) {
  for (const type of types) {
    const match = components.find((component) => (component.types ?? []).includes(type));
    if (match) return match.shortText || match.longText || '';
  }
  return '';
}

/**
 * Zet een Google-resultaat om naar het platte LeadPilot-formaat.
 * Alles wat ontbreekt blijft leeg/null - we verzinnen nooit data.
 */
export function normalizePlace(place) {
  const components = place.addressComponents ?? [];
  const city =
    pickAddressPart(components, ['locality', 'postal_town', 'sublocality_level_1', 'sublocality', 'administrative_area_level_2']) || '';
  const country = pickAddressPart(components, ['country']) || '';
  const countryCode = (pickAddressPart(components, ['country']) || '').length === 2 ? pickAddressPart(components, ['country']) : '';
  const street = [pickAddressPart(components, ['route']), pickAddressPart(components, ['street_number'])]
    .filter(Boolean)
    .join(' ');

  const displayName = place.displayName?.text ?? place.displayName ?? '';
  const hours = place.regularOpeningHours?.weekdayDescriptions ?? [];

  return {
    placeId: place.id ?? '',
    name: typeof displayName === 'string' ? displayName : '',
    category: place.primaryTypeDisplayName?.text ?? '',
    street,
    city,
    country: country || countryCode,
    address: place.formattedAddress ?? '',
    phone: place.nationalPhoneNumber ?? place.internationalPhoneNumber ?? '',
    phoneInternational: place.internationalPhoneNumber ?? '',
    website: place.websiteUri ?? '',
    mapsUrl: place.googleMapsUri ?? (place.id ? `https://www.google.com/maps/place/?q=place_id:${place.id}` : ''),
    rating: typeof place.rating === 'number' ? place.rating : null,
    reviews: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
    businessStatus: place.businessStatus ?? '',
    primaryType: place.primaryType ?? '',
    openingHours: Array.isArray(hours) ? hours : [],
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
  };
}

/**
 * Meerdere pagina's ophalen en ondertussen alles wegfilteren wat al gezien is
 * (op place_id). Zo krijg je nooit twee keer dezelfde lead, ook niet na refresh.
 */
export async function searchPlacesPaged({
  apiKey,
  query,
  lat,
  lng,
  radius,
  languageCode,
  regionCode,
  exclude = new Set(),
  wantCount = 10,
  maxPages = 3,
  cachedCall,
}) {
  const found = [];
  const seen = new Set();
  let pageToken = null;
  let pages = 0;
  let onlyExcluded = true;

  while (pages < maxPages) {
    const page = await cachedCall({ query, lat, lng, radius, pageToken });
    if (!page.ok) return { ok: false, error: page.error, leads: found };

    pages += 1;
    page.places.forEach((place) => {
      const lead = normalizePlace(place);
      if (!lead.placeId || seen.has(lead.placeId)) return;
      seen.add(lead.placeId);
      if (exclude.has(lead.placeId)) return;
      onlyExcluded = false;
      found.push(lead);
    });

    pageToken = page.nextPageToken;
    if (found.length >= wantCount || !pageToken) break;
  }

  return { ok: true, leads: found, pages, exhausted: !pageToken, onlyExcluded: onlyExcluded && found.length === 0 };
}
