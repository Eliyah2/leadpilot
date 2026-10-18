/**
 * Trend Finder — free sources in, scored opportunities out.
 *
 * Honesty rules enforced here:
 *   - No guarantee language ("will go viral") is ever produced.
 *   - Competition/relevance are transparent estimates from *this* database.
 *   - Trending items are used as inspiration; final content is original.
 */
import { all, get, run } from '../db/index.js';
import { id, now, slugify, similarity, sample, rng, hashStr } from '../lib/util.js';
import {
  hnTrending,
  googleTrends,
  arxivRecent,
  wikipediaTrending,
  type TrendItem,
} from './research.js';
import { getSetting } from './settings.js';
import { PACKS, type Lang } from './language.js';
import { log } from '../lib/logger.js';

export type TrendView = {
  id: string;
  topic: string;
  keyword: string;
  source: string;
  url: string;
  searchInterest: number;
  relevance: number; // 0..1
  competition: 'low' | 'medium' | 'high';
  opportunity: string;
  suggestedHooks: string[];
  relatedKeywords: string[];
  capturedAt: number;
  online: boolean;
};

type NicheRow = { id: string; name: string; slug: string; prompt_config: string; language: string };

function nicheKeywords(niche: NicheRow): string[] {
  let cfg: any = {};
  try {
    cfg = JSON.parse(niche.prompt_config || '{}');
  } catch {}
  const fromConfig: string[] = Array.isArray(cfg.keywords) ? cfg.keywords.map(String) : [];
  const extra = niche.name.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  return Array.from(new Set([...fromConfig, niche.slug, ...extra]));
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** 0..1: how much the item talks about this niche. */
function relevanceOf(item: TrendItem, keywords: string[]): number {
  const text = tokenize(`${item.headline} ${item.keyword}`);
  if (!text.length) return 0;
  const kw = new Set(keywords.flatMap((k) => k.toLowerCase().split(/\s+/)));
  let hits = 0;
  for (const t of text) if (kw.has(t)) hits++;
  const ratio = hits / text.length;
  // also allow a soft match against niche keyword phrases
  let phrase = 0;
  const joined = ` ${text.join(' ')} `;
  for (const k of keywords) if (joined.includes(` ${k.toLowerCase()} `)) phrase += 0.25;
  return Math.min(1, ratio * 2.2 + phrase);
}

/** Competition is measured against *this channel's own* output, not the internet. */
function competitionOf(item: TrendItem, nicheId: string): { level: 'low' | 'medium' | 'high'; made: number } {
  const titles = all<{ title: string }>(
    `SELECT title FROM videos WHERE niche_id = ? AND title <> ''`,
    nicheId,
  );
  const itemTokens = new Set(tokenize(item.keyword || item.headline));
  let made = 0;
  for (const t of titles) {
    const tt = tokenize(t.title);
    const overlap = tt.filter((x) => itemTokens.has(x)).length;
    if (overlap >= Math.max(1, Math.floor(tt.length * 0.3))) made++;
  }
  const level = made >= 3 ? 'high' : made >= 1 ? 'medium' : 'low';
  return { level, made };
}

function opportunityText(item: TrendItem, rel: number, made: number, online: boolean): string {
  if (!online) {
    return 'Offline mode: angle drawn from the bundled knowledge base (no live interest data).';
  }
  if (made === 0 && rel > 0.25) {
    return 'Fresh for this channel: strong source interest and no competing Short of yours yet.';
  }
  if (made >= 3) {
    return `You already published ${made} related Shorts — needs a clearly different angle to stay original.`;
  }
  if (rel < 0.15) {
    return 'Weak match for this niche — usable only if you reframe it around your audience.';
  }
  return `Trending source with ${item.searchInterest.toLocaleString()} interest signals; one earlier Short of yours touches it.`;
}

function hooksFor(headline: string, lang: Lang): string[] {
  const pack = PACKS[lang] ?? PACKS.en;
  const subject = headline.replace(/\s*[-–—:].*$/, '').slice(0, 60);
  const r = rng(`hook:${headline}`);
  const templates = [...pack.hooks.curiosity, ...pack.hooks.question, ...pack.hooks.howto];
  const chosen = sample(templates, 3, r);
  return chosen.map((t) =>
    t
      .replace(/\{subject\}/g, titleCaseSafe(subject))
      .replace(/\{topic\}/g, titleCaseSafe(subject))
      .replace(/\{claim\}/g, headline.slice(0, 90))
      .replace(/\{claim_lower\}/g, lowerFirst(headline.slice(0, 90)))
      .replace(/\{n\}/g, '3'),
  );
}

function titleCaseSafe(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

/** Pull from all enabled free sources; never throws. */
export async function fetchTrendItems(sources: string[], lang: string, geo = 'US'): Promise<TrendItem[]> {
  const out: TrendItem[] = [];
  const tasks: Promise<TrendItem[]>[] = [];
  if (sources.includes('wikipedia')) tasks.push(wikipediaTrending(lang === 'en' ? 'en' : 'en', 18));
  if (sources.includes('hn')) tasks.push(hnTrending(15));
  if (sources.includes('google_trends')) tasks.push(googleTrends(geo, 15));
  if (sources.includes('arxiv')) tasks.push(arxivRecent('cs.AI', 8));
  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === 'fulfilled') out.push(...r.value);
    else log.debug('trend source failed', String(r.reason));
  }
  return out;
}

/** Offline fallback: evergreen angles from the bundled corpus. */
function curatedItems(nicheSlug: string, limit: number): TrendItem[] {
  const facts = all<{ subject: string; fact: string; source_url: string }>(
    'SELECT subject, fact, source_url FROM knowledge WHERE niche = ? LIMIT ?',
    nicheSlug,
    limit,
  );
  return facts.map((f) => ({
    source: 'wikipedia' as const,
    keyword: f.subject.toLowerCase(),
    headline: f.subject,
    url: f.source_url || '',
    searchInterest: 0,
    related: [f.fact],
  }));
}

/**
 * Discover trend-derived topic opportunities for a niche.
 * Stores snapshots so the UI can show history and so freshness decays.
 */
export async function discoverTrends(nicheId: string, opts: { limit?: number; lang?: Lang; language?: string; geo?: string } = {}): Promise<{
  items: TrendView[];
  online: boolean;
  sources: string[];
}> {
  const limit = opts.limit ?? 20;
  const niche = get<NicheRow>('SELECT id, name, slug, prompt_config, language FROM niches WHERE id = ?', nicheId);
  if (!niche) throw new Error('Unknown niche');
  const lang = (opts.lang ?? opts.language ?? niche.language ?? 'en') as Lang;
  const keywords = nicheKeywords(niche);
  const enabled = getSetting<string[]>('trends.sources', ['wikipedia', 'hn', 'google_trends']);

  let items = await fetchTrendItems(enabled, lang, opts.geo ?? 'US');
  const online = items.length > 0;
  if (!online) items = curatedItems(niche.slug, limit + 10);

  // Relevance pre-filter, keep the most niche-relevant, allow some exploration.
  const scored = items.map((item) => ({ item, rel: relevanceOf(item, keywords) }));
  scored.sort((a, b) => b.rel - a.rel);
  const keep = scored.filter((s) => s.rel > 0.05).slice(0, limit);
  const explore = scored.filter((s) => s.rel <= 0.05).slice(0, Math.max(2, Math.floor(limit / 6)));
  const selected = [...keep, ...explore].slice(0, limit);

  const views: TrendView[] = [];
  for (const { item, rel } of selected) {
    const comp = competitionOf(item, nicheId);
    const view: TrendView = {
      id: id('trend'),
      topic: item.headline,
      keyword: item.keyword,
      source: item.source,
      url: item.url,
      searchInterest: item.searchInterest,
      relevance: Math.round(rel * 100) / 100,
      competition: comp.level,
      opportunity: opportunityText(item, rel, comp.made, online),
      suggestedHooks: hooksFor(item.headline, lang),
      relatedKeywords: item.related.map((r) => r.slice(0, 60)).filter(Boolean),
      capturedAt: now(),
      online,
    };
    views.push(view);
    run(
      `INSERT INTO trend_snapshots (id, niche_id, source, keyword, headline, url, search_interest, relevance,
        competition, opportunity, related, suggested_hooks, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      view.id,
      nicheId,
      view.source,
      view.keyword,
      view.topic,
      view.url,
      view.searchInterest,
      view.relevance,
      view.competition,
      view.opportunity,
      JSON.stringify(view.relatedKeywords),
      JSON.stringify(view.suggestedHooks),
      view.capturedAt,
    );
  }
  return { items: views, online, sources: enabled };
}

/** Recent stored snapshots for the dashboard. */
export function trendHistory(nicheId?: string, limit = 50): any[] {
  const rows = nicheId
    ? all('SELECT * FROM trend_snapshots WHERE niche_id = ? ORDER BY captured_at DESC LIMIT ?', nicheId, limit)
    : all('SELECT * FROM trend_snapshots ORDER BY captured_at DESC LIMIT ?', limit);
  return rows.map((r) => ({
    ...r,
    related: safeParse(r.related, []),
    suggested_hooks: safeParse(r.suggested_hooks, []),
  }));
}

function safeParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export { nicheKeywords, relevanceOf, tokenize, similarity, slugify };
