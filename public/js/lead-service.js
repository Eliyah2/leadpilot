/**
 * public/js/lead-service.js
 * Regelwerk tussen de UI en de API's:
 *   1. een zoekplan maken: van precies (niche + regio) naar steeds ruimer
 *   2. leads ophalen, met de al geziene leads uitgesloten
 *   3. het kwaliteitsfilter toepassen (soms met een website-analyse)
 *   4. de eerste bruikbare lead volledig analyseren
 *
 * Het zoekplan is er zodat je voor ELKE niche leads krijgt: levert de precieze
 * zoekopdracht niets op, dan probeert de app automatisch de alternatieve
 * zoekterm van die branche, daarna dezelfde zoekterm zonder straalbeperking, en
 * als laatste de hele taal-/landbrede zoekopdracht. De UI laat zien welke stap
 * gelukt is, zodat je nooit denkt dat er niets is terwijl er wel iets is.
 *
 * De zoekterm volgt altijd de taal van het land van de regio (Duits bij een
 * Duitse stad), ook als je de taal van de e-mail handmatig op Nederlands zet.
 * Anders zou je in Duitsland met Nederlandse zoekwoorden zoeken en veel missen.
 */
import { api } from './api.js';
import { NICHES, nicheTerm, nicheTypes, branchForType, allNiches, RANDOM_NICHE } from './config/niches.js';
import { REGIONS, defaultsForCountry } from './config/regions.js';
import { computeLeadScore, salesArguments } from './scoring.js';
import { clamp } from './utils.js';

/** Maximaal aantal website-analyses per klik, om de kosten te beperken. */
const MAX_AUDITS_PER_SEARCH = 5;

/** Maximaal aantal Google-zoekopdrachten per klik (verdeeld over de stappen). */
const MAX_SEARCH_CALLS_PER_CLICK = 4;

/** Google staat maximaal 50 km toe voor een zoekcirkel. */
const MAX_RADIUS_METERS = 50_000;

/**
 * Hoort dit zoekresultaat bij de branche die je zoekt?
 *
 * Google deelt elk bedrijf zelf in een branche in (primaryType). Dat is de
 * betrouwbaarste controle die we hebben: zoek je "kapsalon" (in Nederland ook
 * een gerecht) en geeft Google een snackbar terug, dan zie je dat hier.
 *
 *   'match'   - Google deelt het bedrijf in bij deze branche
 *   'other'   - Google deelt het in bij een andere branche die we kennen
 *   'unknown' - geen branchegegevens (of dezelfde branchefamilie)
 *
 * 'unknown' laten we altijd door: nooit een lead weggooien omdat wij een
 * branche niet kennen.
 */
export function branchMatch(lead, niche, customNiches = []) {
  const wanted = nicheTypes(niche);
  const type = lead?.primaryType ?? '';
  if (!type || wanted.length === 0) return { kind: 'unknown', type, branch: null };
  if (wanted.includes(type)) return { kind: 'match', type, branch: null };
  const other = branchForType(type, customNiches);
  if (!other) return { kind: 'unknown', type, branch: null };
  // Binnen dezelfde branchefamilie (horeca, bouw, beautysalon...) is het geen
  // mismatch: een restaurant dat Google als "afhaal" indeelt is nog steeds eten.
  if (other.category === niche?.category) return { kind: 'unknown', type, branch: other };
  return { kind: 'other', type, branch: other };
}

/**
 * Zet de resultaten die echt bij de branche horen vooraan en de rest achteraan.
 * Zo krijg je nooit een snackbar als je een kapsalon zoekt - tenzij er écht
 * niets beters is (dan volgt er een waarschuwing).
 */
export function rankCandidates(candidates, niche, customNiches = []) {
  const weight = { match: 0, unknown: 1, other: 2 };
  return candidates
    .map((lead, index) => ({ lead, index, ...branchMatch(lead, niche, customNiches) }))
    .sort((a, b) => weight[a.kind] - weight[b.kind] || a.index - b.index);
}

/** Kies een willekeurige niche uit alle beschikbare niches (basis + eigen). */
function pickRandomNiche(settings) {
  const pool = allNiches(settings.customNiches ?? []).filter((niche) => niche.id !== 'random');
  if (pool.length === 0) return RANDOM_NICHE;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickRandomRegion(settings) {
  const pool = [...REGIONS, ...(settings.customRegions ?? [])];
  if (pool.length === 0) return REGIONS[0];
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Naam van het land in de eigen taal, voor de laatste, breedste zoekstap. */
const COUNTRY_SEARCH_NAME = { NL: 'Nederland', DE: 'Deutschland' };

/**
 * Bouw het zoekplan: een geordende lijst zoekopdrachten van precies naar ruim.
 * Stappen met exact dezelfde zoekopdracht worden overgeslagen.
 */
/**
 * Zoek de niche op, en meld het als de opgeslagen keuze niet meer bestaat.
 * Zonder deze melding zou de app stil met een andere branche zoeken - en dan
 * denk je dat er voor jouw niche geen leads zijn.
 */
function resolveNiche(settings) {
  const custom = settings.customNiches ?? [];
  if (!settings.nicheId || settings.nicheId === 'random') return { niche: pickRandomNiche(settings), missing: false };
  const found = NICHES.find((item) => item.id === settings.nicheId) ?? custom.find((item) => item.id === settings.nicheId);
  if (found) return { niche: found, missing: false };
  return { niche: NICHES[0], missing: true };
}

/** Zelfde voor de regio. */
function resolveRegion(settings) {
  const custom = settings.customRegions ?? [];
  if (!settings.regionId || settings.regionId === 'random') return { region: pickRandomRegion(settings), missing: false };
  const found = REGIONS.find((item) => item.id === settings.regionId) ?? custom.find((item) => item.id === settings.regionId);
  if (found) return { region: found, missing: false };
  return { region: REGIONS[0], missing: true };
}

export function buildSearchPlan(settings) {
  const { niche, missing: nicheMissing } = resolveNiche(settings);
  const { region, missing: regionMissing } = resolveRegion(settings);

  const country = region.country ?? 'NL';
  // De zoekterm hangt af van het land van de regio; de e-mailtaal volgt jouw instelling.
  const searchLanguage = defaultsForCountry(country).language;
  const emailLanguage = settings.languageMode === 'auto' ? searchLanguage : settings.languageMode;

  const primaryTerm = nicheTerm(niche, searchLanguage, 'terms') || nicheTerm(niche, 'nl');
  const altTerm = niche.alt ? nicheTerm(niche, searchLanguage, 'alt') : '';
  const place = region.textOnly ? region.term ?? region.label : region.label;
  const useBias = Boolean(region.lat && region.lng);
  const radiusMeters = useBias
    ? clamp((settings.radiusKm ?? region.radius ?? 10) * 1000, 500, MAX_RADIUS_METERS)
    : null;

  const base = {
    niche,
    region,
    country,
    lang: searchLanguage,
    emailLanguage,
    nicheLabel: niche.label,
    regionLabel: region.label,
    categoryKey: niche.category ?? 'overig',
    radiusKmUsed: radiusMeters ? Math.round(radiusMeters / 1000) : null,
    requestedRadiusKm: settings.radiusKm ?? region.radius ?? null,
    // Waarschuwingen voor de UI: de opgeslagen keuze bestaat niet (meer).
    nicheMissing,
    regionMissing,
  };

  /** Zoekterm + plaats combineren; "in" laten we weg bij hele-provincie/land zoekopdrachten. */
  const joinQuery = (term, where) => {
    const needsIn = where && !/^(nederland|limburg|deutschland)$/i.test(String(where));
    return [term, needsIn ? 'in' : '', where]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const candidates = [
    {
      q: joinQuery(primaryTerm, place),
      lat: region.lat ?? null,
      lng: region.lng ?? null,
      radius: radiusMeters,
      stepLabel: `${primaryTerm} in ${place}`,
      reason: 'standaard',
    },
  ];

  if (region.textOnly) {
    // Hele provincie/land: dezelfde zoekterm zonder de plaatsnaam levert soms
    // juist meer op, omdat bedrijven hun provincie zelden in hun naam zetten.
    candidates.push({
      q: primaryTerm,
      lat: region.lat ?? null,
      lng: region.lng ?? null,
      radius: radiusMeters,
      stepLabel: primaryTerm,
      reason: 'zonder plaatsnaam',
    });
  } else {
    candidates.push({
      q: joinQuery(primaryTerm, place),
      lat: null,
      lng: null,
      radius: null,
      stepLabel: `${primaryTerm} in ${place} (zonder straal)`,
      reason: 'zonder straalbeperking',
    });
  }

  if (altTerm && altTerm.toLowerCase() !== primaryTerm.toLowerCase()) {
    candidates.push({
      q: joinQuery(altTerm, place),
      lat: region.lat ?? null,
      lng: region.lng ?? null,
      radius: radiusMeters,
      stepLabel: `${altTerm} in ${place}`,
      reason: 'alternatieve branchenaam',
    });
  }

  // Laatste redmiddel: de hele taal-/landbrede zoekopdracht. Er zijn altijd
  // bedrijven van dit type in het land, dus dit kan niet leeg blijven.
  const countryName = COUNTRY_SEARCH_NAME[country] ?? COUNTRY_SEARCH_NAME.NL;
  if (place !== countryName) {
    candidates.push({
      q: joinQuery(primaryTerm, countryName),
      lat: null,
      lng: null,
      radius: null,
      stepLabel: `${primaryTerm} in ${countryName}`,
      reason: 'landbreed (buiten je regio)',
    });
  }

  // Dubbele zoekopdrachten eruit; de eerste (preciese) stap wint.
  const seen = new Set();
  const plan = candidates.filter((step) => {
    const key = `${step.q}|${step.radius ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Elke stap krijgt een index en hoeveel pagina's we eraan besteden:
  // de precieze stap mag 2 pagina's doen, de bredere stappen 1.
  return plan.slice(0, MAX_SEARCH_CALLS_PER_CLICK).map((step, index) => ({
    ...base,
    ...step,
    index,
    broadened: index > 0,
    maxPages: index === 0 ? 2 : 1,
  }));
}

/** De eerste (meest precieze) stap: gebruikt voor de demo-link en de werkbalk. */
export function buildSearchQuery(settings) {
  return buildSearchPlan(settings)[0];
}

/** Past de lead door het kwaliteitsfilter? (goedkope controles, zonder audit) */
function passesCheapFilter(lead, settings) {
  switch (settings.qualityFilter) {
    case 'geen-website':
      return !lead.website;
    case 'weinig-reviews':
      return !Number.isFinite(lead.reviews) || lead.reviews < 50;
    default:
      return true;
  }
}

/** Past de lead door het filter als we ook de website-analyse meewegen? */
function passesAuditFilter(audit, settings) {
  if (settings.qualityFilter !== 'verouderde-website') return true;
  if (!audit || audit.status !== 'ok') return false;
  return Number(audit.websiteScore ?? 100) < 70;
}

/** Analyseer de website van een lead (of geef een nette melding terug). */
export async function auditLead(lead, { force = false } = {}) {
  if (!lead?.website) {
    return {
      status: 'unavailable',
      reason: 'geen_website',
      message: 'Dit bedrijf heeft geen website in Google Maps - dat is juist de grootste kans.',
    };
  }
  try {
    const response = await api.audit(lead.website, { force });
    return response.audit ?? null;
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error.code ?? 'error',
      message: `Website niet te analyseren: ${error.message}`,
    };
  }
}

/** Volledige lead-record maken: score, argumenten, taal, mail-variantruimte. */
export function enrichLead({ lead, audit, search, settings }) {
  const scored = computeLeadScore(lead, audit, { category: search.categoryKey });
  const argumenten = salesArguments(lead, audit, { category: search.categoryKey, nicheLabel: search.nicheLabel });
  return {
    ...lead,
    nicheId: search.niche.id,
    nicheLabel: search.nicheLabel,
    categoryKey: search.categoryKey,
    regionId: search.region.id,
    regionLabel: search.regionLabel,
    regionCountry: search.country,
    radiusKm: search.radiusKmUsed ?? settings.radiusKm ?? search.region.radius ?? null,
    query: search.q,
    country: search.country || lead.country,
    websiteStatus: !lead.website ? 'none' : audit?.status === 'ok' ? 'analysed' : 'unavailable',
    audit: audit ?? null,
    score: scored.score,
    scoreBand: scored.band,
    scoreReasons: scored.reasons,
    salesArguments: argumenten,
    language: search.lang,
    tone: defaultsForCountry(search.country).tone,
    viewedAt: new Date().toISOString(),
  };
}

/** Korte uitleg per planstap, voor de UI. */
function stepLabel(step, term) {
  if (step.reason === 'alternatieve branchenaam') return `alternatieve zoekterm "${term}"`;
  if (step.reason === 'zonder straalbeperking') return 'dezelfde zoekopdracht zonder straalbeperking';
  if (step.reason === 'zonder plaatsnaam') return 'dezelfde zoekopdracht zonder plaatsnaam';
  if (step.reason === 'landbreed (buiten je regio)') return 'heel het land (buiten je regio)';
  if (step.reason === 'andere branche') return 'dezelfde zoekopdracht (Google gaf een andere branche terug)';
  return 'de standaard zoekopdracht';
}

/**
 * Beoordeel één zoekresultaat: past het door het kwaliteitsfilter, en zo ja,
 * maak er dan een complete lead van (met website-analyse als dat aanstaat).
 * Levert null op als het resultaat afvalt.
 */
async function selectCandidate({ candidate, step, settings, onProgress, budget }) {
  if (!passesCheapFilter(candidate, settings)) return null;

  let audit = null;
  const needsAuditForFilter = settings.qualityFilter === 'verouderde-website';
  const shouldAudit =
    candidate.website && (settings.autoAudit || needsAuditForFilter) && budget.audits < MAX_AUDITS_PER_SEARCH;

  if (shouldAudit) {
    onProgress({ step: 'audit', message: `Website van ${candidate.name} analyseren...` });
    audit = await auditLead(candidate);
    budget.audits += 1;
  } else if (!candidate.website) {
    audit = await auditLead(candidate); // geeft meteen de "geen website"-melding
  } else if (needsAuditForFilter) {
    return null; // zonder analyse kunnen we het filter 'verouderde website' niet toepassen
  }

  if (!passesAuditFilter(audit, settings)) return null;
  return { lead: enrichLead({ lead: candidate, audit, search: step, settings }), audit };
}

/**
 * Haal de volgende lead op. Probeert automatisch ruimere zoekopdrachten als de
 * precieze zoekopdracht niets bruikbaars oplevert.
 *
 * @returns {Promise<object>} één van:
 *   { kind:'demo', searchLinks, message, query }
 *   { kind:'lead', lead, audit, search, quota, attempts }
 *   { kind:'empty', message, exhausted, triedAll, search }
 */
export async function fetchNextLead({ settings, seenPlaceIds = new Set(), onProgress = () => {} }) {
  const plan = buildSearchPlan(settings);
  const first = plan[0];
  onProgress({ step: 'search', message: `Zoeken naar ${first.nicheLabel.toLowerCase()} in ${first.regionLabel}...` });

  const budget = { audits: 0 };
  let calls = 0;
  const attempts = [];
  let lastResult = null;
  // Resultaten die Google bij een ándere branche indeelt (bijvoorbeeld een
  // snackbar bij de zoekterm "kapsalon") bewaren we als laatste redmiddel: pas
  // als geen enkele zoekopdracht een bedrijf uit de juiste branche oplevert.
  let crossBranch = null;

  for (const step of plan) {
    if (calls >= MAX_SEARCH_CALLS_PER_CLICK) break;

    if (step.index > 0) {
      onProgress({
        step: 'search',
        message: `Niets bruikbaars gevonden. Nu proberen we ${stepLabel(step, step.q)}...`,
      });
    }

    const response = await api.fetchLeads({
      q: step.q,
      lat: step.lat,
      lng: step.lng,
      radius: step.radius,
      lang: step.lang,
      country: step.country,
      exclude: [...seenPlaceIds],
      want: 10,
      // Aantal pagina's dat deze stap mag ophalen: de precieze stap 2, de
      // ruimere stappen 1. Zo blijven de Google-kosten per klik beperkt.
      pages: step.maxPages,
    });
    calls += 1;

    if (response.mode === 'demo') {
      return {
        kind: 'demo',
        query: step.q,
        searchLinks: response.searchLinks ?? [],
        message: response.message ?? 'Demo-modus: geen Google Places-sleutel ingesteld.',
        search: step,
      };
    }

    const candidates = (response.leads ?? []).filter((lead) => !seenPlaceIds.has(lead.placeId));
    // Eerst de bedrijven die Google zelf in deze branche indeelt, dan pas de rest.
    const ranked = rankCandidates(candidates, step.niche, settings.customNiches ?? []);
    let usable = 0;

    if (ranked.length > 0) {
      for (const entry of ranked) {
        if (entry.kind === 'other') {
          // Verkeerde branche: liever nog een zoekopdracht proberen dan deze
          // mail sturen. Bewaren voor het geval er niets beters komt.
          if (!crossBranch) {
            crossBranch = { lead: entry.lead, branch: entry.branch, type: entry.type, step };
          }
          continue;
        }
        usable += 1;
        const picked = await selectCandidate({ candidate: entry.lead, step, settings, onProgress, budget });
        if (!picked) continue;
        return {
          kind: 'lead',
          lead: picked.lead,
          audit: picked.audit,
          search: step,
          quota: response.quota,
          meta: response.meta,
          attempts,
          broadened: step.broadened,
          broadenedReason: step.broadened ? stepLabel(step, step.q) : '',
          brandMismatch: null,
        };
      }
      lastResult = {
        filteredOut: usable > 0,
        otherBranchOnly: usable === 0,
        branchLabel: crossBranch?.branch?.label ?? '',
        candidates: usable,
        step,
        exhausted: false,
      };
    } else {
      lastResult = {
        filteredOut: false,
        otherBranchOnly: false,
        allSeen: Boolean(response.allSeen),
        exhausted: Boolean(response.exhausted),
        step,
      };
    }

    attempts.push({ query: step.q, reason: step.reason, results: candidates.length });
  }

  // Laatste redmiddel: alleen resultaten van een andere branche. Liever een
  // resultaat mét waarschuwing dan "er is niets", maar we zeggen er eerlijk bij
  // dat het misschien niet de branche is die je zocht.
  if (crossBranch) {
    const picked = await selectCandidate({ candidate: crossBranch.lead, step: crossBranch.step, settings, onProgress, budget });
    if (picked) {
      const brandMismatch = {
        type: crossBranch.type,
        branchLabel: crossBranch.branch?.label ?? '',
        nicheLabel: crossBranch.step.nicheLabel,
      };
      return {
        kind: 'lead',
        lead: { ...picked.lead, brandMismatch },
        audit: picked.audit,
        search: crossBranch.step,
        attempts,
        broadened: false,
        broadenedReason: '',
        brandMismatch,
      };
    }
  }

  // Niets gelukt: geef een uitleg die precies zegt wat er speelt.
  const allSeenOnly = Boolean(lastResult?.allSeen) && !lastResult?.filteredOut;
  let message;
  if (allSeenOnly) {
    message =
      'Je hebt alle bedrijven uit deze zoekopdracht (en de ruimere varianten) al gezien. Kies een andere niche of regio, of wis de geziene lijst.';
  } else if (lastResult?.otherBranchOnly) {
    message = `Google vond wel bedrijven voor "${first.nicheLabel}" in ${first.regionLabel}, maar die horen volgens Google bij een andere branche${
      lastResult.branchLabel ? ` (${lastResult.branchLabel})` : ''
    }. Probeer een andere regio, een ruimere straal of een andere zoekterm.`;
  } else if (lastResult?.filteredOut) {
    message =
      settings.qualityFilter === 'alles'
        ? 'Er waren wel resultaten, maar geen daarvan was bruikbaar. Probeer een andere regio of niche.'
        : `Alle gevonden bedrijven vallen buiten je filter ("${settings.qualityFilter}"). Zet het filter op "alles" voor meer resultaten.`;
  } else {
    message = `Geen resultaten gevonden voor "${first.nicheLabel}" in ${first.regionLabel}, ook niet met de ruimere zoekopdrachten. Probeer een andere regio of een ruimere straal.`;
  }

  return {
    kind: 'empty',
    message,
    exhausted: Boolean(lastResult?.exhausted),
    allSeen: allSeenOnly,
    filteredOut: Boolean(lastResult?.filteredOut),
    otherBranchOnly: Boolean(lastResult?.otherBranchOnly),
    branchLabel: lastResult?.branchLabel ?? '',
    triedAll: true,
    attempts,
    query: first.q,
    search: first,
  };
}

/** Zoekopdracht voor de demo-modus (zonder API-sleutel) en voor de werkbalk. */
export function demoSuggestions(settings) {
  return buildSearchQuery(settings);
}
