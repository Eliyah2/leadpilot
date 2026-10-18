import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const minLevel = ORDER[(CONFIG.LOG_LEVEL as Level) || 'info'] ?? 20;
const logFile = path.join(CONFIG.DIRS.logs, 'shortforge.log');

function fileLog(level: Level, msg: string, meta?: unknown) {
  try {
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, meta }) + '\n';
    fs.appendFileSync(logFile, line);
  } catch {
    /* logging must never crash the app */
  }
}

function fmt(level: Level, msg: string, meta?: unknown): string {
  const ts = new Date().toISOString().slice(11, 19);
  const extra = meta === undefined ? '' : ' ' + (typeof meta === 'string' ? meta : safe(meta));
  return `[${ts}] ${level.toUpperCase().padEnd(5)} ${msg}${extra}`;
}

function safe(meta: unknown): string {
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

export const log = {
  debug(msg: string, meta?: unknown) {
    if (ORDER.debug >= minLevel) console.log(fmt('debug', msg, meta));
    fileLog('debug', msg, meta);
  },
  info(msg: string, meta?: unknown) {
    if (ORDER.info >= minLevel) console.log(fmt('info', msg, meta));
    fileLog('info', msg, meta);
  },
  warn(msg: string, meta?: unknown) {
    if (ORDER.warn >= minLevel) console.warn(fmt('warn', msg, meta));
    fileLog('warn', msg, meta);
  },
  error(msg: string, meta?: unknown) {
    if (ORDER.error >= minLevel) console.error(fmt('error', msg, meta));
    fileLog('error', msg, meta);
  },
};
