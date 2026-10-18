/**
 * Content pipeline: topic → hooks → script → research → fact check →
 * metadata → scenes → persisted video package.
 *
 * One call produces a complete, reviewable Short. Rendering is a separate,
 * retryable job so a failed encode never loses generated content.
 */
import { all, get, run, insert, tx } from '../db/index.js';
import { id, now, slugify, rng, pick, words, clamp, similarity, subjectFromTitle, topicPhrase } from '../lib/util.js';
import { generateTopics, pickTopic, markTopicUsed, type TopicRow } from './topics.js';
import { generateHooks, pickHook, type HookView } from './hooks.js';
import { buildScript, pickFormat, type ScriptResult, type FactRow } from './scripts.js';
import { factCheck, type QcResult } from './factcheck.js';
import { buildMetadata, type MetadataResult } from './metadata.js';
import { researchTopic, saveSource } from './research.js';
import { getSetting } from './settings.js';
import { translate, llmAvailable } from './llm.js';
import { log } from '../lib/logger.js';
import { enqueue } from '../jobs/queue.js';
import type { Lang, ScriptFormat } from './language.js';

export type CreateVideoInput = {
  userId: string;
  nicheId: string;
  channelId?: string | null;
  language?: Lang;
  targetSec?: number;
  format?: ScriptFormat | 'auto';
  tone?: string;
  batchId?: string | null;
  topicId?: string;
  hookText?: string;
  origin?: 'factory' | 'recycle' | 'manual';
  parentVideoId?: string | null;
  experimentId?: string | null;
  variantId?: string | null;
  research?: boolean;
  autoRender?: boolean;
  visibility?: string;
};

export type CreateVideoResult = {
  videoId: string;
  topicId: string;
  title: string;
  qcStatus: string;
  qcScore: number;
  status: string;
  hook: string;
  format: ScriptFormat;
  wordCount: number;
  estDurationSec: number;
  sceneCount: number;
  notes: string[];
  needsReviewReasons: string[];
};

function parseJsonArray<T>(raw: string | null | undefined, fallback: T[] = []): T[] {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function relatedSubject(candidateSubject: string, subjectKey: string, title: string): boolean {
  const s = candidateSubject.trim().toLowerCase();
  const key = subjectKey.trim().toLowerCase();
  const t = title.trim().toLowerCase();
  if (s.length < 4 || !key) return false;
  return s === key || key.includes(s) || s.includes(key) || t.includes(s);
}

/**
 * Facts for a topic: its own corpus entries first, then — only if they are
 * about the SAME subject — extra niche facts. One Short is about one thing;
 * mixing in unrelated niche facts is what made videos read as fact salads.
 */
export function factsForTopic(topic: TopicRow, limit = 4): FactRow[] {
  const ids = parseJsonArray<string>(topic.source_ids);
  const own = ids.length
    ? all<FactRow>(
        `SELECT id, subject, fact, detail, source_url, source_name FROM knowledge WHERE id IN (${ids.map(() => '?').join(',')})`,
        ...ids,
      )
    : [];
  const out: FactRow[] = [];
  const seenFacts = new Set<string>();
  const push = (f: FactRow) => {
    const key = f.fact.trim().toLowerCase();
    if (!key || seenFacts.has(key)) return;
    seenFacts.add(key);
    out.push(f);
  };
  own.forEach(push);
  if (out.length >= limit) return out.slice(0, limit);

  const nicheSlug = get<{ slug: string }>('SELECT slug FROM niches WHERE id = ?', topic.niche_id)?.slug ?? 'facts';
  const subjectKey = own[0]?.subject ?? subjectFromTitle(topic.title);
  const fill = all<FactRow>(
    `SELECT id, subject, fact, detail, source_url, source_name FROM knowledge
      WHERE niche = ? AND id NOT IN (${ids.map(() => '?').join(',') || "''"})
      ORDER BY use_count ASC, RANDOM() LIMIT 30`,
    nicheSlug,
    ...ids,
  );
  for (const f of fill) {
    if (out.length >= limit) break;
    if (relatedSubject(f.subject, subjectKey, topic.title)) push(f);
  }
  return out.slice(0, limit);
}

/** Build the whole package for one Short. */
export async function createVideo(input: CreateVideoInput): Promise<CreateVideoResult> {
  const niche = get<{ id: string; name: string; slug: string; language: string; audience: string; style: string; prompt_config: string }>(
    'SELECT id, name, slug, language, audience, style, prompt_config FROM niches WHERE id = ?',
    input.nicheId,
  );
  if (!niche) throw new Error('Unknown niche');
  const lang = (input.language ?? niche.language ?? 'en') as Lang;
  const targetSec = clamp(input.targetSec ?? getSetting<number>('generation.duration_target_sec', 40), 15, 90);
  const videoId = id('vid');
  const autoRender = input.autoRender ?? getSetting<boolean>('generation.auto_render', true);

  /* 1 — topic ---------------------------------------------------------- */
  let topic: TopicRow | null = input.topicId
    ? get<TopicRow>('SELECT * FROM topics WHERE id = ?', input.topicId) ?? null
    : null;
  if (!topic) {
    const recent = all<{ title: string }>('SELECT title FROM videos WHERE niche_id = ? ORDER BY created_at DESC LIMIT 40', niche.id).map((v) => v.title);
    topic = pickTopic(niche.id, lang, recent);
    if (!topic) {
      await generateTopics({ nicheId: niche.id, count: 8, language: lang });
      topic = pickTopic(niche.id, lang, recent);
    }
  }
  if (!topic) throw new Error('Could not create a topic for this niche');

  const seed = `${videoId}:${topic.id}`;
  const r = rng(seed);

  /* 2 — source research ------------------------------------------------- */
  const wantResearch = input.research !== false;
  const facts = factsForTopic(topic);
  let researchSentences: string[] = [];
  let researchSourceIds: string[] = [];
  if (wantResearch) {
    try {
      const res = await researchTopic(topic.title, lang === 'en' ? 'en' : 'en');
      researchSentences = res.sentences.slice(0, 3);
      researchSourceIds = res.sourceIds;
    } catch (err) {
      log.debug('research skipped (offline?)', String(err));
    }
  }

  /* 3 — hooks ----------------------------------------------------------- */
  const subject = topicPhrase(facts[0]?.subject, topic.title);
  const hooks = generateHooks({
    topicId: topic.id,
    videoId,
    topicTitle: topic.title,
    subject,
    fact: facts[0]?.fact,
    detail: facts[0]?.detail,
    count: getSetting<number>('generation.hooks_per_topic', 7),
    lang,
  });
  if (!hooks.length) throw new Error('Hook generation produced no candidates');
  const hook: HookView = input.hookText
    ? hooks.find((h) => h.text === input.hookText) ?? pickHook(hooks)
    : pickHook(hooks);

  /* 4 — script ---------------------------------------------------------- */
  const format = !input.format || input.format === 'auto' ? pickFormat(niche.slug, lang, seed) : input.format;
  let script = buildScript({
    topicId: topic.id,
    topicTitle: topic.title,
    subject,
    format,
    hook,
    facts,
    researchSentences,
    sourceUrls: [...facts.map((f) => f.source_url), ...researchSourceIds.map((s) => get<{ url: string }>('SELECT url FROM sources WHERE id = ?', s)?.url ?? '')],
    lang,
    targetSec,
    seed,
    tone: input.tone,
  });

  // Non-English without a local LLM: translate naturalness is not guaranteed.
  if (lang !== 'en' && llmAvailable()) {
    const translated = await translateFactSentences(script, lang);
    if (translated) script = translated;
  }

  /* 5 — fact check ------------------------------------------------------ */
  const nicheCfg = (() => {
    try {
      return JSON.parse(niche.prompt_config || '{}');
    } catch {
      return {};
    }
  })();
  const sourceIds = [...new Set([...researchSourceIds, ...facts.map((f) => saveSource({
    url: f.source_url || `curated://knowledge/${f.id}`,
    title: f.subject,
    publisher: f.source_name || 'ShortForge knowledge base',
    kind: f.source_url ? 'wikipedia' : 'doc',
    snippet: [f.fact, f.detail].filter(Boolean).join(' ').slice(0, 400),
    credibility: 0.8,
  }))])];

  const meta = buildMetadata({
    topicTitle: topic.title,
    subject,
    script,
    lang,
    nicheId: niche.id,
    nicheSlug: niche.slug,
    sources: sourceIds
      .map((sid) => get<{ url: string; title: string }>('SELECT url, title FROM sources WHERE id = ?', sid))
      .filter((s): s is { url: string; title: string } => Boolean(s?.url)),
    seed,
  });

  const qc: QcResult = factCheck({
    script,
    facts,
    sourceIds,
    researchSentences,
    language: lang,
    title: meta.chosenTitle,
    hookText: hook.text,
    videoId,
    nicheBanned: Array.isArray(nicheCfg.banned_phrases) ? nicheCfg.banned_phrases.map(String) : [],
  });

  const status = qc.status === 'failed' ? 'review' : qc.status === 'needs_review' ? 'review' : 'draft';
  const reviewNotes = qc.notes.slice(0, 12);

  /* 6 — persist ---------------------------------------------------------- */
  const nowTs = now();
  tx(() => {
    run(
      `INSERT INTO videos (id, user_id, channel_id, niche_id, topic_id, batch_id, parent_video_id, experiment_id,
         variant_id, title, description, hashtags, keywords, tags, language, tone, style, format,
         duration_target_sec, hook_id, hook_text, status, qc_status, render_status, cover_path, visibility,
         origin, seed, review_notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?, ?, ?, ?)`,
      videoId,
      input.userId,
      input.channelId ?? null,
      niche.id,
      topic.id,
      input.batchId ?? null,
      input.parentVideoId ?? null,
      input.experimentId ?? null,
      input.variantId ?? null,
      meta.chosenTitle,
      meta.description,
      JSON.stringify(meta.hashtags),
      JSON.stringify(meta.keywords),
      JSON.stringify(meta.tags),
      lang,
      input.tone ?? getSetting<string>('generation.tone', 'engaging'),
      getSetting<string>('generation.style', 'Fast-paced educational') || niche.style,
      script.format,
      targetSec,
      hook.id,
      hook.text,
      status,
      qc.status,
      input.visibility ?? getSetting<string>('youtube.privacy', 'private'),
      input.origin ?? 'factory',
      seed,
      JSON.stringify(reviewNotes),
      nowTs,
      nowTs,
    );

    // scenes
    let cursor = 0;
    script.scenes.forEach((scene, idx) => {
      run(
        `INSERT INTO scenes (id, video_id, idx, kind, text_on_screen, voiceover, visual, transition, duration_sec,
           start_sec, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id('scn'),
        videoId,
        idx,
        scene.kind,
        scene.textOnScreen,
        scene.voiceover,
        JSON.stringify(scene.visual),
        scene.transition,
        scene.durationSec,
        cursor,
        nowTs,
      );
      cursor += scene.durationSec;
    });

    // script row
    run(
      `INSERT INTO scripts (id, video_id, topic_id, format, language, hook_text, voiceover_text, word_count,
         est_duration_sec, version, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      id('scr'),
      videoId,
      topic.id,
      script.format,
      lang,
      hook.text,
      script.voiceoverText,
      script.wordCount,
      script.estDurationSec,
      qc.status === 'passed' ? 'approved' : 'draft',
      nowTs,
    );

    // source links
    for (const sid of sourceIds) {
      run('INSERT OR IGNORE INTO video_sources (video_id, source_id, note) VALUES (?, ?, ?)', videoId, sid, 'used during generation');
    }

    // voiceover placeholder row
    run(
      `INSERT INTO voiceovers (id, video_id, provider, voice, rate, pitch, text, status, created_at)
       VALUES (?, ?, 'auto', '', 1, 1, ?, 'pending', ?)`,
      id('vob'),
      videoId,
      script.voiceoverText,
      nowTs,
    );
  });

  markTopicUsed(topic.id);

  /* 7 — optional auto-render -------------------------------------------- */
  if (autoRender && getSetting<boolean>('generation.auto_tts', true)) {
    enqueue('video_render', { videoId, userId: input.userId }, { videoId, userId: input.userId, priority: 60 });
  }

  return {
    videoId,
    topicId: topic.id,
    title: meta.chosenTitle,
    qcStatus: qc.status,
    qcScore: qc.score,
    status,
    hook: hook.text,
    format: script.format,
    wordCount: script.wordCount,
    estDurationSec: script.estDurationSec,
    sceneCount: script.scenes.length,
    notes: reviewNotes,
    needsReviewReasons: qc.checks.filter((c) => c.status !== 'pass').map((c) => `${c.label}: ${c.detail}`),
  };
}

/** Translate narration scenes when a free/local LLM is configured. */
async function translateFactSentences(script: ScriptResult, lang: Lang): Promise<ScriptResult | null> {
  try {
    const scenes = [...script.scenes];
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i]!;
      if (s.voiceover.length < 12) continue;
      const out = await translate(s.voiceover, lang, 'Shorts scene narration, keep it spoken and short');
      if (out) {
        scenes[i] = { ...s, voiceover: out };
      }
    }
    const voiceoverText = scenes.map((s) => s.voiceover).join(' ');
    if (voiceoverText === script.voiceoverText) return null;
    return { ...script, scenes, voiceoverText, wordCount: words(voiceoverText).length };
  } catch (err) {
    log.debug('translation failed', String(err));
    return null;
  }
}

/** Full request parser: "Generate 20 shorts about interesting AI facts". */
export type ParsedRequest = {
  count: number;
  nicheHint: string;
  topicHint: string;
  language: Lang;
  durationSec: number;
  raw: string;
};

export function parseContentRequest(raw: string, defaults: { language: Lang; durationSec: number }): ParsedRequest {
  const text = raw.trim();
  const countMatch = /(\d{1,3})\s*(shorts?|videos?|clips?)?/i.exec(text);
  const count = clamp(countMatch ? Number(countMatch[1]) : 1, 1, 100);
  const aboutMatch = /(?:about|on|covering|regarding|around|for)\s+(.+)$/i.exec(text);
  const topicHint = (aboutMatch?.[1] ?? text.replace(/generate|create|make|build/gi, '')).trim();
  const langCodes: Lang[] = ['en', 'nl', 'de', 'es', 'fr'];
  const lang = (langCodes.find((l) => new RegExp(`\\b${l}\\b`, 'i').exec(text)?.[0] && text.toLowerCase().includes(
    { en: 'english', nl: 'dutch', de: 'german', es: 'spanish', fr: 'french' }[l]!,
  )) ?? defaults.language) as Lang;
  const durMatch = /(\d{2,3})\s*(?:-|–|to)?\s*(\d{2,3})?\s*(?:s|sec|seconds)/i.exec(text);
  const durationSec = durMatch ? clamp(Number(durMatch[2] ?? durMatch[1]), 15, 90) : defaults.durationSec;
  return { count, nicheHint: topicHint, topicHint, language: lang, durationSec, raw: text };
}

/** Resolve which niche a free-form request should use. */
export function resolveNiche(hint: string, fallback?: string | null): string {
  const h = hint.toLowerCase();
  const niches = all<{ id: string; name: string; slug: string; prompt_config: string }>('SELECT id, name, slug, prompt_config FROM niches');
  let best: { id: string; score: number } | null = null;
  for (const n of niches) {
    let score = 0;
    if (h.includes(n.slug)) score += 5;
    if (h.includes(n.name.toLowerCase())) score += 5;
    try {
      const kw: string[] = JSON.parse(n.prompt_config || '{}').keywords ?? [];
      for (const k of kw) if (h.includes(String(k).toLowerCase())) score += 2;
    } catch {}
    if (score > 0 && (!best || score > best.score)) best = { id: n.id, score };
  }
  if (best) return best.id;
  if (fallback) return fallback;
  return get<{ id: string }>('SELECT id FROM niches ORDER BY is_builtin DESC LIMIT 1')!.id;
}
