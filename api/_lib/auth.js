/**
 * api/_lib/auth.js
 * Eenvoudige wachtwoordbeveiliging met APP_PASSWORD.
 *
 * - Zonder APP_PASSWORD draait de app in "open modus" (handig lokaal/demo).
 *   De frontend toont dan een waarschuwing.
 * - Met APP_PASSWORD accepteert de API twee dingen:
 *     1. de header  x-app-password: <wachtwoord>
 *     2. het cookie lp_auth dat /api/login heeft gezet (HttpOnly)
 */
import { getHeader, parseCookies, safeEqual, sign } from './http.js';

const COOKIE_NAME = 'lp_auth';
const SESSION_LABEL = 'leadpilot-sessie-v1';
const SESSION_DAYS = 30;

/** Is er een wachtwoord ingesteld? */
export function authConfigured() {
  return Boolean((process.env.APP_PASSWORD ?? '').trim());
}

/** Het cookie-token: een HMAC met het wachtwoord als sleutel. Nooit het wachtwoord zelf. */
export function sessionToken() {
  return sign(SESSION_LABEL, (process.env.APP_PASSWORD ?? '').trim());
}

/**
 * Controleer de aanvraag.
 * @returns {{ ok: true, mode: 'password'|'open' } | { ok: false, reason: string }}
 */
export function checkAuth(req) {
  if (!authConfigured()) return { ok: true, mode: 'open' };

  const headerPassword = getHeader(req, 'x-app-password');
  if (headerPassword && safeEqual(headerPassword, (process.env.APP_PASSWORD ?? '').trim())) {
    return { ok: true, mode: 'password' };
  }

  const cookies = parseCookies(req);
  const cookie = cookies[COOKIE_NAME];
  if (cookie && safeEqual(cookie, sessionToken())) {
    return { ok: true, mode: 'password' };
  }

  return { ok: false, reason: 'Voer je wachtwoord in om verder te gaan.' };
}

/** Vergelijk een ingetypt wachtwoord met APP_PASSWORD (voor /api/login). */
export function passwordMatches(candidate) {
  if (!authConfigured()) return false;
  return safeEqual(candidate, (process.env.APP_PASSWORD ?? '').trim());
}

/** Set-Cookie header voor een geslaagde login. */
export function sessionCookieHeader() {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${COOKIE_NAME}=${encodeURIComponent(sessionToken())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Secure`;
}

/** Set-Cookie header om uit te loggen. */
export function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`;
}
