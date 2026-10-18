/** Debug: reproduce grounding failures and dump claim vs sources. */
import { db, get, all } from '../server/db/index.js';
import { migrate } from '../server/db/schema.js';
import { seed } from '../server/db/seed.js';
import { createVideo } from '../server/engine/pipeline.js';

migrate(db);
seed();

const niche = get<{ id: string }>("SELECT id FROM niches WHERE slug = 'ai'")!;
import { run } from '../server/db/index.js';
import { id, now } from '../server/lib/util.js';
import { hashPassword } from '../server/lib/crypto.js';
const userId = id('usr');
run(
  `INSERT INTO users (id, email, password_hash, name, role, locale, created_at, last_login_at) VALUES (?, ?, ?, ?, 'owner', 'en', ?, ?)`,
  userId, 'debug@local', hashPassword('debug-password-1'), 'Debug', now(), now(),
);

for (let i = 0; i < 5; i++) {
  const res = await createVideo({ userId, nicheId: niche.id, research: false, autoRender: false });
  console.log(`\n=== video ${i}: ${res.title} [${res.qcStatus}]`);
  if (res.notes.length) {
    for (const n of res.notes) console.log('  NOTE:', n);
    const v = get<any>('SELECT id, hook_text FROM videos WHERE id = ?', res.videoId);
    const scenes = all<any>('SELECT voiceover FROM scenes WHERE video_id = ? ORDER BY idx', v.id);
    console.log('  VOICEOVER:', scenes.map((s) => s.voiceover).join(' | '));
    const facts = all<any>(
      `SELECT k.subject, k.fact FROM knowledge k JOIN topics t ON t.id = (SELECT topic_id FROM videos WHERE id = ?)
        WHERE k.id IN (SELECT value FROM json_each(t.source_ids))`,
      v.id,
    );
    console.log('  TOPIC FACTS:', JSON.stringify(facts, null, 1));
  }
}
process.exit(0);
