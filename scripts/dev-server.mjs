#!/usr/bin/env node
/**
 * scripts/dev-server.mjs
 * Kleine lokale server om LeadPilot te testen zonder Vercel CLI.
 *
 *   - serveert de statische bestanden uit public/
 *   - stuurt /api/... naar de echte serverless functies in api/
 *   - leest .env (bestaat die niet, dan werkt de app in demo-modus)
 *
 * Starten: npm run dev:local
 * Daarna openen: http://127.0.0.1:4321
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const API_DIR = path.join(ROOT, 'api');
const PORT = Number(process.env.PORT) || 4321;

// Procesvariabelen hebben voorrang, daarna .env.local en ten slotte .env.
for (const name of ['.env.local', '.env']) {
  const envFile = path.join(ROOT, name);
  if (!fs.existsSync(envFile)) continue;
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, '').trim();
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
  console.log(`Bestand ${name} ingelezen.`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = path.join(PUBLIC_DIR, decodeURIComponent(url.pathname));
  // Nooit buiten public/ komen te staan.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    res.end('Verboden');
    return;
  }
  if (url.pathname === '/' || !path.extname(filePath)) {
    const indexFile = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexFile)) filePath = indexFile;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Niet gevonden');
    return;
  }
  res.setHeader('Content-Type', MIME[path.extname(filePath)] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, name) {
  const file = path.join(API_DIR, `${name}.js`);
  if (!fs.existsSync(file)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: { code: 'not_found', message: `Geen API-route: ${name}` } }));
    return;
  }
  try {
    const module = await import(pathToFileURL(file).href);
    await module.default(req, res);
  } catch (error) {
    console.error(`Fout in /api/${name}:`, error);
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: { code: 'server_error', message: error.message } }));
    }
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const startedAt = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${url.pathname} -> ${res.statusCode} (${Date.now() - startedAt} ms)`);
  });

  const apiMatch = url.pathname.match(/^\/api\/([a-z0-9-]+)\/?$/i);
  if (apiMatch) {
    handleApi(req, res, apiMatch[1]);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nLeadPilot draait op http://127.0.0.1:${PORT}`);
  console.log(`Diagnose: http://127.0.0.1:${PORT}/api/health\n`);
});
