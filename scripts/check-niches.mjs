/**
 * scripts/check-niches.mjs
 * De belangrijkste garantie van LeadPilot: voor ELKE niche moet er een
 * bruikbare zoekopdracht zijn, in elke regio, met een terugvaloptie als de
 * eerste zoekopdracht niets oplevert. En de hele keten van een Google-resultaat
 * naar een kant-en-klare e-mail moet voor elke branche-categorie werken.
 *
 * Draait mee met `npm test` (zie scripts/validate.mjs).
 */
import {
  CATEGORY_LABELS,
  NICHES,
  nicheTerm,
  nicheTypes,
  nichesWithTypes,
  createCustomNiche,
} from '../public/js/config/niches.js';
import { RADIUS_OPTIONS, REGIONS, createCustomRegion } from '../public/js/config/regions.js';
import {
  buildSearchPlan,
  buildSearchQuery,
  enrichLead,
  branchMatch,
  rankCandidates,
  fetchNextLead,
} from '../public/js/lead-service.js';
import { normalizePlace, FIELD_MASK } from '../api/_lib/places.js';
import { buildEmail } from '../public/js/email/engine.js';
import { computeLeadScore, salesArguments } from '../public/js/scoring.js';

const OPENINGS = {
  nl: (await import('../public/js/email/templates/niches.nl.js')).openings,
  de: (await import('../public/js/email/templates/niches.de.js')).openings,
};

const SENDER = {
  name: 'Eliyah',
  company: 'Eliyah Webdesign',
  phone: '+31 6 12345678',
  website: 'https://eliyah-webdesign.vercel.app',
  portfolio: '',
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Zoekinstellingen zoals de app die gebruikt. */
function settingsFor(nicheId, regionId, extra = {}) {
  return {
    nicheId,
    regionId,
    radiusKm: 10,
    languageMode: 'auto',
    toneMode: 'auto',
    qualityFilter: 'alles',
    customNiches: [],
    customRegions: [],
    variantHistory: [],
    sender: SENDER,
    ...extra,
  };
}

/**
 * Controle 1: elke niche in elke regio levert een geldig zoekplan met minimaal
 * twee pogingen, de juiste taal en alleen geldige waarden voor Google.
 */
export function checkNicheCoverage() {
  const problems = [];
  const eigenRegio = createCustomRegion({ label: 'Tegelen', country: 'NL', radiusKm: 5 });
  const eigenNiche = createCustomNiche({ label: 'Rijschool', nl: 'rijschool', de: 'Fahrschule' });
  const regions = [...REGIONS, eigenRegio].filter(Boolean);
  const niches = [...NICHES, eigenNiche].filter(Boolean);
  // Eigen niches en plaatsen moeten meetellen in de instellingen van de app.
  const customs = { customNiches: eigenNiche ? [eigenNiche] : [], customRegions: eigenRegio ? [eigenRegio] : [] };

  niches.forEach((niche) => {
    // Elke niche moet een categorie hebben waarvoor e-mailteksten bestaan.
    if (!CATEGORY_LABELS[niche.category]) {
      problems.push(`niche "${niche.id}": categorie "${niche.category}" bestaat niet`);
    }
    ['nl', 'de'].forEach((language) => {
      if (!OPENINGS[language][niche.category]) {
        problems.push(`niche "${niche.id}": geen ${language.toUpperCase()}-e-mailteksten voor categorie "${niche.category}"`);
      }
      if (!nicheTerm(niche, language)) {
        problems.push(`niche "${niche.id}": geen zoekterm in het ${language.toUpperCase()}`);
      }
    });

    regions.forEach((region) => {
      const plan = buildSearchPlan(settingsFor(niche.id, region.id, customs));
      const label = `${niche.id} × ${region.id}`;

      if (plan.length < 2) {
        problems.push(`${label}: zoekplan heeft maar ${plan.length} stap(pen), er is geen terugvaloptie`);
      }

      const expectedLanguage = region.country === 'DE' ? 'de' : 'nl';
      plan.forEach((step, index) => {
        if (!step.q || step.q.trim().length < 3) problems.push(`${label} stap ${index}: lege zoekopdracht`);
        if (/\s{2,}/.test(step.q)) problems.push(`${label} stap ${index}: dubbele spaties in "${step.q}"`);
        if (/[{}]|undefined|null/.test(step.q)) problems.push(`${label} stap ${index}: rare tekens in "${step.q}"`);
        if (/\bin in\b/i.test(step.q)) problems.push(`${label} stap ${index}: "in in" in "${step.q}"`);
        if (step.lang !== expectedLanguage) {
          problems.push(`${label} stap ${index}: taal ${step.lang}, verwacht ${expectedLanguage}`);
        }
        if (step.country !== region.country) {
          problems.push(`${label} stap ${index}: land ${step.country}, verwacht ${region.country}`);
        }
        if (step.radius !== null && (step.radius < 500 || step.radius > 50_000)) {
          problems.push(`${label} stap ${index}: straal ${step.radius} m valt buiten wat Google toestaat`);
        }
        if (step.radius !== null && (!step.lat || !step.lng)) {
          problems.push(`${label} stap ${index}: straal zonder coördinaten`);
        }
        if (step.lat !== null && (step.lat < -90 || step.lat > 90)) problems.push(`${label}: ongeldige latitude`);
        if (step.lng !== null && (step.lng < -180 || step.lng > 180)) problems.push(`${label}: ongeldige longitude`);
        // De zoekterm moet de term van dat land bevatten (Duits bij een Duitse stad).
        const term = nicheTerm(niche, expectedLanguage);
        if (term && !step.q.toLowerCase().includes(term.toLowerCase()) && step.reason !== 'alternatieve branchenaam') {
          problems.push(`${label} stap ${index}: "${step.q}" bevat de zoekterm "${term}" niet`);
        }
      });

      // De laatste stap moet landbreed zijn, zodat er altijd iets te vinden is.
      const last = plan[plan.length - 1];
      if (last.radius !== null) {
        problems.push(`${label}: de laatste stap heeft nog een straalbeperking ("${last.q}")`);
      }
    });
  });

  // Een handmatige e-mailtaal mag de zoekterm niet veranderen: in Duitsland
  // zoek je altijd met Duitse termen, ook als je in het Nederlands mailt.
  const dutchOverride = buildSearchQuery(settingsFor('kapper', 'koeln', { languageMode: 'nl' }));
  if (dutchOverride.lang !== 'de' || !dutchOverride.q.includes('Friseur')) {
    problems.push(`Duitse regio met Nederlandse e-mailtaal zoekt met "${dutchOverride.q}" in plaats van met "Friseur"`);
  }

  // 100 km kiezen mag geen ongeldige straal opleveren.
  const wide = buildSearchQuery(settingsFor('kapper', 'venlo', { radiusKm: 100 }));
  if (wide.radius !== 50_000) {
    problems.push(`100 km-keuze geeft straal ${wide.radius} m in plaats van de door Google toegestane 50.000 m`);
  }
  if (wide.radiusKmUsed !== 50) problems.push('de gebruikte straal wordt niet correct teruggegeven aan de UI');

  // Willekeurige niche en regio moeten ook werken.
  const randomPlan = buildSearchPlan(settingsFor('random', 'random', customs));
  if (!randomPlan.length || !randomPlan[0].q) problems.push('willekeurige niche/regio levert geen zoekopdracht op');

  // Een eigen niche moet echt met de eigen zoekterm zoeken.
  if (eigenNiche) {
    const customPlan = buildSearchPlan(settingsFor(eigenNiche.id, 'venlo', customs));
    if (!customPlan[0].q.includes('rijschool')) {
      problems.push(`eigen niche "${eigenNiche.label}" zoekt met "${customPlan[0].q}" in plaats van met "rijschool"`);
    }
    const customDe = buildSearchPlan(settingsFor(eigenNiche.id, 'krefeld', customs));
    if (!customDe[0].q.includes('Fahrschule')) {
      problems.push(`eigen niche in Duitsland zoekt met "${customDe[0].q}" in plaats van met "Fahrschule"`);
    }
  }

  // Een opgeslagen niche of regio die niet meer bestaat mag nooit stil met
  // iets anders zoeken: de app moet het melden.
  const verdwenenNiche = buildSearchQuery(settingsFor('custom-bestaat-niet', 'venlo', customs));
  if (!verdwenenNiche.nicheMissing) {
    problems.push('een onbekende niche wordt stil vervangen zonder melding aan de gebruiker');
  }
  const verdwenenRegio = buildSearchQuery(settingsFor('kapper', 'custom-bestaat-niet', customs));
  if (!verdwenenRegio.regionMissing) {
    problems.push('een onbekende regio wordt stil vervangen zonder melding aan de gebruiker');
  }

  if (problems.length) {
    throw new Error(`\n${problems.slice(0, 15).join('\n')}${problems.length > 15 ? `\n... en ${problems.length - 15} meer` : ''}`);
  }

  return `${niches.length} niches × ${regions.length} regio's = ${niches.length * regions.length} zoekplannen, elk met minimaal 2 pogingen (incl. provincie/land en 100 km-straal)`;
}

/**
 * Controle 2: van een Google-resultaat naar een kant-en-klare e-mail.
 * We gebruiken expres rommelige payloads (geen telefoon, geen website, geen
 * rating) zoals Google die in het echt teruggeeft.
 */
export function checkLeadPipeline() {
  const problems = [];
  const payloads = [
    {
      name: 'compleet',
      place: {
        id: 'ChIJtest-compleet',
        displayName: { text: 'Testkapsalon Venlo' },
        formattedAddress: 'Teststraat 1, 5911 AA Venlo, Nederland',
        addressComponents: [
          { types: ['route'], shortText: 'Teststraat' },
          { types: ['street_number'], shortText: '1' },
          { types: ['locality'], shortText: 'Venlo' },
          { types: ['country'], shortText: 'NL' },
        ],
        nationalPhoneNumber: '+31 6 12345678',
        websiteUri: 'https://example.com/',
        googleMapsUri: 'https://maps.google.com/?cid=1',
        rating: 4.6,
        userRatingCount: 128,
        businessStatus: 'OPERATIONAL',
        primaryType: 'hair_salon',
        primaryTypeDisplayName: { text: 'Kapsalon' },
        regularOpeningHours: { weekdayDescriptions: ['maandag: 09:00–18:00'] },
        location: { latitude: 51.3704, longitude: 6.1724 },
      },
    },
    {
      name: 'zonder website',
      place: {
        id: 'ChIJtest-geen-site',
        displayName: { text: 'Testgarage Krefeld' },
        addressComponents: [
          { types: ['locality'], shortText: 'Krefeld' },
          { types: ['country'], shortText: 'DE' },
        ],
        nationalPhoneNumber: '02151 123456',
        rating: 4.8,
        userRatingCount: 7,
        businessStatus: 'OPERATIONAL',
        primaryTypeDisplayName: { text: 'Autowerkstatt' },
        location: { latitude: 51.3388, longitude: 6.5853 },
      },
    },
    {
      name: 'minimaal (bijna lege payload)',
      place: { id: 'ChIJtest-minimaal', displayName: { text: 'Testbedrijf Zonder Alles' } },
    },
    {
      name: 'permanent gesloten',
      place: {
        id: 'ChIJtest-gesloten',
        displayName: { text: 'Testbedrijf Gesloten' },
        businessStatus: 'CLOSED_PERMANENTLY',
        addressComponents: [{ types: ['locality'], shortText: 'Weert' }, { types: ['country'], shortText: 'NL' }],
      },
    },
  ];

  // Zonder dit veld kunnen we niet controleren of een resultaat bij de branche
  // hoort, en dan kan er zomaar een snackbar als kapsalon in de lijst staan.
  if (!String(FIELD_MASK).includes('places.primaryType')) {
    problems.push('het brancheveld (places.primaryType) wordt niet opgevraagd bij Google');
  }

  payloads.forEach(({ name, place }) => {
    const lead = normalizePlace(place);
    if (!lead.name) problems.push(`${name}: geen bedrijfsnaam na normaliseren`);
    if (!lead.placeId) problems.push(`${name}: geen place_id na normaliseren`);
    if (place.primaryType && lead.primaryType !== place.primaryType) {
      problems.push(`${name}: de branche van Google komt niet door naar de lead (${lead.primaryType})`);
    }

    const search = {
      niche: { id: 'test', category: 'kapper' },
      region: { id: 'test', label: 'Venlo' },
      nicheLabel: 'Kapper',
      regionLabel: 'Venlo',
      categoryKey: 'kapper',
      country: 'NL',
      lang: 'nl',
      q: 'kapper in Venlo',
      radiusKmUsed: 10,
    };

    const scored = computeLeadScore(lead, null, { category: 'kapper' });
    if (scored.score < 0 || scored.score > 100) problems.push(`${name}: score ${scored.score} valt buiten 0-100`);
    if (!scored.reasons.length) problems.push(`${name}: geen uitleg bij de score`);
    const args = salesArguments(lead, null, { category: 'kapper', nicheLabel: 'Kapper' });
    if (args.length < 1 || args.length > 3) problems.push(`${name}: ${args.length} verkoopargumenten (moet 1-3 zijn)`);

    const enriched = enrichLead({ lead, audit: null, search, settings: settingsFor('kapper', 'venlo') });
    if (!enriched.city && lead.address) problems.push(`${name}: stad niet overgenomen terwijl er wel een adres is`);
    const email = buildEmail({ lead: enriched, audit: null, settings: settingsFor('kapper', 'venlo'), kind: 'eerste' });
    if (email.wordCount === 0 || email.wordCount > 120) problems.push(`${name}: mail heeft ${email.wordCount} woorden`);
    if (!email.body.includes('Eliyah Webdesign')) problems.push(`${name}: handtekening ontbreekt`);
    if (/\{\{|\}\}/.test(email.body)) problems.push(`${name}: onvervulde variabele in de mail`);
    if (!/Geen interesse|Kein Interesse/.test(email.body)) problems.push(`${name}: afmeldregel ontbreekt`);
  });

  // Elke categorie moet met elke mogelijke combinatie van problemen een mail
  // kunnen maken: geen website, verouderde site, geen reviews, alles goed.
  const audits = [
    { label: 'geen audit', audit: null },
    {
      label: 'alles mis',
      audit: {
        status: 'ok',
        websiteScore: 20,
        copyrightYear: 2014,
        checks: [
          { id: 'viewport', status: 'bad', label: 'Mobiel', detail: 'geen viewport', weight: 15 },
          { id: 'https', status: 'bad', label: 'HTTPS', detail: 'geen https', weight: 12 },
          { id: 'booking', status: 'warn', label: 'Boeken', detail: 'geen knop', weight: 8 },
          { id: 'copyright', status: 'bad', label: 'Oud', detail: '© 2014', weight: 8 },
          { id: 'layout', status: 'bad', label: 'Layout', detail: 'tabellen', weight: 10 },
          { id: 'title', status: 'bad', label: 'Titel', detail: 'geen titel', weight: 6 },
          { id: 'contact_form', status: 'warn', label: 'Formulier', detail: 'geen formulier', weight: 6 },
          { id: 'performance', status: 'warn', label: 'Traag', detail: 'traag', weight: 6 },
          { id: 'jquery', status: 'bad', label: 'jQuery', detail: 'jquery 1.4', weight: 8 },
          { id: 'structured_data', status: 'warn', label: 'Schema', detail: 'geen schema', weight: 4 },
        ],
        problems: ['alles'],
      },
    },
  ];

  Object.keys(CATEGORY_LABELS).forEach((category) => {
    ['nl', 'de'].forEach((language) => {
      audits.forEach(({ label, audit }) => {
        const lead = {
          name: 'Testbedrijf',
          city: language === 'de' ? 'Krefeld' : 'Venlo',
          country: language === 'de' ? 'DE' : 'NL',
          regionCountry: language === 'de' ? 'DE' : 'NL',
          nicheLabel: 'Kapper',
          categoryKey: category,
          placeId: `${category}-${language}-${label}`,
          website: label === 'geen audit' ? '' : 'https://example.com',
          rating: label === 'alles mis' ? 4.9 : 3.2,
          reviews: label === 'alles mis' ? 6 : 40,
          businessStatus: 'OPERATIONAL',
        };
        const email = buildEmail({
          lead,
          audit,
          settings: settingsFor('kapper', 'venlo', { languageMode: language }),
          kind: 'eerste',
        });
        if (email.wordCount === 0 || email.wordCount > 120) {
          problems.push(`${category}/${language}/${label}: ${email.wordCount} woorden`);
        }
        if (!email.subject || email.subject.length > 50) {
          problems.push(`${category}/${language}/${label}: onderwerp "${email.subject}" is te lang of leeg`);
        }
        if (!email.body.includes('Testbedrijf')) {
          problems.push(`${category}/${language}/${label}: bedrijfsnaam staat niet in de mail`);
        }
      });
    });
  });

  // Alle straalopties moeten door de zoeklogica geaccepteerd worden.
  RADIUS_OPTIONS.forEach((radius) => {
    const step = buildSearchQuery(settingsFor('kapper', 'venlo', { radiusKm: radius }));
    if (step.radius === null || step.radius > 50_000) problems.push(`straaloptie ${radius} km levert een ongeldige straal op`);
  });

  if (problems.length) {
    throw new Error(`\n${problems.slice(0, 15).join('\n')}${problems.length > 15 ? `\n... en ${problems.length - 15} meer` : ''}`);
  }

  const combinations = Object.keys(CATEGORY_LABELS).length * 2 * audits.length;
  return `${payloads.length} rommelige Google-payloads verwerkt, ${combinations} categorie/taal/audit-combinaties leveren allemaal een mail binnen de grenzen`;
}

/**
 * Controle 3: de zoektermen en de branche-indeling zelf.
 *
 * Dit vangt de twee manieren waarop je wél resultaten kunt krijgen maar géén
 * bruikbare leads: een zoekterm die iets anders betekent dan de branche
 * ("kapsalon" is in Nederland ook een gerecht) en een branche-indeling die
 * elkaars types overneemt.
 */
export function checkNicheTerms() {
  const problems = [];
  // Branches waarvoor Google écht geen eigen type heeft. Staat een nieuwe niche
  // hier niet in en heeft hij geen type, dan moet dat bewust worden toegevoegd.
  const ZONDER_GOOGLE_TYPE = ['schoonmaakbedrijf', 'fotograaf', 'personal-trainer'];
  const gezienTypes = new Map(); // type -> { id, category }

  NICHES.forEach((niche) => {
    ['nl', 'de'].forEach((language) => {
      const term = nicheTerm(niche, language, 'terms');
      const alt = nicheTerm(niche, language, 'alt');
      if (!term) problems.push(`${niche.id}/${language}: geen hoofdzoekterm`);
      if (!alt) problems.push(`${niche.id}/${language}: geen alternatieve zoekterm (de terugvaloptie)`);
      if (term && alt && term.toLowerCase() === alt.toLowerCase()) {
        problems.push(`${niche.id}/${language}: hoofd- en alternatieve zoekterm zijn gelijk ("${term}")`);
      }
      [term, alt].forEach((value) => {
        if (value && (/\s{2,}/.test(value) || value.length > 30)) {
          problems.push(`${niche.id}/${language}: onbruikbare zoekterm "${value}"`);
        }
      });
    });

    const types = nicheTypes(niche);
    if (types.length === 0 && !ZONDER_GOOGLE_TYPE.includes(niche.id)) {
      problems.push(`niche "${niche.id}": geen Google-branchtype terwijl die wel bestaat voor deze branche`);
    }
    types.forEach((type) => {
      if (!/^[a-z][a-z_]*$/.test(type)) problems.push(`niche "${niche.id}": ongeldig type "${type}"`);
      const known = gezienTypes.get(type);
      // Hetzelfde type in twee niches mag binnen één branchefamilie
      // (kapper/barbershop, restaurant/horeca), maar niet daarbuiten: anders is
      // een waarschuwing over "de verkeerde branche" niet meer eenduidig.
      if (known && known.category !== niche.category) {
        problems.push(`type "${type}" hoort bij zowel "${known.id}" als "${niche.id}" (verschillende branches)`);
      }
      if (!known) gezienTypes.set(type, { id: niche.id, category: niche.category });
    });
  });

  const niche = (id) => NICHES.find((item) => item.id === id);
  const kapper = niche('kapper');

  // Een echte kapsalon moet geaccepteerd worden, een snackbar niet.
  const match = branchMatch({ primaryType: 'hair_salon' }, kapper);
  if (match.kind !== 'match') problems.push('een bedrijf met type hair_salon wordt niet als kapsalon herkend');
  const other = branchMatch({ primaryType: 'meal_takeaway' }, kapper);
  // Welke horeca-niche hem opeist maakt niet uit, zolang het maar horeca is.
  if (other.kind !== 'other' || other.branch?.category !== 'horeca' || !other.branch?.label) {
    problems.push(
      `een snackbar (meal_takeaway) wordt niet als andere branche gezien (${other.kind} / ${other.branch?.category} / "${other.branch?.label}")`
    );
  }
  if (branchMatch({ primaryType: '' }, kapper).kind !== 'unknown') {
    problems.push('zonder branchegegevens van Google is er geen veilige terugval (moet "unknown" zijn)');
  }
  if (branchMatch({ primaryType: 'bar' }, niche('restaurant')).kind === 'other') {
    problems.push('een restaurant dat Google als bar indeelt, wordt onterecht afgekeurd');
  }
  const zonderType = NICHES.find((item) => nicheTypes(item).length === 0);
  if (zonderType && branchMatch({ primaryType: 'iets_onbekends' }, zonderType).kind === 'other') {
    problems.push(`niche "${zonderType.id}" zonder Google-type keurt resultaten af`);
  }

  // De juiste branche hoort vooraan te staan, de verkeerde achteraan.
  const ranked = rankCandidates(
    [
      { name: 'snackbar', primaryType: 'meal_takeaway' },
      { name: 'kapsalon', primaryType: 'hair_salon' },
      { name: 'zonder type', primaryType: '' },
    ],
    kapper
  );
  if (ranked[0].lead.name !== 'kapsalon') problems.push('een echte kapsalon wordt niet bovenaan gezet');
  if (ranked[2].lead.name !== 'snackbar') problems.push('een resultaat van een andere branche wordt niet onderaan gezet');

  if (problems.length) {
    throw new Error(`\n${problems.slice(0, 15).join('\n')}${problems.length > 15 ? `\n... en ${problems.length - 15} meer` : ''}`);
  }

  return `${NICHES.length} niches × 2 talen: zoektermen en branche-indeling kloppen, ${gezienTypes.size} Google-types zonder dubbele`;
}

/**
 * Controle 4: de hele keten van "klik" tot lead, met een nagebootste Google.
 *
 * Dit is de test die "ik vind geen leads" voorkomt: we simuleren precies de
 * gevallen waarin je denkt dat er niets is - alleen resultaten van de verkeerde
 * branche, helemaal niets, en elke niche afzonderlijk.
 */
export async function checkColdLeadGuarantee() {
  const { api } = await import('../public/js/api.js');
  const origineel = api.fetchLeads;
  const problems = [];

  const snackbar = { placeId: 'snack-1', name: 'Snackbar De Kapsalon', primaryType: 'meal_takeaway', city: 'Venlo', website: '', rating: 4.2, reviews: 210 };
  const bezorging = { placeId: 'snack-2', name: 'Kebab Venlo', primaryType: 'meal_takeaway', city: 'Venlo', website: '' };
  const kapsalon = { placeId: 'hair-1', name: 'Kapsalon Anita', primaryType: 'hair_salon', city: 'Venlo', website: 'https://example.com', rating: 4.7, reviews: 64 };

  const basis = {
    radiusKm: 10,
    languageMode: 'auto',
    toneMode: 'auto',
    qualityFilter: 'alles',
    autoAudit: false,
    customNiches: [],
    customRegions: [],
    variantHistory: [],
    sender: SENDER,
  };
  const settingsFor = (nicheId, regionId = 'venlo') => ({ ...basis, nicheId, regionId });

  const calls = [];
  const stub = (byQuery) => {
    calls.length = 0;
    // Nooit het echte netwerk op, altijd deze namaak-Google.
    api.fetchLeads = async ({ q }) => {
      calls.push(q);
      return { mode: 'live', leads: byQuery(q) ?? [], quota: { searchesToday: calls.length, searchLimit: 100 }, meta: {} };
    };
  };

  try {
    // 1) De eerste zoekopdrachten geven alleen snackbars, maar de alternatieve
    //    zoekterm vindt een echte kapsalon. Die moet winnen.
    stub((q) => (q.includes('kapsalon') ? [kapsalon] : [snackbar, bezorging]));
    const eerste = await fetchNextLead({ settings: settingsFor('kapper') });
    if (eerste.kind !== 'lead') {
      problems.push(`geen lead terwijl er een echte kapsalon is (${eerste.kind}: ${eerste.message ?? ''})`);
    } else {
      if (eerste.lead.placeId !== kapsalon.placeId) problems.push(`verkeerde branche gekozen: ${eerste.lead.name}`);
      if (eerste.brandMismatch) problems.push('onterechte branche-waarschuwing bij een echte kapsalon');
    }
    if (calls.length !== 3) problems.push(`verwachtte 3 Google-aanroepen (2× snackbar + de kapsalon), kreeg ${calls.length}`);
    if (calls.length >= 3 && !String(calls[calls.length - 1]).includes('kapsalon')) {
      problems.push(`de alternatieve zoekterm werd niet gebruikt (${calls.join(' | ')})`);
    }

    // 2) Alleen maar resultaten van een andere branche: dan liever een resultaat
    //    met een duidelijke waarschuwing dan "er is niets".
    stub(() => [snackbar, bezorging]);
    const tweede = await fetchNextLead({ settings: settingsFor('kapper') });
    if (tweede.kind !== 'lead') {
      problems.push(`met alleen resultaten van een andere branche komt er niets terug (${tweede.kind})`);
    } else if (!tweede.brandMismatch) {
      problems.push('een snackbar werd zonder waarschuwing als kapsalon gepresenteerd');
    } else if (!/horeca|restaurant|café|eetcafé/i.test(tweede.brandMismatch.branchLabel ?? '')) {
      problems.push(`de waarschuwing noemt niet de horecabranche ("${tweede.brandMismatch.branchLabel}")`);
    }
    if (calls.length !== 4) problems.push(`verwachtte 4 pogingen voor een laatste redmiddel, kreeg ${calls.length}`);

    // 3) Helemaal niets: een lege melding met niche, regio en alle pogingen.
    stub(() => []);
    const derde = await fetchNextLead({ settings: settingsFor('kapper') });
    if (derde.kind !== 'empty') {
      problems.push(`zonder resultaten hoort de app "empty" te melden (${derde.kind})`);
    } else {
      if (!/Kapper/.test(derde.message ?? '') || !/Venlo/.test(derde.message ?? '')) {
        problems.push(`de lege melding noemt de niche en regio niet: "${derde.message}"`);
      }
      if ((derde.attempts ?? []).length !== 4) {
        problems.push(`de lege melding toont ${(derde.attempts ?? []).length} pogingen in plaats van 4`);
      }
    }

    // 4) Voor elke niche moet een ideaal resultaat meteen geaccepteerd worden.
    for (const niche of NICHES) {
      const type = nicheTypes(niche)[0] ?? '';
      const ideaal = {
        placeId: `lead-${niche.id}`,
        name: `Testbedrijf ${niche.label}`,
        primaryType: type,
        city: 'Venlo',
        website: '',
        rating: 4.5,
        reviews: 30,
      };
      stub(() => [ideaal]);
      const resultaat = await fetchNextLead({ settings: settingsFor(niche.id) });
      if (resultaat.kind !== 'lead') {
        problems.push(`niche "${niche.id}": een ideaal resultaat wordt niet geaccepteerd (${resultaat.kind})`);
        continue;
      }
      if (resultaat.lead.placeId !== ideaal.placeId) problems.push(`niche "${niche.id}": verkeerd resultaat gekozen`);
      if (resultaat.brandMismatch) problems.push(`niche "${niche.id}": onterechte branche-waarschuwing`);
      if (calls.length !== 1) problems.push(`niche "${niche.id}": ${calls.length} zoekopdrachten nodig voor een ideaal resultaat`);
    }

    // 5) En voor elke niche moet een resultaat van een andere branche óf
    //    geaccepteerd worden (horeca) of gewaarschuwd worden - nooit stil fout.
    for (const niche of NICHES) {
      const kanControleren = nicheTypes(niche).length > 0 && niche.category !== 'horeca';
      if (!kanControleren) continue;
      stub(() => [snackbar]);
      const resultaat = await fetchNextLead({ settings: settingsFor(niche.id) });
      if (resultaat.kind !== 'lead') {
        problems.push(`niche "${niche.id}": alleen een snackbar levert niets op`);
      } else if (!resultaat.brandMismatch) {
        problems.push(`niche "${niche.id}": een snackbar werd zonder waarschuwing als lead gepresenteerd`);
      }
    }

    // 6) Zonder API-sleutel moet de demo-modus gewoon doorgegeven worden.
    api.fetchLeads = async () => ({
      mode: 'demo',
      searchLinks: [{ label: 'Zoek op Google Maps', url: 'https://www.google.com/maps/search/kapper' }],
      message: 'Geen GOOGLE_PLACES_API_KEY ingesteld.',
      quota: {},
    });
    const demo = await fetchNextLead({ settings: settingsFor('kapper') });
    if (demo.kind !== 'demo' || !demo.searchLinks?.length) problems.push('de demo-modus wordt niet goed doorgegeven aan de UI');
  } finally {
    api.fetchLeads = origineel;
  }

  if (problems.length) {
    throw new Error(`\n${problems.slice(0, 15).join('\n')}${problems.length > 15 ? `\n... en ${problems.length - 15} meer` : ''}`);
  }

  return `${NICHES.length} niches doorgerekend met nagebootste Google: ideale resultaten, verkeerde branche, helemaal niets en de demo-modus`;
}
