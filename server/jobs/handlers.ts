/**
 * Job handlers. Each handler is retry-safe: it either completes fully or
 * throws, and the queue schedules a backoff retry without losing prior work.
 */
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run } from '../db/index.js';
import { now, id, clamp } from '../lib/util.js';
import { createVideo } from '../engine/pipeline.js';
import { discoverTrends } from '../engine/trends.js';
import { getSetting } from '../engine/settings.js';
import { synthesizeVideo } from '../media/tts.js';
import { renderShort, subtitleStyleFromSettings } from '../media/render.js';
import { aspectSize } from '../lib/aspect.js';
import { enqueue, updateProgress, logLine, type JobType, type JobRow } from './queue.js';
import { CONFIG } from '../config.js';
import { log } from '../lib/logger.js';
import type { Lang, ScriptFormat } from '../engine/language.js';

export type HandlerCtx = {
  job: JobRow;
  progress: (percent: number, message?: string) => void;
  info: (message: string, meta?: unknown) => void;
};

export type Handler = (payload: any, ctx: HandlerCtx) => Promise<unknown>;

export const HANDLERS: Partial<Record<JobType, Handler>> = {
  /* ---------------------------------------------------------------- */
  batch_generate: async (payload, ctx) => {
    const { batchId, count, request, nicheId, language, targetSec, format, userId } = payload;
    const enqueued: string[] = [];
    for (let i = 0; i < count; i++) {
      const jobId = `${batchId}_v${i + 1}`;
      const childId = enqueue(
        'video_generate',
        { batchId, userId, nicheId, language, targetSec, format, index: i + 1, count, request },
        { jobId, batchId, userId, priority: 100 + i, dedupeKey: `${batchId}:video:${i + 1}`, maxAttempts: 3 },
      );
      enqueued.push(childId);
      ctx.progress(Math.round(((i + 1) / count) * 100), `Queued ${i + 1}/${count}`);
    }
    ctx.info(`Batch ${batchId}: queued ${count} generation jobs`);
    return { enqueued: enqueued.length, batchId };
  },

  /* ---------------------------------------------------------------- */
  video_generate: async (payload, ctx) => {
    const { batchId, userId, nicheId, language, targetSec, format, request, index, count } = payload;
    ctx.progress(10, 'Selecting topic and research');
    const result = await createVideo({
      userId,
      nicheId,
      language: language as Lang,
      targetSec,
      format: (format as ScriptFormat) || 'auto',
      batchId: batchId ?? null,
      research: getSetting<boolean>('generation.auto_research', true),
    });
    ctx.progress(90, 'Package created');
    ctx.info(
      `Generated "${result.title}" [${result.qcStatus}] (${count ? `${index}/${count}` : 'solo'})`,
      { videoId: result.videoId },
    );
    if (batchId) bumpBatch(batchId);
    return result;
  },

  /* ---------------------------------------------------------------- */
  video_voiceover: async (payload, ctx) => {
    const { videoId } = payload;
    const video = get<any>('SELECT * FROM videos WHERE id = ?', videoId);
    if (!video) throw new Error(`Video ${videoId} not found`);
    const scenes = all<any>('SELECT * FROM scenes WHERE video_id = ? ORDER BY idx', videoId);
    if (!scenes.length) throw new Error('Video has no scenes');
    ctx.progress(20, 'Synthesizing narration');
    const tts = await synthesizeVideo(
      videoId,
      scenes.map((s: any) => ({
        kind: s.kind,
        voiceover: s.voiceover,
        textOnScreen: s.text_on_screen,
        visual: JSON.parse(s.visual || '{}'),
        transition: s.transition,
        durationSec: s.duration_sec,
      })),
      {
        voice: getSetting<string>('voice.voice', ''),
        rate: getSetting<number>('voice.rate', 1.02),
        pitch: getSetting<number>('voice.pitch', 1),
        volume: getSetting<number>('voice.volume', 1),
      },
      (video.language as Lang) ?? 'en',
    );
    // persist exact timings
    for (const s of tts.scenes) {
      const row = scenes[s.idx];
      if (row) {
        run('UPDATE scenes SET duration_sec = ?, start_sec = ?, audio_path = ?, audio_ms = ? WHERE id = ?', s.durationSec, tts.scenes.slice(0, s.idx).reduce((acc, x) => acc + x.durationSec, 0), s.file, Math.round(s.durationSec * 1000), row.id);
      }
    }
    run('UPDATE voiceovers SET provider = ?, voice = ?, duration_ms = ?, file_path = ?, status = ? WHERE video_id = ?',
      tts.provider, tts.voice, Math.round(tts.totalDurationSec * 1000), tts.combinedFile, 'done', videoId);
    ctx.progress(100, 'Narration ready');
    return { totalDurationSec: tts.totalDurationSec, provider: tts.provider, voice: tts.voice, voiceMismatch: tts.voiceMismatch };
  },

  /* ---------------------------------------------------------------- */
  video_render: async (payload, ctx) => {
    const { videoId } = payload;
    const video = get<any>('SELECT * FROM videos WHERE id = ?', videoId);
    if (!video) throw new Error(`Video ${videoId} not found`);
    const scenes = all<any>('SELECT * FROM scenes WHERE video_id = ? ORDER BY idx', videoId);
    if (!scenes.length) throw new Error('Video has no scenes');

    run("UPDATE videos SET render_status = 'rendering', updated_at = ? WHERE id = ?", now(), videoId);
    try {
      ctx.progress(5, 'Synthesizing narration');
      const sceneSpecs = scenes.map((s: any) => ({
        kind: s.kind as any,
        voiceover: s.voiceover,
        textOnScreen: s.text_on_screen,
        visual: JSON.parse(s.visual || '{}'),
        transition: s.transition as any,
        durationSec: s.duration_sec,
      }));
      const tts = await synthesizeVideo(
        videoId,
        sceneSpecs,
        {
          voice: getSetting<string>('voice.voice', ''),
          rate: getSetting<number>('voice.rate', 1.02),
          pitch: getSetting<number>('voice.pitch', 1),
          volume: getSetting<number>('voice.volume', 1),
        },
        (video.language as Lang) ?? 'en',
      );

      // keep scene timings in sync with the real audio
      let cursor = 0;
      tts.scenes.forEach((s, i) => {
        const row = scenes[i];
        if (!row) return;
        run('UPDATE scenes SET duration_sec = ?, start_sec = ?, audio_path = ?, audio_ms = ? WHERE id = ?',
          s.durationSec, cursor, s.file, Math.round(s.durationSec * 1000), row.id);
        cursor += s.durationSec;
      });
      run('UPDATE voiceovers SET provider = ?, voice = ?, rate = ?, pitch = ?, duration_ms = ?, file_path = ?, status = ?, error = NULL WHERE video_id = ?',
        tts.provider, tts.voice, getSetting<number>('voice.rate', 1.02), getSetting<number>('voice.pitch', 1),
        Math.round(tts.totalDurationSec * 1000), tts.combinedFile, 'done', videoId);

      if (tts.voiceMismatch) {
        logLine(ctx.job.id, videoId, 'warn', `No local voice matches language "${video.language}"; used "${tts.voiceLabel}".`);
      }

      ctx.progress(35, 'Rendering scenes');
      const result = await renderShort({
        ...aspectSize(video.aspect),
        videoId,
        scenes: sceneSpecs.map((s, i) => ({ ...s, durationSec: tts.scenes[i]?.durationSec ?? s.durationSec })),
        tts,
        title: video.title || video.hook_text,
        keyword: pickKeyword(videoId, scenes),
        subtitleStyle: subtitleStyleFromSettings(),
        music: getSetting<boolean>('voice.music_enabled', true),
        musicVolume: getSetting<number>('voice.music_volume', 0.07),
        onProgress: (p, msg) => ctx.progress(35 + Math.round(p * 0.6), msg),
      });

      run(
        `UPDATE videos SET render_status = 'done', mp4_path = ?, cover_path = ?, size_bytes = ?, duration_sec = ?,
           updated_at = ? WHERE id = ?`,
        result.mp4, result.coverPath, result.sizeBytes, result.durationSec, now(), videoId,
      );
      ctx.info(`Rendered ${result.sceneCount} scenes in ${(result.renderMs / 1000).toFixed(1)}s (${(result.sizeBytes / 1e6).toFixed(1)} MB)`, { videoId });
      return { mp4: result.mp4, durationSec: result.durationSec, sizeBytes: result.sizeBytes, coverPath: result.coverPath };
    } catch (err) {
      run("UPDATE videos SET render_status = 'failed', error = ?, updated_at = ? WHERE id = ?",
        String(err instanceof Error ? err.message : err).slice(0, 1000), now(), videoId);
      throw err;
    }
  },

  /* ---------------------------------------------------------------- */
  trend_scan: async (payload, ctx) => {
    const nicheIds: string[] = payload?.nicheId ? [payload.nicheId] : all<{ id: string }>('SELECT id FROM niches').map((n) => n.id);
    const results: Record<string, number> = {};
    let i = 0;
    for (const nicheId of nicheIds) {
      try {
        const res = await discoverTrends(nicheId, { limit: payload?.limit ?? 20, lang: payload?.language });
        results[nicheId] = res.items.length;
        logLine(ctx.job.id, null, res.online ? 'info' : 'warn',
          res.online ? `Trends refreshed (${res.items.length} items)` : `Offline: curated angles used for ${nicheId}`,
          { sources: res.sources });
      } catch (err) {
        logLine(ctx.job.id, null, 'error', `Trend scan failed for niche ${nicheId}: ${String(err)}`);
      }
      i++;
      ctx.progress(Math.round((i / nicheIds.length) * 100), `Scanning niche ${i}/${nicheIds.length}`);
    }
    return results;
  },

  /* ---------------------------------------------------------------- */
  schedule_dispatch: async (_payload, ctx) => {
    const due = all<any>(
      `SELECT s.*, v.status AS video_status, v.render_status FROM schedules s
         JOIN videos v ON v.id = s.video_id
        WHERE s.status = 'queued' AND s.run_at <= ? ORDER BY s.run_at ASC LIMIT 50`,
      now(),
    );
    let dispatched = 0;
    // Without a linked channel a publish job would no-op and reschedule itself
    // every tick; keep the slot queued and only dispatch once YouTube is linked.
    const channelLinked = Boolean(
      get<{ id: string }>("SELECT id FROM channels WHERE youtube_channel_id IS NOT NULL AND youtube_channel_id <> '' LIMIT 1"),
    );
    for (const s of due) {
      if (s.kind === 'render' && s.render_status !== 'done') {
        enqueue('video_render', { videoId: s.video_id }, { videoId: s.video_id, batchId: s.batch_id ?? null, priority: 50, dedupeKey: `render:${s.video_id}` });
        dispatched++;
      } else if (s.kind === 'publish') {
        // Two gates: a channel must be linked, and auto-publish must be on
        // (default on — zero-touch). The slot stays queued until both hold.
        if (!channelLinked || !getSetting<boolean>('youtube.auto_publish', true)) continue;
        enqueue('publish_video', { videoId: s.video_id, scheduleId: s.id }, { videoId: s.video_id, priority: 40, dedupeKey: `publish:${s.video_id}` });
        dispatched++;
      } else if (s.kind === 'sync') {
        enqueue('analytics_sync', { videoId: s.video_id }, { videoId: s.video_id, priority: 80, dedupeKey: `sync:${s.video_id}` });
        dispatched++;
      }
      run("UPDATE schedules SET status = 'done', updated_at = ? WHERE id = ?", now(), s.id);
    }
    ctx.progress(100, `${dispatched} dispatched`);
    return { dispatched, checked: due.length };
  },

  /* ---------------------------------------------------------------- */
  publish_video: async (payload, ctx) => {
    const { videoId, scheduleId } = payload;
    const mod = await import('../services/youtube.js');
    ctx.progress(10, 'Checking channel connection');
    const res = await mod.uploadToYouTube(videoId, {
      onProgress: (p: number, msg: string) => ctx.progress(10 + Math.round(p * 0.85), msg),
    });
    // Only consume the slot when the upload really happened: if no channel is
    // linked (or the render is missing) the schedule stays queued and fires
    // again as soon as the user connects YouTube — no silent lost slots.
    if (scheduleId && res.uploaded) run("UPDATE schedules SET status = 'done', updated_at = ? WHERE id = ?", now(), scheduleId);
    // Pull performance numbers for the dashboard without anyone clicking.
    if (res.uploaded) enqueue('analytics_sync', {}, { priority: 85, dedupeKey: `sync:after:${videoId}` });
    ctx.info(res.uploaded ? `Uploaded to YouTube (${res.videoId})` : res.reason ?? 'Upload skipped', { videoId });
    return res;
  },

  /* ---------------------------------------------------------------- */
  export_package: async (payload, ctx) => {
    const mod = await import('../services/export.js');
    ctx.progress(20, 'Collecting assets');
    const res = await mod.buildExportPackage(payload.videoId);
    ctx.progress(100, 'Export ready');
    return res;
  },

  /* ---------------------------------------------------------------- */
  analytics_sync: async (payload, ctx) => {
    const mod = await import('../services/analytics.js');
    ctx.progress(10, 'Reading performance data');
    const res = await mod.syncAnalytics(payload ?? {});
    ctx.progress(100, `Synced ${res.synced} videos`);
    return res;
  },

  /* ---------------------------------------------------------------- */
  learning_recompute: async (_payload, ctx) => {
    const mod = await import('../services/learning.js');
    ctx.progress(30, 'Analysing channel performance');
    const insights = mod.computeInsights();
    ctx.progress(90, `Insights: ${insights.length}`);
    return { insights: insights.length };
  },
};

function pickKeyword(videoId: string, scenes: any[]): string {
  for (const s of scenes) {
    try {
      const kw = JSON.parse(s.visual || '{}').keyword;
      if (kw) return String(kw);
    } catch {}
  }
  const v = get<{ title: string }>('SELECT title FROM videos WHERE id = ?', videoId);
  return (v?.title ?? 'shorts').split(/\s+/)[0] ?? 'shorts';
}

/** Update batch roll-up counters after each child job settles. */
export function bumpBatch(batchId: string): void {
  const batch = get<any>('SELECT * FROM batches WHERE id = ?', batchId);
  if (!batch) return;
  const stats = all<{ status: string; n: number }>(
    "SELECT status, COUNT(*) n FROM generation_jobs WHERE batch_id = ? AND type != 'batch_generate' GROUP BY status",
    batchId,
  );
  const counts: Record<string, number> = {};
  for (const s of stats) counts[s.status] = s.n;
  const pending = (counts.queued ?? 0) + (counts.running ?? 0);
  const completed = counts.done ?? 0;
  const failed = counts.failed ?? 0;
  const status = pending > 0 ? 'running' : failed > 0 && completed === 0 ? 'failed' : 'done';
  run(
    'UPDATE batches SET completed = ?, failed = ?, status = ?, updated_at = ? WHERE id = ?',
    completed, failed, status, now(), batchId,
  );
}
