/**
 * Titles, description, hashtags, keywords and cover concept.
 *
 * Rules:
 *   - four title angles (curiosity / educational / search / short), none
 *     deceptive — quality control rejects clickbait patterns;
 *   - description reads like a human wrote it, cites the actual sources used,
 *     and never stuffs keywords;
 *   - 3–5 specific hashtags only (plus #Shorts, which YouTube asks for);
 *   - the final title is chosen by weight from your channel's own title-style
 *     performance, with exploration.
 */
import { all, get } from '../db/index.js';
import { words, rng, pick, sample, capitalize, titleCase, similarity, hashStr, clamp, agreeVerbs } from '../lib/util.js';
import { PACKS, type Lang } from './language.js';
import { getInsightWeights } from '../services/learning.js';
import { titleProblems } from './factcheck.js';
import type { ScriptResult } from './scripts.js';

export type TitleOption = { style: 'curiosity' | 'educational' | 'search' | 'short'; text: string };

export type MetadataResult = {
  titles: TitleOption[];
  chosenTitle: string;
  chosenStyle: string;
  description: string;
  hashtags: string[];
  keywords: string[];
  tags: string[];
  coverHeadline: string;
  coverConcept: string;
};

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'to', 'for', 'with', 'that', 'this', 'is', 'are', 'was',
  'were', 'it', 'its', 'as', 'at', 'by', 'from', 'be', 'how', 'why', 'what', 'when', 'you', 'your', 'youre',
]);

function cleanTitle(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/[.,;:]$/, '').trim();
}

/** Articles that should not stay capitalised when a subject is embedded mid-title. */
const EMBED_ARTICLES = /^(the|a|an|le|la|les|un|une|der|die|das|ein|eine|het|een|de)\s/i;

function fromTemplate(template: string, topicTitle: string): string {
  const filled = cleanTitle(
    agreeVerbs(template, topicTitle).replace(/\{(?:topic|s)\}/g, (_m, offset: number) => {
      // Keep the capital only when the subject opens the title; otherwise
      // "How The first chess victory…" reads like two titles stacked.
      if (offset > 0 && EMBED_ARTICLES.test(topicTitle)) {
        return topicTitle.charAt(0).toLowerCase() + topicTitle.slice(1);
      }
      return topicTitle;
    }),
  );
  return filled ? filled.charAt(0).toUpperCase() + filled.slice(1) : filled;
}

/** Reject titles that stack two "explanation" lead-ins on top of each other. */
function isRedundant(title: string): boolean {
  const lower = ` ${title.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ')} `;
  const leadIns = ['origin of', 'story behind', 'truth about', 'facts about', 'reason behind', 'explained about'];
  for (const lead of leadIns) {
    if (lower.includes(` ${lead} `) && /\b(real|never told|nobody|behind|about)\b/.test(lower.replace(` ${lead} `, ' '))) {
      // two layers of the same framing
      const count = (lower.match(/\b(origin|story|truth|facts|explained)\b/g) ?? []).length;
      if (count >= 2) return true;
    }
  }
  return (lower.match(/\b(how|what|why)\b/g) ?? []).length >= 3;
}

/** Pull distinctive noun-ish terms from the topic/script for tag building. */
function keyTerms(topicTitle: string, script: ScriptResult, nicheKeywords: string[], limit = 12): string[] {
  const bag = new Set<string>();
  for (const w of words(topicTitle.toLowerCase())) if (w.length > 3 && !STOP.has(w)) bag.add(w);
  for (const kw of nicheKeywords) bag.add(kw.toLowerCase());
  const firstSentences = script.voiceoverText.split(/(?<=[.!?])\s+/).slice(0, 4).join(' ');
  for (const w of words(firstSentences.toLowerCase())) {
    if (w.length > 4 && !STOP.has(w) && !/^\d/.test(w)) bag.add(w);
  }
  return [...bag].slice(0, limit);
}

function nicheKeywordsOf(nicheId?: string): string[] {
  if (!nicheId) return [];
  const row = get<{ prompt_config: string }>('SELECT prompt_config FROM niches WHERE id = ?', nicheId);
  if (!row) return [];
  try {
    const cfg = JSON.parse(row.prompt_config || '{}');
    return Array.isArray(cfg.keywords) ? cfg.keywords.map(String) : [];
  } catch {
    return [];
  }
}

export type MetaOpts = {
  topicTitle: string;
  /** Concrete subject of the underlying fact — preferred for title wording. */
  subject?: string;
  script: ScriptResult;
  lang?: Lang;
  nicheId?: string;
  nicheSlug?: string;
  sources?: { url: string; title?: string }[];
  tone?: string;
  seed?: string;
};

const SMALL_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'from', 'by', 'vs', 'versus',
  'over', 'under', 'into', 'onto', 'per', 'via', 'is', 'are', 'was', 'were', 'be', 'been', 'as', 'that', 'than',
]);

/**
 * Embed a subject inside a title template so it reads like a human wrote it:
 * lower-case ordinary words, keep acronyms/names/proper-noun runs intact.
 */
export function smartCase(text: string): string {
  const wordsList = text.trim().split(/\s+/);
  if (!wordsList.length) return text;
  const isCap = (w: string) => /^[A-ZÀ-Þ]/.test(w.replace(/^[^A-Za-zÀ-ÿ]+/, ''));
  const isAllCapsOrDigit = (w: string) => /^[A-Z0-9][A-Z0-9\-\d.]*$/.test(w) && w.length > 1;
  const hasInternalCap = (w: string) => /[a-z][A-Z]/.test(w) || /^[A-Z]{2,}[a-z]/.test(w);
  const isSmall = (w: string) => SMALL_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, ''));

  // find runs of consecutive capitalised words (proper-noun phrases)
  const keep = wordsList.map(() => false);
  let runStart = -1;
  for (let i = 0; i <= wordsList.length; i++) {
    const w = wordsList[i];
    const capital = w !== undefined && isCap(w) && !isSmall(w);
    if (capital) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1 && i - runStart >= 2) for (let k = runStart; k < i; k++) keep[k] = true;
      runStart = -1;
    }
  }
  wordsList.forEach((w, i) => {
    if (isAllCapsOrDigit(w) || hasInternalCap(w)) keep[i] = true;
  });

  const out = wordsList.map((w, i) => {
    if (keep[i]) return w;
    if (i === 0) return w.charAt(0).toUpperCase() + w.slice(1);
    return isSmall(w) || isCap(w) ? w.toLowerCase() : w.toLowerCase();
  });
  return out.join(' ');
}

/** Strip generation angle suffixes/prefixes so titles do not stack on each other. */
export function stripAngles(topic: string): string {
  let t = topic.trim();
  const suffixes = [
    /,\s*explained.*$/i,
    /\s+explained in \d+.*$/i,
    /\s+in \d+\s*(s|sec|seconds)$/i,
    /\s+vs what you expected$/i,
    /,\s*reconsidered$/i,
    /\s+one level deeper$/i,
    /\s*[:—-]\s*myth vs fact$/i,
    /\s*[:—-]\s*the questions everyone asks$/i,
    /\s*[:—-]\s*the next thing to know$/i,
    /\s*—\s*part \d+$/i,
    /\s*\(follow-up\)$/i,
    /\s+actually works$/i,
  ];
  const prefixes = [
    /^the\s+(real\s+)?(origin|story|truth|facts?|reason|details?|questions?)\s+(of|behind)\s+/i,
    /^the\s+surprising\s+(size|story|truth|part)\s+of\s+/i,
    /^what\s+(you were never told about|is|makes)\s+/i,
    /^understanding\s+/i,
  ];
  for (const re of suffixes) t = t.replace(re, '');
  for (const re of prefixes) t = t.replace(re, '');
  return t.trim() || topic.trim();
}

export function buildMetadata(opts: MetaOpts): MetadataResult {
  const lang = opts.lang ?? 'en';
  const pack = PACKS[lang] ?? PACKS.en;
  const r = rng(`meta:${opts.seed ?? opts.topicTitle}`);
  const topic = cleanTitle(opts.topicTitle);
  // Titles read best from the concrete subject; fall back to a de-angled topic.
  const titleBase = smartCase(opts.subject ? cleanTitle(opts.subject) : stripAngles(topic));
  const kw = keyTerms(titleBase, opts.script, nicheKeywordsOf(opts.nicheId));
  const weights = getInsightWeights(opts.nicheId);

  // --- titles ---------------------------------------------------------
  const raw: TitleOption[] = [];
  for (const t of pack.titles.curiosity) raw.push({ style: 'curiosity', text: fromTemplate(t, titleBase) });
  for (const t of pack.titles.educational) raw.push({ style: 'educational', text: fromTemplate(t, titleBase) });
  for (const t of pack.titles.search) raw.push({ style: 'search', text: fromTemplate(t, titleBase) });
  for (const t of pack.titles.short) raw.push({ style: 'short', text: fromTemplate(t, titleBase) });

  // A fact-led option when the script contains a striking number
  const numberMatch = /\b(\d[\d,.]{0,9})\s*(%|percent|million|billion|trillion|km|years?|days?|seconds?|hours?|times)?\b/i.exec(
    opts.script.voiceoverText,
  );
  if (numberMatch) {
    raw.push({
      style: 'curiosity',
      text: cleanTitle(`${capitalize(numberMatch[0])} — the fact behind ${titleBase}`),
    });
  }

  const deduped: TitleOption[] = [];
  for (const t of raw) {
    const text = t.text.length > 100 ? t.text.slice(0, 97).trim() + '…' : t.text;
    if (text.length < 12) continue;
    if (isRedundant(text)) continue;
    if (deduped.some((d) => similarity(d.text, text) > 0.7)) continue;
    if (titleProblems(text).some((p) => p.includes('deceptive'))) continue;
    deduped.push({ style: t.style, text });
  }
  if (!deduped.length) deduped.push({ style: 'short', text: capitalize(titleBase) });

  // Choose with learning weights + exploration
  const scored = deduped.map((t) => ({ t, w: (weights.titleStyle[t.style] ?? 1) * (0.6 + r() * 0.8) }));
  const total = scored.reduce((s, x) => s + x.w, 0);
  let x = r() * total;
  let chosen = scored[0]!.t;
  for (const s of scored) {
    x -= s.w;
    if (x <= 0) {
      chosen = s.t;
      break;
    }
  }

  // --- description -----------------------------------------------------
  const lead = pick(pack.descriptionLead, r).replace(/\{topic\}/g, titleBase);
  const sentences = opts.script.voiceoverText.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const bodySource = sentences.find((s) => s !== opts.script.hook && words(s).length > 8) ?? sentences[0] ?? '';
  const body = bodySource.length > 40 ? bodySource : '';
  const payoff = sentences[sentences.length - 1] ?? '';

  const sourceLines = (opts.sources ?? [])
    .filter((s) => s.url)
    .slice(0, 4)
    .map((s) => `• ${s.title ? `${s.title} — ` : ''}${s.url}`);

  const hashtags = buildHashtags(topic, kw, lang, opts.nicheSlug);
  const descriptionParts = [
    lead,
    body && body !== lead ? body : '',
    payoff && payoff !== body ? `“${payoff}”` : '',
    sourceLines.length ? `\nSources\n${sourceLines.join('\n')}` : '',
    `\n${hashtags.join(' ')}`,
  ].filter(Boolean);
  const description = descriptionParts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

  // --- tags / keywords --------------------------------------------------
  const tags = buildTags(topic, kw, opts.script);
  const keywords = [...tags].slice(0, 15);

  // --- cover ------------------------------------------------------------
  const coverHeadline = shortHeadline(chosen.text, opts.script.hook);
  const coverConcept = coverConceptFor(topic, opts.script, r);

  return {
    titles: deduped,
    chosenTitle: chosen.text,
    chosenStyle: chosen.style,
    description,
    hashtags,
    keywords,
    tags,
    coverHeadline,
    coverConcept,
  };
}

function buildHashtags(topic: string, kw: string[], lang: Lang, nicheSlug?: string): string[] {
  const tags: string[] = [];
  const push = (t: string) => {
    const clean = t.toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]/g, '');
    if (clean.length < 3 || clean.length > 28) return;
    const tag = `#${clean}`;
    if (tags.includes(tag)) return;
    tags.push(tag);
  };
  if (nicheSlug) push(nicheSlug);
  for (const w of words(topic.toLowerCase())) if (w.length > 4 && !STOP.has(w)) push(w);
  for (const k of kw.slice(0, 3)) push(k);
  if (tags.length < 3) push('didyouknow');
  tags.push('#shorts');
  return tags.slice(0, 5);
}

function buildTags(topic: string, kw: string[], script: ScriptResult): string[] {
  const tags: string[] = [];
  const push = (t: string) => {
    const clean = t.trim().toLowerCase().replace(/\s+/g, ' ');
    if (clean.length < 3 || clean.length > 30) return;
    if (tags.includes(clean)) return;
    if (tags.some((x) => x === clean)) return;
    tags.push(clean);
  };
  push(topic.toLowerCase());
  for (const k of kw) push(k);
  for (const w of words(script.hook.toLowerCase())) if (w.length > 4 && !STOP.has(w)) push(w);
  // keep YouTube's combined tag limit in mind (500 chars)
  const out: string[] = [];
  let len = 0;
  for (const t of tags) {
    if (len + t.length + 1 > 460) break;
    out.push(t);
    len += t.length + 1;
  }
  return out;
}

function shortHeadline(title: string, hook: string): string {
  const base = title.replace(/^[—-]\s*/, '');
  const wordsList = words(base);
  if (wordsList.length <= 6) return capitalize(base);
  const fromHook = words(hook).slice(0, 6).join(' ').replace(/[.,!?]$/, '');
  return capitalize(fromHook.length > 12 ? fromHook : wordsList.slice(0, 6).join(' '));
}

function coverConceptFor(topic: string, script: ScriptResult, r: () => number): string {
  const keyword = script.scenes[0]?.visual.keyword || words(topic)[0] || 'shorts';
  const concepts = [
    `Bold headline over a two-colour gradient with a small “${capitalize(keyword)}” badge at the top.`,
    `Minimal cover: big white type, dark vignette, accent badge in the corner.`,
    `Contrast cover: keyword badge, oversized numerals if the fact includes a number.`,
    `Editorial cover: headline centred, subtle grain, accent colour from the niche palette.`,
  ];
  return pick(concepts, r);
}

export { hashStr };
