/**
 * Myth bank for the "myth vs fact" format.
 *
 * Each entry pairs a *widely repeated misconception* with a subject in the
 * knowledge corpus. Myths are stated as claims people commonly hear — never as
 * facts — and every one is paired with a sourced correction from the corpus.
 */
export type MythEntry = { subject: string; myth: string };

export const MYTHS: MythEntry[] = [
  { subject: 'Cleopatra in time', myth: 'Cleopatra lived at the same time as the dinosaurs' },
  { subject: 'Library of Alexandria', myth: 'the Library of Alexandria held every book ever written' },
  { subject: 'The Great Wall of China', myth: 'you can see the Great Wall of China from the Moon' },
  { subject: 'Moon footprints', myth: 'there is wind on the Moon that blows footprints away' },
  { subject: 'Octopus hearts', myth: 'blue blood means an alien-like creature' },
  { subject: 'Human bones', myth: 'babies are born with the same 206 bones as adults' },
  { subject: 'Potassium in bananas', myth: 'radioactive things are always dangerous to be near' },
  { subject: 'Sound in a vacuum', myth: 'sound needs air, so space is completely silent' },
  { subject: 'The speed of light', myth: 'you could reach light speed in a strong enough rocket' },
  { subject: 'Saturn\'s density', myth: 'Saturn is solid enough to land on' },
  { subject: 'Venus day and year', myth: 'a year is always longer than a day' },
  { subject: 'The first email', myth: 'email was invented alongside the smartphone' },
  { subject: 'Bluetooth\'s namesake', myth: 'Bluetooth is a modern invented brand name' },
  { subject: 'Moore\'s law', myth: 'Moore\'s law is an actual law of physics' },
  { subject: 'The first computer mouse', myth: 'the mouse was invented with the first graphical computer' },
  { subject: 'Ten thousand steps', myth: 'ten thousand steps a day is a medical requirement' },
  { subject: 'The Rule of 72', myth: 'banks pay you the same interest they advertise on savings' },
  { subject: 'The forgetting curve', myth: 'reviewing something five times in one day fixes memory' },
  { subject: 'The placebo effect', myth: 'placebo results are all in the patient\'s head' },
  { subject: 'Recovery builds muscle', myth: 'muscles grow while you are training' },
  { subject: 'Sharks older than trees', myth: 'forests came first, then ocean life caught up' },
  { subject: 'Berries that are not berries', myth: 'strawberries are true berries because they are called berries' },
];

const INDEX = new Map(MYTHS.map((m) => [normalize(m.subject), m.myth]));

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Find a myth whose subject matches, allowing partial matches. */
export function mythFor(subject: string): string | null {
  const key = normalize(subject);
  if (INDEX.has(key)) return INDEX.get(key)!;
  for (const [k, myth] of INDEX) {
    if (k.includes(key) || key.includes(k)) return myth;
  }
  const tokens = key.split(' ').filter((t) => t.length > 3);
  for (const [k, myth] of INDEX) {
    const shared = tokens.filter((t) => k.includes(t));
    if (shared.length >= Math.max(1, tokens.length - 1)) return myth;
  }
  return null;
}

/** Find the subject entry that matches a myth (for pairing in the script). */
export function subjectForMyth(myth: string): string | null {
  const m = MYTHS.find((x) => x.myth === myth);
  return m ? m.subject : null;
}
