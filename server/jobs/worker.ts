/**
 * Background worker: claims queued jobs and runs their handlers with bounded
 * concurrency. Progress, logs and errors are persisted so the dashboard can
 * show exactly what happened (1/50, 2/50, …) and failures never stop the batch.
 */
import { CONFIG } from '../config.js';
import { log } from '../lib/logger.js';
import {
  claimNext,
  claimNextById,
  completeJob,
  failJob,
  getJob,
  recoverStuckJobs,
  updateProgress,
  logLine,
  type JobRow,
} from './queue.js';
import { HANDLERS, bumpBatch, type HandlerCtx } from './handlers.js';
import { sleep } from '../lib/util.js';

let timer: NodeJS.Timeout | null = null;
let active = 0;
let started = false;
let lastWake = 0;

export type WorkerEvents = {
  onJobDone?: (job: JobRow) => void;
  onJobFailed?: (job: JobRow) => void;
};

const events: WorkerEvents = {};

export function setWorkerEvents(e: WorkerEvents): void {
  Object.assign(events, e);
}

export function isWorkerRunning(): boolean {
  return started;
}

export function startWorker(concurrency = CONFIG.JOB_CONCURRENCY): void {
  if (started) return;
  started = true;
  recoverStuckJobs();
  timer = setInterval(tick, 350);
  log.info('worker started', { concurrency });
}

export function stopWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

async function tick(): Promise<void> {
  if (!started) return;
  // avoid hot-looping when idle: back off to 1.5s idle polling
  const idle = Date.now() - lastWake > 4000;
  try {
    while (active < CONFIG.JOB_CONCURRENCY) {
      const job = claimNext();
      if (!job) break;
      lastWake = Date.now();
      active++;
      void runJob(job).finally(() => {
        active--;
      });
    }
    if (idle) lastWake = Date.now();
  } catch (err) {
    log.error('worker tick failed', String(err));
  }
}

export async function runJob(job: JobRow): Promise<void> {
  const handler = HANDLERS[job.type];
  if (!handler) {
    failJob(job.id, new Error(`No handler registered for job type "${job.type}"`));
    return;
  }
  let payload: any = {};
  try {
    payload = JSON.parse(job.payload || '{}');
  } catch {
    payload = {};
  }
  const ctx: HandlerCtx = {
    job,
    progress: (percent, message) => updateProgress(job.id, percent, message),
    info: (message, meta) => logLine(job.id, job.video_id, 'info', message, meta),
  };

  const startedAt = Date.now();
  try {
    logLine(job.id, job.video_id, 'info', `Job started: ${job.type} (attempt ${job.attempts})`);
    const result = await handler(payload, ctx);
    completeJob(job.id, result);
    logLine(job.id, job.video_id, 'info', `Job done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    if (job.batch_id) bumpBatch(job.batch_id);
    events.onJobDone?.({ ...job, status: 'done' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logLine(job.id, job.video_id, 'error', `Job failed: ${message.slice(0, 500)}`);
    failJob(job.id, err);
    if (job.batch_id) bumpBatch(job.batch_id);
    if (job.video_id && job.type === 'video_generate') {
      // never leave a half-built video visible
      try {
        const { run } = await import('../db/index.js');
        run("UPDATE videos SET status = 'review', error = ? WHERE id = ? AND render_status = 'pending'", message.slice(0, 500), job.video_id);
      } catch {}
    }
    events.onJobFailed?.({ ...job, status: 'failed', error: message });
  }
}

/** Run a specific job right now (used by tests and by "Run now" buttons). */
export async function runJobNow(jobId: string): Promise<JobRow | undefined> {
  let job = getJob(jobId);
  if (!job) return undefined;
  if (job.status !== 'queued') return job;
  job = claimNextById(jobId) ?? job;
  await runJob(job);
  return getJob(jobId);
}

/** Drain the queue synchronously (tests / CLI batch runs). */
export async function drainQueue(maxJobs = 500): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (let i = 0; i < maxJobs; i++) {
    const job = claimNext();
    if (!job) break;
    const before = job.id;
    await runJob(job);
    const after = getJob(before);
    if (after?.status === 'done') done++;
    else if (after?.status === 'failed') failed++;
  }
  return { done, failed };
}

export { sleep };
