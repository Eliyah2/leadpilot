/**
 * public/js/email/engine.js
 * Zet de losse tekstblokken om in één kant-en-klare, gepersonaliseerde e-mail.
 *
 * Hoe een mail wordt opgebouwd:
 *   1. taal en toon bepalen (per land, of jouw handmatige keuze)
 *   2. onderwerpregel kiezen (uit 10 varianten, max. 50 tekens)
 *   3. openingszin kiezen voor de niche-categorie (6 varianten)
 *   4. probleem kiezen dat écht uit de audit komt (nooit verzonnen)
 *   5. oplossing + call-to-action + afsluiting + afmeldregel
 *
 * De variantkeuze gaat op basis van een hash van de lead, dus dezelfde lead
 * krijgt altijd dezelfde mail, maar een nieuwe lead bijna nooit dezelfde als
 * de vorige (de laatste varianten worden overgeslagen).
 */
import { defaultLanguageFor, defaultToneFor } from '../config/regions.js';
import { countWords, hashString } from '../utils.js';
import nl from './templates/nl.js';
import de from './templates/de.js';
import { openings as nlOpenings } from './templates/niches.nl.js';
import { openings as deOpenings } from './templates/niches.de.js';

const MAX_SUBJECT_LENGTH = 50;
const MAX_WORDS = 120;

// Teksten per taal. Wil je een taal toevoegen? Maak een bestand in
// templates/ met dezelfde structuur en zet het hier bij.
const PACKS = { nl, de };

// Openingszinnen per taal en niche-categorie.
const LANG_OPENINGS = { nl: nlOpenings, de: deOpenings };

/** Volgorde van problemen: hoe hoger, hoe belangrijker voor het gesprek. */
const PROBLEM_PRIORITY = [
  'noWebsite',
  'notMobile',
  'noHttps',
  'outdated',
  'noBooking',
  'slow',
  'noSeo',
  'noContactForm',
  'lowReviews',
  'generic',
];

/** Welke taal krijgt deze lead? */
export function resolveLanguage(lead, settings) {
  if (settings.languageMode === 'nl') return 'nl';
  if (settings.languageMode === 'de') return 'de';
  const country = lead?.country === 'DE' || lead?.regionCountry === 'DE' ? 'DE' : 'NL';
  return defaultLanguageFor(country);
}

/** Informeel (je/du) of formeel (u/Sie)? */
export function resolveTone(lead, settings) {
  if (settings.toneMode === 'informeel') return 'informeel';
  if (settings.toneMode === 'formeel') return 'formeel';
  const country = lead?.country === 'DE' || lead?.regionCountry === 'DE' ? 'DE' : 'NL';
  return defaultToneFor(country);
}

export function languagePack(code) {
  return PACKS[code] ?? PACKS.nl;
}

/** Vul {{variabelen}} in; onbekende variabelen verdwijnen zodat er nooit {{x}} blijft staan. */
export function fill(template, vars) {
  return String(template ?? '').replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, key) => {
    const value = vars[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

/** Onderwerpregel binnen 50 tekens krijgen (langere bedrijfsnamen inkorten). */
function fitSubject(template, vars) {
  let out = fill(template, vars);
  if (out.length <= MAX_SUBJECT_LENGTH) return out;
  const shortCompany = String(vars.company ?? '').slice(0, 22).trim();
  out = fill(template, { ...vars, company: shortCompany });
  if (out.length <= MAX_SUBJECT_LENGTH) return out;
  return `${out.slice(0, MAX_SUBJECT_LENGTH - 3).trimEnd()}...`;
}

/** Welke problemen zijn er écht gevonden? */
export function detectedProblems(lead, audit) {
  const found = [];
  if (!lead?.website) found.push('noWebsite');
  if (!audit || audit.status !== 'ok') return found.length ? found : ['generic'];

  const bad = (id) => {
    const check = audit.checks?.find((item) => item.id === id);
    return check && (check.status === 'bad' || check.status === 'warn');
  };
  if (bad('viewport')) found.push('notMobile');
  if (bad('https')) found.push('noHttps');
  if (bad('copyright') || bad('layout') || bad('jquery') || bad('structured_data')) found.push('outdated');
  if (bad('booking')) found.push('noBooking');
  if (bad('performance') || bad('page_weight')) found.push('slow');
  if (bad('title') || bad('meta_description') || bad('open_graph')) found.push('noSeo');
  if (bad('contact_form')) found.push('noContactForm');
  if (Number.isFinite(lead?.reviews) && lead.reviews < 10) found.push('lowReviews');
  return found.length ? found : ['generic'];
}

/** Kies het probleem met de hoogste prioriteit, met een beetje variatie. */
function pickProblem(found, seed) {
  const sorted = [...found].sort(
    (a, b) => PROBLEM_PRIORITY.indexOf(a) - PROBLEM_PRIORITY.indexOf(b)
  );
  // Kies meestal het belangrijkste probleem, soms het tweede (voor variatie).
  const index = sorted.length > 1 && seed % 4 === 3 ? 1 : 0;
  return sorted[index] ?? 'generic';
}

function varsFor(lead, settings, audit, language, tip) {
  const sender = settings.sender ?? {};
  return {
    company: lead?.name ?? 'uw bedrijf',
    city: lead?.city || lead?.regionLabel || 'de regio',
    niche: (lead?.nicheLabel ?? 'bedrijf').toLowerCase(),
    firstName: (lead?.contactName ?? '').trim(),
    sender: sender.name || 'Eliyah',
    senderCompany: sender.company || 'Eliyah Webdesign',
    phone: sender.phone || '(vul je telefoonnummer in bij Instellingen)',
    website: sender.website || 'https://eliyah-webdesign.vercel.app',
    portfolio: sender.portfolio || sender.website || '',
    year: audit?.copyrightYear ?? new Date().getFullYear() - 3,
    tip: tip ?? '',
  };
}

function greetingFor(pack, tone, firstName, seed) {
  if (firstName) {
    return tone === 'formeel' && pack.code === 'de' ? 'Guten Tag,' : tone === 'formeel' ? `Beste ${firstName},` : pack.code === 'de' ? `Hallo ${firstName},` : `Hallo ${firstName},`;
  }
  if (pack.code === 'de') {
    if (tone === 'formeel') {
      return seed % 2 === 0 ? 'Guten Tag,' : 'Sehr geehrte Damen und Herren,';
    }
    return seed % 2 === 0 ? 'Hallo,' : 'Hallo zusammen,';
  }
  return tone === 'formeel' ? 'Geachte heer, mevrouw,' : 'Hallo,';
}

function openingsFor(language, category) {
  const table = LANG_OPENINGS[language] ?? LANG_OPENINGS.nl;
  return table[category] ?? table.overig;
}

/** Kort de mail in tot maximaal 120 woorden zonder dat het onsamenhangend wordt. */
function enforceWordLimit(paragraphs, maxWords = MAX_WORDS) {
  const list = [...paragraphs];
  const totalWords = () => countWords(list.filter(Boolean).join(' '));
  // Eerst de afsluitende zin, dan de oplossing, dan het probleem inkorten.
  while (totalWords() > maxWords && list.length > 5) {
    list.splice(list.length - 3, 1);
  }
  if (totalWords() > maxWords) {
    const problemIndex = 2;
    if (list[problemIndex]) {
      list[problemIndex] = String(list[problemIndex]).split('. ').slice(0, 1).join('. ');
    }
  }
  return list;
}

/**
 * Bouw één e-mail.
 * @param {object} params
 * @param {object} params.lead      de lead (met nicheLabel, city, country)
 * @param {object|null} params.audit  audit-resultaat
 * @param {object} params.settings  jouw instellingen
 * @param {'eerste'|'followup1'|'followup2'|'laatste'} params.kind
 * @param {string|null} params.variantKey  vast variant (anders automatisch)
 */
export function buildEmail({ lead, audit = null, settings, kind = 'eerste', variantKey = null }) {
  const language = /^(nl|de)-/.test(variantKey ?? '') ? variantKey.slice(0, 2) : resolveLanguage(lead, settings);
  const tone = resolveTone(lead, settings);
  const pack = languagePack(language);
  const category = lead?.categoryKey ?? 'overig';
  const nicheData = openingsFor(language, category);
  const seed = hashString(`${lead?.placeId ?? ''}${lead?.name ?? ''}${lead?.city ?? ''}${kind}`);

  const available = detectedProblems(lead, audit);
  const problemKey = pickProblem(available, seed);
  const problemList = pack.problems[problemKey] ?? pack.problems.generic;
  const tipList = nicheData.tips ?? [];
  const tip = tipList.length ? fill(tipList[seed % tipList.length], { company: lead?.name ?? '', city: lead?.city ?? '' }) : '';

  const vars = varsFor(lead, settings, audit, language, tip);

  const subjectOptions = pack.subjects;
  const openingOptions = nicheData.lines ?? [];
  const ctaOptions = pack.ctas[tone] ?? pack.ctas.formeel ?? pack.ctas.informeel;
  const closingOptions = pack.closings[tone] ?? pack.closings.formeel;
  const valueOptions = pack.valueProps;

  // Sla de varianten over die je net gebruikt hebt (nooit twee keer hetzelfde).
  const history = new Set((settings.variantHistory ?? []).slice(0, 3));
  const pickIndex = (options, salt) => {
    if (!options || options.length === 0) return 0;
    for (let attempt = 0; attempt < options.length; attempt += 1) {
      const index = (seed + salt + attempt) % options.length;
      const candidate = fill(options[index], vars);
      if (!history.has(candidate) || attempt === options.length - 1) return index;
    }
    return 0;
  };

  let subjectIndex = pickIndex(subjectOptions, 0);
  let openingIndex = pickIndex(openingOptions, 1);
  const valueIndex = pickIndex(valueOptions, 2);
  const ctaIndex = pickIndex(ctaOptions, 3);
  const closingIndex = 0;
  const problemIndex = seed % problemList.length;

  const firstName = vars.firstName;
  let subject = kind === 'eerste' ? fitSubject(subjectOptions[subjectIndex], vars) : '';
  let greeting = greetingFor(pack, tone, firstName, seed);

  const paragraphs = [];
  if (kind === 'eerste') {
    paragraphs.push(
      greeting,
      fill(openingOptions[openingIndex] ?? '', vars),
      fill(problemList[problemIndex] ?? '', vars),
      fill(valueOptions[valueIndex] ?? '', vars),
      fill(ctaOptions[ctaIndex] ?? '', vars),
      fill(closingOptions[closingIndex] ?? '', vars),
      fill(pack.signature[tone] ?? pack.signature.formeel, vars),
      fill(pack.optOut[tone] ?? pack.optOut.formeel, vars)
    );
  } else {
    const followUp = pack.followUps[kind] ?? pack.followUps.followup1;
    const subjectTemplate = followUp.subjects[seed % followUp.subjects.length];
    subject = fitSubject(subjectTemplate, vars);
    paragraphs.push(
      greeting,
      fill(followUp.openings[seed % followUp.openings.length], vars),
      fill(followUp.bodies[(seed + 1) % followUp.bodies.length], vars),
      fill(pack.signature[tone] ?? pack.signature.formeel, vars),
      fill(pack.optOut[tone] ?? pack.optOut.formeel, vars)
    );
    greeting = paragraphs[0];
  }

  const limited = enforceWordLimit(paragraphs);
  const body = limited.filter((part) => part !== '').join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

  const key = `${language}-${category}-${problemKey}-s${subjectIndex}-o${openingIndex}-c${ctaIndex}-${kind}`;

  return {
    kind,
    language,
    tone,
    category,
    problemKey,
    subject,
    body,
    wordCount: countWords(body),
    variantKey: variantKey ?? key,
    tip,
    signature: fill(pack.signature[tone] ?? pack.signature.formeel, vars),
    detectedProblems: available,
  };
}

/** Wat betekent een variantKey? (voor het A/B-overzicht in het dashboard) */
export function variantLabel(variantKey) {
  if (!variantKey) return 'Onbekend';
  const [language, category, problem, rest = ''] = String(variantKey).split('-');
  const parts = rest.split('-');
  const subjectIndex = Number((parts.find((part) => /^s\d+$/.test(part)) ?? 's0').slice(1)) + 1;
  const openingIndex = Number((parts.find((part) => /^o\d+$/.test(part)) ?? 'o0').slice(1)) + 1;
  const kind = parts[parts.length - 1];
  const languageName = languagePack(language).name;
  const categoryLabel = (LANG_OPENINGS[language] ?? LANG_OPENINGS.nl)[category]?.label ?? category;
  const kindLabel = { eerste: 'eerste mail', followup1: 'follow-up 1', followup2: 'follow-up 2', laatste: 'laatste mail' }[kind] ?? kind;
  return `${languageName} · ${categoryLabel} · onderwerp #${subjectIndex} + opening #${openingIndex} · ${kindLabel}`;
}

/** Korte WhatsApp/DM-variant voor deze lead. */
export function buildWhatsApp({ lead, audit, settings, seedOffset = 0 }) {
  const language = resolveLanguage(lead, settings);
  const pack = languagePack(language);
  const category = lead?.categoryKey ?? 'overig';
  const nicheData = openingsFor(language, category);
  const seed = hashString(`${lead?.placeId ?? ''}${lead?.name ?? ''}`) + seedOffset;
  const problemKey = pickProblem(detectedProblems(lead, audit), seed);
  const problem = pack.problems[problemKey]?.[0] ?? pack.problems.generic[0];
  const tip = nicheData.tips?.length ? fill(nicheData.tips[seed % nicheData.tips.length], { company: lead?.name ?? '', city: lead?.city ?? '' }) : '';
  const vars = varsFor(lead, settings, audit, language, tip);
  const template = pack.whatsapp[seed % pack.whatsapp.length];
  let message = fill(template, { ...vars, problem: fill(problem, vars) });
  if (message.length > 320) message = `${message.slice(0, 317).trimEnd()}...`;
  return { language, message, variantKey: `${language}-${category}-${problemKey}-whatsapp` };
}

/** Belscript van ongeveer 30 seconden. */
export function buildCallScript({ lead, audit, settings }) {
  const language = resolveLanguage(lead, settings);
  const pack = languagePack(language);
  const problemKey = pickProblem(detectedProblems(lead, audit), 0);
  const vars = varsFor(lead, settings, audit, language, '');
  const problem = fill(pack.problems[problemKey]?.[0] ?? pack.problems.generic[0], vars);
  const text = fill(pack.callScript, { ...vars, problem });
  return { language, text, wordCount: countWords(text) };
}

/** Postkaarttekst (voor Duitse leads of bedrijven waar mailen niet mag). */
export function buildPostcard({ lead, audit, settings }) {
  const language = resolveLanguage(lead, settings);
  const pack = languagePack(language);
  const problemKey = pickProblem(detectedProblems(lead, audit), 0);
  const vars = varsFor(lead, settings, audit, language, '');
  const problem = fill(pack.problems[problemKey]?.[0] ?? pack.problems.generic[0], vars);
  return { language, text: fill(pack.postcard, { ...vars, problem }) };
}

export const MAX_EMAIL_WORDS = MAX_WORDS;
export const MAX_SUBJECT_CHARS = MAX_SUBJECT_LENGTH;
