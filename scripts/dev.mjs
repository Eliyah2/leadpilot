#!/usr/bin/env node
/** Runs the API server and the Vite dev server together with prefixed output. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

function run(name, cmd, args, color) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, FORCE_COLOR: '1' },
    shell: isWin,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    if (code !== 0) shutdown(code ?? 1);
  });
  return child;
}

const children = [];
function shutdown(code = 0) {
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {}
  }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

children.push(run('api', 'npx', ['tsx', 'watch', 'server/index.ts'], '36'));
children.push(run('web', 'npx', ['vite', '--host'], '35'));
