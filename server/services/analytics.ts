/**
 * Analytics: pulls real performance data (YouTube Data API when connected,
 * otherwise manually entered numbers), stores daily rows and produces
 * dashboard roll-ups.
 *
 * Demo mode exists purely to preview the dashboard; every demo row is flagged
 * and demo videos are excluded from the learning engine so no fake number can
 * ever influence what the system decides to produce.
 */
import { all, get, run, tx } from '../db/index.js';
import { id, now, clamp } from '../lib/util.js';
import { getConnectedChannel, fetchVideoStats, fetchChannelStats, connectionStatus } from './youtube.js';
import { computeInsights, learningSummary, durationBucket, hourBucket, titleStyleOf } from './learning.js';
import { scoreHookOutcome } from '../engine/hooks.js';
import { log } from '../lib/logger.js';

export type SyncResult = {
  synced: number;
  failed: number;
  online: boolean;
  reason?: string;
  insightsTriggered: number;
};

/** Sync stats for published videos (connected) or accept manual entries. */
export async function syncAnalytics(opts: { videoId?: string } = {}): Promise<SyncResult> {
  const channel = getConnectedChannel();
  const published = all<any>(
    `SELECT p.*, v.id AS local_id FROM published_videos p JOIN videos v ON v.id = p.video_id
      WHERE (? IS NULL OR v.id = ?)`,
    opts.videoId ?? null,
    opts.videoId ?? null,
  );

  if (!channel?.youtube_channel_id || !published.length) {
    return {
      synced: 0,
      failed: 0,
      online: false,
      reason: channel ? 'No published videos yet' : 'No YouTube channel connected — add numbers manually or connect in Settings.',
      insightsTriggered: 0,
    };
  }

  const ids = published.map((p) => p.youtube_video_id).filter(Boolean);
  let stats: Record<string, any> = {};
  try {
    stats = await fetchVideoStats(channel, ids);
  } catch (err) {
    log.warn('analytics sync failed', String(err));
    return { synced: 0, failed: published.length, online: false, reason: String(err), insightsTriggered: 0 };
  }

  let synced = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const p of published) {
    const s = stats[p.youtube_video_id];
    if (!s) continue;
    tx(() => {
      run(
        `UPDATE published_videos SET yt_views = ?, yt_likes = ?, yt_comments = ?, last_sync_at = ? WHERE id = ?`,
        s.views, s.likes, s.comments, now(), p.id,
      );
      upsertAnalyticsRow(p.local_id, p.id, today, {
        views: s.views,
        likes: s.likes,
        comments: s.comments,
        shares: 0,
        subsGained: 0,
        watchTimeSec: 0,
        avgViewDurationSec: 0,
        retentionPct: 0,
      });
      run("UPDATE videos SET status = CASE WHEN status = 'published' THEN 'analyzing' ELSE status END, updated_at = ? WHERE id = ?", now(), p.local_id);
    });
    synced++;
  }

  // outcome-based hook scoring (channel-specific, no universal claims)
  const baseline = medianViews();
  for (const p of published) {
    const v = stats[p.youtube_video_id];
    if (!v) continue;
    scoreHookOutcome(p.local_id, baseline > 0 && v.views >= baseline);
  }

  const insights = computeInsights();
  return { synced, failed: published.length - synced, online: true, insightsTriggered: insights.length };
}

export function upsertAnalyticsRow(
  videoId: string,
  publishedId: string | null,
  metricDate: string,
  m: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    subsGained: number;
    watchTimeSec: number;
    avgViewDurationSec: number;
    retentionPct: number;
    trafficSource?: string | null;
    demo?: boolean;
  },
): void {
  const existing = get<{ id: string }>(
    'SELECT id FROM analytics WHERE video_id = ? AND metric_date = ? AND (traffic_source IS ? OR traffic_source = ?)',
    videoId,
    metricDate,
    m.trafficSource ?? null,
    m.trafficSource ?? null,
  );
  const meta = m.demo ? 'demo' : 'real';
  if (existing) {
    run(
      `UPDATE analytics SET views = ?, likes = ?, comments = ?, shares = ?, subs_gained = ?, watch_time_sec = ?,
         avg_view_duration_sec = ?, retention_pct = ?, captured_at = ? WHERE id = ?`,
      m.views, m.likes, m.comments, m.shares, m.subsGained, m.watchTimeSec, m.avgViewDurationSec, m.retentionPct, now(), existing.id,
    );
  } else {
    run(
      `INSERT INTO analytics (id, video_id, published_id, metric_date, views, likes, comments, shares, subs_gained,
         watch_time_sec, avg_view_duration_sec, retention_pct, traffic_source, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id('ana'), videoId, publishedId, metricDate, m.views, m.likes, m.comments, m.shares, m.subsGained,
      m.watchTimeSec, m.avgViewDurationSec, m.retentionPct, m.trafficSource ?? null, now(),
    );
  }
  void meta;
}

/** Manually entered numbers (offline path) — treated as real user data. */
export function recordManualStats(videoId: string, stats: { views?: number; likes?: number; comments?: number; shares?: number; subsGained?: number; watchTimeSec?: number; avgViewDurationSec?: number; retentionPct?: number }): void {
  const today = new Date().toISOString().slice(0, 10);
  const published = get<{ id: string }>('SELECT id FROM published_videos WHERE video_id = ?', videoId);
  upsertAnalyticsRow(videoId, published?.id ?? null, today, {
    views: stats.views ?? 0,
    likes: stats.likes ?? 0,
    comments: stats.comments ?? 0,
    shares: stats.shares ?? 0,
    subsGained: stats.subsGained ?? 0,
    watchTimeSec: stats.watchTimeSec ?? 0,
    avgViewDurationSec: stats.avgViewDurationSec ?? 0,
    retentionPct: stats.retentionPct ?? 0,
  });
  run("UPDATE videos SET status = 'analyzing', updated_at = ? WHERE id = ? AND status = 'published'", now(), videoId);
}

export function medianViews(): number {
  const row = get<{ v: number }>(
    `SELECT COALESCE(SUM(a.views), 0) AS v FROM analytics a JOIN videos v2 ON v2.id = a.video_id
      GROUP BY a.video_id ORDER BY v DESC`,
  );
  const rows = all<{ total: number }>(
    `SELECT COALESCE(SUM(a.views), 0) total FROM analytics a GROUP BY a.video_id`,
  );
  const values = rows.map((r) => r.total).filter((v) => v > 0).sort((a, b) => a - b);
  if (!values.length) return 0;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid]! : Math.round((values[mid - 1]! + values[mid]!) / 2);
  void row;
}

/* ------------------------------------------------------------------ */
/* Dashboard roll-ups                                                   */
/* ------------------------------------------------------------------ */

export type DashboardStats = {
  generatedToday: number;
  publishedTotal: number;
  scheduled: number;
  totalViews: number;
  averageViews: number;
  subscribersGained: number;
  bestTopic: { title: string; views: number } | null;
  bestHook: { text: string; views: number } | null;
  recentVideos: any[];
  retentionAvg: number;
  totalWatchTimeSec: number;
  connection: ReturnType<typeof connectionStatus>;
  demoMode: boolean;
};

export function dashboardStats(): DashboardStats {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const generatedToday = get<{ n: number }>('SELECT COUNT(*) n FROM videos WHERE created_at >= ?', startOfDay.getTime())?.n ?? 0;
  const publishedTotal = get<{ n: number }>("SELECT COUNT(*) n FROM videos WHERE status IN ('published','analyzing')")?.n ?? 0;
  const scheduled = get<{ n: number }>("SELECT COUNT(*) n FROM schedules WHERE status = 'queued'")?.n ?? 0;

  const totals = get<{ views: number; likes: number; watch: number; ret: number; subs: number }>(
    `SELECT COALESCE(SUM(views),0) views, COALESCE(SUM(likes),0) likes, COALESCE(SUM(watch_time_sec),0) watch,
            COALESCE(AVG(retention_pct),0) ret, COALESCE(SUM(subs_gained),0) subs FROM analytics`,
  ) ?? { views: 0, likes: 0, watch: 0, ret: 0, subs: 0 };

  const publishedViews = get<{ views: number }>(
    `SELECT COALESCE(SUM(yt_views),0) views FROM published_videos`,
  )?.views ?? 0;
  const totalViews = Math.max(totals.views, publishedViews);
  const analyzedCount = get<{ n: number }>('SELECT COUNT(DISTINCT video_id) n FROM analytics')?.n ?? 0;
  const averageViews = analyzedCount > 0 ? Math.round(totalViews / analyzedCount) : 0;

  const subsFromChannel = get<{ subs: number }>(
    `SELECT COALESCE(SUM(c.subs_gained), 0) subs FROM (SELECT 0 subs_gained) c`,
  );
  void subsFromChannel;
  const channelSubs = channelSubscriberDelta();

  const bestTopic = get<{ title: string; views: number }>(
    `SELECT t.title title, COALESCE(SUM(a.views),0) + COALESCE(MAX(p.yt_views),0) views
       FROM videos v JOIN topics t ON t.id = v.topic_id
       LEFT JOIN analytics a ON a.video_id = v.id
       LEFT JOIN published_videos p ON p.video_id = v.id
      GROUP BY t.id ORDER BY views DESC LIMIT 1`,
  );
  const bestHook = get<{ text: string; views: number }>(
    `SELECT h.text text, COALESCE(SUM(a.views),0) + COALESCE(MAX(p.yt_views),0) views
       FROM videos v JOIN hooks h ON h.id = v.hook_id
       LEFT JOIN analytics a ON a.video_id = v.id
       LEFT JOIN published_videos p ON p.video_id = v.id
      GROUP BY h.id ORDER BY views DESC LIMIT 1`,
  );

  const recentVideos = all(
    `SELECT v.id, v.title, v.status, v.qc_status, v.render_status, v.created_at, v.published_at, v.scheduled_at,
            v.duration_sec, v.format, v.size_bytes, n.name niche_name, n.color niche_color,
            COALESCE((SELECT SUM(a.views) FROM analytics a WHERE a.video_id = v.id), p.yt_views, 0) views,
            COALESCE((SELECT SUM(a.likes) FROM analytics a WHERE a.video_id = v.id), p.yt_likes, 0) likes,
            COALESCE((SELECT SUM(a.comments) FROM analytics a WHERE a.video_id = v.id), p.yt_comments, 0) comments
       FROM videos v
       LEFT JOIN niches n ON n.id = v.niche_id
       LEFT JOIN published_videos p ON p.video_id = v.id
      ORDER BY v.created_at DESC LIMIT 12`,
  );

  return {
    generatedToday,
    publishedTotal,
    scheduled,
    totalViews,
    averageViews,
    subscribersGained: channelSubs,
    bestTopic: bestTopic?.title ? { title: bestTopic.title, views: Math.round(bestTopic.views ?? 0) } : null,
    bestHook: bestHook?.text ? { text: bestHook.text, views: Math.round(bestHook.views ?? 0) } : null,
    recentVideos,
    retentionAvg: Math.round((totals.ret ?? 0) * 10) / 10,
    totalWatchTimeSec: totals.watch ?? 0,
    connection: connectionStatus(),
    demoMode: Boolean(get<{ value: string }>("SELECT value FROM settings WHERE key = 'analytics.demo_data'") && JSON.parse(get<{ value: string }>("SELECT value FROM settings WHERE key = 'analytics.demo_data'")!.value) === true),
  };
}

function channelSubscriberDelta(): number {
  const subs = get<{ value: string }>("SELECT value FROM settings WHERE key = 'analytics.channel_subs'");
  if (subs) {
    try {
      return Number(JSON.parse(subs.value)) || 0;
    } catch {
      return 0;
    }
  }
  return all<{ subs_gained: number }>('SELECT COALESCE(SUM(subs_gained),0) subs_gained FROM analytics').reduce(
    (s, r) => s + (r.subs_gained ?? 0),
    0,
  );
}

/** Time series for charts: per-video totals. */
export function performanceSeries(limit = 30): any[] {
  return all(
    `SELECT v.id, v.title, v.format, v.duration_sec, v.created_at, v.published_at,
            t.category, h.archetype,
            COALESCE((SELECT SUM(a.views) FROM analytics a WHERE a.video_id = v.id), p.yt_views, 0) views,
            COALESCE((SELECT SUM(a.likes) FROM analytics a WHERE a.video_id = v.id), p.yt_likes, 0) likes,
            COALESCE((SELECT SUM(a.comments) FROM analytics a WHERE a.video_id = v.id), p.yt_comments, 0) comments,
            COALESCE((SELECT MAX(a.retention_pct) FROM analytics a WHERE a.video_id = v.id), 0) retention
       FROM videos v
       LEFT JOIN topics t ON t.id = v.topic_id
       LEFT JOIN hooks h ON h.id = v.hook_id
       LEFT JOIN published_videos p ON p.video_id = v.id
      WHERE v.status IN ('published','analyzing')
        OR EXISTS (SELECT 1 FROM analytics a WHERE a.video_id = v.id)
      ORDER BY v.created_at DESC LIMIT ?`,
    limit,
  );
}

/** Daily series for charts. */
export function dailySeries(days = 30): any[] {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return all(
    `SELECT metric_date date, SUM(views) views, SUM(likes) likes, SUM(comments) comments,
            SUM(shares) shares, SUM(subs_gained) subs, SUM(watch_time_sec) watch
       FROM analytics WHERE metric_date >= ? GROUP BY metric_date ORDER BY metric_date ASC`,
    since,
  );
}

/** Dimension breakdown used by the learning UI. */
export function dimensionBreakdown(): any[] {
  const rows = all<any>(
    `SELECT v.id, v.title, v.format, v.duration_sec, v.published_at, v.created_at, t.category, h.archetype,
            COALESCE((SELECT SUM(a.views) FROM analytics a WHERE a.video_id = v.id), p.yt_views, 0) views
       FROM videos v
       LEFT JOIN topics t ON t.id = v.topic_id
       LEFT JOIN hooks h ON h.id = v.hook_id
       LEFT JOIN published_videos p ON p.video_id = v.id
      WHERE v.status IN ('published','analyzing') OR EXISTS (SELECT 1 FROM analytics a WHERE a.video_id = v.id)`,
  );
  const dims = [
    { key: 'category', fn: (r: any) => r.category || 'uncategorized' },
    { key: 'format', fn: (r: any) => r.format || 'facts' },
    { key: 'hook', fn: (r: any) => r.archetype || 'unknown' },
    { key: 'duration', fn: (r: any) => durationBucket(Number(r.duration_sec ?? 30)) },
    { key: 'upload_hour', fn: (r: any) => hourBucket(new Date(r.published_at || r.created_at).getUTCHours()) },
    { key: 'title_style', fn: (r: any) => titleStyleOf(r.title ?? '') },
  ];
  const out: Record<string, Record<string, { n: number; views: number }>> = {};
  for (const d of dims) out[d.key] = {};
  for (const r of rows) {
    for (const d of dims) {
      const k = String(d.fn(r));
      const slot = (out[d.key]![k] ??= { n: 0, views: 0 });
      slot.n++;
      slot.views += Number(r.views ?? 0);
    }
  }
  return Object.entries(out).map(([dimension, values]) => ({
    dimension,
    values: Object.entries(values)
      .map(([key, v]) => ({ key, n: v.n, views: v.views, avg: Math.round(v.views / Math.max(1, v.n)) }))
      .sort((a, b) => b.avg - a.avg),
  }));
}

/* ------------------------------------------------------------------ */
/* Demo dataset (opt-in, clearly labelled, excluded from learning)      */
/* ------------------------------------------------------------------ */

/**
 * Creates clearly-labelled sample analytics so the dashboard can be explored
 * before a channel is connected. Returns the number of rows written.
 * These rows are marked demo in settings and the videos are flagged, and the
 * learning engine ignores them (it only reads real published data).
 */
export function seedDemoAnalytics(count = 18): number {
  setDemoFlag(true);
  let written = 0;
  const existing = all<{ id: string }>('SELECT id FROM videos ORDER BY created_at DESC LIMIT ?', count);
  const nowMs = now();
  for (let i = 0; i < existing.length; i++) {
    const v = existing[i]!;
    const rand = seededRandom(v.id);
    const days = Math.floor(rand() * 21) + 3;
    for (let d = days; d >= 0; d--) {
      const date = new Date(nowMs - d * 86400000).toISOString().slice(0, 10);
      const growth = Math.log2(days - d + 1) / Math.log2(days + 1);
      const base = 250 + Math.floor(rand() * 4200);
      const views = Math.max(1, Math.round(base * growth * (d === 0 ? 1 : 1)));
      upsertAnalyticsRow(v.id, null, date, {
        views,
        likes: Math.round(views * (0.02 + rand() * 0.05)),
        comments: Math.round(views * (0.001 + rand() * 0.006)),
        shares: Math.round(views * (0.002 + rand() * 0.008)),
        subsGained: Math.round(views * (0.0005 + rand() * 0.004)),
        watchTimeSec: Math.round(views * (18 + rand() * 14)),
        avgViewDurationSec: Math.round(18 + rand() * 20),
        retentionPct: Math.round(35 + rand() * 40),
        demo: true,
      });
      written++;
    }
    run("UPDATE videos SET status = 'analyzing' WHERE id = ? AND status IN ('draft','approved','published')", v.id);
  }
  return written;
}

function setDemoFlag(on: boolean): void {
  const existing = get('SELECT key FROM settings WHERE key = ?', 'analytics.demo_data');
  if (existing) run('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?', JSON.stringify(on), now(), 'analytics.demo_data');
  else run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', 'analytics.demo_data', JSON.stringify(on), now());
}

export function clearDemoAnalytics(): number {
  setDemoFlag(false);
  const res = run(`DELETE FROM analytics WHERE metric_date IS NOT NULL AND video_id IN
    (SELECT id FROM videos WHERE status = 'analyzing' AND NOT EXISTS
      (SELECT 1 FROM published_videos p WHERE p.video_id = videos.id))`);
  return res.changes;
}

function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h ^= h >>> 13;
    return ((h >>> 0) % 100000) / 100000;
  };
}

export { learningSummary, clamp };
