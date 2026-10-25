#!/usr/bin/env node
/**
 * scripts/push.mjs
 * Voert uit: git add -A -> git commit -> git push origin main
 *
 * Veiligheden ingebouwd:
 *   - stopt als .env of een andere geheime sleutel in de staging staat
 *     (en haalt die bestanden uit de staging, zonder iets te verwijderen)
 *   - pusht NOOIT met --force
 *   - pusht alleen vanaf de branch main, zodat je nooit per ongeluk een
 *     zijbranch naar productie duwt
 *   - legt bij een fout precies uit wat je moet doen
 *
 * Gebruik:
 *   npm run push
 *   npm run push -- "feat: nieuwe filteroptie"
 */
import { execFileSync } from 'node:child_process';

const SECRET_PATTERN = /(^|\/)(\.env($|\.(?!example$)[^/]*$)|\.vercel\/|.*\.(pem|key|p12|pfx)$)/;

function run(command, args, { allowFailure = false, capture = true } = {}) {
  try {
    const output = execFileSync(command, args, { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
    return { ok: true, output: output ?? '' };
  } catch (error) {
    if (allowFailure) {
      return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
    throw error;
  }
}

function git(args, options) {
  return run('git', args, options);
}

function lines(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function fail(headline, details, commands = []) {
  console.error(`\n✖ ${headline}\n`);
  if (details) console.error(`${details}\n`);
  if (commands.length) {
    console.error('Los het zo op:\n');
    commands.forEach((command) => console.error(`  ${command}`));
    console.error('');
  }
  process.exit(1);
}

// ── 0. Zijn we wel een git-repository? ───────────────────────────────────

const isRepo = git(['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
if (!isRepo.ok || !isRepo.output.includes('true')) {
  fail(
    'Dit is geen git-repository.',
    'De map is nog niet geïnitialiseerd, dus er valt niets te pushen.',
    ['git init -b main', 'git remote add origin https://github.com/Eliyah2/leadpilot.git']
  );
}

// symbolic-ref werkt ook als er nog geen enkele commit is gemaakt.
let branch = git(['symbolic-ref', '--short', 'HEAD'], { allowFailure: true }).output.trim();
if (!branch || branch === 'HEAD') {
  branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true }).output.trim();
}
if (!branch || branch === 'HEAD') branch = 'main'; // nog geen commit: we zitten op de nieuwe main

if (branch !== 'main') {
  fail(
    `Je staat op de branch "${branch}" en niet op "main".`,
    'Dit script pusht alleen main, zodat er nooit per ongeluk iets naar productie gaat dat daar niet hoort.',
    [`git checkout main`, `git merge ${branch}`, 'npm run push']
  );
}

const remoteCheck = git(['remote', 'get-url', 'origin'], { allowFailure: true });
if (!remoteCheck.ok || !remoteCheck.output.trim()) {
  fail(
    'Er is geen remote "origin" ingesteld.',
    'Zonder remote kan er niets naar GitHub.',
    ['git remote add origin https://github.com/Eliyah2/leadpilot.git', 'npm run push']
  );
}
const remoteUrl = remoteCheck.output.trim();

// ── 1. Alles klaarzetten ─────────────────────────────────────────────────

const message = process.argv.slice(2).join(' ').trim() || `chore: LeadPilot bijgewerkt op ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

git(['add', '-A'], { capture: false });

// ── 2. Geheime bestanden controleren ─────────────────────────────────────

const staged = lines(git(['diff', '--cached', '--name-only']).output);
const secrets = staged.filter((file) => SECRET_PATTERN.test(file.replace(/\\/g, '/')));

if (secrets.length > 0) {
  // Veilig: bestanden uit de staging halen (de bestanden zelf blijven staan).
  git(['reset', '-q', 'HEAD', '--', ...secrets], { allowFailure: true });
  fail(
    'Let op: er stonden geheime bestanden klaar om te committen.',
    `Deze bestanden zijn uit de staging gehaald:\n  ${secrets.join('\n  ')}`,
    [
      'Controleer of .gitignore klopt (.env, .vercel, *.pem)',
      'Draai daarna opnieuw: npm run push',
    ]
  );
}

// ── 3. Committen ─────────────────────────────────────────────────────────

let committed = false;
if (staged.length === 0) {
  console.log('Er zijn geen wijzigingen om te committen.');
} else {
  const commit = git(['commit', '-m', message], { allowFailure: true });
  if (!commit.ok) {
    fail(
      'De commit is mislukt.',
      commit.output.trim(),
      [
        'git config user.name "Jouw Naam"',
        'git config user.email "jij@voorbeeld.nl"',
        'npm run push',
      ]
    );
  }
  committed = true;
  console.log(`Gecommit: ${message}`);
  console.log(`  ${staged.length} bestand(en)`);
}

// ── 4. Pushen ────────────────────────────────────────────────────────────

const ahead = lines(git(['log', '--oneline', 'origin/main..HEAD'], { allowFailure: true }).output);
if (!committed && ahead.length === 0) {
  console.log('\nEr is niets te pushen: alles staat al op GitHub.');
  process.exit(0);
}

const push = git(['push', 'origin', 'main'], { allowFailure: true });
if (!push.ok) {
  const output = push.output;
  const guidance = [];
  if (/non-fast-forward|rejected|fetch first/i.test(output)) {
    guidance.push('git pull --rebase origin main', 'npm run push');
  } else if (/Permission denied|Authentication failed|could not read Username|terminal prompts disabled|403/i.test(output)) {
    guidance.push('gh auth login', 'git push origin main');
  } else if (/Repository not found|does not appear to be a git repository|404/i.test(output)) {
    guidance.push(
      'Maak de repository aan: gh repo create leadpilot --public --source=. --remote=origin',
      `controleer de URL: ${remoteUrl}`
    );
  } else {
    guidance.push('git push origin main');
  }

  fail(
    'Pushen naar GitHub is mislukt.',
    `De melding van git:\n\n${output.trim()}\n\nEr is niets geforceerd en er is niets overschreven.`,
    guidance
  );
}

console.log('\nGepusht naar origin/main.');

// ── 5. Link naar de commit ───────────────────────────────────────────────

const sha = git(['rev-parse', 'HEAD'], { allowFailure: true }).output.trim();
const webUrl = remoteUrl
  .replace(/^git@github\.com:/, 'https://github.com/')
  .replace(/\.git$/, '');
if (sha && webUrl.includes('github.com')) {
  console.log(`Commit: ${webUrl}/commit/${sha}`);
}
console.log('Vercel deployt automatisch na elke push naar main.');
