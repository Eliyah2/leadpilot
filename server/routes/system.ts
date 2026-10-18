import { Router } from 'express';
import { all, get, run } from '../db/index.js';
import { validate, v } from '../lib/validate.js';
import { now, id } from '../lib/util.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';
import { dashboardStats, syncAnalytics, recordManualStats, performanceSeries, dailySeries, dimensionBreakdown, seedDemoAnalytics, clearDemoAnalytics } from '../services/analytics.js';
import { computeInsights, learningSummary, latestInsights, getInsightWeights } from '../services/learning.js';
import { usage, costRates, storageBytes } from '../services/usage.js';
import { publicSettings, getSetting, setSetting } from '../engine/settings.js';
import { queueStats, listJobs, enqueue, logLine } from '../jobs/queue.js';
import { createExperiment, listExperiments, evaluateExperiment, deleteExperiment, assignVariant } from '../services/experiments.js';
import { scheduleState, isSchedulerRunning } from '../services/scheduler.js';
import { isWorkerRunning } from '../jobs/worker.js';
import { isSecretSetting } from '../engine/settings.js';
import { CONFIG } from '../config.js';

export const systemRouter = Router();

/* ---------------- health ---------------- */

systemRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    version: '1.0.0',
    env: CONFIG.NODE_ENV,
    worker: isWorkerRunning(),
    scheduler: isSchedulerRunning(),
    queue: queueStats(),
    storageBytes: storageBytes(),
    uptimeSec: Math.round(process.uptime()),
  });
});

/* ---------------- dashboard ---------------- */

systemRouter.get('/dashboard', (_req, res) => {
  const stats = dashboardStats();
  const learning = learningSummary();
  const queue = queueStats();
  const recentJobs = listJobs({ limit: 8 });
  res.json({ stats, learning, queue, recentJobs });
});

/* ---------------- analytics ---------------- */

systemRouter.get('/analytics', (_req, res) => {
  res.json({
    daily: dailySeries(30),
    performance: performanceSeries(40),
    breakdown: dimensionBreakdown(),
    demoMode: Boolean(getSetting<boolean>('analytics.demo_data', false)),
  });
});

systemRouter.post('/analytics/sync', async (req, res, next) => {
  try {
    const jobId = enqueue('analytics_sync', {}, { userId: req.user!.id, dedupeKey: `sync:${Math.floor(now() / 60000)}`, priority: 65 });
    res.status(202).json({ jobId });
  } catch (err) {
    next(err);
  }
});

systemRouter.post('/analytics/sync-now', async (req, res, next) => {
  try {
    const result = await syncAnalytics({});
    if (result.insightsTriggered) logLine(null, null, 'info', `Learning engine recomputed ${result.insightsTriggered} insights`);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

systemRouter.post('/analytics/manual', (req, res, next) => {
  try {
    const body = validate(req.body, {
      videoId: v.string({ min: 3, max: 60 }),
      views: v.int({ min: 0, default: 0 }),
      likes: v.int({ min: 0, default: 0 }),
      comments: v.int({ min: 0, default: 0 }),
      shares: v.int({ min: 0, default: 0 }),
      subsGained: v.int({ min: 0, default: 0 }),
      retentionPct: v.num({ min: 0, max: 100, default: 0 }),
      avgViewDurationSec: v.num({ min: 0, default: 0 }),
    });
    recordManualStats(body.videoId, body);
    res.json({ ok: true, note: 'Numbers stored as manual entries; the learning engine uses them like real data.' });
  } catch (err) {
    next(err);
  }
});

systemRouter.post('/analytics/demo/seed', (req, res, next) => {
  try {
    const rows = seedDemoAnalytics();
    res.json({ rows, demoMode: true, note: 'Sample data for exploring the dashboard. It never influences the learning engine.' });
  } catch (err) {
    next(err);
  }
});

systemRouter.post('/analytics/demo/clear', (_req, res) => {
  const rows = clearDemoAnalytics();
  res.json({ deleted: rows, demoMode: false });
});

/* ---------------- learning ---------------- */

systemRouter.get('/learning', (req, res) => {
  const nicheId = typeof req.query.nicheId === 'string' ? req.query.nicheId : undefined;
  res.json({
    summary: learningSummary(nicheId),
    insights: latestInsights(nicheId, 60),
    weights: getInsightWeights(nicheId),
    disclaimer:
      'These insights describe only this channel\'s own published, tracked videos. They are not universal claims about YouTube.',
  });
});

systemRouter.post('/learning/recompute', (req, res, next) => {
  try {
    const jobId = enqueue('learning_recompute', {}, { userId: req.user!.id, dedupeKey: `learn:${Math.floor(now() / 60000)}` });
    res.status(202).json({ jobId });
  } catch (err) {
    next(err);
  }
});

/* ---------------- experiments ---------------- */

systemRouter.get('/experiments', (_req, res) => {
  res.json(listExperiments());
});

systemRouter.post('/experiments', (req, res, next) => {
  try {
    const body = validate(req.body, {
      name: v.string({ min: 3, max: 120 }),
      nicheId: v.string({ max: 60, default: '' }),
      hypothesis: v.string({ max: 500, default: '' }),
      metric: v.string({ max: 20, default: 'views', oneOf: ['views', 'likes', 'comments', 'retention'] }),
      minSamples: v.int({ min: 1, max: 50, default: 3 }),
      variants: v.array(
        v.object({
          key: v.string({ min: 1, max: 10 }),
          label: v.string({ min: 1, max: 120 }),
          payload: v.string({ max: 400, default: '{}' }),
        }),
        { min: 2, max: 6 },
      ),
    });
    const expId = createExperiment({
      name: body.name,
      nicheId: body.nicheId || null,
      hypothesis: body.hypothesis,
      metric: body.metric as any,
      minSamples: body.minSamples,
      variants: body.variants.map((x: any) => ({ key: x.key, label: x.label, payload: safeParse(x.payload) })),
    });
    res.status(201).json({ id: expId });
  } catch (err) {
    next(err);
  }
});

systemRouter.post('/experiments/:id/evaluate', (req, res, next) => {
  try {
    res.json(evaluateExperiment(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

systemRouter.post('/experiments/:id/assign', (req, res, next) => {
  try {
    const body = validate(req.body, { videoId: v.string({ min: 3, max: 60 }) });
    const variant = assignVariant(String(req.params.id));
    if (!variant) return res.status(400).json({ error: 'Experiment is not active' });
    run('UPDATE videos SET experiment_id = ?, variant_id = ? WHERE id = ?', req.params.id, variant.variantId, body.videoId);
    res.json({ variant });
  } catch (err) {
    next(err);
  }
});

systemRouter.delete('/experiments/:id', (req, res, next) => {
  try {
    deleteExperiment(String(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------------- cost / usage ---------------- */

systemRouter.get('/costs', (req, res) => {
  const days = Number(req.query.days ?? 30);
  res.json({
    summary: usage.summary(days),
    rates: costRates(),
    freeTierNotes: [
      'Everything in ShortForge runs locally: TTS, rendering, subtitles and generation cost $0.',
      'YouTube Data API: free quota of 10 000 units/day (one upload = 1 600 units ≈ 6 uploads/day).',
      'Trend sources used here (Wikipedia, Hacker News, Google Trends RSS, arXiv) require no key and no payment.',
      'Optional paid items are listed in the capability matrix and are never invoked automatically.',
    ],
  });
});

/* ---------------- settings ---------------- */

systemRouter.get('/settings', (_req, res) => {
  res.json({ settings: publicSettings() });
});

systemRouter.put('/settings', requireOwner, (req, res, next) => {
  try {
    const body = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return res.status(400).json({ error: 'Body must be an object' });
    }
    const updated: string[] = [];
    const skipped: string[] = [];
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (!/^[a-z][a-z0-9_.]{1,60}$/i.test(key)) {
        skipped.push(key);
        continue;
      }
      if (isSecretSetting(key) && value === '••••••••') continue; // untouched mask
      setSetting(key, value);
      updated.push(key);
    }
    res.json({ ok: true, updated, skipped });
  } catch (err) {
    next(err);
  }
});

/* ---------------- system logs ---------------- */

systemRouter.get('/logs', (req, res) => {
  const limit = Math.min(500, Number(req.query.limit ?? 200));
  const rows = all(
    `SELECT l.* FROM generation_logs l ORDER BY l.created_at DESC LIMIT ?`,
    limit,
  );
  res.json(rows);
});

function safeParse(s: unknown): any {
  if (typeof s !== 'object') {
    try {
      return JSON.parse(String(s));
    } catch {
      return {};
    }
  }
  return s ?? {};
}
