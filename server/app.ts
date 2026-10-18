import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { CONFIG } from './config.js';
import { securityHeaders, rateLimit, optionalAuth, requireAuth } from './middleware/auth.js';
import { HttpError } from './lib/validate.js';
import { authRouter } from './routes/auth.js';
import { contentRouter } from './routes/content.js';
import { mediaRouter } from './routes/media.js';
import { systemRouter } from './routes/system.js';
import { youtubeRouter } from './routes/youtube.js';
import { scheduleRouter } from './routes/schedule.js';
import { log } from './lib/logger.js';

export function createApp(): express.Express {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(securityHeaders);

  // JSON body parsing — a higher limit only for asset uploads (local app)
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const isUpload = req.path === '/assets/upload';
    express.json({ limit: isUpload ? '150mb' : '10mb' })(req, res, next);
  });
  app.use('/api', express.urlencoded({ extended: false, limit: '1mb' }));

  // rate limiting (strict for auth, generous for the rest)
  app.use('/api', rateLimit({ windowMs: 60_000, max: 600, bucket: 'api' }));
  app.use('/media', rateLimit({ windowMs: 60_000, max: 600, bucket: 'media' }));
  // Rendered files are private: the session gate covers /media too (the /api gate does not).
  app.use('/media', requireAuth);

  // Single authentication gate: every /api route needs a session (plus a CSRF
  // header on mutations) except the explicitly public endpoints below.
  const PUBLIC_API = new Set([
    '/auth/register',
    '/auth/login',
    '/auth/logout',
    '/auth/me',
    '/auth/csrf',
    '/youtube/callback',
    '/health',
  ]);
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (PUBLIC_API.has(req.path)) return next();
    requireAuth(req, res, next);
  });

  app.use('/api/auth', authRouter);
  app.use('/api/youtube', youtubeRouter);
  app.use('/api/schedule', scheduleRouter);
  app.use('/api', optionalAuth, contentRouter);
  app.use('/api', optionalAuth, mediaRouter);
  app.use('/api', optionalAuth, systemRouter);
  /* --------- media files (whitelisted roots, traversal-proof) --------- */
  const MEDIA_ROOTS: Record<string, string> = {
    video: CONFIG.DIRS.video,
    covers: CONFIG.DIRS.covers,
    audio: CONFIG.DIRS.audio,
    assets: CONFIG.DIRS.assets,
    exports: CONFIG.DIRS.exports,
    fonts: CONFIG.DIRS.fonts,
  };
  app.get('/media/*', (req: Request, res: Response) => {
    const rel = decodeURIComponent(req.path.replace(/^\/media\//, ''));
    const [rootName, ...rest] = rel.split('/');
    const root = rootName ? MEDIA_ROOTS[rootName] : undefined;
    if (!root || !rest.length) return res.status(404).json({ error: 'Not found' });
    const target = path.resolve(root, rest.join('/'));
    const base = path.resolve(root);
    if (target !== base && !target.startsWith(base + path.sep)) {
      return res.status(403).json({ error: 'Forbidden path' });
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }
    const ext = path.extname(target).toLowerCase();
    const types: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.json': 'application/json',
      '.txt': 'text/plain; charset=utf-8',
      '.zip': 'application/zip',
      '.ttf': 'font/ttf',
      '.ass': 'text/plain; charset=utf-8',
      '.srt': 'text/plain; charset=utf-8',
    };
    res.setHeader('Content-Type', types[ext] ?? 'application/octet-stream');
    if (ext === '.mp4') res.setHeader('Accept-Ranges', 'bytes');
    res.sendFile(target);
  });

  /* ---------------------- SPA static ---------------------- */
  const distDir = path.join(CONFIG.ROOT, 'client', 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/media')) return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    app.get('/', (_req: Request, res: Response) => {
      res.status(200).type('html').send(`<!doctype html><html><head><title>ShortForge</title>
        <style>body{font-family:system-ui;background:#0b1020;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0}
        .card{max-width:560px;padding:32px;border:1px solid #1e293b;border-radius:16px}
        code{background:#1e293b;padding:2px 6px;border-radius:6px}</style></head>
        <body><div class="card"><h1>ShortForge API is running 🚀</h1>
        <p>The web interface has not been built yet. Run one of:</p>
        <p><code>npm run dev</code> &nbsp; (API + Vite dev server)</p>
        <p><code>npm run build</code> then <code>npm start</code> &nbsp; (production)</p>
        <p>API health: <a style="color:#38bdf8" href="/api/health">/api/health</a></p></div></body></html>`);
    });
  }

  /* ---------------------- errors ---------------------- */
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    const anyErr = err as any;
    if (anyErr?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    if (anyErr?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Payload too large' });
    }
    const message = err instanceof Error ? err.message : String(err);
    log.error('request error', { message, stack: CONFIG.NODE_ENV !== 'production' ? (err as Error)?.stack : undefined });
    res.status(500).json({
      error: message || 'Internal server error',
      ...(CONFIG.NODE_ENV !== 'production' && (err as Error)?.stack ? { stack: (err as Error).stack } : {}),
    });
  });

  return app;
}
