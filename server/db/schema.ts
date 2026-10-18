import type { DatabaseSync } from 'node:sqlite';

/**
 * ShortForge relational schema.
 * Every statement is idempotent so `migrate()` can safely run on each boot.
 */
const DDL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------- identity ----------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'owner',   -- owner | member
  locale        TEXT NOT NULL DEFAULT 'en',
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ---------- channels & niches ----------
CREATE TABLE IF NOT EXISTS channels (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  language            TEXT NOT NULL DEFAULT 'en',
  timezone            TEXT NOT NULL DEFAULT 'UTC',
  niche_id            TEXT,
  youtube_channel_id  TEXT,
  youtube_title       TEXT,
  oauth               TEXT,           -- encrypted JSON {refresh_token, access_token, expiry, scope}
  connected_at        INTEGER,
  created_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS niches (
  id            TEXT PRIMARY KEY,
  user_id       TEXT,                        -- NULL = built-in
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  description   TEXT NOT NULL DEFAULT '',
  style         TEXT NOT NULL DEFAULT 'Fast-paced educational',
  audience      TEXT NOT NULL DEFAULT 'General',
  language      TEXT NOT NULL DEFAULT 'en',
  prompt_config TEXT NOT NULL DEFAULT '{}',  -- JSON tone/format weights/banned phrases
  color         TEXT NOT NULL DEFAULT '#6366f1',
  is_builtin    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

-- ---------- knowledge corpus (factual backbone) ----------
CREATE TABLE IF NOT EXISTS knowledge (
  id          TEXT PRIMARY KEY,
  niche       TEXT NOT NULL,
  subject     TEXT NOT NULL,
  fact        TEXT NOT NULL,
  detail      TEXT,
  source_url  TEXT,
  source_name TEXT,
  language    TEXT NOT NULL DEFAULT 'en',
  confidence  REAL NOT NULL DEFAULT 0.9,
  use_count   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_niche ON knowledge(niche);

CREATE TABLE IF NOT EXISTS sources (
  id           TEXT PRIMARY KEY,
  url          TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL DEFAULT '',
  publisher    TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT 'web',  -- wikipedia | paper | news | doc | web
  snippet      TEXT NOT NULL DEFAULT '',
  credibility  REAL NOT NULL DEFAULT 0.7,
  retrieved_at INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS video_sources (
  video_id  TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  note      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (video_id, source_id)
);

-- ---------- trend discovery ----------
CREATE TABLE IF NOT EXISTS trend_snapshots (
  id            TEXT PRIMARY KEY,
  niche_id      TEXT REFERENCES niches(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,          -- wikipedia | hn | google_trends | arxiv | reddit
  keyword       TEXT NOT NULL,
  headline      TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL DEFAULT '',
  search_interest INTEGER NOT NULL DEFAULT 0,
  relevance     REAL NOT NULL DEFAULT 0,
  competition   TEXT NOT NULL DEFAULT 'medium',  -- low | medium | high
  opportunity   TEXT NOT NULL DEFAULT '',
  related       TEXT NOT NULL DEFAULT '[]',      -- JSON keywords
  suggested_hooks TEXT NOT NULL DEFAULT '[]',
  captured_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trends_captured ON trend_snapshots(captured_at);
CREATE INDEX IF NOT EXISTS idx_trends_niche ON trend_snapshots(niche_id);

-- ---------- content planning ----------
CREATE TABLE IF NOT EXISTS topics (
  id              TEXT PRIMARY KEY,
  niche_id        TEXT NOT NULL REFERENCES niches(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  slug            TEXT NOT NULL,
  main_angle      TEXT NOT NULL DEFAULT '',
  alt_angle       TEXT NOT NULL DEFAULT '',
  audience        TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL DEFAULT '',
  complexity      TEXT NOT NULL DEFAULT 'medium', -- low | medium | high
  language        TEXT NOT NULL DEFAULT 'en',
  status          TEXT NOT NULL DEFAULT 'available', -- available | used | retired
  origin          TEXT NOT NULL DEFAULT 'generated', -- generated | trend | recycle | manual
  parent_video_id TEXT,
  source_ids      TEXT NOT NULL DEFAULT '[]',
  use_count       INTEGER NOT NULL DEFAULT 0,
  score           REAL NOT NULL DEFAULT 0,      -- learning-engine weight
  created_at      INTEGER NOT NULL,
  UNIQUE (niche_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status, niche_id);

CREATE TABLE IF NOT EXISTS hooks (
  id         TEXT PRIMARY KEY,
  topic_id   TEXT REFERENCES topics(id) ON DELETE CASCADE,
  video_id   TEXT,
  text       TEXT NOT NULL,
  archetype  TEXT NOT NULL DEFAULT 'curiosity',
  language   TEXT NOT NULL DEFAULT 'en',
  score      REAL NOT NULL DEFAULT 0,
  wins       INTEGER NOT NULL DEFAULT 0,
  losses     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hooks_topic ON hooks(topic_id);
CREATE INDEX IF NOT EXISTS idx_hooks_video ON hooks(video_id);

CREATE TABLE IF NOT EXISTS scripts (
  id               TEXT PRIMARY KEY,
  video_id         TEXT REFERENCES videos(id) ON DELETE CASCADE,
  topic_id         TEXT REFERENCES topics(id) ON DELETE SET NULL,
  format           TEXT NOT NULL DEFAULT 'facts',
  language         TEXT NOT NULL DEFAULT 'en',
  hook_text        TEXT NOT NULL DEFAULT '',
  voiceover_text   TEXT NOT NULL,
  word_count       INTEGER NOT NULL DEFAULT 0,
  est_duration_sec REAL NOT NULL DEFAULT 0,
  version          INTEGER NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'draft', -- draft | approved | needs_review
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scripts_video ON scripts(video_id);

CREATE TABLE IF NOT EXISTS assets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,          -- image | video | audio | font
  name        TEXT NOT NULL,
  path        TEXT NOT NULL,
  license     TEXT NOT NULL DEFAULT 'own',
  source_url  TEXT NOT NULL DEFAULT '',
  width       INTEGER,
  height      INTEGER,
  duration_ms INTEGER,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  tags        TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id      TEXT,
  niche_id        TEXT REFERENCES niches(id) ON DELETE SET NULL,
  topic_id        TEXT REFERENCES topics(id) ON DELETE SET NULL,
  batch_id        TEXT,
  parent_video_id TEXT,
  experiment_id   TEXT,
  variant_id      TEXT,
  title           TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  hashtags        TEXT NOT NULL DEFAULT '[]',
  keywords        TEXT NOT NULL DEFAULT '[]',
  tags            TEXT NOT NULL DEFAULT '[]',
  language        TEXT NOT NULL DEFAULT 'en',
  tone            TEXT NOT NULL DEFAULT 'engaging',
  style           TEXT NOT NULL DEFAULT 'Fast-paced educational',
  format          TEXT NOT NULL DEFAULT 'facts',
  duration_target_sec INTEGER NOT NULL DEFAULT 40,
  hook_id         TEXT,
  hook_text       TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'draft',
  qc_status       TEXT NOT NULL DEFAULT 'pending',
  render_status   TEXT NOT NULL DEFAULT 'pending',
  cover_path      TEXT,
  mp4_path        TEXT,
  size_bytes      INTEGER NOT NULL DEFAULT 0,
  duration_sec    REAL,
  scheduled_at    INTEGER,
  published_at    INTEGER,
  visibility      TEXT NOT NULL DEFAULT 'public',
  error           TEXT,
  origin          TEXT NOT NULL DEFAULT 'factory',
  seed            TEXT NOT NULL DEFAULT '',
  review_notes    TEXT NOT NULL DEFAULT '[]',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status, created_at);
CREATE INDEX IF NOT EXISTS idx_videos_batch ON videos(batch_id);
CREATE INDEX IF NOT EXISTS idx_videos_niche ON videos(niche_id);
CREATE INDEX IF NOT EXISTS idx_videos_scheduled ON videos(scheduled_at);

CREATE TABLE IF NOT EXISTS scenes (
  id            TEXT PRIMARY KEY,
  video_id      TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  idx           INTEGER NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'value',  -- hook | context | value | payoff | cta | transition
  text_on_screen TEXT NOT NULL DEFAULT '',
  voiceover     TEXT NOT NULL DEFAULT '',
  visual        TEXT NOT NULL DEFAULT '{}',     -- JSON visual spec
  transition    TEXT NOT NULL DEFAULT 'fade',
  duration_sec  REAL NOT NULL DEFAULT 3,
  start_sec     REAL NOT NULL DEFAULT 0,
  audio_path    TEXT,
  audio_ms      INTEGER,
  asset_id      TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scenes_video ON scenes(video_id, idx);

CREATE TABLE IF NOT EXISTS voiceovers (
  id          TEXT PRIMARY KEY,
  video_id    TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL DEFAULT 'windows-sapi',
  voice       TEXT NOT NULL DEFAULT '',
  rate        REAL NOT NULL DEFAULT 1,
  pitch       REAL NOT NULL DEFAULT 1,
  text        TEXT NOT NULL DEFAULT '',
  file_path   TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | done | failed
  error       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voiceovers_video ON voiceovers(video_id);

-- ---------- queue / jobs ----------
CREATE TABLE IF NOT EXISTS batches (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request    TEXT NOT NULL DEFAULT '',
  niche_id   TEXT,
  language   TEXT NOT NULL DEFAULT 'en',
  total      INTEGER NOT NULL DEFAULT 0,
  completed  INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'running', -- running | done | failed | paused
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | failed | canceled
  priority     INTEGER NOT NULL DEFAULT 100,
  payload      TEXT NOT NULL DEFAULT '{}',
  progress     INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  message      TEXT NOT NULL DEFAULT '',
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error        TEXT,
  result       TEXT,
  batch_id     TEXT,
  user_id      TEXT,
  video_id     TEXT,
  dedupe_key   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  started_at   INTEGER,
  finished_at  INTEGER,
  next_run_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON generation_jobs(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_batch ON generation_jobs(batch_id);
CREATE INDEX IF NOT EXISTS idx_jobs_next ON generation_jobs(status, next_run_at);

CREATE TABLE IF NOT EXISTS generation_logs (
  id         TEXT PRIMARY KEY,
  job_id     TEXT,
  video_id   TEXT,
  level      TEXT NOT NULL DEFAULT 'info',
  message    TEXT NOT NULL,
  meta       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_job ON generation_logs(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_logs_video ON generation_logs(video_id, created_at);

-- ---------- scheduling / publishing ----------
CREATE TABLE IF NOT EXISTS schedules (
  id         TEXT PRIMARY KEY,
  video_id   TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  channel_id TEXT,
  run_at     INTEGER NOT NULL,
  timezone   TEXT NOT NULL DEFAULT 'UTC',
  status     TEXT NOT NULL DEFAULT 'queued', -- queued | paused | done | canceled
  kind       TEXT NOT NULL DEFAULT 'publish', -- publish | render | sync
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedules_run ON schedules(status, run_at);

CREATE TABLE IF NOT EXISTS published_videos (
  id                TEXT PRIMARY KEY,
  video_id          TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  channel_id        TEXT,
  youtube_video_id  TEXT,
  title             TEXT NOT NULL DEFAULT '',
  visibility        TEXT NOT NULL DEFAULT 'public',
  published_at      INTEGER,
  last_sync_at      INTEGER,
  yt_views          INTEGER NOT NULL DEFAULT 0,
  yt_likes          INTEGER NOT NULL DEFAULT 0,
  yt_comments       INTEGER NOT NULL DEFAULT 0,
  yt_shares         INTEGER NOT NULL DEFAULT 0,
  yt_subs_gained    INTEGER NOT NULL DEFAULT 0,
  yt_watch_time_sec INTEGER NOT NULL DEFAULT 0,
  error             TEXT,
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_published_video ON published_videos(video_id);
CREATE INDEX IF NOT EXISTS idx_published_yt ON published_videos(youtube_video_id);

CREATE TABLE IF NOT EXISTS analytics (
  id                 TEXT PRIMARY KEY,
  video_id           TEXT REFERENCES videos(id) ON DELETE CASCADE,
  published_id       TEXT,
  metric_date        TEXT NOT NULL,      -- YYYY-MM-DD
  views              INTEGER NOT NULL DEFAULT 0,
  likes              INTEGER NOT NULL DEFAULT 0,
  comments           INTEGER NOT NULL DEFAULT 0,
  shares             INTEGER NOT NULL DEFAULT 0,
  subs_gained        INTEGER NOT NULL DEFAULT 0,
  watch_time_sec     INTEGER NOT NULL DEFAULT 0,
  avg_view_duration_sec REAL NOT NULL DEFAULT 0,
  retention_pct      REAL NOT NULL DEFAULT 0,
  traffic_source     TEXT,
  captured_at        INTEGER NOT NULL,
  UNIQUE (video_id, metric_date, traffic_source)
);
CREATE INDEX IF NOT EXISTS idx_analytics_video ON analytics(video_id);

-- ---------- learning / experiments ----------
CREATE TABLE IF NOT EXISTS insights (
  id            TEXT PRIMARY KEY,
  niche_id      TEXT,
  dimension     TEXT NOT NULL,     -- format | hook_archetype | duration_bucket | upload_hour | title_style | category
  dim_key       TEXT NOT NULL,
  sample_size   INTEGER NOT NULL DEFAULT 0,
  median_views  REAL NOT NULL DEFAULT 0,
  baseline_views REAL NOT NULL DEFAULT 0,
  lift          REAL NOT NULL DEFAULT 0,
  confidence    REAL NOT NULL DEFAULT 0,
  direction     TEXT NOT NULL DEFAULT 'neutral', -- up | down | neutral
  statement     TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_insights_niche ON insights(niche_id, created_at);

CREATE TABLE IF NOT EXISTS experiments (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  niche_id    TEXT,
  hypothesis  TEXT NOT NULL DEFAULT '',
  metric      TEXT NOT NULL DEFAULT 'views',
  min_samples INTEGER NOT NULL DEFAULT 3,
  status      TEXT NOT NULL DEFAULT 'active', -- active | concluded | archived
  result      TEXT,
  created_at  INTEGER NOT NULL,
  ended_at    INTEGER
);

CREATE TABLE IF NOT EXISTS experiment_variants (
  id            TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,     -- A / B
  label         TEXT NOT NULL,
  payload       TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  UNIQUE (experiment_id, key)
);

CREATE TABLE IF NOT EXISTS usage_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  kind       TEXT NOT NULL,        -- llm_call | tts_chars | render_sec | storage_bytes | api_call
  provider   TEXT NOT NULL DEFAULT 'free',
  units      REAL NOT NULL DEFAULT 0,
  unit_label TEXT NOT NULL DEFAULT '',
  cost_usd   REAL NOT NULL DEFAULT 0,
  meta       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_kind ON usage_events(kind, created_at);

-- ---------- app settings ----------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export function migrate(database: DatabaseSync): void {
  database.exec(DDL);
  database
    .prepare(`INSERT INTO schema_meta (key, value) VALUES ('version', '1') ON CONFLICT(key) DO NOTHING`)
    .run();
  upgradeRenderQuality(database);
  upgradeAutopilot(database);
  addVideoAspect(database);
}

/** Adds videos.aspect to databases created before the Create Video wizard. */
function addVideoAspect(database: DatabaseSync): void {
  const cols = database.prepare(`PRAGMA table_info(videos)`).all() as { name: string }[];
  if (cols.some((c) => c.name === 'aspect')) return;
  database.exec(`ALTER TABLE videos ADD COLUMN aspect TEXT NOT NULL DEFAULT '9:16'`);
}

/**
 * One-time autopilot upgrade: zero-touch publishing needs auto_publish on by
 * default (the toggle still turns it off deliberately).
 */
function upgradeAutopilot(database: DatabaseSync): void {
  const marker = database.prepare(`SELECT value FROM schema_meta WHERE key = ?`).get('autopilot_v1');
  if (marker) return;
  database
    .prepare(`UPDATE settings SET value = ? WHERE key = ? AND value = ?`)
    .run(JSON.stringify(true), 'youtube.auto_publish', JSON.stringify(false));
  database
    .prepare(`INSERT INTO schema_meta (key, value) VALUES ('autopilot_v1', '1') ON CONFLICT(key) DO NOTHING`)
    .run();
}

/**
 * One-time quality uplift: the original defaults (CRF 21 / veryfast / 128k)
 * produced soft, slightly blocky uploads. Only values that still equal the
 * old defaults are touched, and the marker keeps it a one-shot upgrade.
 */
function upgradeRenderQuality(database: DatabaseSync): void {
  const marker = database.prepare(`SELECT value FROM schema_meta WHERE key = ?`).get('render_quality_v2');
  if (marker) return;
  const setIfDefault = (key: string, oldValue: string | number, newValue: string | number): void => {
    database
      .prepare(`UPDATE settings SET value = ? WHERE key = ? AND value = ?`)
      .run(JSON.stringify(newValue), key, JSON.stringify(oldValue));
  };
  setIfDefault('render.crf', 21, 18);
  setIfDefault('render.preset', 'veryfast', 'faster');
  setIfDefault('render.audio_bitrate', '128k', '192k');
  database
    .prepare(`INSERT INTO schema_meta (key, value) VALUES ('render_quality_v2', '1') ON CONFLICT(key) DO NOTHING`)
    .run();
}

export const ENTITY_TABLES = [
  'users',
  'channels',
  'niches',
  'knowledge',
  'sources',
  'trend_snapshots',
  'topics',
  'hooks',
  'scripts',
  'videos',
  'scenes',
  'voiceovers',
  'assets',
  'schedules',
  'published_videos',
  'analytics',
  'experiments',
  'experiment_variants',
  'insights',
  'usage_events',
  'generation_jobs',
  'generation_logs',
  'batches',
  'settings',
];
