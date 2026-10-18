import { all, get, run } from '../db/index.js';
import { id, now, clamp } from '../lib/util.js';
import { getSetting, isSecretSetting } from '../engine/settings.js';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';

export type UsageKind = 'llm_call' | 'tts_chars' | 'render_sec' | 'storage_bytes' | 'api_call' | 'export';

type RecordOpts = {
  userId?: string | null;
  provider?: string;
  units?: number;
  unitLabel?: string;
  costUsd?: number;
  meta?: Record<string, unknown> | null;
};

/** Cost/usage ledger. Free-first: every default rate is zero. */
export const usage = {
  record(kind: UsageKind, opts: RecordOpts = {}): void {
    const { userId = null, provider = 'free', units = 1, unitLabel = '', costUsd = 0, meta = null } = opts;
    run(
      `INSERT INTO usage_events (id, user_id, kind, provider, units, unit_label, cost_usd, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id('use'),
      userId,
      kind,
      provider,
      units,
      unitLabel,
      Math.round(costUsd * 1e6) / 1e6,
      meta ? JSON.stringify(meta) : null,
      now(),
    );
  },

  summary(days = 30): UsageSummary {
    const since = now() - days * 86400000;
    const rows = all<{ kind: string; provider: string; units: number; cost_usd: number; n: number }>(
      `SELECT kind, provider, SUM(units) units, SUM(cost_usd) cost_usd, COUNT(*) n
         FROM usage_events WHERE created_at >= ? GROUP BY kind, provider ORDER BY kind`,
      since,
    );
    const byKind: Record<string, { units: number; cost: number; events: number; providers: string[] }> = {};
    for (const r of rows) {
      const slot = (byKind[r.kind] ??= { units: 0, cost: 0, events: 0, providers: [] });
      slot.units += r.units;
      slot.cost += r.cost_usd;
      slot.events += r.n;
      if (!slot.providers.includes(r.provider)) slot.providers.push(r.provider);
    }
    const storage = storageBytes();
    const totalCost = rows.reduce((s, r) => s + r.cost_usd, 0);
    const paidEvents = get<{ n: number }>(
      `SELECT COUNT(*) n FROM usage_events WHERE created_at >= ? AND provider NOT IN ('free', 'local', 'ollama (free/local)')`,
      since,
    );
    return {
      days,
      byKind,
      storageBytes: storage,
      totalCostUsd: Math.round(totalCost * 10000) / 10000,
      paidProviderEvents: paidEvents?.n ?? 0,
      capabilities: CAPABILITIES,
    };
  },
};

export type UsageSummary = {
  days: number;
  byKind: Record<string, { units: number; cost: number; events: number; providers: string[] }>;
  storageBytes: number;
  totalCostUsd: number;
  paidProviderEvents: number;
  capabilities: Capability[];
};

export type Capability = {
  id: string;
  name: string;
  free: string;
  freeActive: boolean;
  paid?: string;
  paidRate?: string;
  paidActive: boolean;
  note?: string;
};

/** Honest free-vs-paid matrix shown in the Cost & Usage screen. */
export const CAPABILITIES: Capability[] = [
  {
    id: 'tts',
    name: 'Voiceover',
    free: 'Local TTS (Windows SAPI / espeak-ng) — unlimited, offline',
    freeActive: true,
    paid: 'ElevenLabs / Azure / Google TTS',
    paidRate: '≈ $0.015 per 1 000 characters',
    paidActive: false,
    note: 'ShortForge never calls a paid voice provider unless you configure one yourself.',
  },
  {
    id: 'llm',
    name: 'Script & hook generation',
    free: 'Built-in template + knowledge engine (no API)',
    freeActive: true,
    paid: 'Optional: any OpenAI-compatible model',
    paidRate: 'provider pricing',
    paidActive: false,
  },
  {
    id: 'render',
    name: 'Video rendering',
    free: 'FFmpeg (local, open source)',
    freeActive: true,
    paid: 'Cloud render farms',
    paidRate: 'per minute rendered',
    paidActive: false,
  },
  {
    id: 'trends',
    name: 'Trend discovery',
    free: 'Wikipedia pageviews, Hacker News, Google Trends RSS, arXiv',
    freeActive: true,
    paid: 'Commercial trend APIs (Glimpse, Exploding Topics)',
    paidRate: 'from $29 / month',
    paidActive: false,
  },
  {
    id: 'youtube',
    name: 'YouTube upload & analytics',
    free: 'YouTube Data API v3 (free quota: 10 000 units/day ≈ 6–8 uploads)',
    freeActive: true,
    paid: 'Additional API quota',
    paidRate: 'Google Cloud billing after free quota',
    paidActive: false,
  },
  {
    id: 'assets',
    name: 'Visual assets',
    free: 'Procedural FFmpeg backgrounds + your own uploads + CC0 sources',
    freeActive: true,
    paid: 'Stock footage / AI image APIs',
    paidRate: 'subscription',
    paidActive: false,
  },
  {
    id: 'translation',
    name: 'Multi-language scripts',
    free: 'Bundled phrase banks + local LLM (Ollama)',
    freeActive: true,
    paid: 'Hosted translation / LLM APIs',
    paidRate: 'provider pricing',
    paidActive: false,
  },
];

function dirBytes(dir: string): number {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else
        try {
          total += fs.statSync(p).size;
        } catch {}
    }
  }
  return total;
}

let cachedStorage: { at: number; bytes: number } | null = null;
export function storageBytes(): number {
  if (cachedStorage && Date.now() - cachedStorage.at < 15000) return cachedStorage.bytes;
  let total = 0;
  for (const dir of Object.values(CONFIG.DIRS)) total += dirBytes(dir);
  total += fs.existsSync(CONFIG.DB_FILE) ? fs.statSync(CONFIG.DB_FILE).size : 0;
  cachedStorage = { at: Date.now(), bytes: total };
  return total;
}

/** Current cost rates configured by the operator (all default to 0). */
export function costRates(): Record<string, number> {
  return {
    llm_per_1k_tokens: getSetting<number>('cost.paid.llm_per_1k_tokens', 0),
    tts_per_1k_chars: getSetting<number>('cost.paid.tts_per_1k_chars', 0),
    image_per_image: getSetting<number>('cost.paid.image_per_image', 0),
    storage_gb_month: getSetting<number>('cost.storage_gb_month', 0),
  };
}

export { isSecretSetting };
