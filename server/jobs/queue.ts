/**
 * Persistent background job queue (SQLite-backed).
 *
 * Guarantees:
 *   - jobs survive restarts (rows are committed before work starts),
 *   - failed jobs retry with exponential backoff up to max_attempts,
 *   - one job's failure never blocks the rest of the batch,
 *   - completed results are stored, never lost,
 *   - duplicate work is collapsed via dedupe keys.
 */
import { all, get, run } from '../db/index.js';
import { id, now, clamp } from '../lib/util.js';
import { log } from '../lib/logger.js';

export type JobType =
  | 'batch_generate'
  | 'video_generate'
  | 'video_render'
  | 'video_voiceover'
  | 'trend_scan'
  | 'analytics_sync'
  | 'schedule_dispatch'
  | 'publish_video'
  | 'export_package'
  | 'learning_recompute';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

export type JobRow = {
  id: string;
  type: JobType;
  status: JobStatus;
  priority: number;
  payload: string;
  progress: number;
  total: number;
  message: string;
  attempts: number;
  max_attempts: number;
  error: string | null;
  result: string | null;
  batch_id: string | null;
  user_id: string | null;
  video_id: string | null;
  dedupe_key: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
  next_run_at: number | null;
};

export type EnqueueOpts = {
  userId?: string | null;
  videoId?: string | null;
  batchId?: string | null;
  priority?: number; // lower runs first
  dedupeKey?: string;
  maxAttempts?: number;
  delayMs?: number;
  jobId?: string; // provide to make enqueue idempotent
};

export function enqueue(type: JobType, payload: unknown, opts: EnqueueOpts = {}): string {
  if (opts.dedupeKey) {
    const existing = get<{ id: string }>(
      `SELECT id FROM generation_jobs WHERE dedupe_key = ? AND status IN ('queued','running') LIMIT 1`,
      opts.dedupeKey,
    );
    if (existing) return existing.id;
  }
  const jobId = opts.jobId ?? id('job');
  if (opts.jobId) {
    const exists = get('SELECT id FROM generation_jobs WHERE id = ?', jobId);
    if (exists) return jobId;
  }
  const ts = now();
  run(
    `INSERT INTO generation_jobs (id, type, status, priority, payload, progress, total, message, attempts,
       max_attempts, batch_id, user_id, video_id, dedupe_key, created_at, updated_at, next_run_at)
     VALUES (?, ?, 'queued', ?, ?, 0, 0, '', 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
    jobId,
    type,
    opts.priority ?? 100,
    JSON.stringify(payload ?? {}),
    opts.maxAttempts ?? 3,
    opts.batchId ?? null,
    opts.userId ?? null,
    opts.videoId ?? null,
    opts.dedupeKey ?? null,
    ts,
    ts,
    opts.delayMs ? ts + opts.delayMs : ts,
  );
  log.debug('job enqueued', { jobId, type });
  return jobId;
}

/** Atomically claim the next runnable job. */
export function claimNext(types?: JobType[]): JobRow | null {
  const typeFilter = types?.length ? `AND type IN (${types.map(() => '?').join(',')})` : '';
  const params = types ?? [];
  const candidate = get<any>(
    `SELECT * FROM generation_jobs
      WHERE status = 'queued' AND (next_run_at IS NULL OR next_run_at <= ?) ${typeFilter}
      ORDER BY priority ASC, created_at ASC LIMIT 1`,
    now(),
    ...params,
  );
  if (!candidate) return null;
  // optimistic claim: only one worker wins
  const res = run(
    `UPDATE generation_jobs SET status = 'running', started_at = ?, updated_at = ?, attempts = attempts + 1, message = 'running'
      WHERE id = ? AND status = 'queued'`,
    now(),
    now(),
    candidate.id,
  );
  if (res.changes !== 1) return null;
  return get<JobRow>('SELECT * FROM generation_jobs WHERE id = ?', candidate.id) ?? null;
}

/** Claim a specific queued job by id (for "run now" and tests). */
export function claimNextById(jobId: string): JobRow | null {
  const res = run(
    `UPDATE generation_jobs SET status = 'running', started_at = ?, updated_at = ?, attempts = attempts + 1, message = 'running'
      WHERE id = ? AND status = 'queued'`,
    now(),
    now(),
    jobId,
  );
  if (res.changes !== 1) return null;
  return get<JobRow>('SELECT * FROM generation_jobs WHERE id = ?', jobId) ?? null;
}

export function updateProgress(jobId: string, progress: number, message?: string, total?: number): void {
  run(
    `UPDATE generation_jobs SET progress = ?, message = COALESCE(?, message), total = COALESCE(?, total), updated_at = ?
      WHERE id = ?`,
    clamp(Math.round(progress), 0, 100),
    message ?? null,
    total ?? null,
    now(),
    jobId,
  );
}

export function completeJob(jobId: string, result?: unknown): void {
  run(
    `UPDATE generation_jobs SET status = 'done', finished_at = ?, updated_at = ?, progress = 100, error = NULL,
       result = ?, message = 'done' WHERE id = ?`,
    now(),
    now(),
    result === undefined ? null : JSON.stringify(result),
    jobId,
  );
}

export function failJob(jobId: string, error: unknown): void {
  const job = get<JobRow>('SELECT * FROM generation_jobs WHERE id = ?', jobId);
  if (!job) return;
  const message = error instanceof Error ? error.message : String(error);
  const attempts = job.attempts;
  const canRetry = attempts < job.max_attempts;
  if (canRetry) {
    const backoff = Math.min(60_000, 2 ** attempts * 5_000);
    run(
      `UPDATE generation_jobs SET status = 'queued', error = ?, updated_at = ?, next_run_at = ?, message = 'retry scheduled'
        WHERE id = ?`,
      message.slice(0, 2000),
      now(),
      now() + backoff,
      jobId,
    );
    log.warn('job failed, retry scheduled', { jobId, attempts, backoff, error: message.slice(0, 200) });
  } else {
    run(
      `UPDATE generation_jobs SET status = 'failed', finished_at = ?, updated_at = ?, error = ?, message = 'failed' WHERE id = ?`,
      now(),
      now(),
      message.slice(0, 4000),
      jobId,
    );
    log.error('job failed permanently', { jobId, error: message.slice(0, 300) });
  }
}

export function cancelJob(jobId: string): boolean {
  const res = run(
    `UPDATE generation_jobs SET status = 'canceled', updated_at = ?, finished_at = ?, message = 'canceled'
      WHERE id = ? AND status IN ('queued','running')`,
    now(),
    now(),
    jobId,
  );
  return res.changes > 0;
}

/** Re-queue jobs that were mid-flight when the process died. */
export function recoverStuckJobs(): number {
  const res = run(
    `UPDATE generation_jobs SET status = 'queued', message = 'recovered after restart', updated_at = ?, next_run_at = ?
      WHERE status = 'running' AND started_at < ?`,
    now(),
    now(),
    now() - 60_000,
  );
  if (res.changes) log.info('recovered stuck jobs', { count: res.changes });
  return res.changes;
}

export function getJob(jobId: string): JobRow | undefined {
  return get<JobRow>('SELECT * FROM generation_jobs WHERE id = ?', jobId);
}

export function listJobs(filter: { status?: string; batchId?: string; type?: string; limit?: number } = {}): JobRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    where.push('status = ?');
    params.push(filter.status);
  }
  if (filter.batchId) {
    where.push('batch_id = ?');
    params.push(filter.batchId);
  }
  if (filter.type) {
    where.push('type = ?');
    params.push(filter.type);
  }
  return all<JobRow>(
    `SELECT * FROM generation_jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY created_at DESC LIMIT ?`,
    ...params,
    clamp(filter.limit ?? 100, 1, 500),
  );
}

export function queueStats(): { queued: number; running: number; done: number; failed: number; total: number } {
  const rows = all<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM generation_jobs GROUP BY status');
  const out = { queued: 0, running: 0, done: 0, failed: 0, total: 0 };
  for (const r of rows) {
    out[r.status as keyof typeof out] = r.n;
    out.total += r.n;
  }
  return out;
}

export function logLine(jobId: string | null, videoId: string | null, level: string, message: string, meta?: unknown): void {
  run(
    'INSERT INTO generation_logs (id, job_id, video_id, level, message, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id('log'),
    jobId,
    videoId,
    level,
    message.slice(0, 2000),
    meta === undefined ? null : JSON.stringify(meta),
    now(),
  );
}

export function jobLogs(jobId: string, limit = 200): any[] {
  return all('SELECT * FROM generation_logs WHERE job_id = ? ORDER BY created_at DESC LIMIT ?', jobId, limit);
}

export function videoLogs(videoId: string, limit = 200): any[] {
  return all('SELECT * FROM generation_logs WHERE video_id = ? ORDER BY created_at DESC LIMIT ?', videoId, limit);
}
