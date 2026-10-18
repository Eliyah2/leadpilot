#!/usr/bin/env node
/**
 * ShortForge test runner.
 * Discovers server/tests/**\/*.test.ts and runs them with node's built-in test
 * runner plus the tsx loader. Uses an isolated storage directory so tests never
 * touch real data.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = path.join(ROOT, 'server', 'tests');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

const only = process.argv.slice(2);
let files = walk(TEST_DIR).sort();
if (only.length) files = files.filter((f) => only.some((o) => f.includes(o)));
if (!files.length) {
  console.error('No test files found in server/tests');
  process.exit(1);
}

// fresh isolated storage for this run
const testStorage = path.join(ROOT, 'storage-test');
fs.rmSync(testStorage, { recursive: true, force: true });
fs.mkdirSync(testStorage, { recursive: true });

const env = {
  ...process.env,
  NODE_ENV: 'test',
  STORAGE_DIR: 'storage-test',
  DB_FILE: 'test.db',
  LOG_LEVEL: process.env.SF_TEST_LOG || 'error',
  SF_ALLOW_NETWORK: process.env.SF_TEST_NETWORK === '1' ? '1' : process.env.SF_ALLOW_NETWORK || '0',
  SESSION_TTL_DAYS: '1',
};

// Run files one at a time: they share a single SQLite database, and parallel
// files race on the "first account becomes owner" rule and on writer locks.
const args = ['--import', 'tsx', '--test', '--test-concurrency=1', ...files];
const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: 'inherit' });
child.on('exit', (code) => {
  process.exit(code ?? 1);
});
