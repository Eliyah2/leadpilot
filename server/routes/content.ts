import { Router, type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import { all, get, run, insert, tx } from '../db/index.js';
import { ASPECT_RATIOS } from '../lib/aspect.js';
import { validate, v, HttpError } from '../lib/validate.js';
import { id, now, slugify, clamp, similarity } from '../lib/util.js';
import { requireAuth } from '../middleware/auth.js';
import { generateTopics, listTopics } from '../engine/topics.js';
import { generateHooks, pickHook, hooksForTopic, hooksForVideo } from '../engine/hooks.js';
import { buildScript, pickFormat } from '../engine/scripts.js';
import { factCheck } from '../engine/factcheck.js';
import { buildMetadata } from '../engine/metadata.js';
import { discoverTrends, trendHistory } from '../engine/trends.js';
import { createVideo, factsForTopic, parseContentRequest, resolveNiche } from '../engine/pipeline.js';
import { enqueue, listJobs, getJob, jobLogs, videoLogs, queueStats, cancelJob } from '../jobs/queue.js';
import { getSetting, setSetting, publicSettings } from '../engine/settings.js';
import { deriveRecycleTopics, recyclableVideos, TRANSFORMS } from '../services/recycling.js';
import { assignScheduleToVideo } from '../services/scheduler.js';
import { buildExportPackage } from '../services/export.js';
import { LANGUAGES, FORMATS, type Lang, type ScriptFormat } from '../engine/language.js';
import { log } from '../lib/logger.js';

export const contentRouter = Router();

/* ------------------------------------------------------------------ */
/* Niches                                                              */
/* ------------------------------------------------------------------ */

contentRouter.get('/niches', (_req, res) => {
  const rows = all<any>('SELECT * FROM niches ORDER BY is_builtin DESC, name ASC');
  res.json(
    rows.map((n) => ({
      id: n.id,
      name: n.name,
      slug: n.slug,
      description: n.description,
      style: n.style,
      audience: n.audience,
      language: n.language,
      color: n.color,
      isBuiltin: Boolean(n.is_builtin),
      promptConfig: safeJson(n.prompt_config, {}),
      stats: {
        topics: get<{ n: number }>('SELECT COUNT(*) n FROM topics WHERE niche_id = ?', n.id)?.n ?? 0,
        availableTopics: get<{ n: number }>("SELECT COUNT(*) n FROM topics WHERE niche_id = ? AND status = 'available'", n.id)?.n ?? 0,
        videos: get<{ n: number }>('SELECT COUNT(*) n FROM videos WHERE niche_id = ?', n.id)?.n ?? 0,
        facts: get<{ n: number }>('SELECT COUNT(*) n FROM knowledge WHERE niche = ?', n.slug)?.n ?? 0,
      },
    })),
  );
});

contentRouter.post('/niches', (req, res, next) => {
  try {
    const body = validate(req.body, {
      name: v.string({ min: 2, max: 60 }),
      description: v.string({ max: 300, default: '' }),
      style: v.string({ max: 80, default: 'Fast-paced educational' }),
      audience: v.string({ max: 120, default: 'General' }),
      language: v.string({ max: 5, default: 'en', oneOf: LANGUAGES.map((l) => l.code) }),
      color: v.string({ max: 20, default: '#6366f1' }),
      keywords: v.array(v.string({ max: 40 }), { max: 30, default: [] as string[] }) as any,
    });
    let slug = slugify(body.name);
    if (get('SELECT id FROM niches WHERE slug = ?', slug)) slug = `${slug}-${Date.now().toString(36)}`;
    const nicheId = id('niche');
    run(
      `INSERT INTO niches (id, user_id, name, slug, description, style, audience, language, prompt_config, color, is_builtin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      nicheId,
      req.user!.id,
      body.name,
      slug,
      body.description,
      body.style,
      body.audience,
      body.language,
      JSON.stringify({ keywords: body.keywords ?? [], formats: {}, banned_phrases: [] }),
      body.color,
      now(),
    );
    res.status(201).json({ id: nicheId, slug });
  } catch (err) {
    next(err);
  }
});

contentRouter.put('/niches/:id', (req, res, next) => {
  try {
    const niche = get<any>('SELECT * FROM niches WHERE id = ?', req.params.id);
    if (!niche) throw new HttpError(404, 'Niche not found');
    const body = validate(req.body, {
      name: v.string({ min: 2, max: 60, default: niche.name }),
      description: v.string({ max: 300, default: niche.description }),
      style: v.string({ max: 80, default: niche.style }),
      audience: v.string({ max: 120, default: niche.audience }),
      language: v.string({ max: 5, default: niche.language, oneOf: LANGUAGES.map((l) => l.code) }),
      color: v.string({ max: 20, default: niche.color }),
    });
    run(
      'UPDATE niches SET name = ?, description = ?, style = ?, audience = ?, language = ?, color = ? WHERE id = ?',
      body.name, body.description, body.style, body.audience, body.language, body.color, niche.id,
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

contentRouter.delete('/niches/:id', (req, res, next) => {
  try {
    const niche = get<any>('SELECT * FROM niches WHERE id = ?', req.params.id);
    if (!niche) throw new HttpError(404, 'Niche not found');
    if (niche.is_builtin) throw new HttpError(400, 'Built-in niches cannot be deleted — edit them instead');
    run('DELETE FROM niches WHERE id = ?', niche.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Trends                                                              */
/* ------------------------------------------------------------------ */

contentRouter.get('/trends', (req, res) => {
  const nicheId = typeof req.query.nicheId === 'string' ? req.query.nicheId : undefined;
  res.json({
    items: trendHistory(nicheId, 60),
    sources: getSetting<string[]>('trends.sources', ['wikipedia', 'hn', 'google_trends']),
    notice: 'Interest figures are public, free signals (Wikipedia pageviews, Hacker News points, Google Trends RSS). They are inspiration, never a prediction of views.',
  });
});

contentRouter.post('/trends/discover', async (req, res, next) => {
  try {
    const body = validate(req.body, {
      nicheId: v.string({ min: 3, max: 60 }),
      limit: v.int({ min: 5, max: 50, default: 20 }),
      language: v.string({ max: 5, default: '' }),
      sync: v.bool({ default: false }),
    });
    if (body.sync) {
      const result = await discoverTrends(body.nicheId, { limit: body.limit, language: (body.language || undefined) as Lang });
      return res.json(result);
    }
    const jobId = enqueue('trend_scan', { nicheId: body.nicheId, limit: body.limit, language: body.language }, {
      userId: req.user!.id,
      dedupeKey: `trends:${body.nicheId}`,
      priority: 70,
    });
    res.status(202).json({ jobId });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Topics                                                              */
/* ------------------------------------------------------------------ */

contentRouter.get('/topics', (req, res) => {
  const nicheId = typeof req.query.nicheId === 'string' ? req.query.nicheId : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  res.json(listTopics(nicheId, status, 300));
});

contentRouter.post('/topics/generate', async (req, res, next) => {
  try {
    const body = validate(req.body, {
      nicheId: v.string({ min: 3, max: 60 }),
      count: v.int({ min: 1, max: 60, default: 20 }),
      language: v.string({ max: 5, default: '' }),
      includeTrends: v.bool({ default: true }),
    });
    const created = await generateTopics({
      nicheId: body.nicheId,
      count: body.count,
      language: (body.language || undefined) as Lang,
      includeTrends: body.includeTrends,
    });
    res.status(201).json({ created: created.length, topics: created });
  } catch (err) {
    next(err);
  }
});

contentRouter.post('/topics/:id/status', (req, res, next) => {
  try {
    const body = validate(req.body, { status: v.string({ min: 2, max: 20, oneOf: ['available', 'used', 'retired'] }) });
    const topic = get('SELECT id FROM topics WHERE id = ?', req.params.id);
    if (!topic) throw new HttpError(404, 'Topic not found');
    run('UPDATE topics SET status = ? WHERE id = ?', body.status, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

contentRouter.get('/topics/:id/hooks', (req, res) => {
  res.json(hooksForTopic(String(req.params.id)));
});

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

contentRouter.post('/hooks/generate', (req, res, next) => {
  try {
    const body = validate(req.body, {
      topicId: v.string({ min: 3, max: 60 }),
      count: v.int({ min: 5, max: 10, default: 7 }),
      language: v.string({ max: 5, default: 'en' }),
    });
    const topic = get<any>('SELECT * FROM topics WHERE id = ?', body.topicId);
    if (!topic) throw new HttpError(404, 'Topic not found');
    const facts = factsForTopic(topic);
    const hooks = generateHooks({
      topicId: topic.id,
      topicTitle: topic.title,
      subject: facts[0]?.subject ?? topic.title,
      fact: facts[0]?.fact,
      detail: facts[0]?.detail,
      count: body.count,
      lang: body.language as Lang,
    });
    res.status(201).json({ hooks });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* Batches / generation                                                */
/* ------------------------------------------------------------------ */

contentRouter.post('/generate', async (req, res, next) => {
  try {
    const body = validate(req.body, {
      request: v.string({ max: 400, default: '' }),
      nicheId: v.string({ max: 60, default: '' }),
      language: v.string({ max: 5, default: getSetting<string>('generation.default_language', 'en') }),
      count: v.int({ min: 1, max: 60, default: 20 }),
      durationSec: v.int({ min: 15, max: 90, default: getSetting<number>('generation.duration_target_sec', 40) }),
      format: v.string({ max: 20, default: 'auto' }),
      tone: v.string({ max: 40, default: '' }),
      autoRender: v.bool({ default: getSetting<boolean>('generation.auto_render', true) }),
      research: v.bool({ default: true }),
    });

    const parsed = body.request
      ? parseContentRequest(body.request, { language: body.language as Lang, durationSec: body.durationSec })
      : null;
    const language = (parsed?.language ?? body.language) as Lang;
    const durationSec = parsed?.durationSec ?? body.durationSec;
    const count = parsed?.count ?? body.count;
    const nicheId = body.nicheId || resolveNiche(parsed?.topicHint ?? body.request, null);

    // make sure there are topics to draw from
    const available = get<{ n: number }>("SELECT COUNT(*) n FROM topics WHERE niche_id = ? AND status = 'available'", nicheId)?.n ?? 0;
    if (available < count) {
      try {
        await generateTopics({ nicheId, count: Math.min(60, count * 2), language });
      } catch (err) {
        log.debug('pre-generation of topics failed', String(err));
      }
    }

    const batchId = id('bat');
    run(
      `INSERT INTO batches (id, user_id, request, niche_id, language, total, completed, failed, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'running', ?, ?)`,
      batchId,
      req.user!.id,
      body.request.slice(0, 400),
      nicheId,
      language,
      count,
      now(),
      now(),
    );
    const jobId = enqueue(
      'batch_generate',
      {
        batchId,
        userId: req.user!.id,
        nicheId,
        language,
        targetSec: durationSec,
        format: body.format === 'auto' ? undefined : body.format,
        count,
        request: body.request,
        autoRender: body.autoRender,
        research: body.research,
      },
      { batchId, userId: req.user!.id, priority: 50, dedupeKey: `batch:${batchId}` },
    );
    res.status(202).json({ batchId, jobId, count, nicheId, language, durationSec });
  } catch (err) {
    next(err);
  }
});

contentRouter.get('/batches', (req, res) => {
  const rows = all<any>('SELECT * FROM batches ORDER BY created_at DESC LIMIT 50');
  res.json(
    rows.map((b) => ({
      ...b,
      niche_name: get<{ name: string }>('SELECT name FROM niches WHERE id = ?', b.niche_id)?.name ?? null,
      jobs: all<any>('SELECT id, type, status, progress, message, error, attempts FROM generation_jobs WHERE batch_id = ? ORDER BY created_at LIMIT 200', b.id).length,
    })),
  );
});

contentRouter.get('/batches/:id', (req, res) => {
  const batch = get<any>('SELECT * FROM batches WHERE id = ?', req.params.id);
  if (!batch) throw new HttpError(404, 'Batch not found');
  res.json({
    ...batch,
    jobs: listJobs({ batchId: batch.id, limit: 300 }),
    videos: all<any>('SELECT id, title, status, qc_status, render_status, created_at FROM videos WHERE batch_id = ? ORDER BY created_at', batch.id),
  });
});

contentRouter.post('/batches/:id/cancel', (req, res) => {
  const batch = get<any>('SELECT * FROM batches WHERE id = ?', req.params.id);
  if (!batch) throw new HttpError(404, 'Batch not found');
  const jobs = listJobs({ batchId: batch.id, limit: 300 });
  let canceled = 0;
  for (const j of jobs) if (cancelJob(j.id)) canceled++;
  run("UPDATE batches SET status = 'done', updated_at = ? WHERE id = ?", now(), batch.id);
  res.json({ canceled });
});

/* ------------------------------------------------------------------ */
/* Videos                                                              */
/* ------------------------------------------------------------------ */

function videoRowView(v: any) {
  return {
    id: v.id,
    title: v.title,
    hook: v.hook_text,
    status: v.status,
    qcStatus: v.qc_status,
    renderStatus: v.render_status,
    format: v.format,
    language: v.language,
    durationSec: v.duration_sec,
    durationTarget: v.duration_target_sec,
    scheduledAt: v.scheduled_at,
    publishedAt: v.published_at,
    visibility: v.visibility,
    sizeBytes: v.size_bytes,
    mp4: v.mp4_path ? true : false,
    cover: v.cover_path ? true : false,
    nicheId: v.niche_id,
    nicheName: v.niche_name ?? null,
    nicheColor: v.niche_color ?? null,
    topicId: v.topic_id,
    topicTitle: v.topic_title ?? null,
    category: v.category ?? null,
    batchId: v.batch_id,
    experimentId: v.experiment_id,
    variantId: v.variant_id,
    views: Number(v.views ?? 0),
    likes: Number(v.likes ?? 0),
    comments: Number(v.comments ?? 0),
    hashtags: safeJson(v.hashtags, []),
    tags: safeJson(v.tags, []),
    createdAt: v.created_at,
    updatedAt: v.updated_at,
    parentVideoId: v.parent_video_id,
    origin: v.origin,
  };
}

const VIDEO_SELECT = `
  SELECT v.*, n.name niche_name, n.color niche_color, t.title topic_title, t.category category,
         COALESCE((SELECT SUM(a.views) FROM analytics a WHERE a.video_id = v.id), p.yt_views, 0) views,
         COALESCE((SELECT SUM(a.likes) FROM analytics a WHERE a.video_id = v.id), p.yt_likes, 0) likes,
         COALESCE((SELECT SUM(a.comments) FROM analytics a WHERE a.video_id = v.id), p.yt_comments, 0) comments
    FROM videos v
    LEFT JOIN niches n ON n.id = v.niche_id
    LEFT JOIN topics t ON t.id = v.topic_id
    LEFT JOIN published_videos p ON p.video_id = v.id`;

contentRouter.get('/videos', (req, res) => {
  const where: string[] = [];
  const params: unknown[] = [];
  const VIDEO_STATUSES = ['draft', 'review', 'approved', 'scheduled', 'published', 'analyzing'];
  if (typeof req.query.status === 'string' && req.query.status !== 'all') {
    if (!VIDEO_STATUSES.includes(req.query.status)) {
      throw new HttpError(400, `Unknown status "${req.query.status}" — expected one of: ${VIDEO_STATUSES.join(', ')}`);
    }
    where.push('v.status = ?');
    params.push(req.query.status);
  }
  if (typeof req.query.nicheId === 'string' && req.query.nicheId) {
    where.push('v.niche_id = ?');
    params.push(req.query.nicheId);
  }
  if (typeof req.query.q === 'string' && req.query.q.trim()) {
    where.push('(v.title LIKE ? OR v.hook_text LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`);
  }
  const limit = clamp(Number(req.query.limit ?? 100), 1, 300);
  const rows = all<any>(
    `${VIDEO_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.created_at DESC LIMIT ?`,
    ...params,
    limit,
  );
  res.json(rows.map(videoRowView));
});

contentRouter.get('/videos/:id', (req, res, next) => {
  try {
    const row = get<any>(`${VIDEO_SELECT} WHERE v.id = ?`, req.params.id);
    if (!row) throw new HttpError(404, 'Video not found');
    const scenes = all<any>('SELECT * FROM scenes WHERE video_id = ? ORDER BY idx', row.id);
    const script = get<any>('SELECT * FROM scripts WHERE video_id = ? ORDER BY created_at DESC LIMIT 1', row.id);
    const sources = all<any>(
      `SELECT s.id, s.url, s.title, s.publisher, s.kind, s.snippet FROM sources s
         JOIN video_sources vs ON vs.source_id = s.id WHERE vs.video_id = ?`,
      row.id,
    );
    const voiceover = get<any>('SELECT * FROM voiceovers WHERE video_id = ? ORDER BY created_at DESC LIMIT 1', row.id);
    const published = get<any>('SELECT * FROM published_videos WHERE video_id = ?', row.id);
    const schedules = all<any>('SELECT * FROM schedules WHERE video_id = ? ORDER BY run_at', row.id);
    const jobs = listJobs({ limit: 50 }).filter((j) => j.video_id === row.id);
    const analytics = all<any>('SELECT * FROM analytics WHERE video_id = ? ORDER BY metric_date DESC LIMIT 60', row.id);
    let qc: any = null;
    if (typeof req.query.recheck === 'string') {
      const facts = row.topic_id ? factsForTopic(get<any>('SELECT * FROM topics WHERE id = ?', row.topic_id)) : [];
      qc = factCheck({
        script: {
          hook: row.hook_text,
          hookArchetype: '',
          format: row.format,
          voiceoverText: script?.voiceover_text ?? '',
          scenes: scenes.map((s: any) => ({
            kind: s.kind,
            voiceover: s.voiceover,
            textOnScreen: s.text_on_screen,
            visual: JSON.parse(s.visual || '{}'),
            transition: s.transition,
            durationSec: s.duration_sec,
          })),
          wordCount: script?.word_count ?? 0,
          estDurationSec: script?.est_duration_sec ?? 0,
          factsUsed: [],
          sourcesUsed: [],
          needsTranslation: false,
          cta: null,
        },
        facts,
        sourceIds: sources.map((s) => s.id),
        title: row.title,
        hookText: row.hook_text,
        videoId: row.id,
      });
    }
    res.json({
      ...videoRowView(row),
      description: row.description,
      keywords: safeJson(row.keywords, []),
      reviewNotes: safeJson(row.review_notes, []),
      error: row.error,
      scenes: scenes.map((s) => ({
        id: s.id,
        idx: s.idx,
        kind: s.kind,
        textOnScreen: s.text_on_screen,
        voiceover: s.voiceover,
        visual: safeJson(s.visual, {}),
        transition: s.transition,
        durationSec: s.duration_sec,
        startSec: s.start_sec,
      })),
      hooks: hooksForVideo(row.id),
      script: script
        ? {
            id: script.id,
            format: script.format,
            hook: script.hook_text,
            voiceoverText: script.voiceover_text,
            wordCount: script.word_count,
            estDurationSec: script.est_duration_sec,
            status: script.status,
          }
        : null,
      sources,
      voiceover: voiceover
        ? { provider: voiceover.provider, voice: voiceover.voice, rate: voiceover.rate, pitch: voiceover.pitch, status: voiceover.status, durationMs: voiceover.duration_ms, file: voiceover.file_path ? true : false }
        : null,
      published: published
        ? { youtubeVideoId: published.youtube_video_id, visibility: published.visibility, views: published.yt_views, likes: published.yt_likes, comments: published.yt_comments, publishedAt: published.published_at, lastSync: published.last_sync_at }
        : null,
      schedules,
      jobs,
      analytics,
      qc,
      logs: videoLogs(row.id, 80),
    });
  } catch (err) {
    next(err);
  }
});

contentRouter.post('/videos', async (req, res, next) => {
  try {
    const body = validate(req.body, {
      nicheId: v.string({ min: 3, max: 60 }),
      language: v.string({ max: 5, default: 'en' }),
      topicId: v.string({ max: 60, default: '' }),
      format: v.string({ max: 20, default: 'auto' }),
      durationSec: v.int({ min: 15, max: 90, default: 40 }),
      tone: v.string({ max: 40, default: '' }),
    });
    const result = await createVideo({
      userId: req.user!.id,
      nicheId: body.nicheId,
      language: body.language as Lang,
      topicId: body.topicId || undefined,
      format: (body.format === 'auto' ? 'auto' : body.format) as ScriptFormat,
      targetSec: body.durationSec,
      tone: body.tone || undefined,
      research: true,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Create Video wizard: turns the user's own idea into a script without
 * rendering, so the user can review and edit the voice-over first.
 */
contentRouter.post('/videos/from-idea', async (req, res, next) => {
  try {
    const body = validate(req.body, {
      idea: v.string({ min: 3, max: 300 }),
      nicheId: v.string({ min: 3, max: 60 }),
      language: v.string({ max: 5, default: 'en', oneOf: ['en', 'nl', 'de', 'es', 'fr'] }),
      durationSec: v.int({ min: 15, max: 90, default: 30 }),
      aspect: v.string({ max: 5, default: '9:16', oneOf: ASPECT_RATIOS }),
      research: v.bool({ default: true }),
    });
    const niche = get<{ id: string }>('SELECT id FROM niches WHERE id = ?', body.nicheId);
    if (!niche) throw new HttpError(400, 'Unknown genre');

    const topicId = id('top');
    const slug = `${slugify(body.idea, 60) || 'idea'}-${topicId.slice(-6)}`;
    run(
      `INSERT INTO topics (id, niche_id, title, slug, main_angle, alt_angle, audience, category, complexity,
         language, status, origin, source_ids, score, created_at)
       VALUES (?, ?, ?, ?, '', '', '', 'manual', 'medium', ?, 'used', 'manual', '[]', 0, ?)`,
      topicId,
      niche.id,
      body.idea,
      slug,
      body.language,
      now(),
    );

    const result = await createVideo({
      userId: req.user!.id,
      nicheId: niche.id,
      language: body.language as Lang,
      topicId,
      format: 'auto',
      targetSec: body.durationSec,
      research: body.research,
      autoRender: false,
    });
    run('UPDATE videos SET aspect = ? WHERE id = ? AND user_id = ?', body.aspect, result.videoId, req.user!.id);
    res.status(201).json({ ...result, aspect: body.aspect });
  } catch (err) {
    next(err);
  }
});

/**
 * Save edited voice-over text, one entry per scene in order. Rendering reads
 * these scene texts, so a render after this call uses the edited script.
 */
contentRouter.put('/videos/:id/script', (req, res, next) => {
  try {
    const video = get<{ id: string; render_status: string }>(
      'SELECT id, render_status FROM videos WHERE id = ? AND user_id = ?',
      req.params.id,
      req.user!.id,
    );
    if (!video) throw new HttpError(404, 'Video not found');
    if (video.render_status === 'rendering') {
      throw new HttpError(409, 'Video is rendering; edit the script after it finishes');
    }
    const body = validate(req.body, {
      voiceovers: v.array(v.string({ min: 1, max: 600 }), { max: 60 }) as any,
    }) as unknown as { voiceovers: string[] };
    const scenes = all<{ id: string }>('SELECT id FROM scenes WHERE video_id = ? ORDER BY idx', video.id);
    if (body.voiceovers.length !== scenes.length) {
      throw new HttpError(400, `Expected ${scenes.length} scene voice-overs, got ${body.voiceovers.length}`);
    }
    const fullText = body.voiceovers.join(' ');
    const wordCount = fullText.split(/\s+/).filter(Boolean).length;
    const estDurationSec = tx(() => {
      scenes.forEach((s, i) => run('UPDATE scenes SET voiceover = ? WHERE id = ?', body.voiceovers[i], s.id));
      const total = get<{ d: number }>('SELECT COALESCE(SUM(duration_sec), 0) d FROM scenes WHERE video_id = ?', video.id)!.d;
      run(
        'UPDATE scripts SET voiceover_text = ?, word_count = ?, est_duration_sec = ? WHERE video_id = ?',
        fullText,
        wordCount,
        total,
        video.id,
      );
      run('UPDATE videos SET updated_at = ? WHERE id = ?', now(), video.id);
      return total;
    });
    res.json({ ok: true, wordCount, estDurationSec });
  } catch (err) {
    next(err);
  }
});

contentRouter.patch('/videos/:id', (req, res, next) => {
  try {
    const video = get<any>('SELECT * FROM videos WHERE id = ?', req.params.id);
    if (!video) throw new HttpError(404, 'Video not found');
    const body = validate(req.body, {
      title: v.string({ max: 100, default: video.title }),
      description: v.string({ max: 5000, default: video.description }),
      hashtags: v.array(v.string({ max: 40 }), { max: 10, default: safeJson(video.hashtags, []) }) as any,
      tags: v.array(v.string({ max: 40 }), { max: 60, default: safeJson(video.tags, []) }) as any,
      status: v.string({ max: 20, default: video.status, oneOf: ['draft', 'review', 'approved', 'scheduled', 'published', 'analyzing'] }),
      visibility: v.string({ max: 20, default: video.visibility, oneOf: ['public', 'unlisted', 'private'] }),
      hookText: v.string({ max: 200, default: video.hook_text }),
      scheduledAt: v.int({ min: 0, default: video.scheduled_at ?? 0 }),
    });
    run(
      `UPDATE videos SET title = ?, description = ?, hashtags = ?, tags = ?, status = ?, visibility = ?, hook_text = ?,
         scheduled_at = NULLIF(?, 0), updated_at = ? WHERE id = ?`,
      body.title,
      body.description,
      JSON.stringify(body.hashtags),
      JSON.stringify(body.tags),
      body.status,
      body.visibility,
      body.hookText,
      body.scheduledAt,
      now(),
      video.id,
    );
    // keep the script's hook text in sync when edited
    if (body.hookText !== video.hook_text) {
      run('UPDATE scripts SET hook_text = ? WHERE video_id = ?', body.hookText, video.id);
      run('UPDATE scenes SET voiceover = ? WHERE video_id = ? AND idx = 0 AND kind = ?', body.hookText, video.id, 'hook');
    }
    res.json({ ok: true, video: videoRowView(get<any>(`${VIDEO_SELECT} WHERE v.id = ?`, video.id)) });
  } catch (err) {
    next(err);
  }
});

contentRouter.post('/videos/:id/approve', (req, res, next) => {
  try {
    const video = get<any>('SELECT * FROM videos WHERE id = ?', req.params.id);
    if (!video) throw new HttpError(404, 'Video not found');
    if (video.qc_status === 'failed') throw new HttpError(400, 'Quality control failed on this video — fix or regenerate before approving');
    run("UPDATE videos SET status = 'approved', updated_at = ? WHERE id = ?", now(), video.id);
    const schedule = assignScheduleToVideo(video.id);
    res.json({ ok: true, schedule });
  } catch (err) {
    next(err);
  }
});

contentRouter.post('/videos/:id/regenerate', async (req, res, next) => {
  try {
    const video = get<any>('SELECT * FROM videos WHERE id = ?', req.params.id);
    if (!video) throw new HttpError(404, 'Video not found');
    const body = validate(req.body, {
      format: v.string({ max: 20, default: video.format }),
      hookId: v.string({ max: 60, default: '' }),
      durationSec: v.int({ min: 15, max: 90, default: video.duration_target_sec }),
    });
    const topic = video.topic_id ? get<any>('SELECT * FROM topics WHERE id = ?', video.topic_id) : null;
    if (!topic) throw new HttpError(400, 'This video has no topic attached');
    const facts = factsForTopic(topic);
    const hooks = hooksForVideo(video.id).length
      ? hooksForVideo(video.id)
      : generateHooks({ topicId: topic.id, videoId: video.id, topicTitle: topic.title, subject: facts[0]?.subject ?? topic.title, fact: facts[0]?.fact, count: 7, lang: video.language });
    const hook = body.hookId ? hooks.find((h) => h.id === body.hookId) ?? pickHook(hooks) : pickHook(hooks);

    const script = buildScript({
      topicId: topic.id,
      topicTitle: topic.title,
      subject: facts[0]?.subject,
      format: body.format as ScriptFormat,
      hook,
      facts,
      lang: video.language,
      targetSec: body.durationSec,
      seed: `${video.id}:${Date.now()}`,
    });
    const meta = buildMetadata({
      topicTitle: topic.title,
      subject: facts[0]?.subject,
      script,
      lang: video.language,
      nicheId: video.niche_id,
      sources: facts.filter((f) => f.source_url).map((f) => ({ url: f.source_url, title: f.subject })),
      seed: `${video.id}:meta:${Date.now()}`,
    });
    // Keep the sources captured at creation time: the regenerated script must
    // be grounded against them too, not only against the fresh fact selection.
    const storedSources = all<{ id: string }>(
      'SELECT s.id FROM sources s JOIN video_sources vs ON vs.source_id = s.id WHERE vs.video_id = ?',
      video.id,
    ).map((r) => r.id);
    const qc = factCheck({
      script,
      facts,
      sourceIds: storedSources,
      title: meta.chosenTitle,
      hookText: hook.text,
      videoId: video.id,
    });

    run('DELETE FROM scenes WHERE video_id = ?', video.id);
    let cursor = 0;
    script.scenes.forEach((scene, idx) => {
      run(
        `INSERT INTO scenes (id, video_id, idx, kind, text_on_screen, voiceover, visual, transition, duration_sec, start_sec, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id('scn'), video.id, idx, scene.kind, scene.textOnScreen, scene.voiceover, JSON.stringify(scene.visual),
        scene.transition, scene.durationSec, cursor, now(),
      );
      cursor += scene.durationSec;
    });
    run(
      `UPDATE scripts SET format = ?, hook_text = ?, voiceover_text = ?, word_count = ?, est_duration_sec = ?,
         version = version + 1, status = ?, created_at = ? WHERE video_id = ?`,
      script.format, hook.text, script.voiceoverText, script.wordCount, script.estDurationSec,
      qc.status === 'passed' ? 'approved' : 'draft', now(), video.id,
    );
    run(
      `UPDATE videos SET title = ?, description = ?, hashtags = ?, tags = ?, format = ?, hook_id = ?, hook_text = ?,
         qc_status = ?, review_notes = ?, status = ?, render_status = 'pending', mp4_path = NULL, updated_at = ?
       WHERE id = ?`,
      meta.chosenTitle, meta.description, JSON.stringify(meta.hashtags), JSON.stringify(meta.tags),
      script.format, hook.id, hook.text, qc.status, JSON.stringify(qc.notes.slice(0, 12)),
      qc.status === 'passed' ? 'draft' : 'review', now(), video.id,
    );
    res.json({ ok: true, qc, title: meta.chosenTitle, hook: hook.text, scenes: script.scenes.length, wordCount: script.wordCount });
  } catch (err) {
    next(err);
  }
});

contentRouter.post('/videos/:id/render', (req, res, next) => {
  try {
    const video = get('SELECT id FROM videos WHERE id = ?', req.params.id);
    if (!video) throw new HttpError(404, 'Video not found');
    const jobId = enqueue('video_render', { videoId: req.params.id }, { videoId: String(req.params.id), userId: req.user!.id, priority: 55, dedupeKey: `render:${req.params.id}` });
    res.status(202).json({ jobId });
  } catch (err) {
    next(err);
  }
});

contentRouter.get('/videos/:id/download', (req, res, next) => {
  try {
    // Scoped to the signed-in owner: another account gets the same 404 as a missing video.
    const video = get<any>('SELECT * FROM videos WHERE id = ? AND user_id = ?', req.params.id, req.user!.id);
    if (!video) throw new HttpError(404, 'Video not found');
    if (!video.mp4_path || !fs.existsSync(video.mp4_path)) throw new HttpError(404, 'No rendered MP4 yet');
    res.download(video.mp4_path, `${slugify(video.title || 'short') || 'short'}.mp4`);
  } catch (err) {
    next(err);
  }
});

contentRouter.get('/videos/:id/export', async (req, res, next) => {
  try {
    const result = await buildExportPackage(String(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

contentRouter.post('/videos/:id/recycle', (req, res, next) => {
  try {
    const body = validate(req.body, {
      kinds: v.array(v.string({ max: 30, oneOf: TRANSFORMS.map((t) => t.kind) }), { min: 1, max: 6, default: TRANSFORMS.map((t) => t.kind) }) as any,
    });
    const topics = deriveRecycleTopics(String(req.params.id), body.kinds as any);
    res.status(201).json({ topics, note: 'Derived topics are new originals — they still go through fact-checking before publishing.' });
  } catch (err) {
    next(err);
  }
});

contentRouter.delete('/videos/:id', (req, res, next) => {
  try {
    const video = get<any>('SELECT * FROM videos WHERE id = ?', req.params.id);
    if (!video) throw new HttpError(404, 'Video not found');
    run('DELETE FROM videos WHERE id = ?', video.id);
    for (const dir of [video.mp4_path, video.cover_path]) {
      try {
        if (dir && fs.existsSync(dir)) fs.rmSync(dir, { force: true });
      } catch {}
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

contentRouter.get('/recycle/candidates', (_req, res) => {
  res.json(recyclableVideos(15));
});

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

contentRouter.get('/meta/formats', (_req, res) => res.json(FORMATS));
contentRouter.get('/meta/languages', (_req, res) => res.json(LANGUAGES));

contentRouter.get('/jobs', (req, res) => {
  const filter: any = {};
  if (typeof req.query.status === 'string') filter.status = req.query.status;
  if (typeof req.query.batchId === 'string') filter.batchId = req.query.batchId;
  if (typeof req.query.type === 'string') filter.type = req.query.type;
  const limit = clamp(Number(req.query.limit ?? 200), 1, 500);
  res.json({ stats: queueStats(), jobs: listJobs({ ...filter, limit }) });
});

contentRouter.get('/jobs/:id', (req, res) => {
  const job = getJob(String(req.params.id));
  if (!job) throw new HttpError(404, 'Job not found');
  res.json({ job, logs: jobLogs(job.id) });
});

contentRouter.post('/jobs/:id/cancel', (req, res) => {
  const ok = cancelJob(String(req.params.id));
  res.json({ ok });
});

function safeJson<T>(raw: unknown, fallback: T): T {
  if (Array.isArray(raw) || (typeof raw === 'object' && raw !== null)) return raw as T;
  try {
    return JSON.parse(String(raw ?? '')) as T;
  } catch {
    return fallback;
  }
}
