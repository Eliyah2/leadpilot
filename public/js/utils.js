/**
 * public/js/utils.js
 * Algemene hulpjes die nergens anders van afhangen.
 */

/** Unieke id zonder externe library. */
export function uid(prefix = 'id') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

/** Vandaag als YYYY-MM-DD (lokale tijd, niet UTC). */
export function todayISO(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

/** Datum + tijd leesbaar in het Nederlands. */
export function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** "3 dagen geleden" / "over 2 dagen". */
export function relativeDays(value) {
  if (!value) return '';
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return '';
  const days = Math.round((startOfDay(target) - startOfDay(new Date())) / 86_400_000);
  if (days === 0) return 'vandaag';
  if (days === 1) return 'morgen';
  if (days === -1) return 'gisteren';
  if (days < 0) return `${Math.abs(days)} dagen geleden`;
  return `over ${days} dagen`;
}

export function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Aantal dagen tussen twee datums (positief = in de toekomst). */
export function daysBetween(from, to) {
  return Math.round((startOfDay(new Date(to)) - startOfDay(new Date(from))) / 86_400_000);
}

/** Datum N dagen vanaf nu, als YYYY-MM-DD. */
export function addDays(days, from = new Date()) {
  const date = new Date(from);
  date.setDate(date.getDate() + days);
  return todayISO(date);
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** Debounce voor invoervelden. */
export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Zorg dat een URL begint met https:// (voor de auditor). */
export function normalizeUrl(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Alleen cijfers en een eventueel plusteken, voor telefoonvergelijking. */
export function phoneDigits(value) {
  return String(value ?? '').replace(/[^\d+]/g, '');
}

/** Domein zonder www/protocol, voor vergelijking en weergave. */
export function domainOf(value) {
  if (!value) return '';
  try {
    const url = new URL(normalizeUrl(value));
    return url.hostname.replace(/^www\./i, '');
  } catch {
    return String(value).replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
  }
}

/**
 * Sleutel om dubbele leads te herkennen: place_id heeft voorrang,
 * daarna website, daarna telefoonnummer.
 */
export function dedupeKeys(lead) {
  const keys = [];
  if (lead.placeId) keys.push(`place:${lead.placeId}`);
  if (lead.website) keys.push(`site:${domainOf(lead.website)}`);
  if (lead.phone) keys.push(`tel:${phoneDigits(lead.phone)}`);
  return keys;
}

/**
 * Extra dubbelsignaal op basis van adres. Alleen gebruikt om een mogelijk
 * duplicaat aan te wijzen; er wordt nooit automatisch samengevoegd.
 */
export function addressKey(lead) {
  const street = String(lead.street ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const city = String(lead.city ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!street || !city) return '';
  return `addr:${street}|${city}`;
}

/** Kopieer naar klembord, met een fallback voor oudere/onveilige contexten. */
export async function copyToClipboard(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* val terug op de oude methode */
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Bestand downloaden vanuit de browser. */
export function downloadFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Schrijf naar het klembord en open daarna de mailapp (mailto). */
export function openMailto({ to = '', subject = '', body = '' }) {
  const params = new URLSearchParams();
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);
  const query = params.toString().replace(/\+/g, '%20');
  const url = `mailto:${encodeURIComponent(to)}?${query}`;
  window.location.href = url;
  return url;
}

/** Woorden tellen (voor de e-maillimiet van 120 woorden). */
export function countWords(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** Veilige JSON-parse met fallback. */
export function safeParse(json, fallback = null) {
  if (!json) return fallback;
  try {
    const value = JSON.parse(json);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

/** Diepe kopie zonder verrassingen (gestructureerde data). */
export function deepClone(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* val terug op JSON */
    }
  }
  return safeParse(JSON.stringify(value), value);
}

/** Kleine, stabiele hash - gebruikt om varianten per lead te kiezen. */
export function hashString(value) {
  let hash = 0;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Kies een element uit een lijst op basis van een zaadwaarde. */
export function pickSeeded(list, seed, offset = 0) {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return list[(Number(seed) + offset) % list.length];
}
