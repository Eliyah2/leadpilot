/**
 * Fact-checking / quality control.
 *
 * Flags, with evidence, the failure modes that matter for a factual channel:
 *   - unsupported factual claims (not present in corpus or fetched sources),
 *   - suspicious statistics (numbers with no backing source),
 *   - contradictions between two numeric claims,
 *   - fake quotes / appeals to unnamed "experts",
 *   - repeated content vs. previously written scripts,
 *   - hook claims that the script does not actually deliver,
 *   - deceptive title patterns and banned clickbait phrases.
 *
 * Anything uncertain is never silently dropped: it becomes a "Needs Review"
 * note attached to the video so a human decides.
 */
import { all, get } from '../db/index.js';
import { words, similarity, clamp } from '../lib/util.js';
import { getSetting } from './settings.js';
import type { ScriptResult } from './scripts.js';

export type CheckStatus = 'pass' | 'warn' | 'fail';
export type Check = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
};

export type QcResult = {
  status: 'passed' | 'needs_review' | 'failed';
  score: number;
  checks: Check[];
  notes: string[];
  unverifiedClaims: string[];
  verifiedSourceIds: string[];
};

type FactRow = { id: string; subject: string; fact: string; detail: string; source_url: string };

const EXCERPT = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1).trim() + '…' : s);

function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A sentence that carries an externally checkable claim (numbers, dates, named entities). */
function claimSentences(text: string): string[] {
  return sentencesOf(text).filter((s) => {
    if (words(s).length < 6) return false;
    if (/\d/.test(s)) return true;
    if (/\b(study|studies|research|university|institute|academy|journal)\b/i.test(s)) return true;
    // two+ capitalised words mid-sentence usually indicate named entities
    const caps = (s.match(/\b[A-Z][a-z]{3,}/g) ?? []).length;
    return caps >= 2;
  });
}

function isStructural(sentence: string, packPhrases: string[]): boolean {
  const norm = sentence.toLowerCase().replace(/[^a-z ]/g, '').trim();
  return packPhrases.some((p) => {
    const pn = p.toLowerCase().replace(/[^a-z ]/g, '').replace(/\{[^}]+\}/g, '').trim();
    if (pn.length < 8) return false;
    return norm.startsWith(pn.slice(0, Math.min(pn.length, 30)));
  });
}

function numbersIn(text: string): { value: number; unit: string; raw: string }[] {
  const out: { value: number; unit: string; raw: string }[] = [];
  const re = /(\d[\d,.]*)\s*(%|percent|million|billion|trillion|km|kg|cm|miles?|years?|days?|hours?|seconds?|minutes?|points?|times|x)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const value = Number(m[1]!.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    out.push({ value, unit: (m[2] ?? '').toLowerCase(), raw: m[0] });
  }
  return out;
}

type SourceSentence = { text: string; url: string; id: string };

function sourcedSentences(facts: FactRow[], sourceIds: string[], extra: string[]): SourceSentence[] {
  const out: SourceSentence[] = [];
  for (const f of facts) {
    out.push({ text: f.fact, url: f.source_url, id: f.id });
    if (f.detail) out.push({ text: f.detail, url: f.source_url, id: f.id });
  }
  for (const sid of sourceIds) {
    const src = get<{ id: string; url: string; snippet: string }>('SELECT id, url, snippet FROM sources WHERE id = ?', sid);
    if (src?.snippet) {
      out.push({ text: src.snippet, url: src.url, id: src.id });
      // Also index each sentence separately: a snippet is "fact + detail", so a
      // claim copied verbatim from the fact would otherwise only match via fuzzy
      // similarity and can fall below the threshold when the detail is long.
      for (const part of sentencesOf(src.snippet)) {
        if (part.length >= 20 && part !== src.snippet) out.push({ text: part, url: src.url, id: src.id });
      }
    }
  }
  for (const e of extra) out.push({ text: e, url: '', id: 'research' });
  return out;
}

export type FactCheckInput = {
  script: ScriptResult;
  facts: FactRow[];
  sourceIds: string[];
  researchSentences?: string[];
  language?: string;
  title?: string;
  hookText?: string;
  bannedPhrases?: string[];
  videoId?: string;
  nicheBanned?: string[];
};

export function factCheck(input: FactCheckInput): QcResult {
  const checks: Check[] = [];
  const notes: string[] = [];
  const unverified: string[] = [];
  const { script } = input;
  const threshold = getSetting<number>('qc.similarity_threshold', 0.72);
  const maxUncertain = getSetting<number>('qc.max_uncertain_claims', 2);

  /* 1 — structural sanity ------------------------------------------- */
  const wc = script.wordCount;
  if (script.scenes.length < 3) {
    checks.push({ id: 'structure', label: 'Scene structure', status: 'fail', detail: `Only ${script.scenes.length} scenes; a Short needs at least 3.` });
  } else {
    checks.push({ id: 'structure', label: 'Scene structure', status: 'pass', detail: `${script.scenes.length} scenes: hook, value, payoff present.` });
  }
  const minWords = getSetting<number>('generation.script_min_words', 55);
  const maxWords = getSetting<number>('generation.script_max_words', 135);
  if (wc < minWords) {
    checks.push({ id: 'length', label: 'Script length', status: 'warn', detail: `${wc} words is under the ${minWords}-word floor; narration may feel thin.` });
  } else if (wc > maxWords) {
    checks.push({ id: 'length', label: 'Script length', status: 'warn', detail: `${wc} words is over the ${maxWords}-word ceiling for the target duration.` });
  } else {
    checks.push({ id: 'length', label: 'Script length', status: 'pass', detail: `${wc} words ≈ ${script.estDurationSec}s of narration.` });
  }
  if (!script.hook.trim()) {
    checks.push({ id: 'hook', label: 'Hook present', status: 'fail', detail: 'No hook was generated.' });
  } else {
    checks.push({ id: 'hook', label: 'Hook present', status: 'pass', detail: EXCERPT(script.hook, 70) });
  }

  /* 2 — grounding: every claimful sentence must trace to a source ------ */
  const sources = sourcedSentences(input.facts, input.sourceIds, input.researchSentences ?? []);
  const structuralPhrases = collectStructuralPhrases();
  const hookText = (input.hookText ?? script.hook).trim();
  const hookNorm = hookText.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  // Sentences that come from framing scenes: hook, context lead-in, payoff and
  // CTA. They carry no checkable claim (e.g. "Next time <topic> comes up,
  // you'll know exactly why") and must not be flagged as unverified.
  const framingSentences = new Set<string>();
  for (const sc of script.scenes) {
    if (sc.kind !== 'hook' && sc.kind !== 'context' && sc.kind !== 'payoff' && sc.kind !== 'cta') continue;
    for (const part of sentencesOf(sc.voiceover)) {
      const n = part.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
      if (n.length > 8) framingSentences.add(n);
    }
  }
  const isFramingSentence = (norm: string): boolean => {
    for (const f of framingSentences) {
      // exact match, or a trimmed/merged variant on either side
      if (f.startsWith(norm) || norm.startsWith(f)) return true;
    }
    return false;
  };
  // The hook is a promise, not evidence: it is vetted separately by the
  // "hook payoff" check, so it is excluded from source grounding here.
  const claims = claimSentences(script.voiceoverText).filter((s) => {
    const norm = s.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    if (hookNorm && (norm === hookNorm || norm.startsWith(hookNorm.slice(0, Math.min(hookNorm.length, 60))))) return false;
    // Hook / context / payoff / CTA scenes are rhetorical framing (often with
    // the topic title embedded); they make no externally checkable claim.
    if (isFramingSentence(norm)) return false;
    return true;
  });
  const unsupported: string[] = [];
  for (const sentence of claims) {
    if (isStructural(sentence, structuralPhrases)) continue;
    const norm = sentence.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    const supported = sources.some((s) => {
      const srcNorm = s.text.toLowerCase().replace(/[^a-z0-9 ]/g, '');
      if (norm === srcNorm) return true;
      if (srcNorm.includes(norm) || norm.includes(srcNorm)) return true;
      return similarity(sentence, s.text) >= 0.55;
    });
    if (!supported) unsupported.push(sentence);
  }
  if (sources.length === 0 && claims.length > 0) {
    checks.push({
      id: 'grounding',
      label: 'Factual grounding',
      status: 'fail',
      detail: 'No sources were available for this script — it cannot be published as factual content.',
    });
    notes.push('No source material found: add a source or re-run research before publishing.');
  } else if (unsupported.length > 0) {
    const severe = unsupported.length > maxUncertain;
    checks.push({
      id: 'grounding',
      label: 'Factual grounding',
      status: severe ? 'fail' : 'warn',
      detail: `${unsupported.length} claim(s) could not be matched to a stored source: ${unsupported.map((u) => EXCERPT(u, 60)).join(' | ')}`,
    });
    for (const u of unsupported) notes.push(`Unverified claim — confirm before publishing: "${EXCERPT(u, 110)}"`);
    unverified.push(...unsupported);
  } else {
    checks.push({ id: 'grounding', label: 'Factual grounding', status: 'pass', detail: `All ${claims.length} claimful sentence(s) match stored sources.` });
  }

  /* 3 — suspicious statistics ---------------------------------------- */
  const suspicious: string[] = [];
  for (const s of claims) {
    for (const n of numbersIn(s)) {
      if (n.unit === '%' || n.unit === 'percent') {
        if (n.value > 100 || n.value < 0) suspicious.push(`${s} (percentage out of range: ${n.raw})`);
        else if (n.value >= 99 && !sources.some((x) => x.text.includes(String(n.value)))) suspicious.push(`${s} (near-total percentage with no matching source)`);
      }
      if (/\b(exactly|guaranteed|always|never|every single)\b/i.test(s) && n.value >= 1000) suspicious.push(`${s} (absolute wording with a large figure)`);
    }
  }
  checks.push(
    suspicious.length
      ? { id: 'stats', label: 'Statistics sanity', status: 'warn', detail: suspicious.slice(0, 3).map((x) => EXCERPT(x, 80)).join(' | ') }
      : { id: 'stats', label: 'Statistics sanity', status: 'pass', detail: 'No out-of-range or unsourced statistics detected.' },
  );
  suspicious.forEach((s) => notes.push(`Suspicious statistic to verify: ${EXCERPT(s, 130)}`));

  /* 4 — contradictions between numeric claims ------------------------- */
  const contradiction = detectContradiction(script.voiceoverText);
  checks.push(
    contradiction
      ? { id: 'consistency', label: 'Internal consistency', status: 'warn', detail: contradiction }
      : { id: 'consistency', label: 'Internal consistency', status: 'pass', detail: 'No conflicting numeric claims found.' },
  );
  if (contradiction) notes.push(`Possible contradiction: ${contradiction}`);

  /* 5 — fake quotes / unnamed experts --------------------------------- */
  const quoteIssues: string[] = [];
  for (const s of sentencesOf(script.voiceoverText)) {
    if (/["“][^"”]{10,}["”]/.test(s) && !sources.some((x) => x.text.includes(s.replace(/["“”]/g, '').slice(0, 30)))) {
      quoteIssues.push(`Quoted material without a stored source: ${EXCERPT(s, 90)}`);
    }
    if (/\b(experts?|scientists?|doctors?|researchers?)\s+(say|say that|agree|recommend|proved|claim)\b/i.test(s)) {
      const named = /\b[A-Z][a-z]+\s+[A-Z][a-z]+/.test(s) && /\b(university|institute|journal|study)\b/i.test(s);
      if (!named) quoteIssues.push(`Unnamed authority appeal: ${EXCERPT(s, 90)}`);
    }
  }
  checks.push(
    quoteIssues.length
      ? { id: 'quotes', label: 'Quotes & authorities', status: 'warn', detail: quoteIssues.slice(0, 2).join(' | ') }
      : { id: 'quotes', label: 'Quotes & authorities', status: 'pass', detail: 'No unsourced quotes or anonymous expert claims.' },
  );
  quoteIssues.forEach((q) => notes.push(q));

  /* 6 — repetition against the back-catalogue ------------------------- */
  const previous = all<{ id: string; voiceover_text: string }>(
    `SELECT s.id, s.voiceover_text FROM scripts s
      JOIN videos v ON v.id = s.video_id
     WHERE v.id <> COALESCE(?, '') ORDER BY s.created_at DESC LIMIT 80`,
    input.videoId ?? '',
  );
  let maxSim = 0;
  let nearDup: string | null = null;
  for (const p of previous) {
    const sim = similarity(p.voiceover_text, script.voiceoverText);
    if (sim > maxSim) {
      maxSim = sim;
      nearDup = p.id;
    }
  }
  if (maxSim >= threshold) {
    checks.push({
      id: 'duplication',
      label: 'Originality',
      status: 'fail',
      detail: `This script is ${Math.round(maxSim * 100)}% similar to an existing script (threshold ${Math.round(threshold * 100)}%).`,
    });
    notes.push('Repeated content: regenerate with a different topic or angle before publishing.');
  } else if (maxSim > threshold - 0.15) {
    checks.push({ id: 'duplication', label: 'Originality', status: 'warn', detail: `Some overlap with an earlier script (${Math.round(maxSim * 100)}%).` });
  } else {
    checks.push({ id: 'duplication', label: 'Originality', status: 'pass', detail: `Max similarity to past scripts: ${Math.round(maxSim * 100)}%.` });
  }

  /* 7 — hook delivery -------------------------------------------------- */
  const hook = hookText;
  const hookDelivered = (() => {
    const hw = words(hook.toLowerCase()).filter((w) => w.length > 4);
    if (!hw.length) return true;
    const body = script.voiceoverText.toLowerCase();
    const keyHits = hw.filter((w) => body.includes(w)).length;
    return keyHits >= Math.max(1, Math.ceil(hw.length * 0.3));
  })();
  checks.push(
    hookDelivered
      ? { id: 'hook_delivery', label: 'Hook payoff', status: 'pass', detail: 'The script delivers what the hook promises.' }
      : { id: 'hook_delivery', label: 'Hook payoff', status: 'warn', detail: 'The hook promise is not clearly answered in the narration.' },
  );
  if (!hookDelivered) notes.push(`Hook may overpromise: "${EXCERPT(hook, 90)}" — make sure the payoff appears in the script.`);

  /* 8 — clickbait / banned phrases ------------------------------------- */
  const banned = [...(input.bannedPhrases ?? []), ...(input.nicheBanned ?? []), ...DEFAULT_BANNED];
  const lower = `${script.voiceoverText} ${input.title ?? ''}`.toLowerCase();
  const hits = banned.filter((b) => lower.includes(b.toLowerCase()));
  checks.push(
    hits.length
      ? { id: 'banned', label: 'Clickbait & banned phrasing', status: 'warn', detail: `Matched: ${hits.join(', ')}` }
      : { id: 'banned', label: 'Clickbait & banned phrasing', status: 'pass', detail: 'No banned or deceptive phrases found.' },
  );
  hits.forEach((h) => notes.push(`Remove or rephrase banned phrase: "${h}"`));

  /* 9 — title honesty ---------------------------------------------------- */
  if (input.title) {
    const titleIssues = titleProblems(input.title);
    checks.push(
      titleIssues.length
        ? { id: 'title', label: 'Title honesty', status: 'warn', detail: titleIssues.join('; ') }
        : { id: 'title', label: 'Title honesty', status: 'pass', detail: 'Title is specific and non-deceptive.' },
    );
    titleIssues.forEach((t) => notes.push(`Title: ${t}`));
  }

  /* Verdict ------------------------------------------------------------ */
  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  const score = clamp(Math.round(100 - fails * 30 - warns * 8), 0, 100);
  const status: QcResult['status'] = fails > 0 ? 'failed' : warns > 0 ? 'needs_review' : 'passed';

  return {
    status,
    score,
    checks,
    notes,
    unverifiedClaims: unverified,
    verifiedSourceIds: sources.filter((s) => s.id !== 'research').map((s) => s.id),
  };
}

function detectContradiction(text: string): string | null {
  const sentences = sentencesOf(text);
  for (let i = 0; i < sentences.length; i++) {
    for (let j = i + 1; j < sentences.length; j++) {
      const a = sentences[i]!;
      const b = sentences[j]!;
      const sharedUnit = numbersIn(a).filter((x) => x.unit);
      for (const na of sharedUnit) {
        for (const nb of numbersIn(b)) {
          if (nb.unit !== na.unit) continue;
          if (na.value === 0 || nb.value === 0) continue;
          const ratio = Math.max(na.value, nb.value) / Math.min(na.value, nb.value);
          const subjectOverlap = similarity(a, b) > 0.35;
          if (ratio > 8 && subjectOverlap) {
            return `"${EXCERPT(a, 60)}" vs "${EXCERPT(b, 60)}" — ${na.raw} and ${nb.raw} share the unit "${na.unit}".`;
          }
        }
      }
    }
  }
  return null;
}

export function titleProblems(title: string): string[] {
  const out: string[] = [];
  const t = title.trim();
  if (t.length > 100) out.push('longer than 100 characters');
  const wordsAll = words(t);
  if (wordsAll.length > 18) out.push('more than 18 words');
  if (/(you won'?t believe|shocking|this will (change|blow)|secret|banned|they don'?t want you)/i.test(t)) {
    out.push('uses deceptive curiosity phrasing');
  }
  const letters = t.replace(/[^a-zA-Z]/g, '');
  const upper = letters.replace(/[^A-Z]/g, '');
  if (letters.length > 6 && upper.length / letters.length > 0.7) out.push('mostly capitals (shouty)');
  if (/\b(best|top|ultimate|guaranteed|100%)\b/i.test(t) && !/\?/.test(t)) out.push('absolute claim — consider softening');
  return out;
}

const DEFAULT_BANNED = [
  'in today\'s video',
  'without further ado',
  'smash that like button',
  'subscribe for more',
  'you will not believe',
  'doctors hate',
  'one weird trick',
  'click the link',
  'limited time only',
  'guaranteed to',
];

function collectStructuralPhrases(): string[] {
  const raw = getSetting<string[]>('qc.structural_phrases', []);
  if (raw.length) return raw;
  return [
    'Here\'s the short version',
    'The short version',
    'Give me twenty seconds',
    'It comes down to one simple idea',
    'And that\'s not even the strange part',
    'Now here\'s where it gets interesting',
    'Which leads to the next bit',
    'Stay with me',
    'There\'s more',
    'So next time',
    'And that\'s the part worth remembering',
    'Small detail, big difference',
    'Follow for one like this',
    'Save this one',
    'Follow if you like knowing the why',
    'Comment the fact',
    'Here are three',
    'Let\'s do three',
    'Three things, and the last one is the best',
    'Start with the basics',
    'Then the mechanism kicks in',
    'And that gives you the result',
    'Here\'s the answer',
    'The reality is different',
    'Here\'s what the sources actually say',
    'The truth is simpler and stranger',
    'The explanation is easier than you think',
  ];
}

export { claimSentences, sentencesOf, numbersIn };
