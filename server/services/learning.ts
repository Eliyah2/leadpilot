/**
 * Learning engine.
 *
 * Reads ONLY this channel's real performance data and produces weighted
 * guidance for future topic/hook/format selection.
 *
 * Guardrails (enforced, not aspirational):
 *   - an insight needs at least MIN_SAMPLE published, tracked videos;
 *   - statements are always phrased as channel-specific observations;
 *   - weights are clamped to [0.55, 1.6], so no category is ever eliminated
 *     after a poor video, and no category is guaranteed anything;
 *   - with no data every weight is exactly 1 (neutral).
 */
import { all, get, run } from '../db/index.js';
import { id, now, clamp } from '../lib/util.js';
import { log } from '../lib/logger.js';

export const MIN_SAMPLE = 5;

export type Weights = {
  category: Record<string, number>;
  hook: Record<string, number>;
  format: Record<string, number>;
  duration: Record<string, number>;
  hour: Record<string, number>;
  titleStyle: Record<string, number>;
};

const EMPTY: Weights = {
  category: {},
  hook: {},
  format: {},
  duration: {},
  hour: {},
  titleStyle: {},
};

export function durationBucket(sec: number): string {
  if (sec < 30) return '<30s';
  if (sec <= 45) return '30-45s';
  if (sec <= 60) return '45-60s';
  return '60s+';
}

export function hourBucket(hour: number): string {
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

export function titleStyleOf(title: string): string {
  const t = title.trim();
  if (t.endsWith('?')) return 'question';
  if (t.includes(':')) return 'explainer';
  if (t.length <= 28) return 'short';
  return 'curiosity';
}

type AnalyzedVideo = {
  id: string;
  title: string;
  views: number;
  category: string;
  hook_archetype: string;
  format: string;
  duration: number;
  hour: number;
  published_at: number;
  like_count: number;
  comment_count: number;
};

/** Videos with real numbers attached (analytics rows or synced YouTube stats). */
export function analyzedVideos(nicheId?: string): AnalyzedVideo[] {
  const rows = all<any>(
    `SELECT v.id, v.title, v.format, v.duration_sec, v.published_at, v.niche_id,
            COALESCE(p.yt_views, 0) AS sync_views,
            COALESCE(p.yt_likes, 0) AS sync_likes,
            COALESCE(p.yt_comments, 0) AS sync_comments,
            (SELECT SUM(a.views) FROM analytics a WHERE a.video_id = v.id) AS sum_views,
            (SELECT SUM(a.likes) FROM analytics a WHERE a.video_id = v.id) AS sum_likes,
            (SELECT SUM(a.comments) FROM analytics a WHERE a.video_id = v.id) AS sum_comments,
            h.archetype AS hook_archetype,
            t.category AS category
       FROM videos v
       LEFT JOIN published_videos p ON p.video_id = v.id
       LEFT JOIN hooks h ON h.id = v.hook_id
       LEFT JOIN topics t ON t.id = v.topic_id
      WHERE v.status IN ('published', 'analyzing')`,
    ...(nicheId ? [] : []),
  );
  const filtered = nicheId ? rows.filter((r) => r.niche_id === nicheId) : rows;
  return filtered
    .map((r) => ({
      id: r.id,
      title: r.title ?? '',
      views: Math.max(Number(r.sum_views ?? 0), Number(r.sync_views ?? 0)),
      likes: Math.max(Number(r.sum_likes ?? 0), Number(r.sync_likes ?? 0)),
      like_count: Math.max(Number(r.sum_likes ?? 0), Number(r.sync_likes ?? 0)),
      comment_count: Math.max(Number(r.sum_comments ?? 0), Number(r.sync_comments ?? 0)),
      category: r.category || 'uncategorized',
      hook_archetype: r.hook_archetype || 'unknown',
      format: r.format || 'facts',
      duration: Number(r.duration_sec ?? 0),
      hour: r.published_at ? new Date(r.published_at).getUTCHours() : 12,
      published_at: Number(r.published_at ?? 0),
    }))
    .filter((v) => v.views > 0);
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}

export type InsightRow = {
  id: string;
  dimension: string;
  dim_key: string;
  sample_size: number;
  median_views: number;
  baseline_views: number;
  lift: number;
  confidence: number;
  direction: 'up' | 'down' | 'neutral';
  statement: string;
  created_at: number;
};

/**
 * Recompute insights from actual tracked performance.
 * Returns the newly stored insights (empty when there is no real data yet).
 */
export function computeInsights(nicheId?: string): InsightRow[] {
  const videos = analyzedVideos(nicheId);
  if (videos.length < MIN_SAMPLE) {
    log.debug('learning: not enough tracked videos', { count: videos.length, need: MIN_SAMPLE });
    return [];
  }
  const baseline = median(videos.map((v) => v.views));
  if (baseline <= 0) return [];

  const dimensions: { name: string; key: (v: AnalyzedVideo) => string }[] = [
    { name: 'category', key: (v) => v.category },
    { name: 'hook_archetype', key: (v) => v.hook_archetype },
    { name: 'format', key: (v) => v.format },
    { name: 'duration_bucket', key: (v) => durationBucket(v.duration || 30) },
    { name: 'upload_hour', key: (v) => hourBucket(v.hour) },
    { name: 'title_style', key: (v) => titleStyleOf(v.title) },
  ];

  const out: InsightRow[] = [];
  for (const dim of dimensions) {
    const groups = groupBy(videos, dim.key);
    for (const [key, group] of groups) {
      const n = group.length;
      const med = median(group.map((v) => v.views));
      const lift = baseline > 0 ? (med - baseline) / baseline : 0;
      const confidence = clamp((n / (MIN_SAMPLE * 2)) * (0.6 + Math.min(1, Math.abs(lift))), 0, 1);
      const direction: InsightRow['direction'] = n < 3 ? 'neutral' : lift > 0.15 ? 'up' : lift < -0.15 ? 'down' : 'neutral';

      let statement: string;
      if (n < MIN_SAMPLE) {
        statement = `Only ${n} tracked video${n === 1 ? '' : 's'} in "${key}" — not enough data to draw a conclusion yet (needs ${MIN_SAMPLE}).`;
      } else {
        const dirText =
          direction === 'up'
            ? 'performed above your channel median'
            : direction === 'down'
              ? 'performed below your channel median'
              : 'performed about the same as your channel median';
        statement =
          `On your channel, ${dim.name} "${key}" ${dirText}: median ${Math.round(med).toLocaleString()} views ` +
          `across ${n} tracked video${n === 1 ? '' : 's'}, vs a channel median of ${Math.round(baseline).toLocaleString()}. ` +
          (direction === 'up'
            ? 'Worth producing more of these — based only on your own history.'
            : direction === 'down'
              ? 'Consider a different angle or hook for these; this is a small sample from your channel, not a general rule.'
              : 'No clear difference yet.');
      }

      const row: InsightRow = {
        id: id('ins'),
        dimension: dim.name,
        dim_key: key,
        sample_size: n,
        median_views: Math.round(med),
        baseline_views: Math.round(baseline),
        lift: Math.round(lift * 1000) / 1000,
        confidence: Math.round(confidence * 100) / 100,
        direction,
        statement,
        created_at: now(),
      };
      out.push(row);
      run(
        `INSERT INTO insights (id, niche_id, dimension, dim_key, sample_size, median_views, baseline_views,
           lift, confidence, direction, statement, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        nicheId ?? null,
        row.dimension,
        row.dim_key,
        row.sample_size,
        row.median_views,
        row.baseline_views,
        row.lift,
        row.confidence,
        row.direction,
        row.statement,
        row.created_at,
      );
    }
  }
  return out;
}

/** Latest insight per (dimension, key) → planning weights. Neutral when no data. */
export function getInsightWeights(nicheId?: string): Weights {
  const rows = all<{ dimension: string; dim_key: string; lift: number; sample_size: number }>(
    `SELECT dimension, dim_key, lift, sample_size FROM insights
      WHERE (niche_id IS ? OR niche_id = ?)
        AND created_at = (
          SELECT MAX(i2.created_at) FROM insights i2
           WHERE i2.dimension = insights.dimension AND i2.dim_key = insights.dim_key
             AND (i2.niche_id IS insights.niche_id OR i2.niche_id = ?)
        )`,
    nicheId ?? null,
    nicheId ?? null,
    nicheId ?? null,
  );
  const weights: Weights = structuredClone(EMPTY);
  for (const r of rows) {
    if (r.sample_size < MIN_SAMPLE) continue; // no conclusion before enough data
    const w = clamp(1 + r.lift * 0.5, 0.55, 1.6);
    switch (r.dimension) {
      case 'category':
        weights.category[r.dim_key] = w;
        break;
      case 'hook_archetype':
        weights.hook[r.dim_key] = w;
        break;
      case 'format':
        weights.format[r.dim_key] = w;
        break;
      case 'duration_bucket':
        weights.duration[r.dim_key] = w;
        break;
      case 'upload_hour':
        weights.hour[r.dim_key] = w;
        break;
      case 'title_style':
        weights.titleStyle[r.dim_key] = w;
        break;
    }
  }
  return weights;
}

export function latestInsights(nicheId?: string, limit = 40): InsightRow[] {
  return all<any>(
    `SELECT * FROM insights WHERE niche_id IS ? OR niche_id = ? ORDER BY created_at DESC LIMIT ?`,
    nicheId ?? null,
    nicheId ?? null,
    limit,
  );
}

/** Human-readable learning summary for the dashboard. */
export function learningSummary(nicheId?: string): {
  trackedVideos: number;
  enoughData: boolean;
  need: number;
  best: InsightRow | null;
  worst: InsightRow | null;
  topHooks: { key: string; median: number; n: number }[];
} {
  const videos = analyzedVideos(nicheId);
  const insights = latestInsights(nicheId, 200).filter((i) => i.sample_size >= MIN_SAMPLE && i.dimension === 'category');
  const hooks = all<{ archetype: string; views: number }>(`
    SELECT h.archetype, MAX(COALESCE(p.yt_views, 0)) AS views
      FROM hooks h JOIN videos v ON v.id = h.video_id
      LEFT JOIN published_videos p ON p.video_id = v.id
     WHERE v.status IN ('published','analyzing') GROUP BY h.archetype`);
  const byHook = new Map<string, number[]>();
  for (const h of hooks) {
    if (!byHook.has(h.archetype)) byHook.set(h.archetype, []);
    byHook.get(h.archetype)!.push(Number(h.views ?? 0));
  }
  const topHooks = [...byHook.entries()]
    .map(([key, arr]) => ({ key, median: median(arr.filter((v) => v > 0)), n: arr.length }))
    .filter((h) => h.n > 0)
    .sort((a, b) => b.median - a.median)
    .slice(0, 5);

  const sorted = [...insights].sort((a, b) => b.lift - a.lift);
  return {
    trackedVideos: videos.length,
    enoughData: videos.length >= MIN_SAMPLE,
    need: MIN_SAMPLE,
    best: sorted[0] ?? null,
    worst: sorted[sorted.length - 1] ?? null,
    topHooks,
  };
}
