/**
 * API client: same-origin cookie session + CSRF header on mutations.
 * All endpoints live under /api.
 */

let csrfToken: string | null = null;

export function setCsrf(token: string | null): void {
  csrfToken = token;
}

export function getCsrf(): string | null {
  return csrfToken;
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function refreshCsrf(): Promise<void> {
  try {
    const res = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
    if (res.ok) {
      const data = (await res.json()) as { csrf: string | null };
      csrfToken = data.csrf;
    }
  } catch {
    /* offline — retry on next call */
  }
}

export async function api<T = unknown>(path: string, opts: { method?: Method; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  if (method !== 'GET' && !csrfToken) await refreshCsrf();

  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' && csrfToken ? { 'x-sf-csrf': csrfToken } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 403 && method !== 'GET') {
    // CSRF may have rotated (new login in another tab) — refresh once and retry.
    await refreshCsrf();
    return api<T>(path, opts);
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

/* ---------------- shared types ---------------- */

export type User = { id: string; email: string; name: string; role: string; locale: string; createdAt: number };

export type Video = {
  id: string;
  title: string;
  hook: string;
  status: 'draft' | 'review' | 'approved' | 'scheduled' | 'published' | 'analyzing';
  qcStatus: string | null;
  renderStatus: string | null;
  format: string;
  language: string;
  durationSec: number | null;
  durationTarget: number;
  scheduledAt: number | null;
  publishedAt: number | null;
  visibility: string;
  sizeBytes: number;
  mp4: boolean;
  cover: boolean;
  nicheId: string | null;
  nicheName: string | null;
  nicheColor: string | null;
  topicId: string | null;
  topicTitle: string | null;
  category: string | null;
  batchId: string | null;
  experimentId: string | null;
  variantId: string | null;
  views: number;
  likes: number;
  comments: number;
  hashtags: string[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
  parentVideoId: string | null;
  origin: string;
};

export type VideoDetail = Video & {
  description: string;
  keywords: string[];
  reviewNotes: string[];
  error: string | null;
  scenes: {
    id: string;
    idx: number;
    kind: string;
    textOnScreen: string;
    voiceover: string;
    visual: Record<string, unknown>;
    transition: string;
    durationSec: number;
    startSec: number;
  }[];
  hooks: { id: string; text: string; archetype: string; score: number; supported: boolean }[];
  script: {
    id: string;
    format: string;
    hook: string;
    voiceoverText: string;
    wordCount: number;
    estDurationSec: number;
    status: string;
  } | null;
  sources: { id: string; url: string; title: string; publisher: string; kind: string; snippet: string }[];
  voiceover: { provider: string; voice: string; rate: number; pitch: number; status: string; durationMs: number; file: boolean } | null;
  published: {
    youtubeVideoId: string;
    visibility: string;
    views: number;
    likes: number;
    comments: number;
    publishedAt: number;
    lastSync: number;
  } | null;
  schedules: Record<string, unknown>[];
  jobs: Job[];
  analytics: Record<string, unknown>[];
  qc: QcReport | null;
  logs: { id: string; level: string; message: string; created_at: number }[];
};

export type QcReport = {
  status: 'passed' | 'needs_review' | 'failed';
  score: number;
  checks: { id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }[];
  notes: string[];
  unverifiedClaims: string[];
  verifiedSourceIds: string[];
};

export type Job = {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'canceled';
  progress: number;
  total: number;
  message: string;
  attempts: number;
  error: string | null;
  batch_id: string | null;
  video_id: string | null;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
};

export type Batch = {
  id: string;
  request: string;
  niche_id: string | null;
  niche_name: string | null;
  language: string;
  total: number;
  completed: number;
  failed: number;
  status: string;
  created_at: number;
  jobs: number;
};

export type Niche = {
  id: string;
  name: string;
  slug: string;
  description: string;
  style: string;
  audience: string;
  language: string;
  color: string;
  isBuiltin: boolean;
  promptConfig: Record<string, unknown>;
};

export type Topic = {
  id: string;
  title: string;
  slug: string;
  mainAngle: string;
  altAngle: string;
  audience: string;
  suggestedHook: string;
  suggestedTitle: string;
  complexity: string;
  category: string;
  status: string;
  origin: string;
  useCount: number;
  score: number;
};

export type Trend = {
  id: string;
  niche_id: string;
  keyword: string;
  source: string;
  interest: number;
  velocity: number;
  region: string;
  related: string[];
  suggested_hooks: string[];
  captured_at: number;
};

export type ScheduleState = {
  paused: boolean;
  perDay: number;
  times: string[];
  days: number[];
  timezone: string;
  nextSlots: { runAt: number; iso: string; label: string }[];
};

export type DashboardData = {
  stats: {
    generatedToday: number;
    publishedTotal: number;
    scheduled: number;
    totalViews: number;
    averageViews: number;
    subscribersGained: number;
    bestTopic: { title: string; views: number } | null;
    bestHook: { text: string; views: number } | null;
    recentVideos: Record<string, unknown>[];
    retentionAvg: number;
    totalWatchTimeSec: number;
    connection: Record<string, unknown>;
    demoMode: boolean;
  };
  learning: Record<string, unknown>;
  queue: { queued: number; running: number; done: number; failed: number; total: number };
  recentJobs: Job[];
};
