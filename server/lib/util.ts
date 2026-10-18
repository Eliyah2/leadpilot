import crypto from 'node:crypto';

/** Short unique id with a readable prefix. */
export function id(prefix = ''): string {
  const raw = crypto.randomBytes(9).toString('base64url');
  return prefix ? `${prefix}_${raw}` : raw;
}

export function now(): number {
  return Date.now();
}

export function slugify(input: string, max = 80): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** Deterministic 32-bit hash (FNV-1a) for stable seeded choices. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small fast seeded PRNG (mulberry32). */
export function rng(seed: string | number): () => number {
  let a = typeof seed === 'number' ? seed >>> 0 : hashStr(seed);
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(arr: readonly T[], r: () => number): T {
  if (arr.length === 0) throw new Error('pick() from empty array');
  return arr[Math.floor(r() * arr.length) % arr.length];
}

/** Pick `n` distinct items using a seeded rng. */
export function sample<T>(arr: readonly T[], n: number, r: () => number): T[] {
  const copy = arr.slice();
  const out: T[] = [];
  while (out.length < n && copy.length) {
    out.push(copy.splice(Math.floor(r() * copy.length), 1)[0]);
  }
  return out;
}

export function shuffle<T>(arr: readonly T[], r: () => number): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Word count. */
export function words(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

/** Rough narration duration in seconds (~2.55 words/sec at rate 1.0). */
export function estimateSpeechSeconds(text: string, rate = 1): number {
  const w = words(text).length;
  return w / (2.55 * Math.max(0.5, rate));
}

/** Sentence split that keeps decimals and abbreviations intact enough for narration. */
export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Word-level trigram set used for similarity / duplicate detection. */
export function trigrams(text: string): Set<string> {
  const w = words(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' '));
  const out = new Set<string>();
  for (let i = 0; i + 3 <= w.length; i++) out.add(w.slice(i, i + 3).join(' '));
  return out;
}

/** Jaccard similarity of two texts (0..1). */
export function similarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Capitalize first letter. */
export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase());
}

/**
 * Capitalise the first letter of every word without touching anything else —
 * apostrophes and internal capitals survive ("Neptune's winds" →
 * "Neptune's Winds", never "Neptune'S Winds").
 */
export function titleWords(s: string): string {
  return s.replace(/(^|[\s(\[\u2014\u2013-])([a-zà-ÿ])/g, (_m, p: string, c: string) => p + c.toUpperCase());
}

export function plural(n: number, one: string, many?: string): string {
  return n === 1 ? one : many || `${one}s`;
}

/**
 * Does this subject read as a plural noun phrase? Used for subject–verb
 * agreement when a subject is embedded in a template. Handles possessives
 * ("Neptune's winds"), "X of Y" heads ("the rings of Saturn") and common
 * irregular plurals.
 */
export function isPluralSubject(subject: string): boolean {
  let s = subject.trim().toLowerCase().replace(/[.,;:!?]+$/, '');
  if (!s) return false;
  // In "X of Y" phrases the grammatical head sits before the "of".
  const ofIdx = s.indexOf(' of ');
  if (ofIdx > 0) s = s.slice(0, ofIdx);
  const parts = s.split(/\s+/);
  const head = parts[parts.length - 1]!.replace(/['’]s$/, '').replace(/['’]$/, '');
  if (!head) return false;
  if (/(people|children|men|women|feet|teeth|mice|geese|phenomena|criteria)$/.test(head)) return true;
  // Singular nouns that merely end in s.
  if (/(ss|us|is|ics|sis|ness|ous|news)$/.test(head)) return false;
  return /s$/.test(head);
}

/**
 * Fix subject–verb agreement in a template that is about to embed a (possibly
 * plural) subject: "How {topic} actually works" → "How {topic} actually work"
 * for "Neptune's winds". Verbs that agree with a different subject
 * ("{topic}: how it works") are left untouched. English only.
 */
const PLURAL_VERBS: Record<string, string> = {
  works: 'work',
  is: 'are',
  has: 'have',
  comes: 'come',
  goes: 'go',
  happens: 'happen',
  does: 'do',
  keeps: 'keep',
  looks: 'look',
  makes: 'make',
  takes: 'take',
  turns: 'turn',
};

export function agreeVerbs(template: string, subject: string): string {
  if (!isPluralSubject(subject)) return template;
  return template
    .replace(
      /(\{topic\}|\{s\}|\{subject\})(\s+(?:actually|really|simply|truly))*\s+(works|is|has|comes|goes|happens|does|keeps|looks|makes|takes|turns)\b/g,
      (_m, ph: string, adv: string | undefined, verb: string) => `${ph}${adv ?? ''} ${PLURAL_VERBS[verb.toLowerCase()] ?? verb}`,
    )
    .replace(/\b(Why|How) does (\{topic\}|\{s\}|\{subject\})/g, '$1 do $2');
}

/** Does this read as a full sentence/title rather than a noun phrase? */
export function isSentenceLike(s: string): boolean {
  const clean = s.trim().replace(/\s+/g, ' ');
  if (!clean) return false;
  const wc = clean.split(/\s+/).length;
  if (wc > 6) return true;
  return /^(how|why|what|this|that|these|those|here'?s|let me|you|we|they|it|there|so)\b/i.test(clean) && wc > 3;
}

/**
 * Pull the subject noun phrase out of a generated title so templates like
 * "Let me explain {topic}" don't end up with a whole title stuffed in them.
 */
export function subjectFromTitle(title: string): string {
  let s = title.trim().replace(/\s+/g, ' ');
  if (!s) return s;
  const patterns: RegExp[] = [
    /^(.+?)\s*[:—–]\s*.+$/, // "X: the timeline"
    /^(.+?),\s+(?:explained|understanding|the\b).*$/i, // "X, explained in 40 seconds"
    /^(?:understanding|the truth about|the facts behind|the secret of)\s+(.+?)(?:,\s*.*)?$/i,
    /^(?:how|why)\s+(.+?)\s+(?:actually\s+)?(?:works?|began|changed|happens?|looks?|is|are|was|were)\b.*$/i,
    /^(?:what|this|that|one)\b.*?\s+(?:about|of|behind|on|with|explains?|reveals?|shows?|changes?|defines?)\s+(.+)$/i,
    /^(?:the|your|our)\s+.*?\s+(?:about|of|behind|on|over|with)\s+(.+)$/i,
    /^(.+?)\s+(?:vs\.?|compared to|in (?:one|a|\d+)|—).*$/i,
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m?.[1] && m[1].trim().split(/\s+/).length <= 6) {
      s = m[1].trim().replace(/[,;:]$/, '');
      break;
    }
  }
  return s.replace(/\s+(actually|really|truly)\s+(works?|is|are)\s*$/i, '').trim();
}

/**
 * The noun phrase to speak in templates: the subject when we have one,
 * otherwise the subject extracted from the title. Never a whole sentence.
 */
export function topicPhrase(subject: string | undefined | null, topicTitle: string): string {
  const s = (subject ?? '').replace(/\s+/g, ' ').trim();
  if (s && !isSentenceLike(s)) return s;
  const fromTitle = subjectFromTitle(topicTitle);
  return fromTitle || s || topicTitle.trim();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function hashCode64(s: string): string {
  return crypto.createHash('sha256').update(s).digest('base64url').slice(0, 16);
}
