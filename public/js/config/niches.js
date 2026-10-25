/**
 * public/js/config/niches.js
 * Alle niches met de zoekterm per taal.
 *
 * `terms` = de zoekterm die we als eerste gebruiken.
 * `alt`   = een tweede, bredere of alternatieve zoekterm. Die wordt automatisch
 *           gebruikt als de eerste zoekopdracht niets bruikbaars oplevert (zie
 *           public/js/lead-service.js). Zo vind je voor elke niche leads, ook
 *           als een branche in een regio net onder een andere naam bekendstaat.
 * `types` = de Google Place Types waar deze branche onder valt (zie
 *           developers.google.com/maps/documentation/places/web-service/place-types).
 *           Hiermee controleren we of een zoekresultaat echt bij deze branche
 *           hoort: zoek je "kapsalon", dan kan Google ook een snackbar teruggeven
 *           (kapsalon is in Nederland ook een gerecht). Zo'n resultaat slaan we
 *           over zolang er nog een betere zoekopdracht te proberen is, en anders
 *           krijg je er een duidelijke waarschuwing bij.
 *           Leeg ([]) betekent: Google heeft geen type voor deze branche, dan
 *           kunnen we niets controleren en laten we alles door.
 *
 * De termen zijn afgestemd op hoe bedrijven zich in Nederland en Duitsland
 * daadwerkelijk noemen (Duitse branche-indelingen gebruiken bijvoorbeeld
 * "Dachdecker", "Zahnarzt", "Tierarzt", "Taxi" en "Gebäudereinigung" - niet de
 * langere vormen die je als buitenstaander zou kiezen).
 *
 * Bewust NIET gekozen als zoekterm, omdat de term iets anders betekent dan de
 * branche: "kapsalon" is in Nederland ook een gerecht (snackbars), "garagebedrijf"
 * kan ook een bedrijf voor garagedeuren zijn, "dakbedekking" is een materiaal en
 * geen bedrijf, "Klempner" is in Duitsland een apart vak en niet de loodgieter.
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
  {
    id: 'kapper',
    label: 'Kapper',
    category: 'kapper',
    terms: { nl: 'kapper', de: 'Friseur' },
    alt: { nl: 'kapsalon', de: 'Friseursalon' },
    types: ['hair_salon', 'barber_shop'],
  },
  {
    id: 'barbershop',
    label: 'Barbershop',
    category: 'kapper',
    terms: { nl: 'barbershop', de: 'Barbershop' },
    alt: { nl: 'barbier', de: 'Herrenfriseur' },
    types: ['barber_shop', 'hair_salon'],
  },
  {
    id: 'nagelstudio',
    label: 'Nagelstudio',
    category: 'beauty',
    terms: { nl: 'nagelstudio', de: 'Nagelstudio' },
    // "nagelsalon" in plaats van "nagelstyliste": dat laatste is een persoon
    // (vaak iemand die aan huis werkt) en geen bedrijf met een pand.
    alt: { nl: 'nagelsalon', de: 'Nageldesign' },
    types: ['nail_salon'],
  },
  {
    id: 'schoonheidssalon',
    label: 'Schoonheidssalon',
    category: 'beauty',
    terms: { nl: 'schoonheidssalon', de: 'Kosmetikstudio' },
    alt: { nl: 'schoonheidsinstituut', de: 'Kosmetiksalon' },
    types: ['beauty_salon'],
  },
  {
    id: 'restaurant',
    label: 'Restaurant',
    category: 'horeca',
    terms: { nl: 'restaurant', de: 'Restaurant' },
    alt: { nl: 'bistro', de: 'Gaststätte' },
    types: ['restaurant', 'meal_takeaway', 'bar'],
  },
  {
    id: 'cafe',
    label: 'Café',
    category: 'horeca',
    terms: { nl: 'café', de: 'Café' },
    alt: { nl: 'koffiebar', de: 'Cafébar' },
    types: ['cafe', 'coffee_shop', 'bar'],
  },
  {
    id: 'horeca',
    label: 'Horeca (overig)',
    category: 'horeca',
    terms: { nl: 'eetcafé', de: 'Gaststätte' },
    alt: { nl: 'lunchroom', de: 'Restaurant' },
    types: ['restaurant', 'cafe', 'bar', 'meal_takeaway', 'coffee_shop'],
  },
  {
    id: 'bakkerij',
    label: 'Bakkerij',
    category: 'bakkerij',
    terms: { nl: 'bakkerij', de: 'Bäckerei' },
    // "bakker" in plaats van "banketbakkerij": dat laatste is alleen patisserie
    // en mist de gewone brood-bakkerijen.
    alt: { nl: 'bakker', de: 'Konditorei' },
    types: ['bakery'],
  },
  {
    id: 'bouwbedrijf',
    label: 'Bouwbedrijf',
    category: 'bouw',
    terms: { nl: 'bouwbedrijf', de: 'Bauunternehmen' },
    alt: { nl: 'aannemer', de: 'Baufirma' },
    types: ['general_contractor'],
  },
  {
    id: 'schilder',
    label: 'Schilder',
    category: 'bouw',
    terms: { nl: 'schildersbedrijf', de: 'Malerbetrieb' },
    alt: { nl: 'schilder', de: 'Maler' },
    types: ['painter'],
  },
  {
    id: 'loodgieter',
    label: 'Loodgieter',
    category: 'installatie',
    terms: { nl: 'loodgieter', de: 'Sanitärinstallation' },
    alt: { nl: 'installatiebedrijf', de: 'Sanitärinstallateur' },
    types: ['plumber'],
  },
  {
    id: 'elektricien',
    label: 'Elektricien',
    category: 'installatie',
    terms: { nl: 'elektricien', de: 'Elektriker' },
    alt: { nl: 'elektrobedrijf', de: 'Elektroinstallation' },
    types: ['electrician'],
  },
  {
    id: 'dakdekker',
    label: 'Dakdekker',
    category: 'bouw',
    terms: { nl: 'dakdekker', de: 'Dachdecker' },
    // "dakbedekking" is het materiaal, niet het bedrijf.
    alt: { nl: 'dakdekkersbedrijf', de: 'Dachdeckerei' },
    types: ['roofing_contractor'],
  },
  {
    id: 'schoonmaakbedrijf',
    label: 'Schoonmaakbedrijf',
    category: 'schoonmaak',
    terms: { nl: 'schoonmaakbedrijf', de: 'Gebäudereinigung' },
    alt: { nl: 'schoonmaakdienst', de: 'Reinigungsunternehmen' },
    // Google heeft geen eigen type voor schoonmaakbedrijven.
    types: [],
  },
  {
    id: 'tandarts',
    label: 'Tandarts',
    category: 'gezondheid',
    terms: { nl: 'tandarts', de: 'Zahnarzt' },
    alt: { nl: 'tandartspraktijk', de: 'Zahnarztpraxis' },
    types: ['dentist'],
  },
  {
    id: 'fysiotherapeut',
    label: 'Fysiotherapeut',
    category: 'gezondheid',
    terms: { nl: 'fysiotherapeut', de: 'Physiotherapie' },
    alt: { nl: 'fysiotherapie', de: 'Physiotherapeut' },
    types: ['physiotherapist'],
  },
  {
    id: 'autogarage',
    label: 'Autogarage',
    category: 'auto',
    terms: { nl: 'autogarage', de: 'Autowerkstatt' },
    // "autobedrijf" in plaats van "garagebedrijf": dat laatste kan ook een
    // bedrijf voor garagedeuren zijn.
    alt: { nl: 'autobedrijf', de: 'KFZ-Werkstatt' },
    types: ['car_repair'],
  },
  {
    id: 'taxi',
    label: 'Taxibedrijf',
    category: 'vervoer',
    terms: { nl: 'taxibedrijf', de: 'Taxi' },
    alt: { nl: 'taxi', de: 'Taxiunternehmen' },
    types: ['taxi_service'],
  },
  {
    id: 'fotograaf',
    label: 'Fotograaf',
    category: 'fotografie',
    terms: { nl: 'fotograaf', de: 'Fotograf' },
    alt: { nl: 'fotostudio', de: 'Fotostudio' },
    // Google heeft geen eigen type voor fotografen.
    types: [],
  },
  {
    id: 'personal-trainer',
    label: 'Personal trainer',
    category: 'fitness',
    terms: { nl: 'personal trainer', de: 'Personal Trainer' },
    alt: { nl: 'personal training', de: 'Personal Training' },
    // Google heeft geen eigen type voor personal trainers (een sportschool is
    // iets anders).
    types: [],
  },
  {
    id: 'sportschool',
    label: 'Sportschool',
    category: 'fitness',
    terms: { nl: 'sportschool', de: 'Fitnessstudio' },
    alt: { nl: 'fitnesscentrum', de: 'Fitnesscenter' },
    types: ['gym', 'fitness_center'],
  },
  {
    id: 'dierenarts',
    label: 'Dierenarts',
    category: 'dieren',
    terms: { nl: 'dierenarts', de: 'Tierarzt' },
    // "Tierarztpraxis" in plaats van "Tierklinik": een Klinik is alleen een
    // dierenkliniek, terwijl de gewone praktijken juist de leads zijn.
    alt: { nl: 'dierenartsenpraktijk', de: 'Tierarztpraxis' },
    types: ['veterinary_care'],
  },
];

export const RANDOM_NICHE = { id: 'random', label: 'Willekeurig', category: 'overig', terms: { nl: '', de: '' }, random: true };

/** Zoek een niche op id, inclusief eigen niches die in de instellingen staan. */
export function findNiche(id, customNiches = []) {
  if (!id || id === 'random') return RANDOM_NICHE;
  return NICHES.find((niche) => niche.id === id) ?? customNiches.find((niche) => niche.id === id) ?? NICHES[0];
}

/**
 * De zoekterm voor een niche in een taal.
 * @param {object} niche
 * @param {'nl'|'de'} language
 * @param {'terms'|'alt'} which  de hoofdterm of het alternatief
 */
export function nicheTerm(niche, language = 'nl', which = 'terms') {
  if (!niche) return '';
  const set = which === 'alt' ? niche.alt : niche.terms;
  if (set && set[language]) return set[language];
  if (niche.terms && niche.terms[language]) return niche.terms[language];
  return niche.terms?.nl ?? niche.label ?? '';
}

/** Alle niches die in de keuzelijsten moeten staan (basis + eigen niches). */
export function allNiches(customNiches = []) {
  return [...NICHES, ...customNiches];
}

/**
 * De Google-branchtypes van een niche. Leeg betekent: Google heeft er geen
 * type voor en dan kunnen we niets controleren (we laten alles door).
 */
export function nicheTypes(niche) {
  return Array.isArray(niche?.types) ? niche.types.filter(Boolean) : [];
}

/** Alle niches met een Google-type, om een type naar een branche te herleiden. */
export function nichesWithTypes() {
  return NICHES.filter((niche) => nicheTypes(niche).length > 0);
}

/**
 * Welke branche hoort bij een Google-type? Bijvoorbeeld 'meal_takeaway' -> de
 * horeca-niches. Zo kan de app zeggen "dit lijkt een horecabedrijf" als je
 * eigenlijk een kapsalon zocht. Onbekende types geven null (nooit een
 * valse waarschuwing).
 */
export function branchForType(type, customNiches = []) {
  if (!type) return null;
  const all = [...NICHES, ...customNiches];
  const found = all.find((niche) => nicheTypes(niche).includes(type));
  return found ? { id: found.id, label: found.label, category: found.category } : null;
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
