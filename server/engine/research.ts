/**
 * FREE, keyless research sources.
 *
 * Every function here talks to a public API that requires no API key:
 *   - Wikipedia REST + Action APIs (CC BY-SA content, attribution kept)
 *   - Wikimedia pageviews (public metrics)
 *   - Hacker News via Algolia (public, free)
 *   - Google Trends trending RSS (public)
 *   - arXiv Atom API (open access)
 *
 * All calls fail soft: when offline the callers fall back to the bundled
 * knowledge corpus so the product keeps working without any network access.
 */
import { fetchJson, tryFetchJson, fetchText } from '../lib/net.js';
import { log } from '../lib/logger.js';
import { get, run, all } from '../db/index.js';
import { id, now, slugify } from '../lib/util.js';

export type ResearchSource = {
  url: string;
  title: string;
  publisher: string;
  kind: 'wikipedia' | 'paper' | 'news' | 'doc' | 'web';
  snippet?: string;
  credibility?: number;
};

/** Store/refresh a source and return its id (sources are cited by scripts). */
export function saveSource(s: ResearchSource): string {
  const existing = get<{ id: string }>('SELECT id FROM sources WHERE url = ?', s.url);
  if (existing) {
    run('UPDATE sources SET retrieved_at = ? WHERE id = ?', now(), existing.id);
    return existing.id;
  };
  const sid = id('src');
  run(
    `INSERT INTO sources (id, url, title, publisher, kind, snippet, credibility, retrieved_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sid,
    s.url,
    s.title,
    s.publisher,
    s.kind,
    s.snippet ?? '',
    s.credibility ?? 0.7,
    now(),
    now(),
  );
  return sid;
}

/* ------------------------------------------------------------------ */
/* Wikipedia                                                            */
/* ------------------------------------------------------------------ */

const wikiHost = (lang: string) => `https://${lang || 'en'}.wikipedia.org`;

export type WikiPage = {
  title: string;
  description: string;
  extract: string;
  url: string;
  lang: string;
};

export async function wikiSummary(query: string, lang = 'en'): Promise<WikiPage | null> {
  const slug = encodeURIComponent(query.replace(/\s+/g, '_'));
  const data = await tryFetchJson<any>(`${wikiHost(lang)}/api/rest_v1/page/summary/${slug}`, { cacheSec: 86400 });
  if (!data || data.type === 'disambiguation' || !data.extract) return null;
  return {
    title: data.title ?? query,
    description: data.description ?? '',
    extract: data.extract as string,
    url: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${slug}`,
    lang,
  };
}

export async function wikiSearch(query: string, lang = 'en', limit = 8): Promise<string[]> {
  const url = `${wikiHost(lang)}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    query,
  )}&srlimit=${limit}&format=json&origin=*`;
  const data = await tryFetchJson<any>(url, { cacheSec: 86400 });
  return (data?.query?.search ?? []).map((r: any) => String(r.title));
}

export async function wikiRelated(titles: string[], lang = 'en', limit = 12): Promise<string[]> {
  if (!titles.length) return [];
  const url = `${wikiHost(lang)}/w/api.php?action=query&prop=links&titles=${encodeURIComponent(
    titles.join('|'),
  )}&pllimit=${limit}&format=json&origin=*`;
  const data = await tryFetchJson<any>(url, { cacheSec: 86400 });
  const pages = data?.query?.pages ?? {};
  const out: string[] = [];
  for (const p of Object.values<any>(pages)) {
    for (const l of p.links ?? []) {
      if (l.ns === 0 && typeof l.title === 'string') out.push(l.title);
    }
  }
  return out.slice(0, limit);
}

/** Daily pageviews for a Wikipedia article (last 30 days) as a free interest signal. */
export async function wikiPageviews(article: string, lang = 'en'): Promise<number> {
  const end = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  const start = new Date(Date.now() - 32 * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${lang}/wikipedia/all-access/user/${encodeURIComponent(
    article,
  )}/daily/${start}/${end}`;
  const data = await tryFetchJson<any>(url, { headers: { 'User-Agent': 'ShortForge/1.0' }, cacheSec: 21600 });
  const items = data?.items ?? [];
  return items.reduce((sum: number, it: any) => sum + (it.views ?? 0), 0);
}

/* ------------------------------------------------------------------ */
/* Sentence extraction (grounds scripts in real source text)            */
/* ------------------------------------------------------------------ */

const SKIP_RE = /\b(may refer to|disambiguation|see also|citation needed|listen)\b/i;

export function extractSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“(])/)
    .map((s) => s.trim())
    .filter((s) => {
      const w = s.split(/\s+/).length;
      if (w < 7 || w > 45) return false;
      if (SKIP_RE.test(s)) return false;
      if (/\[[0-9]+\]/.test(s)) return false;
      if (s.split('(').length > 3) return false;
      return true;
    });
}

/** Sentences most useful for narration: they carry a number or a named entity. */
export function strongestSentences(sentences: string[], max = 6): string[] {
  const scored = sentences.map((s) => {
    let score = 0;
    if (/\d/.test(s)) score += 3;
    if (/\b(in|by|since|before|after|around|about)\s+\d{4}\b/.test(s)) score += 2;
    if (/\b(million|billion|percent|kilometres|miles|years|seconds|times)\b/i.test(s)) score += 2;
    const w = s.split(/\s+/).length;
    if (w >= 10 && w <= 26) score += 1;
    if (/^(the|it|its|this|that|these|those)\b/i.test(s)) score += 1;
    return { s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((x) => x.s);
}

export type TopicResearch = {
  page: WikiPage | null;
  sentences: string[];
  related: string[];
  sourceIds: string[];
  online: boolean;
};

/** Fetch grounding material for a topic. Safe to call offline. */
export async function researchTopic(subject: string, lang = 'en', relatedTitles: string[] = []): Promise<TopicResearch> {
  const page = await wikiSummary(subject, lang);
  const sourceIds: string[] = [];
  if (page) {
    sourceIds.push(
      saveSource({
        url: page.url,
        title: page.title,
        publisher: 'Wikipedia',
        kind: 'wikipedia',
        snippet: page.extract.slice(0, 400),
        credibility: 0.75,
      }),
    );
  }
  let related: string[] = [];
  if (page) {
    related = await wikiRelated([page.title], lang);
    if (!relatedTitles.length) relatedTitles = related.slice(0, 3);
  }
  for (const t of relatedTitles.slice(0, 3)) {
    const p = await wikiSummary(t, lang);
    if (p) {
      sourceIds.push(
        saveSource({ url: p.url, title: p.title, publisher: 'Wikipedia', kind: 'wikipedia', snippet: p.extract.slice(0, 300), credibility: 0.75 }),
      );
    }
  }
  const extracts = [page?.extract ?? ''].filter(Boolean);
  const sentences = strongestSentences(extractSentences(extracts.join(' ')), 8);
  return { page, sentences, related, sourceIds, online: Boolean(page) };
}

/* ------------------------------------------------------------------ */
/* Trend sources                                                        */
/* ------------------------------------------------------------------ */

export type TrendItem = {
  source: 'wikipedia' | 'hn' | 'google_trends' | 'arxiv';
  keyword: string;
  headline: string;
  url: string;
  searchInterest: number;
  related: string[];
};

/** Hacker News front-page stories (free Algolia API, no key). */
export async function hnTrending(limit = 15): Promise<TrendItem[]> {
  const data = await tryFetchJson<any>('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30', {
    cacheSec: 1800,
  });
  const hits = data?.hits ?? [];
  return hits.slice(0, limit).map((h: any) => ({
    source: 'hn' as const,
    keyword: String(h.title ?? '').toLowerCase(),
    headline: String(h.title ?? ''),
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    searchInterest: Number(h.points ?? 0) + Number(h.num_comments ?? 0),
    related: [],
  }));
}

/** Google Trends trending-now RSS (public, no key). */
export async function googleTrends(geo = 'US', limit = 15): Promise<TrendItem[]> {
  try {
    const xml = await fetchText(`https://trends.google.com/trending/rss?geo=${geo}`, { cacheSec: 1800, timeoutMs: 10000 });
    const items: TrendItem[] = [];
    const matches = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    for (const block of matches.slice(0, limit)) {
      const title = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(block)?.[1]?.trim();
      const link = /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/.exec(block)?.[1]?.trim();
      const traffic = /<ht:approx_traffic>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/ht:approx_traffic>/.exec(block)?.[1];
      const news = /<ht:news_item_title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/ht:news_item_title>/.exec(block)?.[1];
      if (!title) continue;
      items.push({
        source: 'google_trends',
        keyword: title.toLowerCase(),
        headline: news ? `${title} — ${news}` : title,
        url: link ?? 'https://trends.google.com/trending',
        searchInterest: parseTraffic(traffic ?? ''),
        related: [],
      });
    }
    return items;
  } catch (err) {
    log.debug('google trends unavailable', String(err));
    return [];
  }
}

function parseTraffic(s: string): number {
  const cleaned = s.replace(/[+,]/g, '').trim();
  const n = Number(cleaned);
  if (Number.isFinite(n)) return n;
  const mult: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };
  const m = /^([\d.]+)([KMB])$/i.exec(cleaned);
  if (m) return Math.round(Number(m[1]) * mult[m[2]!.toUpperCase()]);
  return 0;
}

/** arXiv recent preprints in an AI/CS category (open access). */
export async function arxivRecent(category = 'cs.AI', limit = 10): Promise<TrendItem[]> {
  const url = `https://export.arxiv.org/api/query?search_query=cat:${category}&sortBy=submittedDate&sortOrder=descending&max_results=${limit}`;
  try {
    const xml = await fetchText(url, { cacheSec: 7200, timeoutMs: 15000 });
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
    return entries.map((block) => {
      const title = /<title>([\s\S]*?)<\/title>/.exec(block)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
      const link = /<id>([\s\S]*?)<\/id>/.exec(block)?.[1]?.trim() ?? '';
      const summary = /<summary>([\s\S]*?)<\/summary>/.exec(block)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
      return {
        source: 'arxiv' as const,
        keyword: title.toLowerCase(),
        headline: title,
        url: link,
        searchInterest: 50,
        related: summary ? [summary.slice(0, 160)] : [],
      };
    });
  } catch (err) {
    log.debug('arxiv unavailable', String(err));
    return [];
  }
}

/** Wikipedia "most viewed today" pages — a free proxy for what people search. */
export async function wikipediaTrending(lang = 'en', limit = 15): Promise<TrendItem[]> {
  const y = new Date(Date.now() - 2 * 86400000);
  const ymd = `${y.getUTCFullYear()}/${String(y.getUTCMonth() + 1).padStart(2, '0')}/${String(y.getUTCDate()).padStart(2, '0')}`;
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${lang}/wikipedia/all-access/${ymd}`;
  const data = await tryFetchJson<any>(url, { headers: { 'User-Agent': 'ShortForge/1.0' }, cacheSec: 21600 });
  const articles = data?.items?.[0]?.articles ?? [];
  return articles
    .filter((a: any) => a.article && !a.article.startsWith('Special:'))
    .slice(0, limit + 10)
    .map((a: any) => ({
      source: 'wikipedia' as const,
      keyword: String(a.article).replace(/_/g, ' ').toLowerCase(),
      headline: String(a.article).replace(/_/g, ' '),
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(a.article)}`,
      searchInterest: Number(a.views ?? 0),
      related: [],
    }))
    .slice(0, limit);
}

export { slugify };
