import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../db/schema.js';
import { db } from '../db/index.js';
import { seed } from '../db/seed.js';
import { all, get, run } from '../db/index.js';
import { generateTopics, pickTopic, markTopicUsed, listTopics } from '../engine/topics.js';
import { generateHooks, pickHook } from '../engine/hooks.js';
import { buildScript, pickFormat } from '../engine/scripts.js';
import { factCheck } from '../engine/factcheck.js';
import { FORMATS, type ScriptFormat } from '../engine/language.js';
import { similarity, words, isPluralSubject, agreeVerbs, now } from '../lib/util.js';

before(() => {
  migrate(db);
  seed();
});

test('topic generation creates diverse, de-duplicated topics with angles', async () => {
  const niche = get<{ id: string }>("SELECT id FROM niches WHERE slug = 'ai'")!;
  const created = await generateTopics({ nicheId: niche.id, count: 10 });
  assert.equal(created.length, 10, `expected 10 topics, got ${created.length}`);
  for (const t of created) {
    assert.ok(t.title.length > 5, 'title too short');
    assert.ok(t.mainAngle.length > 20, 'main angle missing');
    assert.ok(t.altAngle.length > 10, 'alt angle missing');
    assert.ok(t.audience.length > 0, 'audience missing');
    assert.ok(t.suggestedHook.length > 10, 'hook suggestion missing');
    assert.ok(t.suggestedTitle.length > 5, 'suggested title missing');
    assert.ok(['low', 'medium', 'high'].includes(t.complexity), 'complexity invalid');
    assert.ok(t.category.length > 0, 'category missing');
  }
  // titles must not be near-duplicates of each other
  for (let i = 0; i < created.length; i++) {
    for (let j = i + 1; j < created.length; j++) {
      const sim = similarity(created[i]!.title, created[j]!.title);
      assert.ok(sim < 0.75, `topics ${i} and ${j} too similar: ${sim.toFixed(2)}`);
    }
  }

  // second run must not recreate the same titles
  const again = await generateTopics({ nicheId: niche.id, count: 10 });
  for (const a of again) {
    for (const b of created) {
      assert.ok(similarity(a.title, b.title) < 0.75, `duplicate topic across runs: ${a.title} / ${b.title}`);
    }
  }
});

test('hook generation yields 5-10 distinct hooks across archetypes', async () => {
  const niche = get<{ id: string }>("SELECT id FROM niches WHERE slug = 'space'")!;
  const topics = await generateTopics({ nicheId: niche.id, count: 3 });
  const topic = topics[0]!;
  const hooks = generateHooks({
    topicId: topic.id,
    topicTitle: topic.title,
    subject: 'Venus',
    fact: 'A day on Venus is longer than its year.',
    detail: 'Venus takes 243 Earth days to rotate once.',
    count: 8,
  });
  assert.ok(hooks.length >= 5 && hooks.length <= 10, `got ${hooks.length} hooks`);
  const texts = hooks.map((h) => h.text);
  assert.equal(new Set(texts).size, texts.length, 'duplicate hook texts');
  const archetypes = new Set(hooks.map((h) => h.archetype));
  assert.ok(archetypes.size >= 4, `only ${archetypes.size} archetypes`);
  const picked = pickHook(hooks, []);
  assert.ok(picked.text.length > 10);
  // no unresolved placeholders
  for (const h of hooks) {
    assert.ok(!h.text.includes('{'), `unresolved placeholder in hook: ${h.text}`);
  }
});

test('every script format produces a valid scene list inside the word budget', async () => {
  const niche = get<{ id: string }>("SELECT id FROM niches WHERE slug = 'science'")!;
  const topics = await generateTopics({ nicheId: niche.id, count: 12 });
  assert.equal(topics.length, 12);

  for (const format of FORMATS.map((f) => f.id as ScriptFormat)) {
    const topic = topics.find((t) => t.status === 'available') ?? topics[0]!;
    const facts = all<{ id: string; subject: string; fact: string; detail: string; source_url: string; source_name: string }>(
      "SELECT id, subject, fact, detail, source_url, source_name FROM knowledge WHERE niche = 'science' LIMIT 3",
    );
    const hooks = generateHooks({
      topicId: topic.id,
      topicTitle: topic.title,
      subject: facts[0]?.subject ?? 'Science',
      fact: facts[0]?.fact,
      count: 6,
    });
    const hook = pickHook(hooks);
    const script = buildScript({
      topicId: topic.id,
      topicTitle: topic.title,
      subject: facts[0]?.subject,
      format,
      hook,
      facts,
      targetSec: 40,
      seed: `test:${format}`,
    });

    assert.equal(script.format, format);
    assert.ok(script.scenes.length >= 3, `${format}: only ${script.scenes.length} scenes`);
    assert.equal(script.scenes[0]!.kind, 'hook', `${format}: first scene must be the hook`);
    // the script normalises a hook that lacks terminal punctuation
    const stripEnd = (s: string) => s.replace(/[.!?…]+\s*$/, '').trim();
    assert.equal(stripEnd(script.scenes[0]!.voiceover), stripEnd(hook.text), `${format}: hook scene must narrate the hook`);
    const last = script.scenes[script.scenes.length - 1]!;
    assert.ok(['payoff', 'cta'].includes(last.kind), `${format}: must end with payoff/cta, got ${last.kind}`);
    assert.ok(script.wordCount >= 45 && script.wordCount <= 150, `${format}: word count ${script.wordCount} out of range`);
    assert.ok(script.estDurationSec > 12 && script.estDurationSec < 65, `${format}: duration ${script.estDurationSec}`);
    for (const s of script.scenes) {
      assert.ok(s.voiceover.length > 3, `${format}: empty scene voiceover`);
      assert.ok(s.textOnScreen.length > 0, `${format}: missing on-screen text`);
      assert.ok(s.textOnScreen.split(/\s+/).length <= 10, `${format}: on-screen text too long: ${s.textOnScreen}`);
      assert.ok(s.durationSec > 0, `${format}: bad duration`);
      assert.ok(/^#[0-9a-f]{6}$/i.test(s.visual.colors[0]), 'palette colors must be hex');
      assert.ok(!s.voiceover.includes('{'), `unresolved placeholder: ${s.voiceover}`);
    }
    // no consecutive identical transitions
    for (let i = 1; i < script.scenes.length; i++) {
      assert.ok(
        script.scenes[i]!.transition !== script.scenes[i - 1]!.transition || script.scenes.length === 2,
        `${format}: repeated transition at scene ${i}`,
      );
    }
  }
});

test('fact checking passes well-sourced scripts and flags fabricated claims', async () => {
  const niche = get<{ id: string }>("SELECT id FROM niches WHERE slug = 'space'")!;
  const topics = await generateTopics({ nicheId: niche.id, count: 4 });
  const topic = topics[0]!;
  const facts = all<any>("SELECT id, subject, fact, detail, source_url, source_name FROM knowledge WHERE niche = 'space' LIMIT 3");
  const hooks = generateHooks({ topicId: topic.id, topicTitle: topic.title, subject: 'Venus', fact: facts[0].fact, count: 6 });
  const hook = pickHook(hooks);
  const script = buildScript({
    topicId: topic.id,
    topicTitle: topic.title,
    subject: facts[0].subject,
    format: 'facts',
    hook,
    facts,
    targetSec: 40,
    seed: 'qc-pass',
  });

  const good = factCheck({
    script,
    facts,
    sourceIds: [],
    researchSentences: [],
    hookText: hook.text,
    videoId: 'video_test_1',
  });
  assert.notEqual(good.status, 'failed', `clean script failed QC: ${JSON.stringify(good.checks.filter((c) => c.status === 'fail'), null, 2)}`);
  assert.ok(good.score >= 60, `score too low: ${good.score}`);

  // Now inject a fabricated claim with an unsourced statistic
  const badScript = {
    ...script,
    voiceoverText: `${script.voiceoverText} A secret study in New Atlantis proved that 187% of rockets now run on cheese.`,
    scenes: [...script.scenes],
  };
  const bad = factCheck({ script: badScript, facts, sourceIds: [], hookText: hook.text, videoId: 'video_test_2' });
  assert.ok(['needs_review', 'failed'].includes(bad.status), `fabricated claim not flagged: ${bad.status}`);
  assert.ok(bad.notes.some((n) => /unverified|suspicious/i.test(n)), 'expected an unverified/suspicious note');
});

test('duplicate scripts are rejected as repeated content', async () => {
  const niche = get<{ id: string }>("SELECT id FROM niches WHERE slug = 'history'")!;
  const topics = await generateTopics({ nicheId: niche.id, count: 3 });
  const topic = topics[0]!;
  const facts = all<any>("SELECT id, subject, fact, detail, source_url, source_name FROM knowledge WHERE niche = 'history' LIMIT 3");
  const hooks = generateHooks({ topicId: topic.id, topicTitle: topic.title, subject: 'Oxford', fact: facts[0].fact, count: 5 });
  const hook = pickHook(hooks);
  const script = buildScript({ topicId: topic.id, topicTitle: topic.title, format: 'facts', hook, facts, targetSec: 40, seed: 'dup' });

  // existing user + video so FKs hold
  run(
    `INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'owner', ?)
     ON CONFLICT(email) DO NOTHING`,
    'usr_dup',
    'dup@example.com',
    'x',
    'Dup',
    Date.now(),
  );
  run(
    `INSERT INTO videos (id, user_id, niche_id, topic_id, title, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Earlier video', 'draft', ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    'video_orig',
    'usr_dup',
    niche.id,
    topic.id,
    Date.now(),
    Date.now(),
  );

  run(
    'INSERT INTO scripts (id, video_id, topic_id, format, language, hook_text, voiceover_text, word_count, est_duration_sec, version, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    'script_orig',
    'video_orig',
    topic.id,
    'facts',
    'en',
    script.hook,
    script.voiceoverText,
    script.wordCount,
    script.estDurationSec,
    1,
    'approved',
    Date.now(),
  );

  const dup = factCheck({
    script: { ...script, voiceoverText: script.voiceoverText },
    facts,
    sourceIds: [],
    hookText: hook.text,
    videoId: 'video_other',
  });
  const dupCheck = dup.checks.find((c) => c.id === 'duplication')!;
  assert.equal(dupCheck.status, 'fail', `expected duplication fail, got ${dupCheck.status}: ${dupCheck.detail}`);
  assert.equal(dup.status, 'failed');
});

test('format picker returns only configured formats', () => {
  for (let i = 0; i < 30; i++) {
    const f = pickFormat('ai', 'en', `seed-${i}`);
    assert.ok(FORMATS.some((x) => x.id === f), `unexpected format ${f}`);
  }
});

test('subject-verb agreement keeps plural subjects grammatical', () => {
  // Plural detection
  assert.equal(isPluralSubject("Neptune's winds"), true);
  assert.equal(isPluralSubject('the rings of Saturn'), true);
  assert.equal(isPluralSubject('Voyager 1'), false);
  assert.equal(isPluralSubject('the Great Red Spot'), false);
  assert.equal(isPluralSubject('the United States'), true);
  assert.equal(isPluralSubject('physics'), false);

  // Template conjugation
  assert.equal(agreeVerbs('How {s} actually works', "Neptune's winds"), 'How {s} actually work');
  assert.equal(agreeVerbs('How {s} actually works', 'Voyager 1'), 'How {s} actually works');
  assert.equal(agreeVerbs('Why {topic} works like this', 'the rings of Saturn'), 'Why {topic} work like this');
  // "it works" has its own subject — untouched
  assert.equal(agreeVerbs('{topic}: how it works and why it matters', "Neptune's winds"), '{topic}: how it works and why it matters');
  assert.equal(agreeVerbs('Why does {subject} work like that?', "Neptune's winds"), 'Why do {subject} work like that?');
});

test('generated topic titles agree with plural subjects', async () => {
  const niche = get<{ id: string }>("SELECT id FROM niches WHERE slug = 'space'")!;
  run(
    `INSERT INTO knowledge (id, niche, subject, fact, detail, source_url, use_count, created_at)
     VALUES ('knw_pluraltest', 'space', 'Neptune''s winds', 'Neptune has the fastest winds in the solar system.',
       'Winds on Neptune reach up to 2,100 km/h according to NASA observations.', 'https://science.nasa.gov/neptune/', 0, ?)`,
    now(),
  );
  const created = await generateTopics({ nicheId: niche.id, count: 6, force: true });
  const fromWinds = created.filter((t) => t.title.toLowerCase().includes('winds'));
  assert.ok(fromWinds.length > 0, `no plural-subject topic generated: ${created.map((t) => t.title).join(' | ')}`);
  for (const t of fromWinds) {
    assert.ok(!/winds actually works\b/i.test(t.title), `bad agreement: ${t.title}`);
    assert.ok(!/winds works\b/i.test(t.title), `bad agreement: ${t.title}`);
    assert.ok(!/\bwinds work\b.*\bdoes\b/i.test(t.title));
  }
  run("DELETE FROM knowledge WHERE id = 'knw_pluraltest'");
});
