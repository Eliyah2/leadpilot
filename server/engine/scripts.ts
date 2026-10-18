/**
 * Script generator.
 *
 * Produces a complete Shorts script: hook → context → value → payoff → CTA,
 * as a scene list ready for TTS and rendering.
 *
 * Rules enforced by construction:
 *   - get to the point immediately (hook scene is first, no intro scene),
 *   - spoken, natural sentences with varied connectives (never the same
 *     transition twice in a row),
 *   - hard word budget matched to the target duration,
 *   - only sourced facts from the knowledge base / fetched sources are used,
 *   - on-screen text is short, mobile-legible and never duplicates narration.
 */
import { all, get } from '../db/index.js';
import { rng, pick, sample, capitalize, estimateSpeechSeconds, words, clamp, similarity, agreeVerbs, topicPhrase } from '../lib/util.js';
import { PACKS, type Lang, type ScriptFormat, FORMATS } from './language.js';
import { mythFor } from './myths.js';
import { getSetting } from './settings.js';
import { getInsightWeights } from '../services/learning.js';
import { translate, llmAvailable } from './llm.js';
import { log } from '../lib/logger.js';

export type VisualSpec = {
  style: 'gradient' | 'radial' | 'bands' | 'grid' | 'particles' | 'noise' | 'image';
  colors: [string, string];
  keyword: string;
  motion: 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'none';
  assetId?: string | null;
};

export type TransitionKind = 'fade' | 'slideleft' | 'circleopen' | 'wipeleft';

export type SceneSpec = {
  kind: 'hook' | 'context' | 'value' | 'list' | 'payoff' | 'cta';
  voiceover: string;
  textOnScreen: string;
  visual: VisualSpec;
  transition: TransitionKind;
  durationSec: number;
};

export type ScriptResult = {
  hook: string;
  hookArchetype: string;
  format: ScriptFormat;
  voiceoverText: string;
  scenes: SceneSpec[];
  wordCount: number;
  estDurationSec: number;
  factsUsed: string[];
  sourcesUsed: string[];
  needsTranslation: boolean;
  cta: string | null;
};

export type FactRow = {
  id: string;
  subject: string;
  fact: string;
  detail: string;
  source_url: string;
  source_name: string;
};

type BuildOpts = {
  topicTitle: string;
  topicId?: string;
  subject?: string;
  lang?: Lang;
  format?: ScriptFormat;
  targetSec?: number;
  hook: { text: string; archetype: string };
  facts?: FactRow[];
  researchSentences?: string[];
  sourceUrls?: string[];
  seed?: string;
  tone?: string;
  allowCta?: boolean;
};

/* ------------------------------------------------------------------ */
/* Visual palette                                                       */
/* ------------------------------------------------------------------ */

const PALETTES: Record<string, [string, string][]> = {
  ai: [['#0f172a', '#6366f1'], ['#111827', '#22d3ee'], ['#1e1b4b', '#a855f7']],
  technology: [['#082f49', '#0ea5e9'], ['#042f2e', '#14b8a6'], ['#111827', '#38bdf8']],
  science: [['#022c22', '#10b981'], ['#082f49', '#38bdf8'], ['#134e4a', '#2dd4bf']],
  space: [['#0b1026', '#8b5cf6'], ['#111827', '#6366f1'], ['#1e1b4b', '#c084fc']],
  history: [['#2e1065', '#f59e0b'], ['#431407', '#fbbf24'], ['#1c1917', '#d97706']],
  psychology: [['#4a044e', '#ec4899'], ['#1e1b4b', '#f472b6'], ['#3b0764', '#e879f9']],
  finance: [['#052e16', '#22c55e'], ['#022c22', '#84cc16'], ['#0a1f14', '#facc15']],
  productivity: [['#042f2e', '#14b8a6'], ['#082f49', '#38bdf8'], ['#134e4a', '#5eead4']],
  business: [['#082f49', '#3b82f6'], ['#111827', '#60a5fa'], ['#1e3a8a', '#93c5fd']],
  gaming: [['#2e1065', '#a855f7'], ['#3b0764', '#f43f5e'], ['#111827', '#a855f7']],
  fitness: [['#450a0a', '#ef4444'], ['#431407', '#fb923c'], ['#1c1917', '#f87171']],
  travel: [['#431407', '#f97316'], ['#082f49', '#38bdf8'], ['#164e63', '#22d3ee']],
  facts: [['#111827', '#f43f5e'], ['#1e1b4b', '#fb7185'], ['#0f172a', '#f59e0b']],
};

function paletteFor(nicheSlug: string, r: () => number): [string, string] {
  const set = PALETTES[nicheSlug] ?? PALETTES.facts!;
  return pick(set, r);
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                         */
/* ------------------------------------------------------------------ */

const FILLER = /^(and|but|so|then|well|okay|now|actually|basically|literally|just)\s+/i;

function cleanSentence(s: string): string {
  let out = s.trim().replace(/\s+/g, ' ');
  out = out.replace(FILLER, '');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

const ON_SCREEN_LEAD = /^(that|which|who|whom|whose|it|they|this|these|those|is|are|was|were|has|have|had|can|could|will|would|because|which means|and|but|so|then)\s+/i;
const WEAK_TAIL = /^(of|in|to|for|with|on|at|and|or|the|a|an|is|are|was|were|its|my|your|his|her|their)$/i;

/** Fit text to the on-screen budget; keeps an ellipsis when genuinely truncated. */
function fitOnScreen(s: string, maxWords: number): string {
  const parts = words(s.replace(/\s+/g, ' ').replace(/[.!?…]+$/, '').trim());
  if (!parts.length) return s.trim();
  if (parts.length <= maxWords) return parts.join(' ');
  const cut = parts.slice(0, maxWords);
  while (cut.length > 2 && WEAK_TAIL.test(cut[cut.length - 1]!)) cut.pop();
  return cut.join(' ') + '…';
}

/**
 * Short on-screen line that reads as a COMPLETE thought: prefer the clause
 * that contains the striking number, else the longest clause. Never a
 * mid-phrase cut like "Moon could last for millions".
 */
function onScreenFrom(sentence: string, fallback: string, maxWords = 8): string {
  const clauses = sentence
    .split(/(?<=[.!?])\s+|,|:|;|\s+—\s+|\s+-\s+/)
    .map((c) => c.trim().replace(/[.!?…]+$/, ''))
    .filter((c) => words(c).length >= 2)
    .map((c) => c.replace(ON_SCREEN_LEAD, ''));
  const withNumber = clauses.filter((c) => /\d|thousand|million|billion|percent|%/i.test(c));
  const pool = withNumber.length ? withNumber : clauses;
  const best = [...pool].sort((a, b) => words(b).length - words(a).length)[0];
  return (best && fitOnScreen(best, maxWords)) || fitOnScreen(fallback, maxWords);
}

function trimWords(s: string, n: number): string {
  const parts = words(s.replace(/[.!?]+$/, ''));
  return parts.slice(0, n).join(' ') + (parts.length > n ? '…' : '');
}

/* ------------------------------------------------------------------ */
/* Format selection                                                     */
/* ------------------------------------------------------------------ */

export function pickFormat(nicheSlug: string, lang: Lang, seed: string): ScriptFormat {
  const cfgWeights = (() => {
    const niche = get<{ prompt_config: string }>('SELECT prompt_config FROM niches WHERE slug = ?', nicheSlug);
    if (!niche) return {} as Record<string, number>;
    try {
      return (JSON.parse(niche.prompt_config).formats ?? {}) as Record<string, number>;
    } catch {
      return {} as Record<string, number>;
    }
  })();
  const learned = getInsightWeights();
  const allowed = getSetting<ScriptFormat[]>('generation.formats', FORMATS.map((f) => f.id));
  const r = rng(`fmt:${seed}`);
  const entries = allowed.map((f) => {
    const base = cfgWeights[f] ?? 1;
    const lift = learned.format[f] ?? 1;
    return { f, w: base * lift * (0.8 + r() * 0.4) };
  });
  const total = entries.reduce((s, e) => s + e.w, 0);
  let x = r() * total;
  for (const e of entries) {
    x -= e.w;
    if (x <= 0) return e.f;
  }
  return 'facts';
}

/* ------------------------------------------------------------------ */
/* Script builder                                                       */
/* ------------------------------------------------------------------ */

export function buildScript(opts: BuildOpts): ScriptResult {
  const lang = opts.lang ?? 'en';
  const pack = PACKS[lang] ?? PACKS.en;
  const targetSec = clamp(opts.targetSec ?? 40, 15, 60);
  const seed = opts.seed ?? `${opts.topicTitle}:${opts.hook.text}`;
  const r = rng(seed);
  const nicheSlug = nicheSlugOf(opts.topicId);
  const format = opts.format ?? pickFormat(nicheSlug, lang, seed);
  const facts = (opts.facts ?? []).filter((f) => f.fact?.trim());
  const research = opts.researchSentences ?? [];
  const palette = paletteFor(nicheSlug, r);
  const topic = opts.topicTitle;

  const subject = topicPhrase(opts.subject ?? facts[0]?.subject, topic);
  const myth = mythFor(subject);
  const allowedCta = opts.allowCta !== false && getSetting<boolean>('generation.auto_cta', true);

  const transitions: TransitionKind[] = ['fade', 'slideleft', 'circleopen', 'wipeleft'];
  const transitionOffset = Math.floor(r() * transitions.length);
  const scene = (
    kind: SceneSpec['kind'],
    voiceover: string,
    textOnScreen: string,
    visualKeyword: string,
    style: VisualSpec['style'] = 'gradient',
    motion: VisualSpec['motion'] = 'zoom_in',
  ): SceneSpec => ({
    kind,
    voiceover: cleanSentence(voiceover),
    textOnScreen: fitOnScreen(textOnScreen, kind === 'hook' ? 10 : 8),
    visual: { style, colors: palette, keyword: trimWords(visualKeyword, 3), motion },
    transition: 'fade', // assigned after the scene list is final
    durationSec: 3,
  });

  // Narration beats. Every fact yields its headline claim AND its detail
  // sentence (both grounded in the same stored source), then research sentences
  // fill any remaining gaps. One Short is about one subject: depth comes from
  // the material we have on that subject, never from unrelated filler facts.
  const beats: string[] = [];
  const addBeat = (t: string | null | undefined) => {
    const text = (t ?? '').trim();
    if (text && !beats.some((b) => similarity(b, text) > 0.8)) beats.push(text);
  };
  for (const f of facts) {
    addBeat(f.fact);
    addBeat(f.detail);
  }
  research.forEach(addBeat);
  const factText = (i: number): string | null => beats[i] ?? null;

  const scenes: SceneSpec[] = [];
  const usedTransitions: string[] = [];

  const hookScene = scene('hook', opts.hook.text, onScreenFrom(opts.hook.text, subject, 10), trimWords(subject, 2), 'radial', 'zoom_in');
  // narration must end in punctuation so downstream sentence splitting is clean
  if (!/[.!?…]$/.test(hookScene.voiceover)) hookScene.voiceover += '.';
  scenes.push(hookScene);

  const pushTrans = () => {
    const t = pack.transitions.filter((x) => !usedTransitions.includes(x));
    const chosen = t.length ? pick(t, r) : pick(pack.transitions, r);
    usedTransitions.push(chosen);
    return chosen;
  };

  switch (format) {
    case 'facts': {
      scenes.push(scene('context', pick(pack.context, r), onScreenFrom(subject, subject), subject, 'gradient', 'pan_left'));
      const f1 = factText(0);
      if (f1) scenes.push(scene('value', f1, onScreenFrom(f1!, subject), subject, 'bands', 'zoom_out'));
      const f2 = factText(1);
      if (f2) {
        scenes.push(scene('value', `${pushTrans()} ${f2}`, onScreenFrom(f2!, subject), subject, 'gradient', 'pan_right'));
      }
      const f3 = factText(2);
      if (f3 && estimateSpeechSeconds(scenes.map((s) => s.voiceover).join(' ')) < targetSec - 8) {
        scenes.push(scene('value', f3, onScreenFrom(f3!, subject), subject, 'grid', 'zoom_in'));
      }
      break;
    }
    case 'list': {
      const items = [factText(0), factText(1), factText(2)].filter(Boolean) as string[];
      scenes.push(scene('context', pick(pack.listIntro, r), onScreenFrom(subject, subject), subject, 'gradient', 'pan_left'));
      items.forEach((item, i) => {
        const connector = pack.listConnectors[i] ?? pack.listConnectors[pack.listConnectors.length - 1]!;
        scenes.push(
          scene('list', `${connector}. ${item}`, onScreenFrom(item, `${connector} ${subject}`), subject, i % 2 ? 'bands' : 'grid', i % 2 ? 'pan_left' : 'zoom_in'),
        );
      });
      break;
    }
    case 'explainer': {
      scenes.push(scene('context', pick(pack.context, r), onScreenFrom(subject, subject), subject, 'gradient', 'pan_left'));
      const steps = [factText(0), factText(1)].filter(Boolean) as string[];
      steps.forEach((step, i) => {
        const lead = pack.explainerSteps[i] ?? pack.explainerSteps[pack.explainerSteps.length - 1]!;
        scenes.push(scene('value', `${lead} ${step}`, onScreenFrom(step, subject), subject, 'grid', 'zoom_in'));
      });
      const extra = factText(2);
      if (extra && !steps.includes(extra)) scenes.push(scene('value', extra, onScreenFrom(extra, subject), subject, 'bands', 'pan_right'));
      break;
    }
    case 'story': {
      const f1 = factText(0);
      const f2 = factText(1);
      scenes.push(scene('context', f1 ?? pick(pack.context, r), onScreenFrom(f1 ?? subject, subject), subject, 'gradient', 'pan_left'));
      if (f2) scenes.push(scene('value', `${pushTrans()} ${f2}`, onScreenFrom(f2, subject), subject, 'bands', 'zoom_out'));
      break;
    }
    case 'comparison': {
      const f1 = factText(0);
      const f2 = factText(1);
      scenes.push(scene('context', pick(pack.comparisonLead, r) + '.', onScreenFrom(subject, subject), subject, 'gradient', 'pan_left'));
      if (f1) scenes.push(scene('value', f1, onScreenFrom(f1, subject), subject, 'bands', 'pan_left'));
      if (f2) scenes.push(scene('value', f2, onScreenFrom(f2, subject), subject, 'bands', 'pan_right'));
      break;
    }
    case 'question': {
      const answer = factText(0);
      scenes.push(scene('context', pick(pack.questionLead, r), onScreenFrom(subject, subject), subject, 'radial', 'zoom_in'));
      if (answer) scenes.push(scene('value', answer, onScreenFrom(answer, subject), subject, 'grid', 'zoom_out'));
      const extra = factText(1);
      if (extra) scenes.push(scene('value', extra, onScreenFrom(extra, subject), subject, 'gradient', 'pan_right'));
      break;
    }
    case 'myth_vs_fact': {
      const f1 = factText(0);
      scenes.push(
        scene('context', myth ? pack.hooks.myth[0]!.replace('{myth}', myth) : pack.hooks.curiosity[0]!.replace(/\{subject\}/g, subject).replace(/\{topic\}/g, subject), onScreenFrom(myth ?? subject, subject), subject, 'noise', 'zoom_in'),
      );
      scenes.push(scene('value', pick(pack.mythReveal, r), onScreenFrom(f1 ?? 'the sources', subject), subject, 'gradient', 'pan_left'));
      if (f1) scenes.push(scene('value', f1, onScreenFrom(f1, subject), subject, 'bands', 'zoom_out'));
      break;
    }
    case 'documentary': {
      const parts = [factText(0), factText(1), factText(2)].filter(Boolean) as string[];
      parts.forEach((p, i) =>
        scenes.push(scene('value', i === 0 ? p : `${pushTrans()} ${p}`, onScreenFrom(p, subject), subject, i % 2 ? 'gradient' : 'bands', i % 2 ? 'pan_right' : 'zoom_in')),
      );
      break;
    }
  }

  // Payoff (always) + CTA (budget permitting) -------------------------
  const payoff = agreeVerbs(pick(pack.payoff, r), subject).replace(/\{topic\}/g, subject).replace(/\{subject\}/g, capitalize(subject));
  scenes.push(scene('payoff', payoff, pick(pack.onScreenPayoff, r), subject, 'radial', 'zoom_out'));

  let cta: string | null = null;
  if (allowedCta && r() < 0.7) {
    cta = pick(pack.cta, r);
    scenes.push(scene('cta', cta, fitOnScreen(cta, 8), subject, 'gradient', 'none'));
  }

  // Word budget --------------------------------------------------------
  const minWords = getSetting<number>('generation.script_min_words', 55);
  const maxWords = getSetting<number>('generation.script_max_words', 135);
  const budgetWords = Math.round(targetSec * 2.55);
  const clampScenes = (target: number) => {
    let guard = 0;
    while (totalWords() > target && guard++ < 30) {
      // trim from the back: drop optional scenes first, then shorten
      const ctaIdx = scenes.findIndex((s) => s.kind === 'cta');
      if (ctaIdx !== -1 && totalWords() > target) {
        scenes.splice(ctaIdx, 1);
        cta = null;
        continue;
      }
      const idx = scenes.reduce(
        (best, s, i) => (i > 0 && i < scenes.length && words(s.voiceover).length > words(scenes[best]!.voiceover).length ? i : best),
        Math.min(1, scenes.length - 1),
      );
      const victim = scenes[idx];
      if (!victim) break;
      const parts = victim.voiceover.split(/(?<=[.!?])\s+/);
      if (parts.length > 1) {
        victim.voiceover = parts.slice(0, -1).join(' ');
      } else {
        const w = words(victim.voiceover);
        victim.voiceover = w.slice(0, Math.max(6, w.length - 5)).join(' ');
      }
      if (words(victim.voiceover).length < 4) scenes.splice(idx, 1);
    }
    while (totalWords() < target * 0.8 && guard++ < 40) {
      const extraIdx = scenes.length - (cta ? 2 : 1);
      const detail = beats.find((b) => !scenes.some((sc) => sc.voiceover.includes(b) || similarity(sc.voiceover, b) > 0.6));
      if (!detail) break;
      const s = scene('value', detail, onScreenFrom(detail, subject), subject, 'gradient', 'pan_left');
      scenes.splice(Math.max(1, extraIdx), 0, s);
    }
  };

  function totalWords(): number {
    return scenes.reduce((sum, s) => sum + words(s.voiceover).length, 0);
  }

  clampScenes(clamp(budgetWords, minWords, maxWords));

  // Transitions are assigned last so adjacent scenes never repeat a transition
  // (the budget pass can insert or remove scenes mid-list).
  scenes.forEach((s, i) => {
    s.transition = transitions[(i + transitionOffset) % transitions.length]!;
  });

  // Duration estimates (refined later by real TTS timings) -------------
  for (const s of scenes) s.durationSec = Math.max(1.4, estimateSpeechSeconds(s.voiceover));

  const voiceoverText = scenes.map((s) => s.voiceover).join(' ');
  const wordCount = words(voiceoverText).length;
  const factsUsed = facts.map((f) => f.fact).filter((f) => voiceoverText.includes(f.slice(0, 25)));
  const sourcesUsed = (opts.sourceUrls ?? []).filter(Boolean);

  return {
    hook: opts.hook.text,
    hookArchetype: opts.hook.archetype,
    format,
    voiceoverText,
    scenes,
    wordCount,
    estDurationSec: Math.round(estimateSpeechSeconds(voiceoverText) * 10) / 10,
    factsUsed,
    sourcesUsed,
    needsTranslation: lang !== 'en' && !llmAvailable(),
    cta,
  };
}

function nicheSlugOf(topicId?: string): string {
  if (!topicId) return 'facts';
  const row = get<{ slug: string }>(
    'SELECT n.slug slug FROM niches n JOIN topics t ON t.niche_id = n.id WHERE t.id = ?',
    topicId,
  );
  return row?.slug ?? 'facts';
}

/** Optional: improve flow with a local LLM when one is configured. */
export async function polishWithLlm(text: string, lang: Lang): Promise<string | null> {
  if (!llmAvailable()) return null;
  try {
    const out = await translate(text, lang, 'shorts script polish');
    return out;
  } catch (err) {
    log.debug('polish failed', String(err));
    return null;
  }
}
