#!/usr/bin/env node
/**
 * Makes ShortForge start automatically when you log in to Windows.
 *
 *   node scripts/install-autostart.mjs          # install
 *   node scripts/install-autostart.mjs remove   # undo
 *
 * It drops a tiny .cmd into the per-user Startup folder (no admin rights
 * needed, nothing outside this project is touched except that one shortcut)
 * which runs `node scripts/server.mjs start` — the server detaches itself,
 * so the window closes immediately and ShortForge keeps running.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeExe = process.execPath;
const mode = process.argv[2] ?? 'install';

const startupDir = path.join(
  process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
  'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
);
const cmdPath = path.join(startupDir, 'ShortForge.cmd');

if (mode === 'remove') {
  fs.rmSync(cmdPath, { force: true });
  console.log(`removed ${cmdPath}`);
  process.exit(0);
}

fs.mkdirSync(startupDir, { recursive: true });
const script = [
  '@echo off',
  'rem ShortForge autostart (generated — remove with: node scripts/install-autostart.mjs remove)',
  `cd /d "${ROOT}"`,
  `"${nodeExe}" scripts\\server.mjs start`,
  '',
].join('\r\n');
fs.writeFileSync(cmdPath, script, 'utf8');
console.log(`installed: ${cmdPath}`);
console.log('ShortForge now starts at every logon. Undo with: node scripts/install-autostart.mjs remove');
