/**
 * public/js/config/regions.js
 * Regio's met coördinaten, land, taal en standaardtoon.
 *
 * `textOnly: true` betekent: geen cirkel op de kaart, maar de plaatsnaam in de
 * zoekterm ("kapper in heel Limburg"). Dat werkt beter voor grote gebieden.
 */

export const RADIUS_OPTIONS = [5, 10, 25, 50, 100]; // kilometer

/** Standaardtaal en toon per land (taal van de e-mail). */
export const COUNTRY_DEFAULTS = {
  NL: { language: 'nl', tone: 'informeel' },
  DE: { language: 'de', tone: 'formeel' },
};

export const REGIONS = [
  // ── Nederland ──────────────────────────────────────────────
  { id: 'venlo', label: 'Venlo', country: 'NL', lat: 51.3704, lng: 6.1724, radius: 10 },
  { id: 'blerick', label: 'Blerick', country: 'NL', lat: 51.3733, lng: 6.1531, radius: 5 },
  { id: 'roermond', label: 'Roermond', country: 'NL', lat: 51.1942, lng: 5.987, radius: 10 },
  { id: 'weert', label: 'Weert', country: 'NL', lat: 51.253, lng: 5.7066, radius: 10 },
  { id: 'sittard', label: 'Sittard', country: 'NL', lat: 50.9989, lng: 5.8687, radius: 10 },
  { id: 'maastricht', label: 'Maastricht', country: 'NL', lat: 50.8514, lng: 5.691, radius: 10 },
  { id: 'eindhoven', label: 'Eindhoven', country: 'NL', lat: 51.4416, lng: 5.4697, radius: 10 },
  { id: 'limburg', label: 'Heel Limburg', country: 'NL', textOnly: true, term: 'Limburg' },
  { id: 'nederland', label: 'Heel Nederland', country: 'NL', textOnly: true, term: 'Nederland' },

  // ── Duitsland ──────────────────────────────────────────────
  { id: 'duesseldorf', label: 'Düsseldorf', country: 'DE', lat: 51.2277, lng: 6.7735, radius: 25 },
  { id: 'moenchengladbach', label: 'Mönchengladbach', country: 'DE', lat: 51.1805, lng: 6.4428, radius: 10 },
  { id: 'krefeld', label: 'Krefeld', country: 'DE', lat: 51.3388, lng: 6.5853, radius: 10 },
  { id: 'kleve', label: 'Kleve', country: 'DE', lat: 51.788, lng: 6.137, radius: 10 },
  { id: 'viersen', label: 'Viersen', country: 'DE', lat: 51.2545, lng: 6.393, radius: 10 },
  { id: 'neuss', label: 'Neuss', country: 'DE', lat: 51.2042, lng: 6.687, radius: 10 },
  { id: 'koeln', label: 'Köln', country: 'DE', lat: 50.9375, lng: 6.9603, radius: 25 },
];

export const RANDOM_REGION = { id: 'random', label: 'Willekeurig', country: 'NL', random: true };

export function findRegion(id, customRegions = []) {
  if (!id || id === 'random') return RANDOM_REGION;
  return REGIONS.find((region) => region.id === id) ?? customRegions.find((region) => region.id === id) ?? REGIONS[0];
}

export function regionsForCountry(country) {
  return REGIONS.filter((region) => region.country === country);
}

/** Eigen regio op basis van een vrije plaatsnaam. */
export function createCustomRegion({ label, country = 'NL', radiusKm = 10 }) {
  const cleanLabel = String(label ?? '').trim().slice(0, 60);
  if (!cleanLabel) return null;
  const cleanCountry = country === 'DE' ? 'DE' : 'NL';
  return {
    id: `custom-${cleanLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${cleanCountry.toLowerCase()}`,
    label: cleanLabel,
    country: cleanCountry,
    textOnly: true,
    term: cleanLabel,
    radius: Number(radiusKm) || 10,
    custom: true,
  };
}

/** Standaardtaal en toon voor een land. */
export function defaultsForCountry(country) {
  return COUNTRY_DEFAULTS[country] ?? COUNTRY_DEFAULTS.NL;
}

/** Taal van de e-mail op basis van het land van de lead. */
export function defaultLanguageFor(country) {
  return defaultsForCountry(country).language;
}

/** Toon van de e-mail op basis van het land (NL informeel, DE formeel). */
export function defaultToneFor(country) {
  return defaultsForCountry(country).tone;
}
