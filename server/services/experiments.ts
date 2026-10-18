/**
 * A/B experiments (hooks, formats, titles…).
 *
 * Rules:
 *   - variants are only compared after BOTH sides reach min_samples real,
 *     tracked videos;
 *   - results state sample sizes and medians — never "this will go viral";
 *   - a variant is never declared a winner on a single video.
 */
import { all, get, run } from '../db/index.js';
import { id, now, clamp } from '../lib/util.js';
import { log } from '../lib/logger.js';

export type VariantInput = { key: string; label: string; payload?: Record<string, unknown> };
export type ExperimentInput = {
  name: string;
  nicheId?: string | null;
  hypothesis?: string;
  metric?: 'views' | 'likes' | 'comments' | 'retention';
  minSamples?: number;
  variants: VariantInput[];
};

export function createExperiment(input: ExperimentInput): string {
  if (!input.variants || input.variants.length < 2) throw new Error('An experiment needs at least two variants');
  const expId = id('exp');
  run(
    `INSERT INTO experiments (id, name, niche_id, hypothesis, metric, min_samples, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    expId,
    input.name.slice(0, 120),
    input.nicheId ?? null,
    (input.hypothesis ?? '').slice(0, 500),
    input.metric ?? 'views',
    clamp(input.minSamples ?? 3, 1, 100),
    now(),
  );
  for (const v of input.variants) {
    run(
      'INSERT INTO experiment_variants (id, experiment_id, key, label, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id('var'),
      expId,
      v.key,
      v.label.slice(0, 120),
      JSON.stringify(v.payload ?? {}),
      now(),
    );
  }
  return expId;
}

/** Round-robin variant assignment so groups stay balanced. */
export function assignVariant(experimentId: string): { variantId: string; key: string; label: string; payload: any } | null {
  const exp = get<any>('SELECT * FROM experiments WHERE id = ?', experimentId);
  if (!exp || exp.status !== 'active') return null;
  const variants = all<any>('SELECT * FROM experiment_variants WHERE experiment_id = ? ORDER BY key', experimentId);
  if (!variants.length) return null;
  const assigned = all<{ variant_id: string }>('SELECT variant_id FROM videos WHERE experiment_id = ? AND variant_id IS NOT NULL', experimentId);
  const counts = new Map<string, number>();
  for (const a of assigned) counts.set(a.variant_id, (counts.get(a.variant_id) ?? 0) + 1);
  const chosen = [...variants].sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0))[0]!;
  return { variantId: chosen.id, key: chosen.key, label: chosen.label, payload: safeParse(chosen.payload) };
}

export function attachVideoToExperiment(videoId: string, experimentId: string): void {
  const variant = assignVariant(experimentId);
  if (!variant) return;
  run('UPDATE videos SET experiment_id = ?, variant_id = ? WHERE id = ?', experimentId, variant.variantId, videoId);
}

export type VariantResult = {
  key: string;
  label: string;
  n: number;
  median: number;
  mean: number;
  totalViews: number;
  enoughData: boolean;
};

export type Evaluation = {
  id: string;
  name: string;
  status: 'active' | 'concluded' | 'insufficient_data';
  metric: string;
  minSamples: number;
  variants: VariantResult[];
  statement: string;
  winner: string | null;
};

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

export function evaluateExperiment(experimentId: string): Evaluation {
  const exp = get<any>('SELECT * FROM experiments WHERE id = ?', experimentId);
  if (!exp) throw new Error('Experiment not found');
  const variants = all<any>('SELECT * FROM experiment_variants WHERE experiment_id = ? ORDER BY key', experimentId);
  const metric = exp.metric || 'views';

  const results: VariantResult[] = variants.map((v) => {
    const rows = all<any>(
      `SELECT v.id,
              COALESCE((SELECT SUM(a.views) FROM analytics a WHERE a.video_id = v.id),
                       (SELECT p.yt_views FROM published_videos p WHERE p.video_id = v.id), 0) views,
              COALESCE((SELECT SUM(a.likes) FROM analytics a WHERE a.video_id = v.id),
                       (SELECT p.yt_likes FROM published_videos p WHERE p.video_id = v.id), 0) likes,
              COALESCE((SELECT SUM(a.comments) FROM analytics a WHERE a.video_id = v.id),
                       (SELECT p.yt_comments FROM published_videos p WHERE p.video_id = v.id), 0) comments,
              COALESCE((SELECT MAX(a.retention_pct) FROM analytics a WHERE a.video_id = v.id), 0) retention
         FROM videos v
        WHERE v.experiment_id = ? AND v.variant_id = ?
          AND (EXISTS (SELECT 1 FROM analytics a WHERE a.video_id = v.id)
               OR EXISTS (SELECT 1 FROM published_videos p WHERE p.video_id = v.id))`,
      experimentId,
      v.id,
    );
    const values = rows.map((r) => Number(r[metric] ?? r.views ?? 0)).filter((x) => x > 0);
    const totalViews = rows.reduce((s, r) => s + Number(r.views ?? 0), 0);
    return {
      key: v.key,
      label: v.label,
      n: values.length,
      median: median(values),
      mean: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0,
      totalViews,
      enoughData: values.length >= (exp.min_samples ?? 3),
    };
  });

  const allEnough = results.length >= 2 && results.every((r) => r.enoughData);
  const anyData = results.some((r) => r.n > 0);
  let winner: string | null = null;
  let statement: string;
  let status: Evaluation['status'];

  if (!anyData) {
    status = 'active';
    statement = 'No tracked performance data yet. Publish the variants and sync analytics to start the comparison.';
  } else if (!allEnough) {
    status = 'insufficient_data';
    const missing = results.filter((r) => !r.enoughData).map((r) => `${r.key} (${r.n}/${exp.min_samples})`);
    statement = `Not enough data yet — waiting for ${missing.join(', ')} tracked videos. No conclusion is drawn from partial data.`;
  } else {
    const sorted = [...results].sort((a, b) => b.median - a.median);
    const top = sorted[0]!;
    const bottom = sorted[sorted.length - 1]!;
    const diff = bottom.median > 0 ? (top.median - bottom.median) / bottom.median : 0;
    if (diff < 0.15) {
      status = 'concluded';
      statement = `Both variants perform about the same on your channel (medians ${top.median.toLocaleString()} vs ${bottom.median.toLocaleString()} across ${exp.min_samples}+ videos each). Keep either.`;
    } else {
      status = 'concluded';
      winner = top.key;
      statement = `On your channel, variant ${top.key} ("${top.label}") has a median of ${top.median.toLocaleString()} ${metric} vs ${bottom.median.toLocaleString()} for ${bottom.key}, across ${top.n} and ${bottom.n} tracked videos. This is a channel-specific result, not a general rule.`;
    }
  }

  run('UPDATE experiments SET status = ?, result = ?, ended_at = ? WHERE id = ?',
    status, JSON.stringify({ results, statement, winner }), status === 'concluded' ? now() : null, experimentId);

  return { id: experimentId, name: exp.name, status, metric, minSamples: exp.min_samples, variants: results, statement, winner };
}

export function listExperiments(): any[] {
  const rows = all<any>('SELECT * FROM experiments ORDER BY created_at DESC LIMIT 100');
  return rows.map((e) => {
    const variants = all<any>('SELECT * FROM experiment_variants WHERE experiment_id = ? ORDER BY key', e.id);
    const videos = all<{ id: string; title: string; variant_id: string; status: string }>(
      'SELECT id, title, variant_id, status FROM videos WHERE experiment_id = ?',
      e.id,
    );
    let evaluation: Evaluation | null = null;
    try {
      evaluation = evaluateExperiment(e.id);
    } catch (err) {
      log.debug('evaluation skipped', String(err));
    }
    return {
      ...e,
      variants: variants.map((v) => ({ ...v, payload: safeParse(v.payload), videos: videos.filter((x) => x.variant_id === v.id) })),
      evaluation,
    };
  });
}

export function deleteExperiment(experimentId: string): void {
  run('UPDATE videos SET experiment_id = NULL, variant_id = NULL WHERE experiment_id = ?', experimentId);
  run('DELETE FROM experiments WHERE id = ?', experimentId);
}

function safeParse(s: unknown): any {
  if (typeof s !== 'string') return s ?? {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
