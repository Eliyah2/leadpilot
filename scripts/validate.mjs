/**
 * scripts/validate.mjs
 * Controleert de hele app vóór het pushen. Draait ook in GitHub Actions.
 *
 * Wat het doet:
 *   1. syntaxcontrole van alle JavaScript-bestanden (node --check)
 *   2. controleren of alle relatieve imports naar bestaande bestanden wijzen
 *   3. de e-mailtemplates controleren (6+ varianten per niche per taal, etc.)
 *   4. e-mails echt opbouwen en de eisen testen (max 120 woorden, max 50 tekens onderwerp)
 *   5. CSV-export en -import heen en weer testen
 *   6. de API-routes echt opstarten en aanroepen (auth, demo-modus, website-analyse)
 *
 * Gebruik: npm test
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const results = [];
let failed = 0;

function pass(name, extra = '') {
  results.push({ ok: true, name, extra });
}

function fail(name, error) {
  failed += 1;
  results.push({ ok: false, name, extra: error instanceof Error ? error.message : String(error) });
}

async function check(name, fn) {
  try {
    const extra = await fn();
    pass(name, typeof extra === 'string' ? extra : '');
  } catch (error) {
    fail(name, error);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function walk(dir, extensions = ['.js', '.mjs']) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, extensions));
    else if (extensions.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

// ── 1. Syntaxcontrole ────────────────────────────────────────────────────

const jsFiles = [
  ...walk(path.join(ROOT, 'api')),
  ...walk(path.join(ROOT, 'public', 'js')),
  ...walk(path.join(ROOT, 'scripts')),
  path.join(ROOT, 'public', 'sw.js'),
];

async function checkSyntax() {
  const broken = [];
  for (const file of jsFiles) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      broken.push(`${path.relative(ROOT, file)}: ${(result.stderr || result.stdout).trim().split('\n')[0]}`);
    }
  }
  assert(broken.length === 0, `syntaxfouten:\n${broken.join('\n')}`);
  return `${jsFiles.length} bestanden`;
}

// ── 2. Imports controleren ───────────────────────────────────────────────

function checkImports() {
  const missing = [];
  for (const file of jsFiles) {
    const source = fs.readFileSync(file, 'utf8');
    const patterns = [/from\s+['"](\.[^'"]+)['"]/g, /import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(source)) !== null) {
        const target = path.resolve(path.dirname(file), match[1]);
        if (!fs.existsSync(target)) {
          missing.push(`${path.relative(ROOT, file)} -> ${match[1]}`);
        }
      }
    }
  }
  assert(missing.length === 0, `onvindbare imports:\n${missing.join('\n')}`);
  return 'alle relatieve imports bestaan';
}

// ── 3. Templates controleren ─────────────────────────────────────────────

const CATEGORY_LABELS = {
  kapper: 1,
  beauty: 1,
  horeca: 1,
  bakkerij: 1,
  bouw: 1,
  installatie: 1,
  schoonmaak: 1,
  gezondheid: 1,
  auto: 1,
  vervoer: 1,
  fotografie: 1,
  fitness: 1,
  dieren: 1,
  overig: 1,
};

async function checkTemplates() {
  const nl = (await import('../public/js/email/templates/nl.js')).default;
  const de = (await import('../public/js/email/templates/de.js')).default;
  const nichesNl = (await import('../public/js/email/templates/niches.nl.js')).openings;
  const nichesDe = (await import('../public/js/email/templates/niches.de.js')).openings;
  const problems = [];
  const minimum = 6;

  [['nl', nl], ['de', de]].forEach(([code, pack]) => {
    if (pack.subjects.length < minimum) problems.push(`${code}: te weinig onderwerpregels (${pack.subjects.length})`);
    ['informeel', 'formeel'].forEach((tone) => {
      if ((pack.ctas[tone] ?? []).length < minimum) problems.push(`${code}/${tone}: te weinig call-to-actions`);
      if ((pack.closings[tone] ?? []).length < 1) problems.push(`${code}/${tone}: geen afsluitende zin`);
      if (!pack.signature[tone]) problems.push(`${code}/${tone}: geen handtekening`);
    });
    Object.entries(pack.problems).forEach(([key, lines]) => {
      if (!Array.isArray(lines) || lines.length < 1) problems.push(`${code}: probleemtekst "${key}" ontbreekt`);
    });
    ['followup1', 'followup2', 'laatste'].forEach((kind) => {
      const follow = pack.followUps[kind];
      if (!follow || follow.subjects.length < 2 || follow.openings.length < 2 || follow.bodies.length < 2) {
        problems.push(`${code}: follow-up "${kind}" is niet compleet`);
      }
    });
    if (pack.subjects.some((subject) => subject.length > 50)) {
      problems.push(`${code}: onderwerpregel langer dan 50 tekens in de lijst`);
    }
    if (!pack.optOut?.informeel || !pack.optOut?.formeel) problems.push(`${code}: afmeldregel ontbreekt`);
    if (pack.whatsapp.length < 2) problems.push(`${code}: te weinig WhatsApp-varianten`);
    if (!pack.callScript || !pack.postcard) problems.push(`${code}: belscript of postkaarttekst ontbreekt`);
  });

  Object.keys(CATEGORY_LABELS).forEach((category) => {
    [['nl', nichesNl], ['de', nichesDe]].forEach(([code, table]) => {
      const entry = table[category];
      if (!entry) {
        problems.push(`${code}: categorie "${category}" ontbreekt`);
        return;
      }
      if (entry.lines.length < minimum) problems.push(`${code}/${category}: ${entry.lines.length} openingszinnen (minimaal ${minimum})`);
      if (!entry.tips || entry.tips.length < 2) problems.push(`${code}/${category}: te weinig tips`);
    });
  });

  assert(problems.length === 0, problems.join('\n'));
  return `${Object.keys(CATEGORY_LABELS).length} categorieën × 2 talen × ${minimum}+ varianten`;
}

// ── 4. E-mails opbouwen en de eisen testen ───────────────────────────────

async function checkEmails() {
  const { buildEmail, buildWhatsApp, buildCallScript, buildPostcard } = await import('../public/js/email/engine.js');
  const { computeLeadScore, salesArguments } = await import('../public/js/scoring.js');

  const settings = {
    languageMode: 'auto',
    toneMode: 'auto',
    variantHistory: [],
    sender: {
      name: 'Eliyah',
      company: 'Eliyah Webdesign',
      phone: '+31 6 12345678',
      website: 'https://eliyah-webdesign.vercel.app',
      portfolio: '',
    },
  };

  // Testlead voor de unit test - dit is dus GEEN voorbeeld van echte data.
  const leads = [
    {
      name: 'Testbedrijf Met Een Erg Lange Bedrijfsnaam B.V.',
      city: 'Venlo',
      country: 'NL',
      regionCountry: 'NL',
      nicheLabel: 'Kapper',
      categoryKey: 'kapper',
      placeId: 'test-nl',
      website: '',
      rating: 4.6,
      reviews: 4,
      businessStatus: 'OPERATIONAL',
    },
    {
      name: 'Testbetrieb GmbH',
      city: 'Krefeld',
      country: 'DE',
      regionCountry: 'DE',
      nicheLabel: 'Friseur',
      categoryKey: 'kapper',
      placeId: 'test-de',
      website: 'https://example.com',
      rating: 4.8,
      reviews: 3,
      businessStatus: 'OPERATIONAL',
    },
  ];

  const audit = {
    status: 'ok',
    websiteScore: 35,
    copyrightYear: 2016,
    problems: ['Geen mobiele weergave'],
    checks: [
      { id: 'viewport', status: 'bad', label: 'Mobiele weergave', detail: 'Geen viewport-meta tag.', weight: 15 },
      { id: 'https', status: 'bad', label: 'HTTPS', detail: 'Geen HTTPS.', weight: 12 },
      { id: 'booking', status: 'warn', label: 'Boeken', detail: 'Geen boekingsknop.', weight: 8 },
      { id: 'copyright', status: 'bad', label: 'Actualiteit', detail: '© 2016', weight: 8 },
      { id: 'title', status: 'good', label: 'Titel', detail: 'Ok.', weight: 0 },
    ],
  };

  let built = 0;
  for (const lead of leads) {
    const kinds = ['eerste', 'followup1', 'followup2', 'laatste'];
    for (const kind of kinds) {
      const email = buildEmail({ lead, audit: kind === 'eerste' ? audit : null, settings, kind });
      built += 1;
      assert(email.wordCount <= 120, `${lead.country}/${kind}: ${email.wordCount} woorden (max 120)`);
      assert(email.subject.length <= 50, `${lead.country}/${kind}: onderwerp is ${email.subject.length} tekens`);
      assert(email.subject.length > 0, `${lead.country}/${kind}: geen onderwerp`);
      assert(!/\{\{|\}\}/.test(email.body), `${lead.country}/${kind}: onvervulde variabele in de tekst`);
      assert(!/\{\{|\}\}/.test(email.subject), `${lead.country}/${kind}: onvervulde variabele in het onderwerp`);
      assert(email.body.includes('Eliyah Webdesign'), `${lead.country}/${kind}: handtekening ontbreekt`);
      const optOutOk = /Geen interesse|Kein Interesse/.test(email.body);
      assert(optOutOk, `${lead.country}/${kind}: afmeldregel ontbreekt`);
      if (kind === 'eerste') {
        assert(email.body.includes(lead.name) || email.body.includes(lead.city), `${lead.country}: mail is niet gepersonaliseerd`);
      }
    }
    // Duits moet echt Duits zijn, en Nederlands geen Duits.
    const deEmail = buildEmail({ lead, audit, settings, kind: 'eerste' });
    if (lead.country === 'DE') {
      assert(deEmail.language === 'de', 'Duitse lead krijgt geen Duitse mail');
      assert(/Sie|Ihre|Ihnen/.test(deEmail.body), 'Duitse mail gebruikt de Sie-vorm niet');
    } else {
      assert(deEmail.language === 'nl', 'Nederlandse lead krijgt geen Nederlandse mail');
    }

    const score = computeLeadScore(lead, audit, { category: lead.categoryKey });
    assert(score.score >= 0 && score.score <= 100, 'score buiten 0-100');
    assert(score.reasons.length > 0, 'geen uitleg bij de score');
    const args = salesArguments(lead, audit, { category: lead.categoryKey, nicheLabel: lead.nicheLabel });
    assert(args.length <= 3 && args.length > 0, 'verkoopargumenten moeten 1-3 stuks zijn');

    const whatsapp = buildWhatsApp({ lead, audit, settings });
    assert(whatsapp.message.length > 20 && whatsapp.message.length <= 320, 'WhatsApp-tekst heeft een rare lengte');
    assert(buildCallScript({ lead, audit, settings }).text.length > 40, 'belscript is te kort');
    assert(buildPostcard({ lead, audit, settings }).text.length > 40, 'postkaarttekst is te kort');
  }

  // Variatie: meerdere leads mogen niet allemaal exact dezelfde mail krijgen.
  const subjects = new Set();
  for (let index = 0; index < 12; index += 1) {
    const email = buildEmail({
      lead: { ...leads[0], placeId: `test-${index}`, name: `Testbedrijf ${index}` },
      audit,
      settings,
      kind: 'eerste',
    });
    subjects.add(email.subject + email.body.slice(0, 60));
  }
  assert(subjects.size >= 6, `te weinig variatie: ${subjects.size} unieke mails uit 12 leads`);

  return `${built} mails gebouwd, ${subjects.size}/12 uniek`;
}

// ── 3b. Elementen met het hidden-attribuut moeten echt verborgen blijven ──

/**
 * Dit is precies de fout die de app onbruikbaar maakte: het login-paneel had
 * het `hidden`-attribuut, maar de stylesheet zette er `display: grid` op. Een
 * class-regel gaat vóór de standaardregel van de browser, dus het paneel bleef
 * staan: een egaal, onzichtbaar vlak over de hele app dat alle muisklikken
 * opving. De app leek "niets te doen" en het scherm leek leeg, terwijl de code
 * gewoon werkte (een klik via JavaScript werkte namelijk wel).
 */
async function checkHiddenElements() {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/css/styles.css'), 'utf8');

  const elementen = [...html.matchAll(/<([a-z0-9-]+)((?:\s[^>]*)?\shidden(?:\s[^>]*)?)>/gi)].map((match) => ({
    tag: match[1].toLowerCase(),
    classes: (match[2].match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean),
  }));

  assert(elementen.length > 0, 'geen enkel element met het hidden-attribuut gevonden - klopt index.html nog?');

  const globaleRegel = /\[hidden\]\s*\{[^}]*display:\s*none/i.test(css);
  assert(
    globaleRegel,
    `index.html heeft ${elementen.length} element(en) met "hidden", maar de stylesheet heeft geen [hidden]-regel. ` +
      'Een class met "display:" kan zo\'n element zichtbaar maken: dan ligt er een onzichtbaar paneel over de app dat alle kliks opvangt.'
  );

  // Welke van die elementen hebben een class die zelf een display-waarde zet?
  const risico = elementen.flatMap(({ classes }) =>
    classes.filter((cls) => new RegExp(`\.${cls}[^,{]*\{[^}]*display:\s*(?!none)`, 'i').test(css)).map((cls) => `.${cls}`)
  );

  return `${elementen.length} element(en) met het hidden-attribuut blijven verborgen (${elementen
    .map((e) => e.classes[0] || e.tag)
    .join(', ')})${risico.length ? ` - ${risico.join(', ')} wordt door de [hidden]-regel tegengehouden` : ''}`;
}

// ── 4b. Elke niche in elke regio, en de hele keten tot een e-mail ────────

async function checkAllNiches() {
  const { checkNicheCoverage, checkLeadPipeline, checkNicheTerms, checkColdLeadGuarantee } = await import(
    './check-niches.mjs'
  );
  const coverage = checkNicheCoverage();
  const pipeline = checkLeadPipeline();
  const terms = checkNicheTerms();
  const guarantee = await checkColdLeadGuarantee();
  return `${coverage}\n         ${pipeline}\n         ${terms}\n         ${guarantee}`;
}

// ── 5. CSV heen en weer ──────────────────────────────────────────────────

async function checkCsv() {
  const { leadsToCsv, csvToLeads, parseCsv } = await import('../public/js/csv.js');
  const source = [
    {
      name: 'Test "Quoted" Bedrijf; B.V.',
      nicheLabel: 'Kapper',
      city: 'Venlo',
      country: 'NL',
      phone: '+31 6 11111111',
      website: '',
      rating: 4.2,
      reviews: 12,
      score: 78,
      status: 'gemaild',
      notes: [{ text: 'Notitie met ; en "quotes"' }],
      updatedAt: '2026-01-01T10:00:00.000Z',
    },
  ];
  const csv = leadsToCsv(source);
  const rows = parseCsv(csv);
  assert(rows.length === 2, `verwachtte 2 CSV-regels, kreeg ${rows.length}`);
  assert(rows[1][0] === 'Test "Quoted" Bedrijf; B.V.', 'quotes of puntkomma niet goed geëscaped');
  const { leads, skipped } = csvToLeads(csv);
  assert(leads.length === 1 && skipped === 0, 'CSV-import leverde niet één lead op');
  assert(leads[0].name === source[0].name, 'bedrijfsnaam niet goed teruggelezen');
  assert(leads[0].status === 'gemaild', 'status niet goed teruggelezen');
  assert(leads[0].rating === 4.2, 'rating niet goed teruggelezen');
  assert(leads[0].notes[0].text.includes('quotes'), 'notitie niet goed teruggelezen');

  // Komma-gescheiden bestanden moeten ook werken.
  const { leads: commaLeads } = csvToLeads('bedrijfsnaam,stad,telefoon\nTest BV,Weert,0612345678');
  assert(commaLeads.length === 1 && commaLeads[0].city === 'Weert', 'komma-gescheiden CSV niet ondersteund');

  // Rijen zonder naam worden overgeslagen.
  const { skipped: skippedRows } = csvToLeads('bedrijfsnaam,stad\n,Venlo\nTest,Venlo');
  assert(skippedRows === 1, 'rij zonder naam zou overgeslagen moeten worden');

  return 'export en import in beide scheidingstekens';
}

// ── 6. API-routes echt aanroepen ─────────────────────────────────────────

const BAD_TEST_PAGE = `<!DOCTYPE html>
<html><head><title>Verouderde testsite</title></head>
<body>
<table><tr><td><font size="3" color="red">Welkom</font></td></tr></table>
<table><tr><td>Menu</td></tr></table>
<table><tr><td>Meer</td></tr></table>
<table><tr><td>Nog meer</td></tr></table>
<div>tekst</div>
<center><h1>Onze zaak</h1></center>
<img src="/spacer.gif" width="1" height="1" alt="" />
<script src="https://code.jquery.com/jquery-1.12.4.min.js"></script>
<p>&copy; 2015 Alle rechten voorbehouden</p>
<p>Stuur een bericht naar info@testbedrijf.nl</p>
<a href="/contact.html">Contact</a>
</body></html>`;

async function checkApi() {
  process.env.APP_PASSWORD = 'test-wachtwoord-123';
  process.env.ALLOW_PRIVATE_AUDIT_TARGETS = 'true';
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const leadsHandler = (await import('../api/leads.js')).default;
  const auditHandler = (await import('../api/audit.js')).default;
  const loginHandler = (await import('../api/login.js')).default;
  const healthHandler = (await import('../api/health.js')).default;
  const stateHandler = (await import('../api/state.js')).default;

  const routes = {
    '/api/leads': leadsHandler,
    '/api/audit': auditHandler,
    '/api/login': loginHandler,
    '/api/health': healthHandler,
    '/api/state': stateHandler,
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/oude-site.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(BAD_TEST_PAGE);
      return;
    }
    const handler = routes[url.pathname];
    if (!handler) {
      res.statusCode = 404;
      res.end('{}');
      return;
    }
    Promise.resolve(handler(req, res)).catch((error) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: { message: error.message } }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const call = async (route, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, payload, response };
  };

  const notes = [];

  try {
    // Health: zonder sleutel moet demo-modus gemeld worden en het wachtwoord ingesteld.
    const health = await call('/api/health');
    assert(health.status === 200, `health gaf status ${health.status}`);
    assert(health.payload.checks.googlePlacesKey.includes('ontbreekt'), 'health meldt geen ontbrekende Places-sleutel');
    assert(health.payload.checks.appPassword.includes('ingesteld'), 'health meldt geen ingesteld wachtwoord');
    notes.push('health ok');

    // Zonder wachtwoord moet alles 401 geven.
    const blocked = await call('/api/leads', { method: 'POST', body: { q: 'kapper Venlo' } });
    assert(blocked.status === 401, `zonder wachtwoord verwachtte ik 401, kreeg ${blocked.status}`);
    notes.push('auth 401 ok');

    // Verkeerd wachtwoord.
    const wrong = await call('/api/login', { method: 'POST', body: { password: 'fout' } });
    assert(wrong.status === 401, `verkeerd wachtwoord gaf ${wrong.status}`);

    // Juist wachtwoord zet een cookie...
    const login = await call('/api/login', { method: 'POST', body: { password: 'test-wachtwoord-123' } });
    assert(login.status === 200 && login.payload.authenticated, 'inloggen met het juiste wachtwoord mislukte');
    const setCookie = login.response.headers.get('set-cookie') ?? '';
    assert(setCookie.includes('lp_auth='), 'er werd geen sessiecookie gezet');
    assert(setCookie.includes('HttpOnly'), 'het cookie is niet HttpOnly');
    notes.push('login + cookie ok');

    // ...en daarmee komen we binnen.
    const viaCookie = await call('/api/leads', {
      method: 'POST',
      body: { q: 'kapper Venlo' },
      headers: { cookie: setCookie.split(';')[0] },
    });
    assert(viaCookie.status === 200, `met cookie verwachtte ik 200, kreeg ${viaCookie.status}`);
    assert(viaCookie.payload.mode === 'demo', 'zonder API-sleutel hoort de app demo-modus te gebruiken');
    assert(Array.isArray(viaCookie.payload.searchLinks) && viaCookie.payload.searchLinks.length > 0, 'demo-modus geeft geen zoeklinks');
    notes.push('demo-modus ok');

    // Leads zonder zoekterm moet een nette 400 zijn.
    const noQuery = await call('/api/leads', {
      method: 'POST',
      body: {},
      headers: { 'x-app-password': 'test-wachtwoord-123' },
    });
    assert(noQuery.status === 400, `zonder zoekterm verwachtte ik 400, kreeg ${noQuery.status}`);
    notes.push('validatie ok');

    // De audit moet de verouderde testpagina echt analyseren.
    const audit = await call('/api/audit', {
      method: 'POST',
      body: { url: `${base}/oude-site.html` },
      headers: { 'x-app-password': 'test-wachtwoord-123' },
    });
    assert(audit.status === 200, `audit gaf status ${audit.status}: ${JSON.stringify(audit.payload).slice(0, 200)}`);
    const result = audit.payload.audit;
    assert(result.status === 'ok', `audit kon de testpagina niet analyseren: ${result.message ?? ''}`);
    const checkStatus = (id) => result.checks.find((check) => check.id === id)?.status;
    assert(checkStatus('viewport') === 'bad', 'viewport-probleem niet gevonden');
    assert(checkStatus('https') === 'bad', 'HTTPS-probleem niet gevonden');
    assert(checkStatus('jquery') === 'bad', 'oude jQuery niet gevonden');
    assert(checkStatus('copyright') === 'bad', 'verouderd copyright-jaar niet gevonden');
    assert(checkStatus('layout') === 'bad', 'tabellen-layout niet gevonden');
    assert(checkStatus('contact_form') !== 'good', 'contactformulier zou ontbreken');
    assert(result.publicEmails.includes('info@testbedrijf.nl'), 'openbaar e-mailadres niet gevonden');
    assert(result.websiteScore < 60, `websiteScore zou laag moeten zijn, nu ${result.websiteScore}`);
    notes.push(`audit ok (score ${result.websiteScore}/100)`);

    // Een onbereikbare site mag geen crash geven, maar "niet te analyseren".
    const broken = await call('/api/audit', {
      method: 'POST',
      body: { url: 'https://veel-te-lange-domeinnaam-die-niet-bestaat-voor-leadpilot-test.invalid' },
      headers: { 'x-app-password': 'test-wachtwoord-123' },
    });
    assert([200, 429].includes(broken.status), `audit van een onbereikbare site gaf ${broken.status}`);
    if (broken.status === 200) {
      assert(broken.payload.audit.status === 'unavailable', 'onbereikbare site moet als "niet te analyseren" gelden');
    }
    notes.push('foutafhandeling ok');

    // SSRF-bescherming: een privé-adres moet geweigerd worden.
    const savedFlag = process.env.ALLOW_PRIVATE_AUDIT_TARGETS;
    delete process.env.ALLOW_PRIVATE_AUDIT_TARGETS;
    const loopback = await call('/api/audit', {
      method: 'POST',
      body: { url: 'http://127.0.0.1:9/secret' },
      headers: { 'x-app-password': 'test-wachtwoord-123' },
    });
    process.env.ALLOW_PRIVATE_AUDIT_TARGETS = savedFlag;
    assert(
      loopback.status === 200 && loopback.payload.audit.status === 'unavailable',
      'een localhost-adres had geweigerd moeten worden'
    );
    notes.push('SSRF-check ok');

    // State zonder KV moet 501 geven (en de app valt dan terug op localStorage).
    const state = await call('/api/state?key=leads', { headers: { 'x-app-password': 'test-wachtwoord-123' } });
    assert(state.status === 501, `state zonder KV gaf ${state.status}, verwacht 501`);
    notes.push('KV-optioneel ok');

    // De daglimiet moet het aantal échte Google-zoekopdrachten tellen, niet het
    // aantal API-aanvragen. Met een onbruikbare sleutel faalt de aanvraag bij
    // Google, maar de teller loopt wel op - daarna moet de limiet blokkeren.
    process.env.GOOGLE_PLACES_API_KEY = 'test-sleutel-die-niet-werkt';
    process.env.MAX_SEARCHES_PER_DAY = '1';
    const eersteGoogleCall = await call('/api/leads', {
      method: 'POST',
      body: { q: 'kapper in Venlo', pages: 1 },
      headers: { 'x-app-password': 'test-wachtwoord-123' },
    });
    assert(
      eersteGoogleCall.status !== 429 || eersteGoogleCall.payload?.error?.code !== 'daily_limit',
      'de eerste zoekopdracht werd al geblokkeerd door de daglimiet (teller telt dubbel)'
    );
    // De aanvraag moet echt bij Google zijn aangekomen (en dus geteld zijn) en
    // mag niet op een andere fout zijn stukgelopen.
    assert(
      ['places_error', 'places_permission_denied', 'places_quota'].includes(eersteGoogleCall.payload?.error?.code),
      `de aanvraag bereikte Google niet: status ${eersteGoogleCall.status}, code ${eersteGoogleCall.payload?.error?.code}`
    );
    const tweedeGoogleCall = await call('/api/leads', {
      method: 'POST',
      body: { q: 'kapper in Venlo', pages: 1 },
      headers: { 'x-app-password': 'test-wachtwoord-123' },
    });
    assert(
      tweedeGoogleCall.status === 429 && tweedeGoogleCall.payload?.error?.code === 'daily_limit',
      `de daglimiet blokkeert niet (status ${tweedeGoogleCall.status}, code ${tweedeGoogleCall.payload?.error?.code})`
    );
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.MAX_SEARCHES_PER_DAY;
    notes.push('daglimiet per Google-aanroep ok');

    // Cross-site POST moet geweigerd worden.
    const crossOrigin = await call('/api/leads', {
      method: 'POST',
      body: { q: 'kapper Venlo' },
      headers: { 'x-app-password': 'test-wachtwoord-123', origin: 'https://kwaad.example.com', host: 'localhost' },
    });
    assert(crossOrigin.status === 403, `cross-site POST gaf ${crossOrigin.status}, verwacht 403`);
    notes.push('same-origin-check ok');
  } finally {
    server.close();
  }

  return notes.join(', ');
}

// ── Uitvoeren ───────────────────────────────────────────────────────────

console.log('LeadPilot - controle\n');

await check('Syntaxcontrole JavaScript', checkSyntax);
await check('Relatieve imports', checkImports);
await check('Verborgen elementen echt verborgen', checkHiddenElements);
await check('E-mailtemplates compleet', checkTemplates);
await check('E-mails opbouwen en eisen', checkEmails);
await check('Zoekplan, zoektermen en keten tot een lead per niche', checkAllNiches);
await check('CSV export/import', checkCsv);
await check('API-routes en beveiliging', checkApi);

console.log(results.map((row) => `${row.ok ? '  OK  ' : '  FOUT'}  ${row.name}${row.extra ? `\n         ${row.extra}` : ''}`).join('\n'));

if (failed > 0) {
  console.error(`\n${failed} controle(s) mislukt.`);
  process.exit(1);
}
console.log(`\nAlles in orde (${results.length} controles).`);
