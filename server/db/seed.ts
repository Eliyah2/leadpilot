import { db, run, get } from './index.js';
import { CORPUS } from './corpus.js';
import { id, slugify, now } from '../lib/util.js';

export type NicheSeed = {
  name: string;
  slug: string;
  description: string;
  style: string;
  audience: string;
  color: string;
  config: Record<string, unknown>;
};

/** The built-in niche library. Users can add their own at runtime. */
export const NICHES: NicheSeed[] = [
  {
    name: 'AI',
    slug: 'ai',
    description: 'Artificial intelligence: how it works, what it can do, where it is going.',
    style: 'Fast-paced educational',
    audience: 'Curious tech-curious adults 18-45',
    color: '#6366f1',
    config: {
      tone: 'curious',
      formats: { facts: 3, explainer: 3, myth_vs_fact: 2, list: 2, comparison: 1, story: 1 },
      keywords: ['ai', 'artificial intelligence', 'machine learning', 'neural network', 'llm', 'robots'],
      banned_phrases: ['in today\'s video', 'without further ado', 'smash that like button'],
    },
  },
  {
    name: 'Technology',
    slug: 'technology',
    description: 'Gadgets, software, the internet and the history of the devices we use.',
    style: 'Fast-paced educational',
    audience: 'General tech audience 16-45',
    color: '#0ea5e9',
    config: {
      tone: 'direct',
      formats: { explainer: 3, story: 2, facts: 2, list: 2, comparison: 2 },
      keywords: ['tech', 'computer', 'internet', 'software', 'phone', 'gadget'],
      banned_phrases: ['in today\'s video', 'without further ado', 'let that sink in'],
    },
  },
  {
    name: 'Science',
    slug: 'science',
    description: 'Physics, chemistry, biology and the odd corners of the natural world.',
    style: 'Curious and surprising',
    audience: 'General audience 14-55',
    color: '#10b981',
    config: {
      tone: 'wonder',
      formats: { facts: 3, explainer: 3, myth_vs_fact: 2, question: 1, comparison: 1 },
      keywords: ['science', 'physics', 'biology', 'chemistry', 'nature', 'experiment'],
      banned_phrases: ['scientists hate him', 'in today\'s video', 'one weird trick'],
    },
  },
  {
    name: 'Space',
    slug: 'space',
    description: 'Astronomy, spaceflight, planets, stars and the scale of the universe.',
    style: 'Cinematic and awe-driven',
    audience: 'Space enthusiasts and general audience',
    color: '#8b5cf6',
    config: {
      tone: 'wonder',
      formats: { facts: 3, explainer: 3, documentary: 2, story: 1 },
      keywords: ['space', 'nasa', 'planet', 'star', 'galaxy', 'rocket', 'astronomy'],
      banned_phrases: ['in today\'s video', 'mind = blown', 'nasa does not want you to know'],
    },
  },
  {
    name: 'History',
    slug: 'history',
    description: 'Surprising, well-sourced stories and comparisons from the past.',
    style: 'Story-driven',
    audience: 'General audience 18-55',
    color: '#f59e0b',
    config: {
      tone: 'storyteller',
      formats: { story: 3, facts: 3, comparison: 2, documentary: 2 },
      keywords: ['history', 'ancient', 'war', 'empire', 'century', 'archive'],
      banned_phrases: ['history books lied', 'in today\'s video', 'they do not teach you this'],
    },
  },
  {
    name: 'Psychology',
    slug: 'psychology',
    description: 'How the mind works: biases, experiments, memory and behaviour.',
    style: 'Calm, evidence-led',
    audience: 'Self-improvement audience 18-40',
    color: '#ec4899',
    config: {
      tone: 'calm',
      formats: { explainer: 3, facts: 2, myth_vs_fact: 2, question: 2, story: 1 },
      keywords: ['psychology', 'mind', 'brain', 'bias', 'memory', 'behaviour'],
      banned_phrases: ['psychologists hate this', 'in today\'s video', 'you will not believe'],
    },
  },
  {
    name: 'Finance education',
    slug: 'finance',
    description: 'Personal finance fundamentals explained without hype or hype-y promises.',
    style: 'Clear and responsible',
    audience: 'Adults 20-45 building financial literacy',
    color: '#22c55e',
    config: {
      tone: 'responsible',
      formats: { explainer: 3, list: 2, myth_vs_fact: 3, facts: 2 },
      keywords: ['money', 'investing', 'saving', 'budget', 'compound interest', 'finance'],
      banned_phrases: ['get rich quick', 'guaranteed returns', 'this stock will', 'in today\'s video'],
    },
  },
  {
    name: 'Interesting facts',
    slug: 'facts',
    description: 'Bite-sized surprising facts from everywhere.',
    style: 'Rapid-fire',
    audience: 'General audience 13-45',
    color: '#f43f5e',
    config: {
      tone: 'playful',
      formats: { facts: 4, list: 3, question: 1 },
      keywords: ['facts', 'amazing', 'surprising', 'did you know', 'random'],
      banned_phrases: ['in today\'s video', 'nobody knows this', 'doctors are furious'],
    },
  },
  {
    name: 'Productivity',
    slug: 'productivity',
    description: 'Evidence-based systems for focus, habits and getting meaningful work done.',
    style: 'Practical and direct',
    audience: 'Students and professionals 18-40',
    color: '#14b8a6',
    config: {
      tone: 'direct',
      formats: { list: 3, explainer: 3, myth_vs_fact: 2, story: 1 },
      keywords: ['productivity', 'focus', 'habit', 'time management', 'deep work'],
      banned_phrases: ['in today\'s video', 'hustle harder', 'you are being lied to'],
    },
  },
  {
    name: 'Business',
    slug: 'business',
    description: 'How companies, markets and startups actually work.',
    style: 'Analytical with stories',
    audience: 'Aspiring founders and professionals',
    color: '#3b82f6',
    config: {
      tone: 'analytical',
      formats: { story: 3, explainer: 3, facts: 2, comparison: 2 },
      keywords: ['business', 'startup', 'marketing', 'sales', 'strategy', 'company'],
      banned_phrases: ['in today\'s video', 'this one trick', 'guaranteed profit'],
    },
  },
  {
    name: 'Gaming',
    slug: 'gaming',
    description: 'Video game history, design, industry stories and player culture.',
    style: 'Energetic and witty',
    audience: 'Gamers 14-35',
    color: '#a855f7',
    config: {
      tone: 'playful',
      formats: { story: 3, facts: 3, list: 2, comparison: 2 },
      keywords: ['gaming', 'video games', 'esports', 'arcade', 'console', 'indie'],
      banned_phrases: ['in today\'s video', 'pro gamers hate this', 'you suck at'],
    },
  },
  {
    name: 'Fitness education',
    slug: 'fitness',
    description: 'Training, recovery and health facts grounded in established guidance.',
    style: 'Motivating but honest',
    audience: 'Beginners and intermediate trainees',
    color: '#ef4444',
    config: {
      tone: 'motivating',
      formats: { list: 3, myth_vs_fact: 3, explainer: 2, facts: 2 },
      keywords: ['fitness', 'training', 'gym', 'muscle', 'health', 'workout'],
      banned_phrases: ['in today\'s video', 'get ripped fast', 'doctors do not want you to know'],
    },
  },
  {
    name: 'Travel',
    slug: 'travel',
    description: 'Places, logistics, geography and the surprising rules of getting around.',
    style: 'Vivid and informative',
    audience: 'Travellers and curious adults 20-50',
    color: '#f97316',
    config: {
      tone: 'wonder',
      formats: { facts: 3, list: 3, story: 2, explainer: 2 },
      keywords: ['travel', 'airport', 'country', 'flight', 'destination', 'geography'],
      banned_phrases: ['in today\'s video', 'secret travel hack', 'never travel without'],
    },
  },
];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  'generation.default_language': 'en',
  'generation.duration_target_sec': 40,
  'generation.hooks_per_topic': 7,
  'generation.tone': 'engaging',
  'generation.style': 'Fast-paced educational',
  'generation.formats': ['facts', 'story', 'list', 'explainer', 'comparison', 'question', 'myth_vs_fact', 'documentary'],
  'generation.script_min_words': 55,
  'generation.script_max_words': 135,
  'generation.auto_render': true,
  'generation.auto_cover': true,
  'generation.min_gap_similarity': 0.62,
  'subtitles.font': 'auto',
  'subtitles.size': 104,
  'subtitles.bold': true,
  'subtitles.position': 0.8,
  'subtitles.max_words': 4,
  'subtitles.style': 'word_highlight',
  'subtitles.primary_color': '#ffffff',
  'subtitles.highlight_color': '#ffd60a',
  'subtitles.outline': 7,
  'subtitles.margin_v': 340,
  'subtitles.all_caps': true,
  'voice.provider': 'auto',
  'voice.voice': '',
  'voice.rate': 1.02,
  'voice.pitch': 1.0,
  'voice.volume': 1.0,
  'voice.music_enabled': true,
  'voice.music_volume': 0.07,
  'render.width': 1080,
  'render.height': 1920,
  'render.fps': 30,
  'render.crf': 18,
  'render.preset': 'faster',
  'render.audio_bitrate': '192k',
  'render.visual_theme': 'auto',
  'schedule.per_day': 1,
  'schedule.times': ['17:00'],
  'schedule.days': [1, 2, 3, 4, 5],
  'schedule.timezone': 'UTC',
  'schedule.paused': false,
  'youtube.privacy': 'private',
  'youtube.category': '28',
  'youtube.tags': [],
  'youtube.made_for_kids': false,
  'youtube.auto_publish': true,
  'llm.provider': 'none',
  'llm.baseUrl': '',
  'llm.model': '',
  'llm.apiKey': '',
  'llm.temperature': 0.8,
  'trends.sources': ['wikipedia', 'hn', 'google_trends'],
  'trends.auto_refresh_hours': 6,
  'content.autopilot': true,
  'content.videos_per_day': 3,
  'content.auto_approve_passed': true,
  'content.autopilot_niche': '',
  'content.autopilot_niches': '',
  'analytics.sync_hours': 6,
  'qc.auto_review': true,
  'qc.similarity_threshold': 0.72,
  'qc.min_sources': 1,
  'qc.max_uncertain_claims': 2,
  'analytics.demo_data': false,
  'cost.storage_gb_month': 0,
  'cost.paid.llm_per_1k_tokens': 0.0,
  'cost.paid.tts_per_1k_chars': 0.015,
  'cost.paid.image_per_image': 0.02,
};

let seeded = false;

/** Idempotent seed: safe to call on every boot. */
export function seed(): void {
  if (seeded) return;
  const hasNiche = get('SELECT id FROM niches LIMIT 1');
  if (!hasNiche) {
    for (const n of NICHES) {
      run(
        `INSERT INTO niches (id, user_id, name, slug, description, style, audience, language, prompt_config, color, is_builtin, created_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, 'en', ?, ?, 1, ?)`,
        id('niche'),
        n.name,
        n.slug,
        n.description,
        n.style,
        n.audience,
        JSON.stringify(n.config),
        n.color,
        now(),
      );
    }
  }

  const hasKnowledge = get('SELECT id FROM knowledge LIMIT 1');
  if (!hasKnowledge) {
    for (const [slug, facts] of Object.entries(CORPUS)) {
      for (const f of facts) {
        run(
          `INSERT INTO knowledge (id, niche, subject, fact, detail, source_url, source_name, language, confidence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'en', 0.9, ?)`,
          id('kn'),
          slug,
          f.subject,
          f.fact,
          f.detail ?? '',
          f.url ?? '',
          f.src ?? 'curated',
          now(),
        );
      }
    }
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const exists = get('SELECT value FROM settings WHERE key = ?', key);
    if (!exists) {
      run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(value), now());
    }
  }
  seeded = true;
}

export function knowledgeStats(): { niches: number; facts: number } {
  const row = get<{ n: number }>('SELECT COUNT(*) n FROM knowledge');
  const niches = get<{ n: number }>('SELECT COUNT(DISTINCT niche) n FROM knowledge');
  return { facts: row?.n ?? 0, niches: niches?.n ?? 0 };
}

export { slugify };
