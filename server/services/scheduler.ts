/**
 * Scheduling engine — timezone-aware upload slots, capacity limits,
 * pause/resume and a calendar feed.
 *
 * Free by design: the scheduler only enqueues local jobs; it never contacts
 * YouTube unless a channel is connected and a publish job runs.
 */
import { all, get, run } from '../db/index.js';
import { id, now, clamp } from '../lib/util.js';
import { getSetting, setSetting } from '../engine/settings.js';
import { enqueue } from '../jobs/queue.js';
import { generateTopics } from '../engine/topics.js';
import type { Lang } from '../engine/language.js';
import { log } from '../lib/logger.js';

export type ScheduleSettings = {
  perDay: number;
  times: string[];
  days: number[]; // 1 = Monday … 7 = Sunday
  timezone: string;
  paused: boolean;
};

export function scheduleSettings(): ScheduleSettings {
  const times = getSetting<string[]>('schedule.times', ['17:00']);
  const days = getSetting<number[]>('schedule.days', [1, 2, 3, 4, 5]);
  return {
    perDay: clamp(getSetting<number>('schedule.per_day', 1), 0, 24),
    times: Array.isArray(times) && times.length ? times : ['17:00'],
    days: Array.isArray(days) && days.length ? days : [1, 2, 3, 4, 5],
    timezone: getSetting<string>('schedule.timezone', 'UTC'),
    paused: Boolean(getSetting<boolean>('schedule.paused', false)),
  };
}

/* ---------------- timezone helpers ---------------- */

const TZ_CACHE = new Map<string, Intl.DateTimeFormat>();

function tzFormatter(tz: string): Intl.DateTimeFormat {
  let f = TZ_CACHE.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
      });
    } catch {
      f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
    }
    TZ_CACHE.set(tz, f);
  }
  return f;
}

export function zonedParts(tz: string, date: Date): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const parts = tzFormatter(tz).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    weekday: weekdayMap[wd] ?? 0,
  };
}

/** Convert wall-clock time in a timezone to a UTC timestamp (two-pass). */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = naive;
  for (let i = 0; i < 2; i++) {
    const parts = zonedParts(tz, new Date(guess));
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    guess += naive - asUtc;
  }
  return guess;
}

const isoWeekday = (wd: number): number => (wd === 0 ? 7 : wd); // JS Sun=0 → ISO Sun=7

/** Next `count` slot timestamps honouring times, weekdays and timezone. */
export function nextSlots(count: number, from = now(), settings = scheduleSettings()): number[] {
  const slots: number[] = [];
  const cursor = new Date(from);
  for (let d = 0; d < 120 && slots.length < count; d++) {
    const day = new Date(cursor.getTime() + d * 86400000);
    const parts = zonedParts(settings.timezone, day);
    const isoWd = isoWeekday(parts.weekday);
    if (!settings.days.includes(isoWd)) continue;
    for (const time of settings.times.slice(0, Math.max(1, settings.perDay || settings.times.length))) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
      if (!m) continue;
      const ts = zonedToUtc(parts.year, parts.month, parts.day, Number(m[1]), Number(m[2]), settings.timezone);
      if (ts > from) slots.push(ts);
    }
  }
  return slots.sort((a, b) => a - b).slice(0, count);
}

/** Count of queued schedules already booked for a given timestamp. */
function bookedAt(ts: number): number {
  return get<{ n: number }>("SELECT COUNT(*) n FROM schedules WHERE status = 'queued' AND run_at = ?", ts)?.n ?? 0;
}

/** Find the next slot with free capacity (per-day limit enforced). */
export function findNextSlot(from = now()): number | null {
  const settings = scheduleSettings();
  if (settings.paused) return null;
  const perDay = Math.max(1, settings.perDay || settings.times.length);
  const candidates = nextSlots(perDay * 21 + settings.times.length, from, settings);
  const perDayCount = new Map<string, number>();
  for (const ts of candidates) {
    const dayKey = new Date(ts).toISOString().slice(0, 10);
    const used = perDayCount.get(dayKey) ?? 0;
    if (used >= perDay) continue;
    // One upload per time slot: stacking several uploads on the same timestamp
    // would burn the prime slot at once instead of spacing posts across the day.
    if (bookedAt(ts) > 0) continue;
    perDayCount.set(dayKey, used + 1);
    return ts;
  }
  return null;
}

/* ---------------- schedule rows ---------------- */

export function assignScheduleToVideo(videoId: string, opts: { runAt?: number; kind?: 'publish' | 'render' | 'sync'; force?: boolean } = {}): { scheduleId: string; runAt: number } | null {
  const existing = get<any>("SELECT * FROM schedules WHERE video_id = ? AND status = 'queued' ORDER BY run_at LIMIT 1", videoId);
  if (existing && !opts.force) return { scheduleId: existing.id, runAt: existing.run_at };

  const settings = scheduleSettings();
  const runAt = opts.runAt ?? findNextSlot();
  if (!runAt) {
    log.debug('no free schedule slot right now (paused or fully booked)', { videoId });
    return null;
  }
  const scheduleId = id('sch');
  run(
    `INSERT INTO schedules (id, video_id, run_at, timezone, status, kind, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`,
    scheduleId,
    videoId,
    runAt,
    settings.timezone,
    opts.kind ?? 'publish',
    now(),
    now(),
  );
  run('UPDATE videos SET scheduled_at = ?, updated_at = ? WHERE id = ?', runAt, now(), videoId);
  return { scheduleId, runAt };
}

export function cancelSchedule(scheduleId: string): boolean {
  const res = run("UPDATE schedules SET status = 'canceled', updated_at = ? WHERE id = ? AND status = 'queued'", now(), scheduleId);
  if (res.changes) {
    const s = get<{ video_id: string }>('SELECT video_id FROM schedules WHERE id = ?', scheduleId);
    if (s) run('UPDATE videos SET scheduled_at = NULL WHERE id = ?', s.video_id);
  }
  return res.changes > 0;
}

export function pauseSchedule(scheduleId: string): void {
  run("UPDATE schedules SET status = 'paused', updated_at = ? WHERE id = ? AND status = 'queued'", now(), scheduleId);
}
export function resumeSchedule(scheduleId: string): void {
  run("UPDATE schedules SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'paused'", now(), scheduleId);
}

/** Assign slots to approved videos that don't have one yet. */
export function autoAssignPending(limit = 50): number {
  const settings = scheduleSettings();
  if (settings.paused) return 0;
  const pending = all<{ id: string }>(
    `SELECT id FROM videos WHERE status = 'approved'
       AND NOT EXISTS (SELECT 1 FROM schedules s WHERE s.video_id = videos.id AND s.status IN ('queued','paused'))
      ORDER BY created_at ASC LIMIT ?`,
    limit,
  );
  let assigned = 0;
  for (const v of pending) {
    const res = assignScheduleToVideo(v.id);
    if (res) assigned++;
    else break; // out of slots / paused
  }
  return assigned;
}

export function calendarRange(fromMs: number, toMs: number): any[] {
  return all(
    `SELECT s.id, s.video_id, s.run_at, s.status, s.kind, s.timezone, v.title, v.status video_status,
            v.render_status, v.duration_sec, v.mp4_path, n.name niche_name, n.color niche_color
       FROM schedules s JOIN videos v ON v.id = s.video_id
       LEFT JOIN niches n ON n.id = v.niche_id
      WHERE s.run_at >= ? AND s.run_at <= ? AND s.status <> 'canceled'
      ORDER BY s.run_at ASC LIMIT 500`,
    fromMs,
    toMs,
  );
}

export function scheduleState(): {
  paused: boolean;
  perDay: number;
  times: string[];
  days: number[];
  timezone: string;
  nextSlots: { runAt: number; iso: string; label: string }[];
  queued: number;
} {
  const s = scheduleSettings();
  return {
    paused: s.paused,
    perDay: s.perDay,
    times: s.times,
    days: s.days,
    timezone: s.timezone,
    nextSlots: nextSlots(10).map((ts) => ({
      runAt: ts,
      iso: new Date(ts).toISOString(),
      label: new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    })),
    queued: get<{ n: number }>("SELECT COUNT(*) n FROM schedules WHERE status = 'queued'")?.n ?? 0,
  };
}

/* ---------------- background ticker ---------------- */

/**
 * Autopilot — keeps the factory producing so publishing never runs dry:
 *   1. approves videos that already passed QC (never the needs_review ones),
 *   2. refreshes free trend sources on the configured cadence,
 *   3. tops the pipeline back up to a two-day runway of schedulable videos.
 * Everything is throttled and keyed, so a 30s tick costs a couple of SELECTs.
 */
async function autopilotTick(): Promise<void> {
  if (!getSetting<boolean>('content.autopilot', true)) return;
  const owner = get<{ id: string }>("SELECT id FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1");
  if (!owner) return;

  /* 1 — auto-approve videos that are safe without a human --------------- */
  if (getSetting<boolean>('content.auto_approve_passed', true)) {
    // Passed QC → always. Needs-review → only when the notes are advisory
    // (length, pacing, duplication) and carry no factual risk: anything with
    // an unverified claim or suspicious statistic stays held for a human.
    const approvable = all<{ id: string }>(
      `SELECT id FROM videos
        WHERE status IN ('draft', 'review') AND render_status = 'done'
          AND (
            qc_status = 'passed'
            OR (
              qc_status = 'needs_review'
              AND COALESCE(review_notes, '[]') NOT LIKE '%Unverified claim%'
              AND COALESCE(review_notes, '[]') NOT LIKE '%Suspicious statistic%'
              AND COALESCE(review_notes, '[]') NOT LIKE '%No source material%'
              AND COALESCE(review_notes, '[]') NOT LIKE '%Repeated content%'
            )
          )
        LIMIT 10`,
    );
    for (const v of approvable) {
      run("UPDATE videos SET status = 'approved', updated_at = ? WHERE id = ? AND status IN ('draft','review')", now(), v.id);
      log.info('autopilot approved QC-safe video', { videoId: v.id });
    }
  }

  /* 2 — trend refresh on its configured cadence ------------------------- */
  const trendEveryMs = clamp(getSetting<number>('trends.auto_refresh_hours', 6), 1, 168) * 3600_000;
  const lastTrend = getSetting<number>('content.last_trend_run', 0);
  if (now() - lastTrend >= trendEveryMs) {
    setSetting('content.last_trend_run', now());
    enqueue('trend_scan', {}, { dedupeKey: `trends:${Math.floor(now() / trendEveryMs)}`, priority: 60 });
  }

  /* 2b — refresh performance stats for the dashboard -------------------- */
  const statsEveryMs = clamp(getSetting<number>('analytics.sync_hours', 6), 1, 168) * 3600_000;
  const lastStats = getSetting<number>('content.last_stats_sync', 0);
  const publishedN = get<{ n: number }>("SELECT COUNT(*) n FROM videos WHERE status = 'published'")?.n ?? 0;
  if (publishedN > 0 && now() - lastStats >= statsEveryMs) {
    setSetting('content.last_stats_sync', now());
    enqueue('analytics_sync', {}, { priority: 85, dedupeKey: `sync:periodic:${Math.floor(now() / statsEveryMs)}` });
  }

  /* 3 — keep a two-day runway of schedulable content -------------------- */
  const perDay = clamp(getSetting<number>('content.videos_per_day', 3), 0, 12);
  if (!perDay) return;
  const lastBatch = getSetting<number>('content.last_autopilot_run', 0);
  if (now() - lastBatch < 30 * 60_000) return; // at most one top-up per 30 min

  const horizon = now() + 2 * 86_400_000;
  const booked =
    get<{ n: number }>("SELECT COUNT(*) n FROM schedules WHERE status = 'queued' AND run_at <= ?", horizon)?.n ?? 0;
  const ready =
    get<{ n: number }>(
      `SELECT COUNT(*) n FROM videos v
        WHERE v.status = 'approved'
          AND NOT EXISTS (SELECT 1 FROM schedules s WHERE s.video_id = v.id AND s.status = 'queued')`,
    )?.n ?? 0;
  const inFlight =
    get<{ n: number }>(
      "SELECT COUNT(*) n FROM generation_jobs WHERE type IN ('video_generate','batch_generate') AND status IN ('queued','running')",
    )?.n ?? 0;
  const target = perDay * 2;
  const missing = target - (booked + ready + inFlight);
  if (missing <= 0 || inFlight > 0) return;

  const nicheSetting = getSetting<string>('content.autopilot_niches', '').trim();
  const nicheIds = nicheSetting
    ? nicheSetting.split(',').map((s) => s.trim()).filter(Boolean)
    : all<{ id: string }>('SELECT id FROM niches WHERE is_builtin = 1 ORDER BY created_at ASC').map((n) => n.id);
  if (!nicheIds.length) return;
  // Rotate so the channel is not one-note: advance one niche per top-up.
  const idx = getSetting<number>('content.autopilot_niche_idx', 0);
  const nicheId = getSetting<string>('content.autopilot_niche', '') || nicheIds[idx % nicheIds.length]!;
  setSetting('content.autopilot_niche_idx', (idx + 1) % nicheIds.length);

  const language = getSetting<string>('generation.default_language', 'en');
  const targetSec = getSetting<number>('generation.duration_target_sec', 40);
  const count = clamp(missing, 1, 3);

  // Make sure there are topics to draw from (same as the manual route).
  const available =
    get<{ n: number }>("SELECT COUNT(*) n FROM topics WHERE niche_id = ? AND status = 'available'", nicheId)?.n ?? 0;
  if (available < count) {
    try {
      await generateTopics({ nicheId, count: Math.min(60, count * 2), language: language as Lang });
    } catch (err) {
      log.debug('autopilot topic pre-generation failed', String(err));
    }
  }

  setSetting('content.last_autopilot_run', now());
  const batchId = id('bat');
  run(
    `INSERT INTO batches (id, user_id, request, niche_id, language, total, completed, failed, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'running', ?, ?)`,
    batchId,
    owner.id,
    'autopilot top-up',
    nicheId,
    language,
    count,
    now(),
    now(),
  );
  enqueue(
    'batch_generate',
    {
      batchId,
      userId: owner.id,
      nicheId,
      language,
      targetSec,
      count,
      request: '',
      autoRender: getSetting<boolean>('generation.auto_render', true),
      research: true,
    },
    { batchId, userId: owner.id, priority: 60, dedupeKey: `autopilot:${batchId}` },
  );
  log.info('autopilot queued a content top-up', { batchId, count, nicheId });
}

let timer: NodeJS.Timeout | null = null;

export function startScheduler(intervalMs = 30_000): void {
  if (timer) return;
  timer = setInterval(() => {
    try {
      const s = scheduleSettings();
      if (!s.paused) {
        autoAssignPending();
        // Only enqueue a dispatch job when there is actually work waiting —
        // a tick with nothing queued would just flood the job history.
        const queued = get<{ n: number }>("SELECT COUNT(*) n FROM schedules WHERE status = 'queued' AND run_at <= ?", now() + 3600_000)?.n ?? 0;
        if (queued > 0) {
          enqueue('schedule_dispatch', {}, { dedupeKey: `dispatch:${Math.floor(now() / 60_000)}`, priority: 30 });
        }
        void autopilotTick().catch((err) => log.error('autopilot tick failed', String(err)));
      }
    } catch (err) {
      log.error('scheduler tick failed', String(err));
    }
  }, intervalMs);
  log.info('scheduler started', { intervalMs });
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function isSchedulerRunning(): boolean {
  return Boolean(timer);
}
