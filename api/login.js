/**
 * api/login.js
 * Wachtwoordcontrole voor APP_PASSWORD.
 *
 * POST { password: "..." }  -> zet een HttpOnly cookie bij succes
 * DELETE                    -> logt uit (cookie wissen)
 * GET                       -> vertelt of er een wachtwoord nodig is
 */
import { authConfigured, checkAuth, clearCookieHeader, passwordMatches, sessionCookieHeader } from './_lib/auth.js';
import { isSameOrigin, methodNotAllowed, readJsonBody, sendError, sendOk } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const auth = checkAuth(req);
    return sendOk(res, { passwordRequired: authConfigured(), authenticated: auth.ok, mode: auth.ok ? auth.mode : 'locked' });
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearCookieHeader());
    return sendOk(res, { loggedOut: true });
  }

  if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);

  if (!isSameOrigin(req)) {
    return sendError(res, 403, 'cross_origin', 'Deze aanvraag komt van een andere site en is geweigerd.');
  }

  let body = {};
  try {
    body = await readJsonBody(req, 4096);
  } catch {
    return sendError(res, 400, 'invalid_body', 'De aanvraag kon niet gelezen worden.');
  }

  if (!authConfigured()) {
    return sendOk(res, { authenticated: true, mode: 'open', message: 'Er is geen APP_PASSWORD ingesteld; de app is open.' });
  }

  const password = String(body.password ?? '');
  if (!password) return sendError(res, 400, 'missing_password', 'Vul je wachtwoord in.');

  if (!passwordMatches(password)) {
    return sendError(res, 401, 'wrong_password', 'Dit wachtwoord klopt niet.');
  }

  res.setHeader('Set-Cookie', sessionCookieHeader());
  return sendOk(res, { authenticated: true, mode: 'password' });
}
