import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, all, get, run, tx, insert, update } from '../db/index.js';
import { migrate } from '../db/schema.js';
import { seed, NICHES, knowledgeStats, DEFAULT_SETTINGS } from '../db/seed.js';
import { id, slugify, similarity, rng, estimateSpeechSeconds } from '../lib/util.js';
import { hashPassword, verifyPassword, encrypt, decrypt } from '../lib/crypto.js';
import { validate, v, HttpError } from '../lib/validate.js';

test('migrate creates all core tables', () => {
  migrate(db);
  const tables = all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  );
  const names = new Set(tables.map((t) => t.name));
  for (const t of [
    'users', 'channels', 'niches', 'knowledge', 'sources', 'topics', 'hooks', 'scripts',
    'videos', 'scenes', 'voiceovers', 'assets', 'schedules', 'published_videos', 'analytics',
    'experiments', 'experiment_variants', 'generation_jobs', 'generation_logs', 'settings',
    'batches', 'insights', 'usage_events', 'trend_snapshots', 'sessions', 'video_sources',
  ]) {
    assert.ok(names.has(t), `missing table ${t}`);
  }
});

test('seed inserts niches, corpus and settings exactly once', () => {
  migrate(db);
  seed();
  const afterFirst = all<{ key: string }>('SELECT key FROM settings').map((r) => r.key);
  seed(); // idempotent
  const niches = all('SELECT * FROM niches');
  assert.equal(niches.length, NICHES.length);
  const stats = knowledgeStats();
  assert.ok(stats.facts > 90, `expected a large corpus, got ${stats.facts}`);
  assert.ok(stats.niches >= 13);
  // Seeding again must not duplicate rows or drop any default key, and every
  // default must be present even when other tests added their own settings.
  const settings = all<{ key: string }>('SELECT key FROM settings').map((r) => r.key);
  assert.deepEqual(settings.slice().sort(), afterFirst.slice().sort(), 'seed must be idempotent');
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    assert.ok(settings.includes(key), `missing default setting ${key}`);
  }
});

test('foreign keys and cascade deletes work', () => {
  migrate(db);
  seed();
  // Use a throwaway niche: deleting a built-in one would break later test files.
  const nicheId = id('nch');
  insert('niches', { id: nicheId, name: 'Cascade test', slug: 'cascade-test', created_at: Date.now() });
  const topicId = insert('topics', {
    id: id('top'),
    niche_id: nicheId,
    title: 'Test topic',
    slug: slugify('Test topic'),
    created_at: Date.now(),
  });
  const hookId = insert('hooks', {
    id: id('h'),
    topic_id: topicId,
    text: 'Test hook',
    created_at: Date.now(),
  });
  const hook = get('SELECT * FROM hooks WHERE id = ?', hookId);
  assert.ok(hook);
  run('DELETE FROM topics WHERE id = ?', topicId);
  assert.equal(get('SELECT * FROM hooks WHERE id = ?', hookId), undefined);
  run('DELETE FROM niches WHERE id = ?', nicheId);
});

test('transactions roll back on failure and support nesting', () => {
  migrate(db);
  const before = all('SELECT key FROM settings').length;
  assert.throws(() => {
    tx(() => {
      run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', 'tx.test', '1', Date.now());
      throw new Error('boom');
    });
  }, /boom/);
  assert.equal(all('SELECT key FROM settings').length, before);

  tx(() => {
    run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', 'tx.outer', '1', Date.now());
    try {
      tx(() => {
        run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', 'tx.inner', '1', Date.now());
        throw new Error('inner boom');
      });
    } catch {
      /* swallowed: savepoint rolled back */
    }
  });
  assert.ok(get('SELECT value FROM settings WHERE key = ?', 'tx.outer'));
  assert.equal(get('SELECT value FROM settings WHERE key = ?', 'tx.inner'), undefined);
  run('DELETE FROM settings WHERE key LIKE ?', 'tx.%');
});

test('update() helper only touches provided columns', () => {
  migrate(db);
  seed();
  const u = insert('users', {
    id: id('usr'),
    email: 'helper@example.com',
    password_hash: 'x',
    name: 'Helper',
    created_at: Date.now(),
  });
  update('users', u, { name: 'Renamed' });
  const row = get<{ name: string; email: string }>('SELECT name, email FROM users WHERE id = ?', u);
  assert.equal(row?.name, 'Renamed');
  assert.equal(row?.email, 'helper@example.com');
  run('DELETE FROM users WHERE id = ?', u);
});

test('password hashing verifies and rejects correctly', () => {
  const h = hashPassword('correct horse battery staple');
  assert.ok(verifyPassword('correct horse battery staple', h));
  assert.ok(!verifyPassword('wrong password', h));
  assert.ok(!verifyPassword('correct horse battery staple', 'garbage'));
});

test('encrypt/decrypt round-trips OAuth secrets', () => {
  const secret = JSON.stringify({ refresh_token: 'abc/+=xyz', access_token: 'tok' });
  const enc = encrypt(secret);
  assert.notEqual(enc, secret);
  assert.equal(decrypt(enc), secret);
});

test('util: slugify, similarity, seeded rng, speech estimate', () => {
  assert.equal(slugify('Hello, World! 2024'), 'hello-world-2024');
  const a = 'The quick brown fox jumps over the lazy dog';
  assert.ok(similarity(a, a) > 0.99);
  assert.ok(similarity(a, 'completely different sentence about routers') < 0.15);
  const r1 = rng('seed-1');
  const r2 = rng('seed-1');
  assert.equal(r1(), r2());
  const est = estimateSpeechSeconds('one two three four five six seven eight nine ten');
  assert.ok(est > 2 && est < 6, `unexpected estimate ${est}`);
});

test('validation accepts good input and rejects bad input', () => {
  const shape = { name: v.string({ min: 2, max: 10 }), count: v.int({ min: 1, max: 5, default: 3 }) };
  const out = validate({ name: '  Valid  ' }, shape);
  assert.equal(out.name, 'Valid');
  assert.equal(out.count, 3);
  assert.throws(() => validate({ name: 'x' }, shape), HttpError);
  assert.throws(() => validate({ name: 'way too long for the rule' }, shape), HttpError);
  assert.throws(() => validate('not an object', shape), HttpError);
});
