/**
 * public/js/lead-service.js
 * Regelwerk tussen de UI en de API's:
 *   1. zoekterm samenstellen uit niche + regio
 *   2. leads ophalen (met de al geziene leads uitgesloten)
 *   3. het kwaliteitsfilter toepassen (soms met een website-analyse)
 *   4. de eerste bruikbare lead volledig analyseren
 *
 * Zo blijft de UI-code leesbaar: die roept alleen fetchNextLead() aan.
 */
import { api } from './api.js';
import { findNiche, nicheTerm, allNiches, RANDOM_NICHE } from './config/niches.js';
import { findRegion, REGIONS, defaultsForCountry } from './config/regions.js';
import { computeLeadScore, salesArguments } from './scoring.js';
import { clamp } from './utils.js';

/** Maximaal aantal website-analyses per klik, om de kosten te beperken. */
const MAX_AUDITS_PER_SEARCH = 5;

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

/** Zoekterm + coördinaten + taal voor deze instellingen. */
export function buildSearchQuery(settings) {
  const niche = settings.nicheId === 'random' ? pickRandomNiche(settings) : findNiche(settings.nicheId, settings.customNiches);
  const region = settings.regionId === 'random' ? pickRandomRegion(settings) : findRegion(settings.regionId, settings.customRegions);

  const country = region.country ?? 'NL';
  const language = settings.languageMode === 'auto' ? defaultsForCountry(country).language : settings.languageMode;
  const term = nicheTerm(niche, language) || nicheTerm(niche, 'nl');

  const place = region.textOnly ? region.term ?? region.label : region.label;
  const q = [term, region.id === 'nederland' || region.id === 'limburg' ? '' : 'in', place].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  return {
    q,
    lat: region.lat ?? null,
    lng: region.lng ?? null,
    radius: region.lat ? clamp((settings.radiusKm ?? region.radius ?? 10) * 1000, 500, 50_000) : null,
    lang: language,
    country,
    niche,
    region,
    nicheLabel: niche.label,
    regionLabel: region.label,
    categoryKey: niche.category ?? 'overig',
  };
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

/** Analyseer de website van een lead (of geef null terug als dat niet kan). */
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

/** Volledige lead-record maken: score, argumenten, mail-variantruimte. */
export function enrichLead({ lead, audit, search, settings }) {
  const scored = computeLeadScore(lead, audit, { category: search.categoryKey });
  const arguments_ = salesArguments(lead, audit, { category: search.categoryKey, nicheLabel: search.nicheLabel });
  return {
    ...lead,
    nicheId: search.niche.id,
    nicheLabel: search.nicheLabel,
    categoryKey: search.categoryKey,
    regionId: search.region.id,
    regionLabel: search.regionLabel,
    regionCountry: search.country,
    radiusKm: settings.radiusKm ?? search.region.radius ?? null,
    query: search.q,
    country: search.country || lead.country,
    websiteStatus: !lead.website ? 'none' : audit?.status === 'ok' ? 'analysed' : 'unavailable',
    audit: audit?.status === 'ok' ? audit : audit ?? null,
    score: scored.score,
    scoreBand: scored.band,
    scoreReasons: scored.reasons,
    salesArguments: arguments_,
    language: search.lang,
    tone: defaultsForCountry(search.country).tone,
    viewedAt: new Date().toISOString(),
  };
}

/**
 * Haal de volgende lead op.
 * @returns {Promise<object>} één van:
 *   { kind:'demo', searchLinks, message, query }
 *   { kind:'lead', lead, audit, search, excluded, quota }
 *   { kind:'empty', message, exhausted, query }
 */
export async function fetchNextLead({ settings, seenPlaceIds = new Set(), onProgress = () => {} }) {
  const search = buildSearchQuery(settings);
  onProgress({ step: 'search', message: `Zoeken naar ${search.nicheLabel.toLowerCase()} in ${search.regionLabel}...` });

  const response = await api.fetchLeads({
    q: search.q,
    lat: search.lat,
    lng: search.lng,
    radius: search.radius,
    lang: search.lang,
    country: search.country,
    exclude: [...seenPlaceIds],
    want: 10,
  });

  if (response.mode === 'demo') {
    return {
      kind: 'demo',
      query: search.q,
      searchLinks: response.searchLinks ?? [],
      message: response.message ?? 'Demo-modus: geen Google Places-sleutel ingesteld.',
      search,
    };
  }

  const candidates = (response.leads ?? []).filter((lead) => !seenPlaceIds.has(lead.placeId));
  if (candidates.length === 0) {
    return {
      kind: 'empty',
      exhausted: Boolean(response.exhausted),
      allSeen: Boolean(response.allSeen),
      query: search.q,
      message: response.allSeen
        ? 'Je hebt alle resultaten van deze zoekopdracht al gezien. Kies een andere niche of regio, of reset de geziene lijst.'
        : 'Geen resultaten gevonden voor deze combinatie. Probeer een andere niche, regio of ruimere straal.',
      search,
    };
  }

  let audits = 0;
  let lastAudit = null;

  for (const candidate of candidates) {
    if (!passesCheapFilter(candidate, settings)) continue;

    let audit = null;
    const needsAuditForFilter = settings.qualityFilter === 'verouderde-website';
    const shouldAudit = candidate.website && (settings.autoAudit || needsAuditForFilter) && audits < MAX_AUDITS_PER_SEARCH;

    if (shouldAudit) {
      onProgress({ step: 'audit', message: `Website van ${candidate.name} analyseren...` });
      audit = await auditLead(candidate);
      audits += 1;
      lastAudit = audit;
    } else if (!candidate.website) {
      audit = await auditLead(candidate); // geeft meteen de "geen website"-melding
    } else if (settings.qualityFilter === 'verouderde-website') {
      continue; // zonder analyse kunnen we dit filter niet toepassen
    }

    if (!passesAuditFilter(audit, settings)) continue;

    const lead = enrichLead({ lead: candidate, audit, search, settings });
    return { kind: 'lead', lead, audit, search, quota: response.quota, meta: response.meta };
  }

  return {
    kind: 'empty',
    exhausted: false,
    filteredOut: true,
    lastAudit,
    query: search.q,
    message:
      settings.qualityFilter === 'alles'
        ? 'Er waren resultaten, maar die zijn niet bruikbaar. Probeer het opnieuw of kies een andere regio.'
        : `Alle resultaten in deze zoekopdracht vallen buiten je filter ("${settings.qualityFilter}"). Zet het filter op "alles" of probeer een andere regio.`,
    search,
  };
}

/** Zoeklinks voor de demo-modus (zonder API-sleutel). */
export function demoSuggestions(settings) {
  const search = buildSearchQuery(settings);
  return search;
}
