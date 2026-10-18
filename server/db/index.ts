import { DatabaseSync } from 'node:sqlite';
import { CONFIG } from '../config.js';
import { log } from '../lib/logger.js';

// node:sqlite is still flagged experimental in Node 22 — silence only that warning.
const originalEmitWarning = process.emitWarning;
(process as any).emitWarning = function (warning: unknown, ...rest: any[]) {
  const text = typeof warning === 'string' ? warning : String((warning as Error)?.message ?? '');
  if (text.includes('SQLite is an experimental feature')) return;
  return (originalEmitWarning as any)(warning, ...rest);
};

export const db = new DatabaseSync(CONFIG.DB_FILE);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 8000;');
db.exec('PRAGMA synchronous = NORMAL;');

/** node:sqlite only binds null/number/bigint/string/Uint8Array — normalise JS values. */
function bindable(value: unknown): any {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  return value;
}

export function all<T = any>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...params.map(bindable)) as unknown as T[];
}

export function get<T = any>(sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...params.map(bindable)) as unknown as T | undefined;
}

export function run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
  try {
    const res = db.prepare(sql).run(...params.map(bindable));
    return { changes: Number(res.changes), lastInsertRowid: res.lastInsertRowid };
  } catch (err) {
    // Attach the statement so SQL errors are immediately diagnosable.
    const message = err instanceof Error ? err.message : String(err);
    const wrapped = new Error(`${message} :: ${sql.replace(/\s+/g, ' ').slice(0, 300)}`);
    (wrapped as any).cause = err;
    throw wrapped;
  }
}

/** Run several statements atomically. */
export function exec(sql: string): void {
  db.exec(sql);
}

let txDepth = 0;
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) {
    // nested: use a savepoint so an inner failure doesn't kill the outer tx
    const sp = `sp_${txDepth}_${Date.now()}`;
    db.exec(`SAVEPOINT ${sp}`);
    txDepth++;
    try {
      const out = fn();
      db.exec(`RELEASE ${sp}`);
      return out;
    } catch (err) {
      db.exec(`ROLLBACK TO ${sp}`);
      db.exec(`RELEASE ${sp}`);
      throw err;
    } finally {
      txDepth--;
    }
  }
  db.exec('BEGIN IMMEDIATE');
  txDepth = 1;
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch (e) {
      log.warn('transaction rollback failed', String(e));
    }
    throw err;
  } finally {
    txDepth = 0;
  }
}

export function insert(table: string, data: Record<string, unknown>): string {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  const res = run(sql, ...keys.map((k) => data[k]));
  // Prefer the logical id when the table uses a TEXT primary key: SQLite's
  // last_insert_rowid() reflects the implicit rowid, not the text id.
  if (data.id !== undefined && data.id !== null) return String(data.id);
  return String(res.lastInsertRowid);
}

export function update(table: string, id: string, data: Record<string, unknown>): void {
  const keys = Object.keys(data);
  if (!keys.length) return;
  run(
    `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    ...keys.map((k) => data[k]),
    id,
  );
}
