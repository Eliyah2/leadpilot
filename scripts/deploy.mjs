#!/usr/bin/env node
/**
 * scripts/deploy.mjs
 * Doet twee dingen:
 *   1. pushen naar GitHub (via scripts/push.mjs)
 *   2. als de Vercel CLI beschikbaar en ingelogd is: `vercel --prod`
 *
 * Is Vercel gekoppeld aan je GitHub-repository (de normale situatie), dan is
 * stap 2 eigenlijk niet nodig: een push naar main deployt dan al automatisch.
 * Dit script is bedoeld als je handmatig wilt deployen.
 *
 * Gebruik: npm run deploy
 */
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('Stap 1: pushen naar GitHub\n');
try {
  execFileSync(process.execPath, [path.join(__dirname, 'push.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
} catch {
  console.error('\nDe push is niet gelukt. Deploy wordt gestopt; los eerst de push op.');
  process.exit(1);
}

console.log('\nStap 2: controleren of de Vercel CLI er is\n');
let vercelAvailable = false;
/**
 * Let op (Windows): `vercel` is daar een .cmd-bestand en dat kan Node alleen
 * via de shell starten. execSync doet dat op elk besturingssysteem goed.
 */
function findVercel() {
  try {
    const output = execSync('vercel --version', { encoding: 'utf8', stdio: 'pipe' });
    return { version: String(output ?? '').trim().split('\n')[0].replace(/^Vercel CLI\s*/, '') || 'versie onbekend' };
  } catch {
    return null;
  }
}

const vercelCli = findVercel();
try {
  if (!vercelCli) throw new Error('niet gevonden');
  console.log(`Vercel CLI gevonden (versie ${vercelCli.version}).`);
  vercelAvailable = true;
} catch {
  console.log('Vercel CLI niet gevonden of niet uitvoerbaar. Deploy via GitHub gebeurt automatisch.');
}

if (!vercelAvailable) {
  console.log('\nJe push naar main is klaar. Als je het project in Vercel aan de repository hebt gekoppeld,');
  console.log('gaat de productie-deploy nu vanzelf. Bekijk de voortgang op https://vercel.com/dashboard.');
  process.exit(0);
}

console.log('\nStap 3: handmatige productie-deploy met Vercel\n');
try {
  execSync('vercel --prod --yes', { stdio: 'inherit' });
  console.log('\nDeploy klaar.');
} catch (error) {
  console.error('\nDe Vercel-deploy is mislukt.');
  console.error('Los het zo op:');
  console.error('  vercel login');
  console.error('  vercel link');
  console.error('  npm run deploy');
  process.exit(1);
}
