/**
 * Content recycling: turns a successful Short into several NEW original
 * concepts (sequel, different angle, FAQ, deeper explanation, myth-vs-fact,
 * related topic). The original video is never re-posted; every derived topic
 * goes through the same de-duplication and fact-checking pipeline as any other.
 */
import { all, get, run } from '../db/index.js';
import { id, now, slugify, similarity, rng, pick } from '../lib/util.js';
import type { TopicView, TopicRow } from '../engine/topics.js';

export type TransformKind = 'part_2' | 'different_angle' | 'faq' | 'deeper_explanation' | 'myth_vs_fact' | 'related_topic';

export const TRANSFORMS: { kind: TransformKind; label: string; description: string }[] = [
  { kind: 'part_2', label: 'Part 2', description: 'Direct sequel covering the next layer of the same subject' },
  { kind: 'different_angle', label: 'Different angle', description: 'Same subject, opposite or sideways framing' },
  { kind: 'faq', label: 'FAQ', description: 'Answer the questions the comments are likely to ask' },
  { kind: 'deeper_explanation', label: 'Deeper explanation', description: 'Same hook idea, one level of detail further' },
  { kind: 'myth_vs_fact', label: 'Myth vs fact', description: 'Correct the most common misunderstanding around it' },
  { kind: 'related_topic', label: 'Related topic', description: 'Neighbouring fact from the same knowledge area' },
];

export function deriveRecycleTopics(videoId: string, kinds: TransformKind[] = TRANSFORMS.map((t) => t.kind)): TopicView[] {
  const video = get<any>('SELECT * FROM videos WHERE id = ?', videoId);
  if (!video) throw new Error('Video not found');
  const topic = video.topic_id ? get<TopicRow>('SELECT * FROM topics WHERE id = ?', video.topic_id) : null;
  const sourceTitle: string = topic?.title ?? video.title ?? 'this topic';
  const facts = all<{ id: string; subject: string; fact: string; detail: string }>(
    `SELECT k.id, k.subject, k.fact, k.detail FROM knowledge k
      JOIN niches n ON n.slug = k.niche
     WHERE n.id = ? ORDER BY RANDOM() LIMIT 8`,
    video.niche_id,
  );
  const existingTitles = all<{ title: string }>('SELECT title FROM topics WHERE niche_id = ?', video.niche_id).map((t) => t.title);
  const r = rng(`recycle:${videoId}`);
  const created: TopicView[] = [];

  const titleFor = (kind: TransformKind, base: string): string => {
    const trimmed = base.replace(/^(how|what|why|the)\s+/i, '').replace(/[?.!:]+$/, '');
    switch (kind) {
      case 'part_2':
        return `${trimmed} — part 2`;
      case 'different_angle':
        return pick([`${trimmed}: the other side`, `What everyone misses about ${trimmed}`, `${trimmed}, reconsidered`], r);
      case 'faq':
        return `${trimmed}: the questions everyone asks`;
      case 'deeper_explanation':
        return `How ${trimmed} really works, one level deeper`;
      case 'myth_vs_fact':
        return `${trimmed}: myth vs fact`;
      case 'related_topic':
        return `${trimmed}: the next thing to know`;
      default:
        return `${trimmed} (follow-up)`;
    }
  };

  const angleFor = (kind: TransformKind): string => {
    switch (kind) {
      case 'part_2':
        return 'Sequel: continue from where the previous Short stopped, with fresh sourced facts and a new payoff.';
      case 'different_angle':
        return 'Reframe the same subject around the counter-intuitive consequence instead of the definition.';
      case 'faq':
        return 'Answer the three most predictable audience questions directly, each backed by a source.';
      case 'deeper_explanation':
        return 'Keep the original hook idea but explain the mechanism step by step.';
      case 'myth_vs_fact':
        return 'Open with the common misconception, then correct it with the sourced fact.';
      case 'related_topic':
        return 'Bridge to a neighbouring fact in the same knowledge area with a new hook.';
      default:
        return 'Original follow-up with new facts.';
    }
  };

  for (const kind of kinds) {
    const title = titleFor(kind, sourceTitle);
    const slug = slugify(title);
    if (!slug) continue;
    if (existingTitles.some((t) => similarity(t, title) > 0.72)) continue;
    existingTitles.push(title);
    const fact = facts.find((f) => !existingTitles.some((t) => similarity(t, f.fact) > 0.7)) ?? facts[0];

    const topicId = id('top');
    run(
      `INSERT INTO topics (id, niche_id, title, slug, main_angle, alt_angle, audience, category, complexity,
         language, status, origin, parent_video_id, source_ids, score, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', 'recycle', ?, ?, ?, ?)`,
      topicId,
      video.niche_id,
      title,
      slug,
      angleFor(kind),
      `Built from your published Short "${sourceTitle}". Do not restate the same facts — this must stand alone.`,
      video.review_notes ? '' : '',
      topic?.category ?? 'how-it-works',
      topic?.complexity ?? 'medium',
      video.language,
      videoId,
      JSON.stringify(fact ? [fact.id] : []),
      0.6 + r() * 0.4,
      now(),
    );
    run('UPDATE topics SET audience = ? WHERE id = ?', topic?.audience ?? 'Your existing audience', topicId);

    const row = get<TopicRow>('SELECT * FROM topics WHERE id = ?', topicId)!;
    created.push({
      id: row.id,
      title: row.title,
      slug: row.slug,
      mainAngle: row.main_angle,
      altAngle: row.alt_angle,
      audience: row.audience,
      suggestedHook: '',
      suggestedTitle: row.title,
      complexity: row.complexity as any,
      category: row.category,
      status: row.status,
      origin: row.origin,
      useCount: row.use_count,
      score: row.score,
    });
  }
  return created;
}

/** Suggest recyclable videos: published, above-median performers. */
export function recyclableVideos(limit = 10): any[] {
  const rows = all<any>(
    `SELECT v.id, v.title, v.published_at, v.duration_sec, t.title topic_title,
            COALESCE((SELECT SUM(a.views) FROM analytics a WHERE a.video_id = v.id), p.yt_views, 0) views
       FROM videos v
       LEFT JOIN topics t ON t.id = v.topic_id
       LEFT JOIN published_videos p ON p.video_id = v.id
      WHERE v.status IN ('published', 'analyzing')
      ORDER BY views DESC LIMIT ?`,
    limit,
  );
  const withViews = rows.filter((r) => Number(r.views) > 0);
  if (!withViews.length) return rows;
  const median = (() => {
    const s = withViews.map((r) => Number(r.views)).sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  })();
  return rows.map((r) => ({ ...r, aboveMedian: Number(r.views) >= median, medianViews: median }));
}
