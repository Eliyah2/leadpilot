/**
 * public/js/email/templates/nl.js
 * ALLE Nederlandse e-mailteksten op één plek. Pas hier rustig dingen aan:
 * de engine (../engine.js) plakt de onderdelen aan elkaar tot één mail.
 *
 * Beschikbare variabelen tussen dubbele accolades:
 *   {{company}} {{city}} {{niche}} {{firstName}} {{sender}} {{senderCompany}}
 *   {{phone}} {{website}} {{portfolio}} {{year}} {{tip}}
 *
 * Opbouw van elke e-mail:
 *   aanhef -> opening (per niche) -> probleem -> oplossing -> call-to-action
 *   -> afsluiting met handtekening -> afmeldregel
 *
 * De "probleem"-teksten zijn bewust neutraal geschreven (zonder je/u), zodat
 * dezelfde zin werkt bij informele en formele toon. Alleen de aanhef, de
 * call-to-action, de afsluiting en de afmeldregel wisselen per toon.
 */

export const lang = {
  code: 'nl',
  name: 'Nederlands',
  locale: 'nl-NL',

  /** Onderwerpregels (max. 50 tekens - de engine kort lange bedrijfsnamen in). */
  subjects: [
    'Even over de website van {{company}}',
    'Idee voor {{company}} in {{city}}',
    'Vraagje over {{company}}',
    '{{company}} online in {{city}}',
    'Website voor {{company}}?',
    'Korte vraag van een webdesigner',
    '{{company}} in {{city}}: één idee',
    'Ik zag de site van {{company}}',
    'Mag ik {{company}} één tip geven?',
    '{{niche}} in {{city}}: valt mij iets op',
  ],

  /**
   * Probleemzinnen per bevinding. De engine kiest de zin die past bij het
   * echte audit-resultaat; zonder bevinding valt hij terug op `generic`.
   */
  problems: {
    noWebsite: [
      'Bij een zoekopdracht naar {{niche}} in {{city}} kom ik {{company}} alleen op Google Maps tegen, zonder website. Wie eerst wil zien wat jullie doen, kan nergens terecht.',
      'Ik zie nergens een website bij {{company}}. Klanten die rustig willen kijken voordat ze bellen, haken daardoor af.',
      'Zonder eigen site ben je voor nieuwe klanten in {{city}} alleen via Maps te vinden - en concurrenten met een site staan bovenaan.',
    ],
    notMobile: [
      'Op mobiel is de site van {{company}} niet goed leesbaar: bezoekers moeten inzoomen en haken dan af.',
      'De meeste mensen zoeken op hun telefoon, maar de site schaalt niet mee met het scherm.',
    ],
    noHttps: [
      'De site is niet beveiligd met HTTPS, waardoor browsers bezoekers een waarschuwing tonen.',
      'Zonder HTTPS-verbinding krijgen bezoekers een "niet veilig"-melding te zien voordat ze iets van {{company}} lezen.',
    ],
    outdated: [
      'De site oogt nog van een paar jaar geleden: © {{year}} onderaan en opbouw in tabellen in plaats van een modern ontwerp.',
      'Technisch loopt de site van {{company}} achter, wat ook de vindbaarheid in Google kost.',
    ],
    noBooking: [
      'Klanten kunnen op de site niet online reserveren of een afspraak maken, dus alles loopt via de telefoon.',
      'Er staat geen boekingsknop op de site. Wie buiten openingstijden zoekt, kan niets achterlaten.',
    ],
    noContactForm: [
      'Er staat geen contactformulier op de site, dus bezoekers moeten zelf zoeken hoe ze jullie bereiken.',
      'Er is geen plek op de site waar iemand met één vraag een berichtje kan achterlaten.',
    ],
    slow: [
      'De site laadt traag, en bij een trage pagina haakt een deel van de bezoekers af voordat ze iets zien.',
      'De pagina is zwaar en laadt daardoor langzaam, zeker op mobiel internet.',
    ],
    noSeo: [
      'De site heeft geen duidelijke titel en omschrijving, waardoor Google niet goed weet wanneer {{company}} getoond moet worden.',
      'In de zoekresultaten ontbreekt de informatie die Google nodig heeft om jullie netjes te tonen.',
    ],
    lowReviews: [
      'Jullie hebben nog weinig reviews online, waardoor nieuwe klanten niet kunnen zien hoe goed {{company}} eigenlijk is.',
      'Met zo weinig reviews op Google is het lastig om je te onderscheiden van de zaak om de hoek.',
    ],
    generic: [
      'Ik was op zoek naar {{niche}} in {{city}} en kwam bij {{company}} uit. Daarbij viel me op dat er online nog wat te winnen is.',
      'Ik keek even naar hoe {{company}} in {{city}} online te vinden is, en zag een paar punten die jullie klanten kosten.',
    ],
  },

  /** Oplossing in één zin (wisselt per mail). */
  valueProps: [
    'Ik maak snelle, mobielvriendelijke websites voor lokale bedrijven, in {{city}} en omgeving.',
    'Ik bouw websites waarop klanten meteen kunnen bellen, boeken of een bericht achterlaten.',
    'Eén overzichtelijke site die laat zien wat {{company}} doet, met reviews, openingstijden en duidelijke knoppen.',
    'Ik zorg dat je niet alleen een nette site hebt, maar ook bovenaan meekomt met zoeken naar {{niche}} in {{city}}.',
  ],

  /** Call-to-action per toon. */
  ctas: {
    informeel: [
      'Zullen we er 10 minuten voor bellen? Dan vertel ik wat ik zou aanpakken.',
      'Mag ik een gratis voorbeeldontwerp van je startpagina maken? Dan zie je meteen wat ik bedoel.',
      'Heb je deze week 10 minuten? Ik loop graag even met je door de site.',
      'Zin om kort te sparren? Ik laat vrijblijvend zien wat er beter kan.',
      'Ik kan een gratis schets maken van een nieuwe startpagina. Alleen als je dat interessant vindt.',
      'Eén telefoontje van 10 minuten is genoeg om te horen of dit iets voor je is.',
    ],
    formeel: [
      'Zullen we hiervoor 10 minuten bellen? Dan vertel ik wat ik zou aanpakken.',
      'Mag ik een gratis voorbeeldontwerp van uw startpagina maken? Dan ziet u meteen wat ik bedoel.',
      'Hebt u deze week 10 minuten? Ik loop graag met u door de site.',
      'Ik denk graag vrijblijvend met u mee. Een korte kennismaking van 10 minuten is daarvoor genoeg.',
      'Ik kan een gratis schets van een nieuwe startpagina voor u maken.',
      'Eén telefoontje van 10 minuten is genoeg om te horen of dit interessant is voor u.',
    ],
  },

  /** Afsluitende zin, direct boven de handtekening. */
  closings: {
    informeel: ['Hoor graag wat je ervan vindt.', 'Laat me weten of dit zinvol klinkt.', 'Geen haast, maar ik hoor het graag.'],
    formeel: ['Ik hoor graag wat u ervan vindt.', 'Laat u me weten of dit zinvol klinkt?', 'Geen haast, maar ik hoor het graag van u.'],
  },

  /**
   * Persoonlijke regel die alleen wordt toegevoegd als de bedrijfsnaam nog
   * nergens in de tekst staat. Zo staat er altijd iets over hun eigen zaak in.
   */
  personalLine: 'Ik heb even naar {{company}} in {{city}} gekeken.',

  /** Afmeldregel - verplicht in elke mail. */
  optOut: {
    informeel: 'Geen interesse? Laat het me even weten, dan mail ik je niet meer.',
    formeel: 'Geen interesse? Laat het me even weten, dan mail ik u niet meer.',
  },

  /** Handtekening (de engine vult je eigen gegevens uit de instellingen in). */
  signature: {
    informeel: 'Groet,\n{{sender}}\n{{senderCompany}}\n{{phone}}\n{{website}}',
    formeel: 'Met vriendelijke groet,\n{{sender}}\n{{senderCompany}}\n{{phone}}\n{{website}}',
  },

  /** Follow-up mails: kort, vriendelijk, geen verwijt. */
  followUps: {
    followup1: {
      subjects: [
        'Even terugkomen op mijn mail',
        'Korte herinnering over {{company}}',
        'Heb je mijn mail gezien?',
      ],
      openings: [
        'Vorige week stuurde ik je een kort berichtje over de website van {{company}}.',
        'Ik weet dat het druk is, dus heel kort: ik mailde je eerder over de site van {{company}}.',
        'Misschien is mijn vorige mail tussen de bedrijven door verdwenen.',
      ],
      bodies: [
        'Mocht het nu niet spelen, dan hoor ik dat ook graag - dan laat ik het erbij.',
        'Als het nu geen prioriteit is, is dat helemaal prima. Laat je het me even weten?',
        'Nog geen haast: ik hoor graag of het de moeite waard is om erover te praten.',
      ],
    },
    followup2: {
      subjects: ['Nog één tip voor {{company}}', 'Iets kleins dat je kan helpen'],
      openings: [
        'Eén concrete tip, ook als je niets met mijn aanbod doet:',
        'Ik zat nog even naar de site van {{company}} te kijken.',
      ],
      bodies: [
        'Zorg dat je openingstijden en telefoonnummer op elke pagina zichtbaar zijn. Dat is vaak de snelste winst voor lokale bedrijven: {{tip}}',
        'Zet je reviews van Google op de site zelf. Bezoekers kiezen sneller als ze meteen zien wat anderen van {{company}} vinden. Extra: {{tip}}',
      ],
    },
    laatste: {
      subjects: ['Laatste berichtje over {{company}}', 'Ik laat het hierbij'],
      openings: [
        'Ik wil je niet blijven mailen, dus dit is mijn laatste berichtje.',
        'Dit is mijn laatste mail over dit onderwerp, beloofd.',
      ],
      bodies: [
        'Als je later een nieuwe website wilt, weet je me te vinden. Succes met {{company}}!',
        'Mocht het ooit spelen, dan hoor ik het graag. Veel succes met de zaak!',
      ],
    },
  },

  /** Korte WhatsApp/DM-varianten (max. ~300 tekens). */
  whatsapp: [
    'Hoi! Ik ben Eliyah, ik maak websites voor lokale bedrijven in {{city}}. Ik zag dat {{company}} online nog weinig te vinden is en maakte alvast een idee voor een startpagina. Mag ik dat laten zien?',
    'Hoi! Ik keek naar de website van {{company}}. Eén ding valt op: {{tip}} Dat is meestal snel te verbeteren. Zal ik je een gratis voorbeeld sturen?',
  ],

  /** Belscript van ongeveer 30 seconden. */
  callScript: `Goedemiddag, u spreekt met {{sender}} van {{senderCompany}}, ik maak websites voor lokale bedrijven in {{city}}.
Ik bel omdat ik zag dat {{company}} online nog niet zo goed te vinden is.
Ik heb alvast gekeken wat er beter kan, en dat kost u geen tijd.
Mag ik dat in tien minuten laten zien? Dan belt u me terug op {{phone}} als het u past.`,

  /** Tekst voor een postkaart (voor bedrijven waar je niet mag mailen). */
  postcard: `Beste {{company}},

Ik liep online tegen uw bedrijf aan: {{problem}}
Ik maak websites voor lokale bedrijven in {{city}} en heb alvast gekeken wat er beter kan.

Mag ik u tien minuten bellen? U kunt me ook bereiken via {{phone}} of {{website}}.

{{sender}} - {{senderCompany}}`,
};

export default lang;
