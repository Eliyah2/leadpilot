/**
 * ShortForge server entry point.
 * migrate → seed → recover jobs → start worker + scheduler → listen
 */
import { createApp } from './app.js';
import { CONFIG } from './config.js';
import { db } from './db/index.js';
import { migrate } from './db/schema.js';
import { seed, knowledgeStats } from './db/seed.js';
import { startWorker, stopWorker } from './jobs/worker.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';
import { recoverStuckJobs, queueStats } from './jobs/queue.js';
import { log } from './lib/logger.js';
import { get } from './db/index.js';
import os from 'node:os';

/** IPv4 addresses of this machine on the local network (for phone access). */
function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

async function main(): Promise<void> {
  migrate(db);
  seed();
  recoverStuckJobs();

  const app = createApp();
  const server = app.listen(CONFIG.PORT, CONFIG.HOST, () => {
    const stats = knowledgeStats();
    const hasUser = Boolean(get('SELECT id FROM users LIMIT 1'));
    log.info('ShortForge ready', {
      url: `http://${CONFIG.HOST === '0.0.0.0' ? 'localhost' : CONFIG.HOST}:${CONFIG.PORT}`,
      env: CONFIG.NODE_ENV,
      facts: stats.facts,
      queue: queueStats(),
    });
    console.log('');
    console.log(`  ShortForge is running → http://localhost:${CONFIG.PORT}`);
    if (CONFIG.HOST === '0.0.0.0') {
      for (const ip of lanAddresses()) console.log(`  On your phone (same Wi-Fi) → http://${ip}:${CONFIG.PORT}`);
    }
    console.log(`  ${stats.facts} sourced facts across ${stats.niches} niches loaded`);
    console.log(`  ${hasUser ? 'Sign in with your account' : 'First run: create the owner account in the browser'}`);
    if (!hasUser) console.log('  Tip: open the URL above, then register your account.');
    console.log('');
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`Port ${CONFIG.PORT} is already in use. Stop the other process or start with PORT=<other> npm start`);
      process.exit(1);
    }
    log.error('server error', String(err));
    process.exit(1);
  });

  startWorker();
  startScheduler();

  const shutdown = (signal: string) => {
    log.info(`received ${signal}, shutting down`);
    stopWorker();
    stopScheduler();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('failed to start', String(err));
  console.error(err);
  process.exit(1);
});
