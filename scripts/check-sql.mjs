#!/usr/bin/env node
/** Static check: every INSERT INTO x (cols) VALUES (vals) must have equal counts. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.includes(`${path.sep}tests${path.sep}`)) out.push(p);
  }
  return out;
}

function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  let inStr = false;
  let quote = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === quote && s[i - 1] !== '\\') inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = true;
      quote = c;
      cur += c;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

let mismatches = 0;
for (const file of walk(path.join(ROOT, 'server'))) {
  const src = fs.readFileSync(file, 'utf8');
  const re = /INSERT\s+INTO\s+([a-z_]+)\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)/gi;
  let m;
  while ((m = re.exec(src))) {
    const cols = splitTop(m[2]).length;
    const vals = splitTop(m[3]).length;
    if (cols !== vals) {
      mismatches++;
      const line = src.slice(0, m.index).split('\n').length;
      console.log(`MISMATCH ${path.relative(ROOT, file)}:${line} table=${m[1]} cols=${cols} vals=${vals}`);
    }
  }
}
console.log(mismatches ? `${mismatches} mismatch(es) found` : 'All INSERT statements balanced');
process.exit(mismatches ? 1 : 0);
