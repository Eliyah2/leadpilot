/**
 * Topic generator.
 *
 * Produces large, de-duplicated lists of Shorts topics per niche. Every topic
 * carries an angle pair, audience, hook suggestion, working title, complexity
 * and category. Repetition is prevented by:
 *   1. slug uniqueness inside the niche,
 *   2. trigram similarity against every existing topic,
 *   3. similarity against recently published video titles/scripts,
 *   4. use-count spreading (facts used before are deprioritised).
 */
import { all, get, run } from '../db/index.js';
import { id, now, slugify, similarity, rng, pick, sample, capitalize, agreeVerbs } from '../lib/util.js';
import { PACKS, type Lang } from './language.js';
import { getSetting } from './settings.js';
import { llmAvailable, LlmUnavailableError, llmJson } from './llm.js';
import { getInsightWeights } from '../services/learning.js';
import { log } from '../lib/logger.js';

export type TopicView = {
  id: string;
  title: string;
  slug: string;
  mainAngle: string;
  altAngle: string;
  audience: string;
  suggestedHook: string;
  suggestedTitle: string;
  complexity: 'low' | 'medium' | 'high';
  category: string;
  status: string;
  origin: string;
  useCount: number;
  score: number;
};

type FactRow = { id: string; subject: string; fact: string; detail: string; source_url: string };

const CATEGORIES = ['how-it-works', 'origin-story', 'scale-comparison', 'myth-busting', 'surprise-data', 'timeline', 'behaviour'];

function classifyCategory(fact: string, subject: string): string {
  const s = `${fact} ${subject}`.toLowerCase();
  if (/\b(myth|misconception|not true|actually)\b/.test(s)) return 'myth-busting';
  if (/\b(was|were|in \d{3,4}|century|first|founded|origin|created|invented)\b/.test(s)) return 'origin-story';
  if (/\b(bigger|smaller|faster|compared|versus|vs\.?|unlike|while)\b/.test(s)) return 'scale-comparison';
  if (/\d/.test(s)) return 'surprise-data';
  if (/\b(why|how|works|because|causes|means)\b/.test(s)) return 'how-it-works';
  if (/\b(feel|think|remember|habit|brain|people)\b/.test(s)) return 'behaviour';
  return pick(CATEGORIES, rng(fact));
}

function estimateComplexity(fact: string, detail: string): 'low' | 'medium' | 'high' {
  const text = `${fact} ${detail}`.toLowerCase();
  const words = text.split(/\s+/).length;
  const technical = (text.match(/\b(quantum|entropy|algorithm|neural|hormone|tectonic|constitutional|antibody|orbital|resonance|algorithm)\b/g) ?? []).length;
  if (words > 45 || technical >= 2) return 'high';
  if (words > 26 || technical === 1) return 'medium';
  return 'low';
}

const TITLE_PATTERNS: Record<string, string[]> = {
  'how-it-works': ['How {s} actually works', '{s}, explained in 40 seconds', 'What really happens with {s}'],
  'origin-story': ['The real origin of {s}', 'How {s} began', 'The story behind {s}'],
  'scale-comparison': ['{s} vs what you expected', 'The surprising size of {s}', '{s} compared to reality'],
  'myth-busting': ['What you got wrong about {s}', 'The myth about {s}', '{s}: myth vs fact'],
  'surprise-data': ['The numbers behind {s}', 'This number explains {s}', '{s} in one stat'],
  timeline: ['{s}: the timeline', 'How {s} changed over time', 'The dates that define {s}'],
  behaviour: ['Why we do this with {s}', 'Your brain on {s}', 'The psychology of {s}'],
};

const EMBED_ARTICLES = /^(the|a|an|le|la|les|un|une|der|die|das|ein|eine|het|een|de)\s/i;

function titleFor(subject: string, category: string, r: () => number): string {
  const patterns = TITLE_PATTERNS[category] ?? TITLE_PATTERNS['how-it-works']!;
  const pattern = pick(patterns, r);
  const s = subject.replace(/\s+/g, ' ').trim();
  return agreeVerbs(pattern, s).replace('{s}', (_m, offset: number) => {
    if (offset === 0) return s.charAt(0).toUpperCase() + s.slice(1);
    // "The real origin of The first chess victory…" — article lower mid-title.
    if (EMBED_ARTICLES.test(s)) return s.charAt(0).toLowerCase() + s.slice(1);
    return s;
  });
}

const ANGLE_B = [
  'Flip it: explain the counter-intuitive consequence instead of the definition.',
  'Tell it as a before-and-after story with one turning point.',
  'Compare it against the thing people usually confuse it with.',
  'Shrink it: focus on one small detail nobody notices.',
  'Widen it: what does this mean for everyday life?',
  'Myth angle: what most people believe first, then the correction.',
];

function mainAngleFromFact(fact: string): string {
  const trimmed = fact.replace(/\.$/, '').trim();
  const sentence = trimmed.length > 120 ? trimmed.slice(0, 117).trim() + '…' : trimmed;
  return `Anchor the Short on this verified claim: ${lowerFirst(sentence)}.`;
}

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

type GenerateOpts = {
  nicheId: string;
  count: number;
  language?: Lang;
  includeTrends?: boolean;
  origin?: 'generated' | 'trend' | 'recycle' | 'manual';
  force?: boolean;
};

/** Build topic rows; returns everything created this call. */
export async function generateTopics(opts: GenerateOpts): Promise<TopicView[]> {
  const niche = get<{ id: string; name: string; slug: string; audience: string; language: string; prompt_config: string }>(
    'SELECT id, name, slug, audience, language, prompt_config FROM niches WHERE id = ?',
    opts.nicheId,
  );
  if (!niche) throw new Error('Unknown niche');
  const lang = (opts.language ?? niche.language ?? 'en') as Lang;
  const pack = PACKS[lang] ?? PACKS.en;
  const threshold = getSetting<number>('generation.min_gap_similarity', 0.62);

  const existingTopics = all<{ title: string; slug: string; alt_angle: string }>(
    'SELECT title, slug, alt_angle FROM topics WHERE niche_id = ?',
    niche.id,
  );
  const recentVideos = all<{ title: string }>(
    "SELECT title FROM videos WHERE niche_id = ? AND title <> '' ORDER BY created_at DESC LIMIT 60",
    niche.id,
  );
  const existingSlugs = new Set(existingTopics.map((t) => t.slug ?? slugify(t.title)));

  // Candidate pools -------------------------------------------------------
  const facts = all<FactRow>(
    `SELECT id, subject, fact, detail, source_url FROM knowledge WHERE niche = ? ORDER BY use_count ASC, RANDOM()`,
    niche.slug,
  );
  const trendTitles = opts.includeTrends === false
    ? []
    : all<{ headline: string }>(
        `SELECT DISTINCT headline FROM trend_snapshots WHERE niche_id = ? AND captured_at > ? ORDER BY captured_at DESC LIMIT 30`,
        niche.id,
        now() - 7 * 86400000,
      ).map((r) => r.headline);

  const llmIdeas = await tryLlmTopics(niche.name, lang, opts.count, facts.length);

  const weights = getInsightWeights(niche.id);
  const created: TopicView[] = [];
  const seenTexts = [...existingTopics.map((t) => t.title), ...recentVideos.map((v) => v.title)];

  const factBudget = Math.max(opts.count, Math.ceil(opts.count * 0.7));
  const factPool = facts.slice(0, Math.min(facts.length, factBudget * 3));

  let index = 0;
  // Each fact gets several attempts: the first draw picks one title template,
  // later passes draw another, so a niche whose best titles are already used
  // can still reach the requested count instead of stalling half-way.
  const factPasses = factPool.length ? 3 : 0;
  const factSlots = factPool.length * factPasses;
  while (created.length < opts.count && index < factSlots + llmIdeas.length + trendTitles.length) {
    let candidate: { title: string; main: string; alt: string; category: string; fact?: FactRow; origin?: string } | null = null;

    if (index < factSlots) {
      const pass = Math.floor(index / factPool.length);
      const f = factPool[index % factPool.length]!;
      const r = rng(`${niche.id}:${f.id}:${created.length}:${pass}`);
      const category = classifyCategory(f.fact, f.subject);
      const subject = f.subject.replace(/\s+/g, ' ').trim();
      candidate = {
        title: titleFor(subject, category, r),
        main: mainAngleFromFact(f.fact),
        alt: pick(ANGLE_B, r),
        category,
        fact: f,
      };
    } else if (index - factSlots < llmIdeas.length) {
      const idea = llmIdeas[index - factSlots]!;
      candidate = {
        title: String(idea.title ?? '').slice(0, 110),
        main: String(idea.angle ?? '').slice(0, 240),
        alt: String(idea.altAngle ?? pick(ANGLE_B, rng(idea.title))).slice(0, 240),
        category: CATEGORIES.includes(String(idea.category)) ? String(idea.category) : 'how-it-works',
        origin: 'generated',
      };
    } else {
      const t = trendTitles[index - factSlots - llmIdeas.length]!;
      const r = rng(`trend:${t}`);
      candidate = {
        title: `${titleCase(t.slice(0, 70))}: what it means`,
        main: `Ride the current interest in "${t.slice(0, 60)}" with an original, sourced take for your audience.`,
        alt: pick(ANGLE_B, r),
        category: 'surprise-data',
        origin: 'trend',
      };
    }
    index++;
    if (!candidate || candidate.title.length < 6) continue;

    const slug = slugify(candidate.title);
    if (!slug || existingSlugs.has(slug)) continue;
    if (seenTexts.some((t) => similarity(t, candidate!.title) > threshold)) continue;
    existingSlugs.add(slug);
    seenTexts.push(candidate.title);

    const category = candidate.category;
    // Learning engine: nudge selection probability without ever excluding a category.
    const weight = weights.category[category] ?? 1;
    const score = Math.round((0.5 + weight * 0.25 + Math.random() * 0.25) * 100) / 100;

    const topicId = id('top');
    const hook = pick(pack.hooks.curiosity, rng(`${topicId}:hook`))
      .replace(/\{subject\}/g, (candidate.fact?.subject ?? candidate.title.slice(0, 40)).replace(/\b\w/g, (c) => c.toUpperCase()))
      .replace(/\{topic\}/g, candidate.title)
      .replace(/\{claim\}/g, (candidate.fact?.fact ?? candidate.main).slice(0, 90))
      .replace(/\{claim_lower\}/g, lowerFirst((candidate.fact?.fact ?? candidate.main).slice(0, 90)))
      .replace(/\{n\}/g, '3');

    run(
      `INSERT INTO topics (id, niche_id, title, slug, main_angle, alt_angle, audience, category, complexity,
        language, status, origin, source_ids, score, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, ?)`,
      topicId,
      niche.id,
      candidate.title,
      slug,
      candidate.main,
      candidate.alt,
      niche.audience,
      category,
      candidate.fact ? estimateComplexity(candidate.fact.fact, candidate.fact.detail) : 'medium',
      lang,
      opts.origin ?? candidate.origin ?? 'generated',
      JSON.stringify(candidate.fact ? [candidate.fact.id] : []),
      score,
      now(),
    );
    if (candidate.fact) run('UPDATE knowledge SET use_count = use_count + 1 WHERE id = ?', candidate.fact.id);

    created.push({
      id: topicId,
      title: candidate.title,
      slug,
      mainAngle: candidate.main,
      altAngle: candidate.alt,
      audience: niche.audience,
      suggestedHook: hook,
      suggestedTitle: pick(pack.titles.curiosity, rng(`${topicId}:title`)).replace(/\{topic\}/g, candidate.title),
      complexity: candidate.fact ? estimateComplexity(candidate.fact.fact, candidate.fact.detail) : 'medium',
      category,
      status: 'available',
      origin: opts.origin ?? candidate.origin ?? 'generated',
      useCount: 0,
      score,
    });
  }
  return created;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function tryLlmTopics(
  nicheName: string,
  lang: Lang,
  count: number,
  factCount: number,
): Promise<{ title: string; angle: string; altAngle: string; category: string }[]> {
  if (!llmAvailable()) return [];
  if (factCount > 0 && factCount >= count) return []; // corpus already covers demand
  try {
    const ideas = await llmJson<{ topics: any[] }>(
      'You generate ORIGINAL YouTube Shorts topic ideas. Output JSON only: {"topics":[{"title","angle","altAngle","category"}]} where category is one of how-it-works, origin-story, scale-comparison, myth-busting, surprise-data, timeline, behaviour. Never invent statistics; phrase angles so they can be supported by a source.',
      `Niche: ${nicheName}. Language: ${lang}. Generate ${count} distinct, non-repetitive Shorts topics that are NOT already covered by these existing ones: ${(
        all<{ title: string }>('SELECT title FROM topics ORDER BY created_at DESC LIMIT 25').map((t) => t.title).join(' | ') || 'none'
      ).slice(0, 1200)}`,
    );
    return (ideas.topics ?? []).slice(0, count * 2);
  } catch (err) {
    if (!(err instanceof LlmUnavailableError)) log.debug('LLM topic generation failed', String(err));
    return [];
  }
}

/** Weighted pick of a fresh topic for the pipeline (exploration floor keeps every category alive). */
export function pickTopic(nicheId: string, lang: Lang, excludeTitles: string[] = []): TopicRow | null {
  const rows = all<TopicRow>(
    `SELECT * FROM topics WHERE niche_id = ? AND status = 'available' ORDER BY created_at DESC LIMIT 400`,
    nicheId,
  );
  if (!rows.length) return null;
  const weights = getInsightWeights(nicheId);
  const threshold = getSetting<number>('generation.min_gap_similarity', 0.62);

  const eligible = rows.filter((t) => !excludeTitles.some((title) => similarity(title, t.title) > threshold));
  const pool = eligible.length ? eligible : rows;
  const scored = pool.map((t) => {
    const categoryWeight = weights.category[t.category] ?? 1;
    const freshness = 1 / (1 + (t.use_count ?? 0) * 0.6);
    const jitter = 0.75 + rng(`${t.id}:pick`)() * 0.5;
    return { t, w: Math.max(0.05, categoryWeight * freshness * jitter) };
  });
  const total = scored.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (const item of scored) {
    r -= item.w;
    if (r <= 0) return item.t;
  }
  return scored[scored.length - 1]!.t;
}

export type TopicRow = {
  id: string;
  niche_id: string;
  title: string;
  slug: string;
  main_angle: string;
  alt_angle: string;
  audience: string;
  category: string;
  complexity: string;
  language: string;
  status: string;
  origin: string;
  source_ids: string;
  use_count: number;
  score: number;
};

export function markTopicUsed(topicId: string): void {
  run("UPDATE topics SET status = 'used', use_count = use_count + 1 WHERE id = ?", topicId);
}

export function listTopics(nicheId?: string, status?: string, limit = 200): TopicView[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (nicheId) {
    where.push('niche_id = ?');
    params.push(nicheId);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  const sql = `SELECT * FROM topics ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
  const rows = all<any>(sql, ...params, limit);
  return rows.map(rowToView);
}

function rowToView(r: any): TopicView {
  return {
    id: r.id,
    title: r.title,
    slug: r.slug,
    mainAngle: r.main_angle,
    altAngle: r.alt_angle,
    audience: r.audience,
    suggestedHook: '',
    suggestedTitle: r.title,
    complexity: r.complexity,
    category: r.category,
    status: r.status,
    origin: r.origin,
    useCount: r.use_count,
    score: r.score,
  };
}

export { capitalize };
