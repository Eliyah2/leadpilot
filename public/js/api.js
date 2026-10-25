/**
 * public/js/api.js
 * Praat met de serverless functies in /api.
 *
 * - Stuurt het wachtwoord mee als header (x-app-password) én gebruikt het
 *   HttpOnly-cookie dat /api/login zet.
 * - Zet elke fout om in een Nederlandse ApiError met een `code`, zodat de UI
 *   een nette melding kan tonen in plaats van "Failed to fetch".
 */

const PASSWORD_KEY = 'leadpilot.auth.password';

export class ApiError extends Error {
  constructor(message, { code = 'error', status = 0, details = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

let password = '';
try {
  password = window.localStorage.getItem(PASSWORD_KEY) ?? '';
} catch {
  password = '';
}

async function request(path, { method = 'GET', body, query } = {}) {
  const url = new URL(path, window.location.origin);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    });
  }

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (password) headers['x-app-password'] = password;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError('Geen verbinding met de server. Controleer je internetverbinding.', {
      code: 'offline',
      details: error?.message ?? '',
    });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.ok === false) {
    throw new ApiError(payload?.error?.message ?? `De server gaf een foutmelding (${response.status}).`, {
      code: payload?.error?.code ?? `http_${response.status}`,
      status: response.status,
      details: payload?.error?.details ?? '',
    });
  }

  return payload ?? {};
}

export const api = {
  hasPassword() {
    return Boolean(password);
  },

  /** Het bewaarde wachtwoord, zodat we het cookie opnieuw kunnen zetten. */
  getPassword() {
    return password;
  },

  setPassword(value, { remember = true } = {}) {
    password = String(value ?? '');
    try {
      if (remember && password) window.localStorage.setItem(PASSWORD_KEY, password);
      else window.localStorage.removeItem(PASSWORD_KEY);
    } catch {
      /* localStorage geblokkeerd: dan alleen in het geheugen */
    }
  },

  clearPassword() {
    password = '';
    try {
      window.localStorage.removeItem(PASSWORD_KEY);
    } catch {
      /* niets */
    }
  },

  /** Is er een wachtwoord nodig en zijn we al binnen? */
  session() {
    return request('/api/login');
  },

  login(value) {
    return request('/api/login', { method: 'POST', body: { password: value } });
  },

  logout() {
    return request('/api/login', { method: 'DELETE' });
  },

  health() {
    return request('/api/health');
  },

  /**
   * Zoek leads. `exclude` mag een array place_id's zijn (max 500).
   * Zonder API-sleutel krijg je { mode: 'demo', searchLinks: [...] } terug.
   */
  fetchLeads({ q, lat, lng, radius, lang, country, exclude = [], want = 10, pages = 2 }) {
    return request('/api/leads', {
      method: 'POST',
      body: { q, lat, lng, radius, lang, country, exclude: exclude.slice(-500), want, pages },
    });
  },

  /** Website-analyse. Geeft { audit, cached } terug. */
  audit(url, { force = false } = {}) {
    return request('/api/audit', { method: 'POST', body: { url, force: force ? 1 : 0 } });
  },

  /** Optionele KV-synchronisatie (geeft een ApiError met code kv_not_configured). */
  stateGet(key) {
    return request('/api/state', { query: { key } });
  },

  statePut(key, value) {
    return request('/api/state', { method: 'PUT', body: { key, value } });
  },
};
