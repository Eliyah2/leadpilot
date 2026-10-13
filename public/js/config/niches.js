/**
 * public/js/config/niches.js
 * Alle niches met de zoekterm per taal.
 *
 * `category` bepaalt welke e-mailteksten er gebruikt worden
 * (zie public/js/email/templates/niches.nl.js en niches.de.js).
 * Eigen niches uit de instellingen krijgen automatisch category "overig".
 */

export const CATEGORY_LABELS = {
  kapper: 'Kapper / barbershop',
  beauty: 'Beauty & verzorging',
  horeca: 'Horeca',
  bakkerij: 'Bakkerij / ambachtelijk voedsel',
  bouw: 'Bouw & afbouw',
  installatie: 'Installatie & techniek',
  schoonmaak: 'Schoonmaak',
  gezondheid: 'Gezondheidszorg',
  auto: 'Auto & garage',
  vervoer: 'Vervoer & taxi',
  fotografie: 'Fotografie',
  fitness: 'Sport & fitness',
  dieren: 'Dieren',
  overig: 'Overig / algemeen',
};

/** Alle categorieën, in de volgorde waarin ze in de UI verschijnen. */
export const CATEGORIES = Object.keys(CATEGORY_LABELS);

export const NICHES = [
  { id: 'kapper', label: 'Kapper', category: 'kapper', terms: { nl: 'kapper', de: 'Friseur' } },
  { id: 'barbershop', label: 'Barbershop', category: 'kapper', terms: { nl: 'barbershop', de: 'Barbershop' } },
  { id: 'nagelstudio', label: 'Nagelstudio', category: 'beauty', terms: { nl: 'nagelstudio', de: 'Nagelstudio' } },
  { id: 'schoonheidssalon', label: 'Schoonheidssalon', category: 'beauty', terms: { nl: 'schoonheidssalon', de: 'Kosmetikstudio' } },
  { id: 'restaurant', label: 'Restaurant', category: 'horeca', terms: { nl: 'restaurant', de: 'Restaurant' } },
  { id: 'cafe', label: 'Café', category: 'horeca', terms: { nl: 'café', de: 'Café' } },
  { id: 'horeca', label: 'Horeca (overig)', category: 'horeca', terms: { nl: 'eetcafé', de: 'Gaststätte' } },
  { id: 'bakkerij', label: 'Bakkerij', category: 'bakkerij', terms: { nl: 'bakkerij', de: 'Bäckerei' } },
  { id: 'bouwbedrijf', label: 'Bouwbedrijf', category: 'bouw', terms: { nl: 'bouwbedrijf', de: 'Bauunternehmen' } },
  { id: 'schilder', label: 'Schilder', category: 'bouw', terms: { nl: 'schilderbedrijf', de: 'Malerbetrieb' } },
  { id: 'loodgieter', label: 'Loodgieter', category: 'installatie', terms: { nl: 'loodgieter', de: 'Sanitärbetrieb' } },
  { id: 'elektricien', label: 'Elektricien', category: 'installatie', terms: { nl: 'elektricien', de: 'Elektroinstallateur' } },
  { id: 'dakdekker', label: 'Dakdekker', category: 'bouw', terms: { nl: 'dakdekker', de: 'Dachdeckerei' } },
  { id: 'schoonmaakbedrijf', label: 'Schoonmaakbedrijf', category: 'schoonmaak', terms: { nl: 'schoonmaakbedrijf', de: 'Reinigungsunternehmen' } },
  { id: 'tandarts', label: 'Tandarts', category: 'gezondheid', terms: { nl: 'tandartspraktijk', de: 'Zahnarztpraxis' } },
  { id: 'fysiotherapeut', label: 'Fysiotherapeut', category: 'gezondheid', terms: { nl: 'fysiotherapeut', de: 'Physiotherapie' } },
  { id: 'autogarage', label: 'Autogarage', category: 'auto', terms: { nl: 'autogarage', de: 'Autowerkstatt' } },
  { id: 'taxi', label: 'Taxibedrijf', category: 'vervoer', terms: { nl: 'taxibedrijf', de: 'Taxiunternehmen' } },
  { id: 'fotograaf', label: 'Fotograaf', category: 'fotografie', terms: { nl: 'fotograaf', de: 'Fotograf' } },
  { id: 'personal-trainer', label: 'Personal trainer', category: 'fitness', terms: { nl: 'personal trainer', de: 'Personal Trainer' } },
  { id: 'sportschool', label: 'Sportschool', category: 'fitness', terms: { nl: 'sportschool', de: 'Fitnessstudio' } },
  { id: 'dierenarts', label: 'Dierenarts', category: 'dieren', terms: { nl: 'dierenartsenpraktijk', de: 'Tierarztpraxis' } },
];

export const RANDOM_NICHE = { id: 'random', label: 'Willekeurig', category: 'overig', terms: { nl: '', de: '' }, random: true };

/** Zoek een niche op id, inclusief eigen niches die in de instellingen staan. */
export function findNiche(id, customNiches = []) {
  if (!id || id === 'random') return RANDOM_NICHE;
  return NICHES.find((niche) => niche.id === id) ?? customNiches.find((niche) => niche.id === id) ?? NICHES[0];
}

/** De zoekterm voor een niche in een taal, met een nette terugval. */
export function nicheTerm(niche, language = 'nl') {
  if (!niche) return '';
  if (niche.terms && niche.terms[language]) return niche.terms[language];
  return niche.terms?.nl ?? niche.label ?? '';
}

/** Alle niches die in de keuzelijsten moeten staan (basis + eigen niches). */
export function allNiches(customNiches = []) {
  return [...NICHES, ...customNiches];
}

/** Categorie van een niche, met "overig" als onbekend. */
export function categoryOf(niche) {
  return CATEGORY_LABELS[niche?.category] ? niche.category : 'overig';
}

/** Nieuwe eigen niche op basis van vrije invoer. */
export function createCustomNiche({ label, nl, de }) {
  const cleanLabel = String(label ?? '').trim().slice(0, 60);
  if (!cleanLabel) return null;
  const id = `custom-${cleanLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`;
  return {
    id,
    label: cleanLabel,
    category: 'overig',
    custom: true,
    terms: {
      nl: String(nl ?? cleanLabel).trim().slice(0, 60) || cleanLabel,
      de: String(de ?? cleanLabel).trim().slice(0, 60) || cleanLabel,
    },
  };
}
