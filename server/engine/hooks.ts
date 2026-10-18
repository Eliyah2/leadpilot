/**
 * Hook generator — 5..10 distinct hooks per topic, one per archetype family,
 * with honest anti-clickbait rules:
 *   - claim hooks must be backed by the sourced fact (checked by fact-check),
 *   - archetype selection is weighted by *this channel's* historical data only,
 *   - no fabricated performance predictions are ever shown.
 */
import { all, get, run } from '../db/index.js';
import { id, now, rng, sample, similarity, agreeVerbs, topicPhrase } from '../lib/util.js';
import { PACKS, type Lang, type HookArchetype } from './language.js';
import { getInsightWeights } from '../services/learning.js';

export const ARCHETYPES: HookArchetype[] = ['curiosity', 'claim', 'question', 'howto', 'contrast', 'myth', 'story', 'list'];

export type HookView = {
  id: string;
  text: string;
  archetype: HookArchetype;
  score: number;
  supported: boolean;
};

type HookInput = {
  topicId?: string;
  videoId?: string;
  topicTitle: string;
  subject: string;
  fact?: string;
  detail?: string;
  myth?: string;
  count?: number;
  lang?: Lang;
};

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

const EMBED_ARTICLES = /^(the|a|an|le|la|les|un|une|der|die|das|ein|eine|het|een|de)\s/i;

/** Lower-case a leading article when the placeholder is not at the start of the line. */
function embed(template: string, key: string, value: string): string {
  const atStart = template.indexOf(`{${key}}`) === 0;
  const v = !atStart && EMBED_ARTICLES.test(value) ? value.charAt(0).toLowerCase() + value.slice(1) : value;
  return template.replace(new RegExp(`\{${key}\}`, 'g'), v);
}

function fill(template: string, input: HookInput, n: number): string {
  const claim = (input.fact ?? input.detail ?? input.topicTitle).replace(/\s+/g, ' ').replace(/\.$/, '').trim();
  const subjectTitle = input.subject.replace(/\b\w/g, (c) => c.toUpperCase());
  return embed(embed(agreeVerbs(template, input.subject), 'subject', subjectTitle), 'topic', topicPhrase(input.subject, input.topicTitle))
    .replace(/\{claim_lower\}/g, lowerFirst(claim.slice(0, 140)))
    .replace(/\{claim\}/g, claim.charAt(0).toUpperCase() + claim.slice(1, 140))
    .replace(/\{myth\}/g, input.myth ? lowerFirst(input.myth) : `the common story about ${subjectTitle}`)
    .replace(/\{n\}/g, String(n));
}

/**
 * Generate hooks (and persist them when topicId/videoId are given).
 * Returns up to `count` hooks spanning as many archetypes as the data supports.
 */
export function generateHooks(input: HookInput): HookView[] {
  const lang = input.lang ?? 'en';
  const pack = PACKS[lang] ?? PACKS.en;
  const count = input.count ?? 7;
  const weights = getInsightWeights();
  const r = rng(`hooks:${input.topicId ?? input.videoId ?? input.topicTitle}`);

  const candidates: { text: string; archetype: HookArchetype; supported: boolean }[] = [];

  const push = (arch: HookArchetype, supported: boolean) => {
    // Claim/myth hooks only exist when the script can actually back them up.
    if ((arch === 'myth' || arch === 'claim') && !supported) return;
    const templates = pack.hooks[arch];
    if (!templates?.length) return;
    const template = sample(templates, 1, r)[0]!;
    const text = fill(template, input, 3).replace(/\s+/g, ' ').trim();
    if (text.length < 12 || text.length > 170) return;
    if (candidates.some((c) => similarity(c.text, text) > 0.6)) return;
    candidates.push({ text, archetype: arch, supported });
  };

  // Support-gated archetypes first (they must be provable by the script).
  push('claim', Boolean(input.fact));
  push('myth', Boolean(input.myth));
  push('list', Boolean(input.fact));
  push('story', Boolean(input.fact && /\b(1[0-9]{3}|20[0-9]{2})\b/.test(input.fact)) || Boolean(input.detail));
  push('question', true);
  push('howto', true);
  push('curiosity', true);
  push('contrast', Boolean(input.fact));

  // Fill up to `count` using the remaining templates (archetype reused).
  const order: HookArchetype[] = [...ARCHETYPES].sort(
    (a, b) => (weights.hook[b] ?? 1) - (weights.hook[a] ?? 1) || Math.random() - 0.5,
  );
  for (const arch of order) {
    if (candidates.length >= count) break;
    const gated = arch === 'claim' || arch === 'myth';
    const supportable = arch === 'claim' ? Boolean(input.fact) : arch === 'myth' ? Boolean(input.myth) : true;
    if (gated && !supportable) continue;
    const templates = pack.hooks[arch];
    for (const template of templates) {
      if (candidates.length >= count) break;
      const text = fill(template, input, 3).replace(/\s+/g, ' ').trim();
      if (text.length < 12 || text.length > 170) continue;
      if (candidates.some((c) => similarity(c.text, text) > 0.65)) continue;
      candidates.push({ text, archetype: arch, supported: supportable });
    }
  }

  // Learning-influenced ordering: strong archetypes get priority, with
  // exploration preserved by a jitter (no hard elimination ever).
  const ranked = candidates
    .map((c) => ({ ...c, rank: (weights.hook[c.archetype] ?? 1) * (0.85 + r() * 0.3) }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, Math.max(5, count));

  const out: HookView[] = [];
  for (const c of ranked) {
    const hookId = id('hk');
    if (input.topicId || input.videoId) {
      run(
        `INSERT INTO hooks (id, topic_id, video_id, text, archetype, language, score, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        hookId,
        input.topicId ?? null,
        input.videoId ?? null,
        c.text,
        c.archetype,
        lang,
        Math.round((weights.hook[c.archetype] ?? 1) * 100) / 100,
        now(),
      );
    }
    out.push({
      id: hookId,
      text: c.text,
      archetype: c.archetype,
      score: Math.round((weights.hook[c.archetype] ?? 1) * 100) / 100,
      supported: c.supported,
    });
  }
  return out;
}

/** Choose the hook for a video: weighted pick with exploration, skipping near-duplicates. */
export function pickHook(hooks: HookView[], usedTexts: string[] = []): HookView {
  const fresh = hooks.filter((h) => !usedTexts.some((t) => similarity(t, h.text) > 0.75));
  const pool = fresh.length ? fresh : hooks;
  const scored = pool.map((h) => ({ h, w: h.score * (0.7 + Math.random() * 0.6) }));
  const total = scored.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (const s of scored) {
    r -= s.w;
    if (r <= 0) return s.h;
  }
  return scored[scored.length - 1]!.h;
}

export function hooksForVideo(videoId: string): HookView[] {
  return all<any>('SELECT * FROM hooks WHERE video_id = ? ORDER BY created_at', videoId).map(mapRow);
}

export function hooksForTopic(topicId: string): HookView[] {
  return all<any>('SELECT * FROM hooks WHERE topic_id = ? ORDER BY created_at', topicId).map(mapRow);
}

function mapRow(r: any): HookView {
  return { id: r.id, text: r.text, archetype: r.archetype, score: r.score, supported: true };
}

/** Record real outcomes for hook archetypes (called by analytics sync). */
export function scoreHookOutcome(videoId: string, aboveBaseline: boolean): void {
  const hook = get<{ id: string }>('SELECT id FROM hooks WHERE video_id = ? ORDER BY created_at LIMIT 1', videoId);
  if (!hook) return;
  run(`UPDATE hooks SET ${aboveBaseline ? 'wins' : 'losses'} = ${aboveBaseline ? 'wins' : 'losses'} + 1 WHERE id = ?`, hook.id);
}
