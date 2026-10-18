import { Router, type Request, type Response, type NextFunction } from 'express';
import { get, run } from '../db/index.js';
import { hashPassword, verifyPassword, randomToken } from '../lib/crypto.js';
import { validate, v, HttpError, EMAIL_RE } from '../lib/validate.js';
import { id, now } from '../lib/util.js';
import { createSession, setSessionCookie, clearSessionCookie, destroySession, requireAuth, authRateLimit, parseCookies, optionalAuth } from '../middleware/auth.js';
import { log } from '../lib/logger.js';

export const authRouter = Router();

function userView(u: any) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, locale: u.locale, createdAt: u.created_at };
}

authRouter.post('/register', authRateLimit(), (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = validate(req.body, {
      email: v.string({ min: 3, max: 200, pattern: EMAIL_RE }),
      password: v.string({ min: 8, max: 200 }),
      name: v.string({ min: 1, max: 80, default: '' }),
    });
    const existing = get('SELECT id FROM users WHERE email = ?', body.email.toLowerCase());
    if (existing) throw new HttpError(409, 'An account with this email already exists');

    const isFirst = !get('SELECT id FROM users LIMIT 1');
    const userId = id('usr');
    run(
      `INSERT INTO users (id, email, password_hash, name, role, locale, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, 'en', ?, ?)`,
      userId,
      body.email.toLowerCase(),
      hashPassword(body.password),
      body.name || body.email.split('@')[0]!,
      isFirst ? 'owner' : 'member',
      now(),
      now(),
    );
    const session = createSession(userId, req);
    setSessionCookie(res, session.token, session.expiresAt);
    const user = get('SELECT * FROM users WHERE id = ?', userId);
    log.info('user registered', { userId, first: isFirst });
    res.status(201).json({ user: userView(user), csrf: session.csrf });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', authRateLimit(), (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = validate(req.body, {
      email: v.string({ min: 3, max: 200, pattern: EMAIL_RE }),
      password: v.string({ min: 1, max: 200, trim: false }),
    });
    const user: any = get('SELECT * FROM users WHERE email = ?', body.email.toLowerCase());
    // constant-ish response to avoid user enumeration
    const ok = user && verifyPassword(body.password, user.password_hash);
    if (!ok) throw new HttpError(401, 'Incorrect email or password');
    run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), user.id);
    const session = createSession(user.id, req);
    setSessionCookie(res, session.token, session.expiresAt);
    res.json({ user: userView(user), csrf: session.csrf });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', (req: Request, res: Response) => {
  destroySession(req);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', (req: Request, res: Response, next: NextFunction) => {
  optionalAuth(req, res, () => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    const user = get('SELECT * FROM users WHERE id = ?', req.user.id);
    res.json({ user: userView(user), csrf: req.csrfToken ?? null });
  });
});

authRouter.post('/password', requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = validate(req.body, { current: v.string({ min: 1, max: 200, trim: false }), next: v.string({ min: 8, max: 200 }) });
    const user: any = get('SELECT * FROM users WHERE id = ?', req.user!.id);
    if (!verifyPassword(body.current, user.password_hash)) throw new HttpError(401, 'Current password is incorrect');
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(body.next), user.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Bootstrap CSRF token for clients that just loaded the page. */
authRouter.get('/csrf', (req: Request, res: Response, next: NextFunction) => {
  try {
    const cookies = parseCookies(req);
    if (!cookies.sf_session) return res.json({ csrf: null });
    optionalAuth(req, res, () => res.json({ csrf: req.csrfToken ?? null }));
  } catch (err) {
    next(err);
  }
});

export { randomToken };
