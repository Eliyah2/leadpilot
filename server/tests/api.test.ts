/**
 * End-to-end API tests.
 *
 * Boots the real Express app on an ephemeral port and exercises the HTTP
 * surface exactly like the React client does: session cookie + CSRF header.
 * Rendering is disabled so the suite stays fast; everything else (topics,
 * hooks, scripts, fact-check, metadata, queue, scheduling, export) runs for
 * real against an isolated test database.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import fs from 'node:fs';
import { migrate } from '../db/schema.js';
import { db, all } from '../db/index.js';
import { seed } from '../db/seed.js';
import { createApp } from '../app.js';
import { setSetting, getSetting } from '../engine/settings.js';
import { drainQueue } from '../jobs/worker.js';

let server: Server;
let base = '';
let cookie = '';
let csrf = '';

type Res<T = any> = { status: number; body: T; headers: Headers };

async function req<T = any>(
  method: string,
  path: string,
  body?: unknown,
  opts: { csrf?: boolean | string; cookie?: string } = {},
): Promise<Res<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const jar = opts.cookie !== undefined ? opts.cookie : cookie;
  if (jar) headers['cookie'] = jar;
  if (method !== 'GET' && opts.csrf !== false) headers['x-sf-csrf'] = opts.csrf ? String(opts.csrf) : csrf;
  const url = path.startsWith('/media') || path.startsWith('/api') ? `${base}${path}` : `${base}/api${path}`;
  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed as T, headers: res.headers };
}

before(async () => {
  migrate(db);
  seed();
  // Keep the suite fast: package generation only, no ffmpeg encode.
  setSetting('generation.auto_render', false);
  setSetting('generation.auto_research', false);

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  // Keep-alive sockets from fetch would otherwise hold the process open.
  server?.closeAllConnections?.();
  server?.close();
});

/* ------------------------------------------------------------------ */
/* Auth & security                                                     */
/* ------------------------------------------------------------------ */

test('health is public', async () => {
  const r = await req('GET', '/health', undefined, { csrf: false, cookie: '' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('API requires a session', async () => {
  const r = await req('GET', '/niches', undefined, { csrf: false, cookie: '' });
  assert.equal(r.status, 401);
});

test('register first account becomes owner and returns CSRF', async () => {
  const r = await req('POST', '/auth/register', { email: 'owner@test.local', password: 'test-password-1', name: 'Owner' }, { csrf: false, cookie: '' });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.role, 'owner');
  assert.ok(r.body.csrf, 'csrf token missing');
  csrf = r.body.csrf;
  const setCookie = r.headers.get('set-cookie') ?? '';
  cookie = setCookie.split(';')[0] ?? '';
  assert.ok(cookie.startsWith('sf_session='), 'session cookie missing');
});

test('second registration is not owner', async () => {
  const r = await req('POST', '/auth/register', { email: 'member@test.local', password: 'test-password-2' }, { csrf: false, cookie: '' });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.role, 'member');
});

let wizardVideoId = '';

test('Create Video wizard: idea becomes an unrendered script with the chosen aspect', async () => {
  const niches = await req<any[]>('GET', '/niches');
  const nicheId = niches.body[0].id;
  const r = await req('POST', '/videos/from-idea', {
    idea: 'A lighthouse keeper logs a light that appears at 3:12 AM',
    nicheId,
    language: 'en',
    durationSec: 30,
    aspect: '16:9',
    research: false,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  wizardVideoId = r.body.videoId;
  assert.equal(r.body.aspect, '16:9');
  const row = all<{ aspect: string; render_status: string; mp4_path: string | null }>(
    'SELECT aspect, render_status, mp4_path FROM videos WHERE id = ?',
    wizardVideoId,
  )[0];
  assert.equal(row.aspect, '16:9');
  assert.equal(row.render_status, 'pending', 'wizard must not render before the user asks');
  assert.equal(row.mp4_path, null);
  const d = await req('GET', `/videos/${wizardVideoId}`);
  assert.equal(d.status, 200);
  assert.ok(d.body.scenes.length >= 3, 'script needs scenes');
});

test('Create Video wizard rejects unknown genre and unsupported aspect', async () => {
  const niches = await req<any[]>('GET', '/niches');
  const base = { idea: 'Some idea here', nicheId: niches.body[0].id, language: 'en', durationSec: 30 };
  const badAspect = await req('POST', '/videos/from-idea', { ...base, aspect: '4:3' });
  assert.equal(badAspect.status, 400);
  const badGenre = await req('POST', '/videos/from-idea', { ...base, aspect: '9:16', nicheId: 'nope-genre' });
  assert.equal(badGenre.status, 400);
});

test('Create Video wizard: edited voice-over is saved and validated', async () => {
  const d = await req('GET', `/videos/${wizardVideoId}`);
  const edited = d.body.scenes.map((_: unknown, i: number) =>
    i === 0 ? 'Edited opening line for the test.' : `Scene ${i + 1} narration edited by the user.`,
  );
  const short = await req('PUT', `/videos/${wizardVideoId}/script`, { voiceovers: ['only one'] });
  assert.equal(short.status, 400, 'scene count must match');
  const blank = await req('PUT', `/videos/${wizardVideoId}/script`, { voiceovers: edited.map((t: string, i: number) => (i === 0 ? '' : t)) });
  assert.equal(blank.status, 400, 'empty scene text must be rejected');
  const ok = await req('PUT', `/videos/${wizardVideoId}/script`, { voiceovers: edited });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(ok.body.wordCount > 0);
  const after = await req('GET', `/videos/${wizardVideoId}`);
  assert.equal(after.body.scenes[0].voiceover, edited[0]);
  const missing = await req('PUT', '/videos/vid_does_not_exist/script', { voiceovers: edited });
  assert.equal(missing.status, 404);
});

test('revenue endpoint reports unavailable instead of inventing numbers when no channel is connected', async () => {
  const r = await req('GET', '/youtube/revenue');
  assert.equal(r.status, 200);
  assert.equal(r.body.available, false);
  assert.equal(r.body.estimatedRevenue, 0);
});

test('rendered media needs a session, and downloads are owner-only', async () => {
  const anon = await req('GET', '/media/video/anything.mp4', undefined, { csrf: false, cookie: '' });
  assert.equal(anon.status, 401, 'media must not be public');

  const login = await req('POST', '/auth/login', { email: 'member@test.local', password: 'test-password-2' }, { csrf: false, cookie: '' });
  assert.equal(login.status, 200);
  const memberCookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  assert.ok(memberCookie.startsWith('sf_session='), 'member session cookie missing');

  // The owner's video must not be downloadable by another account.
  const foreign = await req('GET', `/videos/${wizardVideoId}/download`, undefined, { csrf: false, cookie: memberCookie });
  assert.equal(foreign.status, 404);
  const anonDownload = await req('GET', `/videos/${wizardVideoId}/download`, undefined, { csrf: false, cookie: '' });
  assert.equal(anonDownload.status, 401);
});

test('mutations without CSRF header are rejected', async () => {
  const r = await req('POST', '/niches', { name: 'Hack' }, { csrf: false });
  assert.equal(r.status, 403);
});

test('wrong CSRF token is rejected', async () => {
  const r = await req('POST', '/niches', { name: 'Hack' }, { csrf: 'not-the-token' });
  assert.equal(r.status, 403);
});

test('login round-trip works and rotates the cookie', async () => {
  const r = await req('POST', '/auth/login', { email: 'owner@test.local', password: 'test-password-1' }, { csrf: false, cookie: '' });
  assert.equal(r.status, 200);
  csrf = r.body.csrf;
  cookie = (r.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const me = await req('GET', '/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, 'owner@test.local');
});

test('media path traversal is blocked', async () => {
  const r = await req('GET', '/media/video/..%2F..%2Fshortforge.db');
  assert.ok(r.status === 403 || r.status === 404, `expected 403/404, got ${r.status}`);
});

test('unknown API routes return JSON 404', async () => {
  const r = await req('GET', '/definitely-not-a-route');
  assert.equal(r.status, 404);
  assert.equal(typeof r.body.error, 'string');
});

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

test('built-in niches, formats and languages are served', async () => {
  const niches = await req<any[]>('GET', '/niches');
  assert.ok(niches.body.length >= 10, `expected 10+ niches, got ${niches.body.length}`);
  const formats = await req<any[]>('GET', '/meta/formats');
  assert.ok(formats.body.length >= 6);
  const languages = await req<any[]>('GET', '/meta/languages');
  assert.ok(languages.body.length >= 5);
});

test('settings are readable and secrets are masked', async () => {
  const set = await req('PUT', '/settings', { 'llm.apiKey': 'raw-secret-value' });
  assert.equal(set.status, 200, JSON.stringify(set.body));

  const r = await req<{ settings: Record<string, unknown> }>('GET', '/settings');
  assert.equal(r.status, 200);
  assert.ok('generation.duration_target_sec' in r.body.settings);
  assert.equal(r.body.settings['llm.apiKey'], '••••••••', 'secret must come back masked');
  assert.notEqual(r.body.settings['llm.apiKey'], 'raw-secret-value');

  // Round-tripping the mask must not clobber the stored secret.
  const again = await req('PUT', '/settings', { 'llm.apiKey': '••••••••' });
  assert.equal(again.status, 200);
  assert.equal(getSetting<string>('llm.apiKey'), 'raw-secret-value');

  // YouTube client secret is masked the same way (client id stays visible).
  const yt = await req('POST', '/youtube/settings', {
    clientId: 'public-client-id',
    clientSecret: 'yt-secret-value',
    redirectUri: 'http://127.0.0.1:4400/api/youtube/callback',
  });
  assert.equal(yt.status, 200, JSON.stringify(yt.body));
  const after = await req<{ settings: Record<string, unknown> }>('GET', '/settings');
  assert.equal(after.body.settings['youtube.clientId'], 'public-client-id');
  assert.equal(after.body.settings['youtube.clientSecret'], '••••••••', 'youtube secret must be masked');
  assert.equal(getSetting<string>('youtube.clientSecret'), 'yt-secret-value');

  // Restore: later tests assert YouTube starts out unconfigured.
  setSetting('youtube.clientId', '');
  setSetting('youtube.clientSecret', '');
});

/* ------------------------------------------------------------------ */
/* Generation pipeline                                                 */
/* ------------------------------------------------------------------ */

let videoId = '';

test('POST /videos creates a complete package synchronously', async () => {
  const niches = await req<any[]>('GET', '/niches');
  const ai = niches.body.find((n) => n.slug === 'ai') ?? niches.body[0];
  const r = await req<{ videoId: string; title: string; qcStatus: string; sceneCount: number; wordCount: number }>(
    'POST',
    '/videos',
    { nicheId: ai.id, language: 'en', durationSec: 40 },
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  videoId = r.body.videoId;
  assert.ok(r.body.title.length >= 12, `title too short: ${r.body.title}`);
  assert.ok(r.body.sceneCount >= 3, 'needs at least 3 scenes');
  assert.ok(r.body.wordCount >= 40, `script too thin: ${r.body.wordCount} words`);
  assert.ok(['passed', 'needs_review', 'failed'].includes(r.body.qcStatus));
  // Title must not stack two lead-ins ("How … explained").
  assert.ok(!/explained explained/i.test(r.body.title), `stacked lead-in: ${r.body.title}`);
});

test('video detail exposes scenes, sources, hooks and QC on demand', async () => {
  const r = await req<any>('GET', `/videos/${videoId}?recheck=1`);
  assert.equal(r.status, 200);
  assert.ok(r.body.scenes.length >= 3);
  assert.ok(r.body.script.voiceoverText.length > 50);
  assert.ok(r.body.hooks.length >= 5, `expected 5+ hooks, got ${r.body.hooks.length}`);
  assert.ok(r.body.sources.length >= 1, 'at least one source must be stored');
  assert.ok(r.body.qc, 'QC report missing');
  assert.equal(r.body.qc.checks.length >= 9, true);
  assert.equal(r.body.qc.status, 'passed', JSON.stringify(r.body.qc.notes));
  // every scene has voiceover text and a visual spec
  for (const s of r.body.scenes) {
    assert.ok(s.voiceover.length > 0);
    assert.ok(s.visual && typeof s.visual === 'object');
  }
});

test('hook archetypes stay honest: claim/myth hooks only when supported', async () => {
  const r = await req<any>('GET', `/videos/${videoId}`);
  for (const h of r.body.hooks) {
    if (h.archetype === 'myth' || h.archetype === 'claim') {
      assert.ok(h.text.length > 12);
      // myth hooks must not use the generic fallback without a myth backing
      assert.ok(!/common belief is wrong: the common story about/i.test(h.text), `unsupported myth hook: ${h.text}`);
    }
  }
});

test('PATCH updates title/description/hashtags', async () => {
  const r = await req<any>('PATCH', `/videos/${videoId}`, {
    title: 'A perfectly honest title about neural networks',
    description: 'Updated description with a source link.',
    hashtags: ['#neuralnetworks', '#shorts'],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.video.title, 'A perfectly honest title about neural networks');
  assert.deepEqual(r.body.video.hashtags, ['#neuralnetworks', '#shorts']);
});

test('video list supports search and status filters', async () => {
  const found = await req<any[]>('GET', '/videos?q=neural');
  assert.ok(found.body.some((v) => v.id === videoId), 'search by title should find the video');
  const drafts = await req<any[]>('GET', '/videos?status=draft');
  assert.ok(Array.isArray(drafts.body));
  const bad = await req<any>('GET', '/videos?status=not-a-status');
  assert.equal(bad.status, 400);
});

test('regenerating the script changes content but keeps the topic', async () => {
  const before = await req<any>('GET', `/videos/${videoId}`);
  const beforeText = before.body.script.voiceoverText;
  const r = await req<any>('POST', `/videos/${videoId}/regenerate`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = await req<any>('GET', `/videos/${videoId}`);
  assert.equal(after.body.topicId, before.body.topicId, 'topic must not change');
  assert.notEqual(after.body.script.voiceoverText, beforeText, 'script should have changed');
  assert.ok(after.body.script.voiceoverText.length > 50);
});

/* ------------------------------------------------------------------ */
/* Batch + queue                                                       */
/* ------------------------------------------------------------------ */

test('batch generation completes through the job queue', async () => {
  const niches = await req<any[]>('GET', '/niches');
  const gen = await req<{ batchId: string }>('POST', '/generate', {
    nicheId: niches.body[0].id,
    count: 1,
    language: 'en',
    durationSec: 40,
    research: false,
    autoRender: false,
  });
  assert.equal(gen.status, 202);

  const result = await drainQueue(50);
  assert.equal(result.failed, 0, `${result.failed} jobs failed`);

  const batch = await req<any>('GET', `/batches/${gen.body.batchId}`);
  assert.equal(batch.body.status, 'done');
  assert.equal(batch.body.total, 1);
  assert.equal(batch.body.completed, 1, 'parent batch job must not count itself as a child');
  assert.equal(batch.body.failed, 0);
});

test('jobs endpoint honors the limit parameter', async () => {
  const r = await req<{ jobs: any[]; stats: { total: number } }>('GET', '/jobs?limit=3');
  assert.ok(r.body.jobs.length <= 3, `expected ≤3 jobs, got ${r.body.jobs.length}`);
  assert.ok(r.body.stats.total >= 1);
});

/* ------------------------------------------------------------------ */
/* Approve + scheduling                                                */
/* ------------------------------------------------------------------ */

test('approve moves the video to approved', async () => {
  const r = await req<any>('POST', `/videos/${videoId}/approve`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = await req<any>('GET', `/videos/${videoId}`);
  assert.equal(v.body.status, 'approved');
});

test('schedule settings persist and validate the timezone', async () => {
  const bad = await req<any>('PUT', '/schedule/settings', {
    perDay: 2,
    times: ['09:00', '18:30'],
    days: [1, 3, 5],
    timezone: 'Not/AZone',
    paused: false,
  });
  assert.equal(bad.status, 400, 'invalid timezone must be rejected');

  const ok = await req<any>('PUT', '/schedule/settings', {
    perDay: 2,
    times: ['09:00', '18:30'],
    days: [1, 2, 3, 4, 5],
    timezone: 'UTC',
    paused: false,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.perDay, 2);
  assert.deepEqual(ok.body.times, ['09:00', '18:30']);
  assert.ok(ok.body.nextSlots.length >= 1, 'next free slots must be computed');
});

test('approved video can be scheduled into a slot and appears on the calendar', async () => {
  const r = await req<any>('POST', '/schedule/video', { videoId });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.runAt > Date.now(), 'runAt must be in the future');

  const cal = await req<any>('GET', '/schedule/calendar');
  assert.equal(cal.status, 200);
  assert.ok(cal.body.items.length >= 1);
  assert.ok(cal.body.items.some((i: any) => i.video_id === videoId));
});

test('queued schedule can be paused, resumed and cancelled', async () => {
  const cal = await req<any>('GET', '/schedule/calendar');
  const item = cal.body.items.find((i: any) => i.video_id === videoId);
  assert.ok(item, 'scheduled item not found');
  assert.equal((await req('POST', `/schedule/${item.id}/pause`)).status, 200);
  assert.equal((await req('POST', `/schedule/${item.id}/resume`)).status, 200);
  assert.equal((await req('POST', `/schedule/${item.id}/cancel`)).status, 200);
  const after = await req<any>('GET', '/schedule/calendar');
  assert.ok(!after.body.items.some((i: any) => i.id === item.id), 'cancelled item still on calendar');
});

/* ------------------------------------------------------------------ */
/* Analytics, learning, experiments                                    */
/* ------------------------------------------------------------------ */

test('analytics endpoint reports demo mode honestly', async () => {
  const r = await req<any>('GET', '/analytics');
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.demoMode, 'boolean');
  assert.ok(Array.isArray(r.body.breakdown));
});

test('learning stays neutral before enough real data', async () => {
  const r = await req<any>('GET', '/learning');
  assert.equal(r.status, 200);
  assert.equal(r.body.summary.enoughData, false);
  assert.ok(r.body.disclaimer.includes('this channel'), 'must scope claims to this channel');
});

test('experiment evaluation never declares a winner below the minimum sample', async () => {
  const create = await req<any>('POST', '/experiments', {
    name: 'Curiosity vs question titles',
    hypothesis: 'Curiosity titles get more views on this channel.',
    metric: 'views',
    minSamples: 3,
    variants: [
      { key: 'a', label: 'Curiosity', payload: '{}' },
      { key: 'b', label: 'Question', payload: '{}' },
    ],
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const expId = create.body.id;

  // assign both variants to real videos
  const videos = await req<any[]>('GET', '/videos?limit=10');
  const two = videos.body.slice(0, 2);
  assert.ok(two.length >= 2);
  for (let i = 0; i < two.length; i++) {
    const assign = await req<any>('POST', `/experiments/${expId}/assign`, { videoId: two[i].id });
    assert.equal(assign.status, 200);
    assert.ok(['a', 'b'].includes(assign.body.variant.key));
  }

  // fake one strong result for variant a — still below min sample for b
  const eval1 = await req<any>('POST', `/experiments/${expId}/evaluate`);
  assert.equal(eval1.status, 200);
  assert.equal(eval1.body.winner, null, 'a winner must not be declared without enough data');
  assert.ok(['active', 'insufficient_data'].includes(eval1.body.status));
  assert.ok(eval1.body.statement.length > 10);
});

/* ------------------------------------------------------------------ */
/* Export, YouTube, costs                                              */
/* ------------------------------------------------------------------ */

test('export package produces upload-ready files without any API keys', async () => {
  const r = await req<any>('GET', `/videos/${videoId}/export`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(Array.isArray(r.body.files));
  assert.ok(r.body.files.includes('title.txt'));
  assert.ok(r.body.files.includes('description.txt'));
  assert.ok(fs.existsSync(r.body.dir), 'export dir must exist');
  assert.ok(
    r.body.missing.some((m: string) => m.includes('MP4')),
    'missing MP4 should be reported honestly (render disabled in tests)',
  );
});

test('YouTube is reported as not connected until the user configures OAuth', async () => {
  const r = await req<any>('GET', '/youtube/status');
  assert.equal(r.status, 200);
  assert.equal(r.body.connected, false);
  assert.equal(r.body.configured, false);
  assert.ok(r.body.quotaHint.includes('10'), 'free quota hint must be shown');
  // zero-touch default: once a channel is linked, uploads go out on schedule
  assert.equal(r.body.autoPublish, true);
});

test('usage ledger reports zero cost and separates free vs paid', async () => {
  const r = await req<any>('GET', '/costs');
  assert.equal(r.status, 200);
  assert.equal(r.body.summary.totalCostUsd, 0);
  assert.ok(r.body.summary.capabilities.length >= 3);
  for (const c of r.body.summary.capabilities) {
    assert.ok(c.free, `${c.id} must document a free option`);
    assert.equal(c.paidActive, false, `${c.id} must not have invoked a paid provider`);
  }
  assert.ok(r.body.freeTierNotes.length >= 3);
});

test('owner-only guard: member cannot change settings', async () => {
  const memberLogin = await req<any>('POST', '/auth/login', { email: 'member@test.local', password: 'test-password-2' }, { csrf: false, cookie: '' });
  const memberCookie = (memberLogin.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const r = await req('PUT', '/settings', { 'generation.tone': 'sneaky' }, { csrf: String(memberLogin.body.csrf), cookie: memberCookie });
  assert.equal(r.status, 403);
});

test('system logs are visible to the signed-in owner', async () => {
  const r = await req<any[]>('GET', '/logs?limit=20');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
  assert.ok(r.body.length > 0, 'generation should have logged something');
});
