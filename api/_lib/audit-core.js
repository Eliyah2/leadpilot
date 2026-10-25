/**
 * api/_lib/audit-core.js
 * Analyseert de website van een bedrijf server-side.
 *
 * We analyseren de HTML met tekst-patronen (geen externe libraries, zodat de
 * app dependency-vrij blijft). Alles wat we niet kunnen vaststellen melden we
 * als "onbekend" - we gokken nooit.
 *
 * Resultaat: een lijst bevindingen (checks) die de UI direct kan tonen, plus
 * een websiteScore (0-100, hoger = gezondere website).
 */
import { isSafePublicUrl } from './http.js';

const USER_AGENT =
  'Mozilla/5.0 (compatible; LeadPilot/1.0; website-analyse; +https://eliyah-webdesign.vercel.app)';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 700_000;
const OLD_JQUERY_MAJOR = 3;
const COPYRIGHT_STALE_YEARS = 3;

/** HTML ophalen met timeout en een maximale grootte. */
async function fetchHtml(url, { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'nl,de;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  let html = '';
  let truncated = false;
  let bytes = 0;

  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    // Lees tot de limiet, dan stoppen we met lezen (Google's bandbreedte sparen).
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (bytes >= maxBytes) {
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
    }
    html += decoder.decode();
  } else {
    const text = await response.text();
    bytes = text.length;
    html = text.slice(0, maxBytes);
    truncated = text.length > maxBytes;
  }

  return {
    html,
    bytes,
    truncated,
    status: response.status,
    finalUrl: response.url,
    contentType: response.headers.get('content-type') ?? '',
    ms: Date.now() - startedAt,
  };
}

/** HTML -> leesbare tekst (voor het vinden van een publiek e-mailadres). */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PLACEHOLDER_EMAIL_PATTERN = /(voorbeeld|example|jouw|uw|domein|domain|naam|name)@/i;

/** Verzamel openbaar genoemde e-mailadressen (mailto + zichtbare tekst). */
function findPublicEmails(html, text) {
  const found = new Set();
  const mailtoMatches = html.match(/mailto:([^"'?>\s]+)/gi) ?? [];
  mailtoMatches.forEach((match) => {
    const address = decodeURIComponent(match.replace(/^mailto:/i, '')).toLowerCase();
    if (address.includes('@')) found.add(address);
  });
  (text.match(EMAIL_PATTERN) ?? []).forEach((address) => found.add(address.toLowerCase()));

  return [...found]
    .filter((address) => !PLACEHOLDER_EMAIL_PATTERN.test(address))
    .filter((address) => !/\.(png|jpg|jpeg|gif|webp|svg|css|js)$/i.test(address))
    .slice(0, 5);
}

/** Laatste copyright-jaar op de pagina, of null. */
function findCopyrightYear(html, text) {
  const source = `${html} ${text}`;
  const years = [];
  const pattern = /(?:©|&copy;|copyright|alle rechte|alle rechten)[^\d]{0,40}(\d{4})/gi;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    years.push(Number(match[1]));
  }
  // Ook "2015 - 2019" of "2015-2019" patronen meenemen.
  const ranges = source.match(/\b(19|20)\d{2}\s*[-–]\s*((19|20)\d{2})\b/g) ?? [];
  ranges.forEach((range) => {
    const parts = range.split(/[-–]/);
    const last = Number(parts[1]);
    if (Number.isFinite(last)) years.push(last);
  });

  const valid = years.filter((year) => year >= 1995 && year <= new Date().getFullYear() + 1);
  return valid.length ? Math.max(...valid) : null;
}

/** jQuery-versie uit de HTML halen (bijv. jquery-1.12.4.min.js). */
function findJQueryVersion(html) {
  const match = html.match(/jquery[.\-/]?v?(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] ?? 0), raw: match[0] };
}

/**
 * Voer alle controles uit op de opgehaalde HTML.
 * @returns {Array<{id:string,label:string,status:'good'|'warn'|'bad'|'info',detail:string,weight:number}>}
 */
function runChecks({ html, text, fetchInfo, requestedUrl }) {
  const checks = [];
  // basis: 'gemeten' = direct uit de HTML of response; 'afgeleid' = redenering op de HTML;
  // 'mening' = ontwerpoordeel dat niet objectief vast te stellen is.
  const add = (id, label, status, detail, weight = 0, basis = 'gemeten') => {
    checks.push({ id, label, status, detail, weight, basis });
  };

  const isHttps = fetchInfo.finalUrl.startsWith('https://');
  add(
    'https',
    'Beveiligde verbinding (HTTPS)',
    isHttps ? 'good' : 'bad',
    isHttps
      ? 'De site is via HTTPS bereikbaar.'
      : 'Geen HTTPS: bezoekers krijgen een "niet veilig"-melding van de browser.',
    12
  );

  if (!isHttps && requestedUrl.startsWith('https://')) {
    add('https_redirect', 'Doorverwijzing naar HTTPS', 'bad', 'De HTTPS-versie stuurt door naar een onbeveiligde pagina.', 6, 'gemeten');
  }

  const hasViewport = /<meta[^>]+name=["']?viewport["']?/i.test(html);
  add(
    'viewport',
    'Mobiele weergave (viewport)',
    hasViewport ? 'good' : 'bad',
    hasViewport
      ? 'De pagina schaalt mee op mobiel.'
      : 'Geen viewport-meta tag: de site wordt op mobiel klein uitgezoomd weergegeven.',
    15,
    'gemeten'
  );

  const responsiveHints = (html.match(/@media[^{]*max-width/gi) ?? []).length;
  add(
    'responsive_css',
    'Responsive CSS-regels',
    responsiveHints > 0 ? 'good' : 'warn',
    responsiveHints > 0
      ? `${responsiveHints} media-query('s) met max-width gevonden in de pagina.`
      : 'Geen media-queries in de HTML gevonden (externe stylesheets kunnen dit wel bevatten).',
    4,
    'afgeleid'
  );

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
  if (!title) {
    add('title', 'Paginatitel (SEO)', 'bad', 'Geen <title> gevonden: Google toont dan een zelfgekozen titel.', 6, 'gemeten');
  } else if (title.length < 15 || title.length > 70) {
    add('title', 'Paginatitel (SEO)', 'warn', `<title> is ${title.length} tekens; ideaal is 30-60. Nu: "${title.slice(0, 80)}".`, 2, 'gemeten');
  } else {
    add('title', 'Paginatitel (SEO)', 'good', `Titel gevonden (${title.length} tekens).`, 0, 'gemeten');
  }

  const descriptionMatch = html.match(/<meta[^>]+name=["']?description["']?[^>]*content=["']([^"']*)["']/i);
  const description = descriptionMatch ? descriptionMatch[1].trim() : '';
  add(
    'meta_description',
    'Meta description',
    description ? (description.length < 50 ? 'warn' : 'good') : 'warn',
    description
      ? `Meta description aanwezig (${description.length} tekens).`
      : 'Geen meta description: Google kiest zelf een stukje tekst in de zoekresultaten.',
    description ? 0 : 3,
    'gemeten'
  );

  const ogTags = (html.match(/<meta[^>]+property=["']og:/gi) ?? []).length;
  add(
    'open_graph',
    'Open Graph (delen op socials)',
    ogTags >= 2 ? 'good' : 'warn',
    ogTags >= 2
      ? `${ogTags} Open Graph-tags gevonden (nette preview bij delen).`
      : 'Geen of nauwelijks Open Graph-tags: een link op WhatsApp/Facebook toont geen nette kaart.',
    ogTags >= 2 ? 0 : 3,
    'gemeten'
  );

  const tableCount = (html.match(/<table/gi) ?? []).length;
  const divCount = (html.match(/<div/gi) ?? []).length;
  const fontTags = (html.match(/<font[\s>]/gi) ?? []).length;
  const centerTags = (html.match(/<center[\s>]/gi) ?? []).length;
  const spacerGifs = (html.match(/spacer\.(gif|png)/gi) ?? []).length;
  const outdatedLayout = (tableCount > 3 && divCount < tableCount * 2) || fontTags > 2 || centerTags > 3 || spacerGifs > 0;
  add(
    'layout',
    'Moderne layout',
    outdatedLayout ? 'bad' : 'good',
    outdatedLayout
      ? `Verouderde techniek: ${fontTags} <font>-tags, ${centerTags} <center>-tags, ${spacerGifs} spacer-afbeeldingen en ${tableCount} tabellen voor de opmaak.`
      : 'Geen aanwijzingen voor tabellen-layout of verouderde opmaak-tags.',
    outdatedLayout ? 10 : 0,
    'mening'
  );

  const flash = /shockwave-flash|\.swf|application\/x-shockwave|<embed[\s>]/i.test(html);
  if (flash) {
    add('flash', 'Flash-content', 'bad', 'Flash wordt door geen enkele moderne browser meer ondersteund.', 8, 'gemeten');
  }

  const jquery = findJQueryVersion(html);
  if (jquery && jquery.major < OLD_JQUERY_MAJOR) {
    add(
      'jquery',
      'Verouderde JavaScript-bibliotheek',
      'bad',
      `jQuery ${jquery.raw} gevonden: die versie krijgt geen veiligheidsupdates meer.`,
      8,
      'afgeleid'
    );
  } else if (jquery) {
    add('jquery', 'JavaScript-bibliotheek', 'info', `jQuery ${jquery.raw} gevonden.`, 0, 'gemeten');
  }

  const copyrightYear = findCopyrightYear(html, text);
  const currentYear = new Date().getFullYear();
  if (copyrightYear && currentYear - copyrightYear >= COPYRIGHT_STALE_YEARS) {
    add(
      'copyright',
      'Actualiteit van de site',
      'bad',
      `De site vermeldt nog © ${copyrightYear}. De inhoud lijkt al ${currentYear - copyrightYear} jaar niet bijgewerkt.`,
      8,
      'afgeleid'
    );
  } else if (copyrightYear) {
    add('copyright', 'Actualiteit van de site', 'good', `De site noemt © ${copyrightYear}.`, 0, 'gemeten');
  }

  const hasForm = /<form[\s>]/i.test(html) && /<input[^>]+(type=["']?(email|text|tel)|name=)/i.test(html);
  add(
    'contact_form',
    'Contactformulier',
    hasForm ? 'good' : 'warn',
    hasForm
      ? 'Er staat een formulier op de site.'
      : 'Geen contactformulier gevonden: bezoekers moeten bellen of zelf een mailadres zoeken.',
    hasForm ? 0 : 6,
    'afgeleid'
  );

  const bookingPattern =
    /\b(reserve(ren|er|ring)?|reservierung|termin\s*(vereinbaren|buchung)|online\s*termin|afspraak\s*(maken|boeken)|boek\s*(nu|online)|book\s*now|booking|opentable|resmio|quandoo|calendly|thefork|zenchef|microsoft\s*bookings|treatwell|salonized)\b/i;
  const hasBooking = bookingPattern.test(text) || /calendly\.com|treatwell\.|salonized\./i.test(html);
  add(
    'booking',
    'Online reserveren / afspraak maken',
    hasBooking ? 'good' : 'warn',
    hasBooking
      ? 'Er is een online reservering of afspraakmogelijkheid gevonden.'
      : 'Geen online reserveren of afspraak maken gevonden: klanten moeten bellen, en dat kost je boekingen.',
    hasBooking ? 0 : 8,
    'afgeleid'
  );

  const hasPhoneLink = /href=["']tel:/i.test(html);
  add(
    'tap_to_call',
    'Klikbaar telefoonnummer',
    hasPhoneLink ? 'good' : 'warn',
    hasPhoneLink ? 'Het telefoonnummer is aanklikbaar op mobiel.' : 'Geen klikbare telefoonlink (tel:) gevonden.',
    hasPhoneLink ? 0 : 4
  );

  const emails = findPublicEmails(html, text);
  const hasContactPage = /href=["'][^"']*contact/i.test(html);
  add(
    'contact_page',
    'Contactpagina',
    hasContactPage ? 'good' : 'warn',
    hasContactPage ? 'Er is een contactpagina gelinkt.' : 'Geen duidelijke link naar een contactpagina gevonden.',
    hasContactPage ? 0 : 3
  );

  const noindex = /<meta[^>]+name=["']?robots["']?[^>]+noindex/i.test(html);
  if (noindex) {
    add('robots', 'Vindbaarheid in Google', 'bad', 'De pagina staat op noindex: Google mag hem niet tonen.', 10, 'gemeten');
  }

  const localBusinessSchema = /"@type"\s*:\s*"(LocalBusiness|Restaurant|HairSalon|Store|LocalBusiness)"/i.test(html);
  add(
    'structured_data',
    'Bedrijfsgegevens voor Google (structured data)',
    localBusinessSchema ? 'good' : 'warn',
    localBusinessSchema
      ? 'LocalBusiness structured data gevonden.'
      : 'Geen LocalBusiness structured data: je mist de uitgebreide weergave in Google.',
    localBusinessSchema ? 0 : 4,
    'gemeten'
  );

  const sizeKb = Math.round(fetchInfo.bytes / 1024);
  const slow = fetchInfo.ms > 2500;
  const heavy = sizeKb > 500;
  add(
    'performance',
    'Laadtijd en paginagrootte',
    slow || heavy ? 'warn' : 'good',
    `HTML geladen in ${fetchInfo.ms} ms, ${sizeKb} kB${fetchInfo.truncated ? ' (afgekapt op de limiet)' : ''}.`,
    slow || heavy ? 6 : 0
  );

  const scriptCount = (html.match(/<script[^>]+src=/gi) ?? []).length;
  add(
    'page_weight',
    'Aantal externe scripts',
    scriptCount > 12 ? 'warn' : 'info',
    scriptCount > 12
      ? `${scriptCount} externe scripts: dat vertraagt de pagina vaak flink.`
      : `${scriptCount} externe scripts gevonden.`,
    scriptCount > 12 ? 4 : 0
  );

  if (fetchInfo.contentType && !/text\/html/i.test(fetchInfo.contentType)) {
    add('content_type', 'HTML-pagina', 'info', `Content-Type is "${fetchInfo.contentType}".`, 0, 'gemeten');
  }

  return { checks, emails, title, description, copyrightYear };
}

/** websiteScore = 100 - som van de gewichten (met een ondergrens van 0). */
function computeWebsiteScore(checks) {
  const penalty = checks.reduce((total, check) => total + (check.status === 'good' ? 0 : check.weight || 0), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

/**
 * Audit een website.
 * @param {string} rawUrl   de website-URL van het bedrijf
 * @param {{timeoutMs?:number,maxBytes?:number}} options
 */
export async function auditWebsite(rawUrl, options = {}) {
  const requestedUrl = String(rawUrl ?? '').trim();
  const startedAt = Date.now();

  if (!requestedUrl) {
    return { ok: false, status: 'unavailable', reason: 'geen_website', message: 'Dit bedrijf heeft geen website in Google Maps.' };
  }
  if (!isSafePublicUrl(requestedUrl)) {
    return {
      ok: false,
      status: 'unavailable',
      reason: 'ongeldige_url',
      message: 'Deze URL kan niet geanalyseerd worden (geen publieke http(s)-link).',
    };
  }

  try {
    const fetchInfo = await fetchHtml(requestedUrl, options);
    const text = htmlToText(fetchInfo.html);
    const { checks, emails, title, description, copyrightYear } = runChecks({
      html: fetchInfo.html,
      text,
      fetchInfo,
      requestedUrl,
    });

    return {
      ok: true,
      status: 'ok',
      url: requestedUrl,
      finalUrl: fetchInfo.finalUrl,
      httpStatus: fetchInfo.status,
      metrics: {
        loadMs: fetchInfo.ms,
        htmlBytes: fetchInfo.bytes,
        sizeKb: Math.round(fetchInfo.bytes / 1024),
        truncated: fetchInfo.truncated,
        analysedAt: new Date().toISOString(),
        totalMs: Date.now() - startedAt,
      },
      seo: { title, description },
      copyrightYear,
      publicEmails: emails,
      checks,
      websiteScore: computeWebsiteScore(checks),
      problems: checks.filter((check) => check.status === 'bad' || check.status === 'warn').map((check) => check.label),
    };
  } catch (error) {
    const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return {
      ok: false,
      status: 'unavailable',
      url: requestedUrl,
      reason: isTimeout ? 'timeout' : 'fetch_failed',
      message: isTimeout
        ? 'De website reageerde niet binnen 10 seconden en is niet te analyseren.'
        : 'De website kon niet opgehaald worden en is niet te analyseren.',
      details: error?.message ?? String(error),
    };
  }
}

/** Alleen een lichte controle of de URL bruikbaar is (voor /api/leads). */
export function looksLikeWebsite(url) {
  return Boolean(url) && isSafePublicUrl(url);
}
