/**
 * public/js/scoring.js
 * Berekent de lead-score (0-100) en legt in gewone taal uit waarom.
 *
 * Hoger = meer kans dat dit bedrijf een nieuwe website wil (én kan betalen).
 * De regels zijn bewust simpel en zichtbaar, zodat je ze kunt aanpassen.
 */

/** Categorieën waarin een online boekingsknop echt geld oplevert. */
const BOOKING_SENSITIVE_CATEGORIES = new Set(['kapper', 'beauty', 'horeca', 'gezondheid', 'dieren', 'fitness', 'auto']);

export const SCORE_BANDS = [
  { min: 80, label: 'Zeer kansrijk', className: 'score-high' },
  { min: 60, label: 'Kansrijk', className: 'score-good' },
  { min: 40, label: 'Mogelijk', className: 'score-medium' },
  { min: 0, label: 'Laag', className: 'score-low' },
];

export function scoreBand(score) {
  return SCORE_BANDS.find((band) => score >= band.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}

function checkById(audit, id) {
  if (!audit || !Array.isArray(audit.checks)) return null;
  return audit.checks.find((check) => check.id === id) ?? null;
}

function isProblem(audit, id) {
  const check = checkById(audit, id);
  return Boolean(check) && (check.status === 'bad' || check.status === 'warn');
}

/**
 * @param {object} lead   de lead met rating, reviews, website, businessStatus
 * @param {object|null} audit  het resultaat van /api/audit (of null)
 * @param {{category?: string}} options
 * @returns {{score:number, band:object, reasons:Array<{label:string,detail:string,kind:string}>}}
 */
export function computeLeadScore(lead, audit, options = {}) {
  const reasons = [];
  const add = (kind, label, detail) => reasons.push({ kind, label, detail });

  let score = 30; // basiskans: elk lokaal bedrijf is een gesprek waard
  add('base', 'Startpunt 30', 'Ieder lokaal bedrijf begint met een basiskans van 30 punten.');

  const hasWebsite = Boolean(lead?.website);
  const auditOk = audit?.status === 'ok';

  if (!hasWebsite) {
    score += 35;
    add('plus', '+35 Geen website', 'Dit bedrijf is online vrijwel onvindbaar: het meeste werk, de grootste kans.');
  } else if (auditOk) {
    const websiteScore = Number(audit.websiteScore ?? 100);
    if (websiteScore < 40) {
      score += 25;
      add('plus', '+25 Website in slechte staat', `Website-score ${websiteScore}/100: er is veel te verbeteren.`);
    } else if (websiteScore < 70) {
      score += 15;
      add('plus', '+15 Website kan beter', `Website-score ${websiteScore}/100: duidelijke verbeterpunten.`);
    } else {
      score += 5;
      add('plus', '+5 Website is redelijk', `Website-score ${websiteScore}/100: minder dringend, wel te onderhouden.`);
    }
  } else if (hasWebsite) {
    add('note', '0 Website niet te analyseren', 'De website reageerde niet of gaf een fout; beoordeel deze handmatig.');
  }

  if (isProblem(audit, 'viewport')) {
    score += 8;
    add('plus', '+8 Geen mobiele weergave', 'Een groot deel van je klanten zoekt op mobiel; zo\'n site verliest bezoekers.');
  }
  if (isProblem(audit, 'https')) {
    score += 6;
    add('plus', '+6 Geen HTTPS', 'Browsers waarschuwen bezoekers voor een onveilige site.');
  }
  if (isProblem(audit, 'booking') && BOOKING_SENSITIVE_CATEGORIES.has(options.category)) {
    score += 6;
    add('plus', '+6 Geen online afspraak/reservering', 'In deze branche boeken klanten graag direct online.');
  }
  if (isProblem(audit, 'contact_form')) {
    score += 3;
    add('plus', '+3 Geen contactformulier', 'Bezoekers moeten zelf een weg naar contact zoeken.');
  }
  if (isProblem(audit, 'copyright') || isProblem(audit, 'layout') || isProblem(audit, 'jquery')) {
    score += 5;
    add('plus', '+5 Verouderde techniek', 'De site is technisch verouderd, wat vertrouwen en vindbaarheid kost.');
  }

  const reviews = Number.isFinite(lead?.reviews) ? lead.reviews : null;
  if (reviews !== null) {
    if (reviews < 10) {
      score += 10;
      add('plus', '+10 Erg weinig reviews', `Slechts ${reviews} reviews: dit bedrijf is online nauwelijks zichtbaar.`);
    } else if (reviews < 50) {
      score += 5;
      add('plus', '+5 Weinig reviews', `${reviews} reviews: er is ruimte om online te groeien.`);
    } else {
      add('note', '0 Veel reviews', `${reviews} reviews: dit bedrijf heeft al een sterke reputatie.`);
    }
  } else {
    add('note', '0 Aantal reviews onbekend', 'Google gaf geen aantal reviews terug.');
  }

  const rating = Number.isFinite(lead?.rating) ? lead.rating : null;
  if (rating !== null) {
    if (rating >= 4.3) {
      score += 8;
      add('plus', '+8 Hoge beoordeling', `${rating}/5: het loopt goed, dus er is budget voor een professionele website.`);
    } else if (rating < 3.5) {
      score -= 8;
      add('minus', '-8 Lage beoordeling', `${rating}/5: let op de service voor je hier tijd in steekt.`);
    } else {
      add('note', '0 Beoordeling is gemiddeld', `${rating}/5: geen sterk signaal.`);
    }
  }

  if (lead?.businessStatus === 'OPERATIONAL') {
    score += 5;
    add('plus', '+5 Actief bedrijf', 'Google meldt dit bedrijf als actief.');
  } else if (lead?.businessStatus && lead.businessStatus !== 'OPERATIONAL') {
    score -= 10;
    add('minus', '-10 Status niet actief', `Google-status: ${lead.businessStatus}.`);
  }

  if (!lead?.phone) {
    score -= 5;
    add('minus', '-5 Geen telefoonnummer', 'Zonder telefoonnummer is bellen geen optie; mail of bezoek wordt lastiger.');
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  return { score: finalScore, band: scoreBand(finalScore), reasons };
}

/**
 * Korte verkoopargumenten (max 3) die passen bij dít bedrijf.
 * Ze komen alleen uit echte bevindingen - nooit uit verzonnen cijfers.
 */
export function salesArguments(lead, audit, options = {}) {
  const args = [];
  const category = options.category ?? 'overig';
  const city = lead?.city || 'de regio';

  if (!lead?.website) {
    args.push({
      title: 'Ze zijn online onvindbaar',
      body: `Zonder website vindt iemand die "${lead?.category || options.nicheLabel || 'dit bedrijf'} ${city}" zoekt alleen Google Maps. Een eigen site zet je zelf in de resultaten én laat zien wat je doet.`,
    });
  } else if (audit?.status === 'ok') {
    const problems = audit.checks.filter((check) => check.status === 'bad' || check.status === 'warn').slice(0, 2);
    if (problems.length) {
      args.push({
        title: 'Concrete verbeterpunten op de site',
        body: problems.map((problem) => `${problem.label}: ${problem.detail}`).join(' '),
      });
    }
  }

  if (isProblem(audit, 'viewport') || !lead?.website) {
    args.push({
      title: 'Mobiel eerst',
      body: 'De meeste lokale zoekopdrachten gebeuren op een telefoon. Een site die op mobiel goed werkt levert direct meer telefoontjes en boekingen op.',
    });
  }

  if (BOOKING_SENSITIVE_CATEGORIES.has(category) && (isProblem(audit, 'booking') || !lead?.website)) {
    args.push({
      title: 'Online afspraken of reserveren',
      body: 'Met een boekingsknop hoeven klanten niet te bellen tijdens jouw drukste momenten, en je verliest geen aanvragen buiten openingstijden.',
    });
  }

  if (ratingHigh(lead)) {
    args.push({
      title: 'Goede reviews, zwakke website',
      body: `${lead.reviews} reviews met een ${lead.rating}/5: de kwaliteit is er, maar online zien nieuwe klanten dat onvoldoende terug. Dat is precies waar een goede site aan bijdraagt.`,
    });
  }

  if (isProblem(audit, 'copyright') || isProblem(audit, 'layout')) {
    args.push({
      title: 'Verouderde uitstraling',
      body: 'Een verouderde site wekt onbewust twijfel over het bedrijf erachter. Een frisse site maakt dezelfde kwaliteit meteen zichtbaar.',
    });
  }

  args.push({
    title: 'Zelf gevonden worden in Google',
    body: `Een snelle, vindbare site voor ${city} betekent dat je niet afhankelijk bent van doorverwijzingen of mond-tot-mond alleen.`,
  });

  // Unieke argumenten, maximaal drie.
  const seen = new Set();
  return args.filter((arg) => {
    if (seen.has(arg.title)) return false;
    seen.add(arg.title);
    return true;
  }).slice(0, 3);
}

function ratingHigh(lead) {
  return Number.isFinite(lead?.rating) && lead.rating >= 4.3 && Number.isFinite(lead?.reviews) && lead.reviews >= 5;
}

/** Is er genoeg informatie om de lead te beoordelen? */
export function scoreConfidence(lead, audit) {
  if (!lead?.website) return { level: 'hoog', text: 'Geen website gevonden: directe kans, geen analyse nodig.' };
  if (audit?.status === 'ok') return { level: 'hoog', text: 'Website succesvol geanalyseerd.' };
  if (audit?.status === 'unavailable') return { level: 'laag', text: audit.message || 'Website niet te analyseren.' };
  return { level: 'midden', text: 'Website is nog niet geanalyseerd.' };
}
