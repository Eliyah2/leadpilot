/**
 * api/_lib/http.js
 * Kleine HTTP-hulpjes voor alle serverless functies.
 * Alles werkt met de standaard Node request/response-objecten van Vercel,
 * zodat dezelfde code ook in een gewone Node-testserver werkt.
 */
import crypto from 'node:crypto';

/** Standaard beveiligingsheaders op elke API-respons. */
export const DEFAULT_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'no-store, max-age=0',
};

/** Stuur een JSON-respons. Geeft altijd `true` terug zodat je `return sendJson(...)` kunt schrijven. */
export function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload ?? null);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [key, value] of Object.entries({ ...DEFAULT_HEADERS, ...extraHeaders })) {
    res.setHeader(key, value);
  }
  res.end(body);
  return true;
}

/** Succesrespons in een vaste envelop: { ok: true, ...data }. */
export function sendOk(res, data = {}, extraHeaders = {}) {
  return sendJson(res, 200, { ok: true, ...data }, extraHeaders);
}

/** Foutrespons in een vaste envelop: { ok: false, error: { code, message } }. */
export function sendError(res, status, code, message, extra = {}) {
  return sendJson(res, status, { ok: false, error: { code, message, ...extra } });
}

/** 405 met een nette Allow-header. */
export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  return sendError(res, 405, 'method_not_allowed', `Methode niet toegestaan. Gebruik: ${allowed.join(', ')}.`);
}

/** Header uitlezen (werkt met kleine en grote letters, en met array-waarden). */
export function getHeader(req, name) {
  const headers = req.headers ?? {};
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return Array.isArray(value) ? value[0] : value;
}

/** IP-adres van de bezoeker, via de header die Vercel meestuurt. */
export function getClientIp(req) {
  const forwarded = getHeader(req, 'x-forwarded-for');
  if (forwarded) return String(forwarded).split(',')[0].trim();
  const real = getHeader(req, 'x-real-ip');
  if (real) return String(real).trim();
  return req.socket?.remoteAddress ?? 'onbekend';
}

/** Cookies parsen naar een simpel object. */
export function parseCookies(req) {
  const raw = getHeader(req, 'cookie');
  const out = {};
  if (!raw) return out;
  for (const part of String(raw).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

/**
 * Lees de JSON-body. Vercel parseert JSON al vaak voor ons; in dat geval
 * gebruiken we dat direct. Anders lezen we de stream zelf met een limiet
 * zodat een enorme body de functie niet kan laten crashen.
 */
export async function readJsonBody(req, limitBytes = 32 * 1024) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    if (req.body.length > limitBytes) throw new Error('body_too_large');
    try {
      return req.body ? JSON.parse(req.body) : {};
    } catch {
      throw new Error('invalid_json');
    }
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('invalid_json');
  }
}

/** HMAC-SHA256 als hex. Wordt gebruikt voor het sessiecookie. */
export function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

/** Tijdconstante stringvergelijking (voorkomt timing-aanvallen op het wachtwoord). */
export function safeEqual(a, b) {
  const bufferA = Buffer.from(String(a ?? ''), 'utf8');
  const bufferB = Buffer.from(String(b ?? ''), 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * Bescherming tegen cross-site aanroepen: bij een POST/PUT/DELETE moet de
 * Origin-header (indien aanwezig) gelijk zijn aan de eigen Host.
 */
export function isSameOrigin(req) {
  const origin = getHeader(req, 'origin');
  if (!origin) return true; // geen Origin (bijv. curl of server-side) -> toestaan
  try {
    const host = getHeader(req, 'host');
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Valideer een URL voor de auditor. Alleen http(s), geen lokale/private
 * adressen en alleen de standaardpoorten (SSRF-bescherming).
 */
export function isSafePublicUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  // Tijdens lokaal ontwikkelen en in de tests mag je ook een lokale testserver
  // analyseren. In productie staat deze vlag uit en gelden alle controles.
  if (process.env.ALLOW_PRIVATE_AUDIT_TARGETS === 'true') return true;

  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (!['80', '443'].includes(port)) return false;

  const host = url.hostname.toLowerCase();
  const privatePatterns = [
    /^localhost$/,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^169\.254\./,
    /^0\./,
    /^\[?::1\]?$/,
    /\.local$/,
    /^\[?fc00:/i,
    /^\[?fe80:/i,
  ];
  if (!host.includes('.') || privatePatterns.some((pattern) => pattern.test(host))) return false;
  return true;
}
