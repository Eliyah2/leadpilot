#!/usr/bin/env node
/**
 * ShortForge dev server control:  node scripts/server.mjs [start|stop|restart|status|logs]
 * Cross-platform (kills whatever listens on the ShortForge port first).
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG = path.join(ROOT, 'storage', 'server.out');
const isWin = process.platform === 'win32';

function envPort() {
  const sf = Number(process.env.SF_PORT);
  if (Number.isInteger(sf) && sf > 0) return sf;
  const p = Number(process.env.PORT);
  return Number.isInteger(p) && p > 0 ? p : 4400;
}
const PORT = envPort();

function pidsOnPort() {
  const pids = new Set();
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes(`:${PORT}`)) continue;
      if (!/LISTENING/i.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[parts.length - 1]);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
  } catch {}
  return [...pids];
}

/** Any node process running this app (stale workers would double-claim jobs). */
function staleServerPids() {
  if (!isWin) return [];
  try {
    const script =
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
      "Where-Object { $_.CommandLine -like '*server/index.ts*' } | " +
      'ForEach-Object { Write-Output $_.ProcessId }';
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
    return out
      .split(/\s+/)
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

function killPort() {
  const pids = new Set([...pidsOnPort(), ...staleServerPids()]);
  for (const pid of pids) {
    try {
      if (isWin) execFileSync('taskkill', ['/PID', String(pid), '/F', '/T'], { stdio: 'ignore' });
      else process.kill(pid, 'SIGTERM');
      console.log(`stopped pid ${pid}`);
    } catch (err) {
      console.log(`could not stop pid ${pid}: ${err.message}`);
    }
  }
}

function start() {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, `\n----- server start ${new Date().toISOString()} -----\n`);
  const fd = fs.openSync(LOG, 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, SF_PORT: String(PORT) },
  });
  child.unref();
  console.log(`started ShortForge server pid ${child.pid} on port ${PORT}`);
}

const cmd = process.argv[2] ?? 'status';
if (cmd === 'start') start();
else if (cmd === 'stop') killPort();
else if (cmd === 'restart') {
  killPort();
  setTimeout(start, 600);
} else if (cmd === 'status') {
  const pids = pidsOnPort();
  console.log(pids.length ? `running on port ${PORT} (pid ${pids.join(', ')})` : `not running on port ${PORT}`);
} else if (cmd === 'logs') {
  const n = Number(process.argv[3] ?? 60);
  if (fs.existsSync(LOG)) {
    const lines = fs.readFileSync(LOG, 'utf8').split(/\r?\n/);
    console.log(lines.slice(-n).join('\n'));
  }
} else {
  console.log('usage: node scripts/server.mjs [start|stop|restart|status|logs]');
}
