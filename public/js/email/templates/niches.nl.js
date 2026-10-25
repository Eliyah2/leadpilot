/**
 * public/js/email/templates/niches.nl.js
 * Openingszinnen en tips per niche-categorie.
 *
 * Per categorie staan er 6 openingszinnen. De engine kiest er één op basis van
 * het bedrijf (rotatie per lead, zie ../engine.js), zodat dezelfde zin niet
 * telkens terugkomt. De `tips` worden gebruikt in de tweede follow-up als
 * concrete, gratis tip - dat maakt de mail waardevol in plaats van opdringerig.
 *
 * Nieuwe categorie toevoegen? Zet hier dezelfde sleutel neer als in
 * public/js/config/niches.js (CATEGORY_LABELS).
 */

export const openings = {
  kapper: {
    label: 'Kapper / barbershop',
    lines: [
      'Ik liep langs de site van {{company}} en dacht: dit verdient meer dan een kaal kaartje op Google.',
      'Voor een kapsalon in {{city}} is een volle stoel het belangrijkste, en die agenda begint steeds vaker online.',
      'Ik zag {{company}} tussen de kappers in {{city}} staan, met een website die niet meer van deze tijd is.',
      'Wie vandaag een kapper zoekt, kijkt eerst online: openingstijden, prijzen en een indruk van het resultaat.',
      'Bij {{company}} viel me op dat nieuwe klanten online weinig van jullie zaak kunnen zien.',
      'Kappers die online goed staan, trekken klanten aan die bewust voor kwaliteit kiezen - daar hoort {{company}} bij.',
    ],
    tips: [
      'zet je openingstijden en een "nu bellen"-knop bovenaan op elke pagina.',
      'laat een paar resultaten zien: een foto van een coupe verkoopt beter dan welke tekst dan ook.',
    ],
  },

  beauty: {
    label: 'Beauty & verzorging',
    lines: [
      'Voor een salon in {{city}} begint een nieuwe klant meestal met een blik online.',
      'Ik keek naar {{company}}: behandelingen en prijzen zijn online lastig te vinden.',
      'Wie een behandeling wil boeken, wil dat het liefst meteen kunnen regelen.',
      'Behandelingen verkopen zichzelf met beeld, en juist dat zie ik nog weinig terug bij {{company}}.',
      'Ik zag dat {{company}} mooie reviews heeft, maar dat de website dat verhaal niet doorvertelt.',
      'In de beautybranche draait alles om vertrouwen: een verzorgde site doet daarin het halve werk.',
    ],
    tips: [
      'zet je behandelingen met prijs en duur in een overzichtelijke lijst, dat scheelt veel telefoontjes.',
      'laat Google-reviews op de site zelf zien; bezoekers twijfelen dan minder.',
    ],
  },

  horeca: {
    label: 'Horeca',
    lines: [
      'Restaurants in {{city}} worden vandaag eerst online gevonden: menu, foto\'s en een tafel die direct te boeken is.',
      'Ik keek naar {{company}}: de kaart staat er wel, maar gasten kunnen niet online reserveren.',
      'Wie in {{city}} zin heeft in eten, zoekt op de telefoon en kiest meestal de zaak met de duidelijkste site.',
      'Bij {{company}} viel me op dat de reviews goed zijn, maar dat de site daar niets mee doet.',
      'Een gast die buiten openingstijden wil reserveren, moet nu wachten tot hij kan bellen.',
      'Ik liep als bezoeker tegen de site van {{company}} aan en dacht: hier kan meer uit worden gehaald.',
    ],
    tips: [
      'zet het menu als leesbare pagina online in plaats van als pdf, dat scheelt bezoekers op mobiel een hoop gedoe.',
      'een reserveringsknop op elke pagina levert vaak meer tafels op dan een los telefoonnummer.',
    ],
  },

  bakkerij: {
    label: 'Bakkerij / ambachtelijk voedsel',
    lines: [
      'Een bakkerij in {{city}} leeft van vaste klanten, en nieuwe klanten zoeken eerst op hun telefoon.',
      'Ik zag {{company}} in de zoekresultaten, maar vond weinig over openingstijden en assortiment.',
      'Voor bestellingen zoals taarten en traktaties is een online formulier eigenlijk onmisbaar.',
      'Bij {{company}} valt op dat de zaak online minder te zien is dan het vakmanschap verdient.',
      'Wie een taart voor het weekend wil bestellen, wil dat \'s avonds kunnen aanvragen en niet pas bij opening.',
      'Ik keek naar de online aanwezigheid van {{company}} in {{city}}: daar zit meer in.',
    ],
    tips: [
      'zet je bestelmogelijkheid voor taarten duidelijk op de site, met een levertijd erbij.',
      'laat zien wat je dagelijks vers maakt; dat trekt meer nieuwe klanten dan een logo alleen.',
    ],
  },

  bouw: {
    label: 'Bouw & afbouw',
    lines: [
      'Voor een bouwbedrijf in {{city}} komen opdrachten vaak uit de buurt, en de eerste indruk is online.',
      'Ik keek naar {{company}}: foto\'s van projecten laten je werk veel beter zien dan een lange tekst.',
      'Bij een verbouwing kijkt men eerst naar eerdere projecten en reviews.',
      'Wat me opviel bij {{company}}: de site laat niet meteen zien wat voor klussen jullie doen.',
      'Een aanvraag voor een verbouwing komt vaak na werktijd, als iemand rustig kan kijken.',
      'Vakmensen worden online gezocht: een heldere site met projectfoto\'s levert meer aanvragen op.',
    ],
    tips: [
      'zet drie recente projecten met een foto voor en na op de site, dat overtuigt sneller dan een prijslijst.',
      'vraag elke tevreden klant om een Google-review; dat weegt zwaar bij grote opdrachten.',
    ],
  },

  installatie: {
    label: 'Installatie & techniek',
    lines: [
      'Bij spoed zoeken mensen in {{city}} de eerste vakman die betrouwbaar overkomt.',
      'Ik keek naar {{company}}: wie een storing heeft, wil in één klik een telefoonnummer en een duidelijke werkwijze zien.',
      'Voor installateurs is het vertrouwen van een nette site bijna net zo belangrijk als het werk zelf.',
      'Bij {{company}} viel me op dat er geen duidelijke knop voor een aanvraag of offerte op de site staat.',
      'Een storing kiest geen kantooruren: klanten zoeken \'s avonds en in het weekend.',
      'Ik zag {{company}} in de regio {{city}} - met een sterkere site komt daar meer werk uit.',
    ],
    tips: [
      'zet je werkgebied en reactietijd op de site, daar kiezen mensen op bij spoed.',
      'een offerteformulier met een paar gerichte vragen bespaart je veel heen-en-weer gebel.',
    ],
  },

  schoonmaak: {
    label: 'Schoonmaak',
    lines: [
      'Voor een schoonmaakbedrijf in {{city}} kiezen opdrachtgevers vaak op basis van een heldere site met tarieven.',
      'Ik keek naar {{company}}: het is niet meteen duidelijk of jullie ook zakelijke klanten bedienen.',
      'Een offerte vraagt een opdrachtgever het liefst online aan, buiten kantooruren.',
      'Bij {{company}} valt op dat er geen duidelijke route is naar een prijsopgave.',
      'Schoonmaken is een kwestie van vertrouwen: een verzorgde site helpt enorm bij die eerste indruk.',
      'Ik zag {{company}} in {{city}}; online kan de zaak scherper neergezet worden.',
    ],
    tips: [
      'maak onderscheid tussen particuliere en zakelijke schoonmaak, dat trekt meteen de juiste aanvragen aan.',
      'noem een indicatieprijs of een starttarief; dat filtert twijfelaars er vooraf uit.',
    ],
  },

  gezondheid: {
    label: 'Gezondheidszorg',
    lines: [
      'Patiënten kiezen een praktijk vaak online: openingstijden, behandeling en of ze snel een afspraak kunnen maken.',
      'Ik keek naar {{company}}: een online afspraakmogelijkheid scheelt de praktijk elke dag telefoontjes.',
      'Voor een praktijk in {{city}} is een rustige, duidelijke website de eerste kennismaking met nieuwe patiënten.',
      'Bij {{company}} viel me op dat informatie over behandelingen en vergoedingen lastig te vinden is.',
      'Wie klachten heeft, zoekt \'s avonds en wil meteen kunnen aanvragen in plaats van de volgende dag bellen.',
      'Ik zag dat {{company}} goed beoordeeld is, maar dat de site dat vertrouwen niet meteen uitstraalt.',
    ],
    tips: [
      'zet veelgestelde vragen over vergoeding en verzekering op de site; dat scheelt de balie veel tijd.',
      'een online afspraakformulier dat buiten openingstijden werkt, vult je agenda zonder extra telefoontjes.',
    ],
  },

  auto: {
    label: 'Auto & garage',
    lines: [
      'Voor een garage in {{city}} is een online afspraak voor onderhoud of APK vaak de eerste stap van een nieuwe klant.',
      'Ik keek naar {{company}}: wie een prijsopgave wil voor een reparatie, vindt geen duidelijk formulier.',
      'Bij autobedrijven is de telefoon vaak de enige route, terwijl klanten liever online aanvragen.',
      'Bij {{company}} valt op dat de site niet laat zien waar jullie in gespecialiseerd zijn.',
      'Iemand met pech zoekt in {{city}} een garage die snel en betrouwbaar overkomt.',
      'Ik zag {{company}} in de regio staan; online is daar meer uit te halen.',
    ],
    tips: [
      'zet een afsprakenformulier voor APK en onderhoud online, met een duidelijke wachttijd erbij.',
      'laat merken en specialismen zien; klanten zoeken op merk en type werk.',
    ],
  },

  vervoer: {
    label: 'Vervoer & taxi',
    lines: [
      'Voor een taxibedrijf in {{city}} is online vindbaar zijn belangrijk: mensen boeken op het laatste moment.',
      'Ik keek naar {{company}}: een rit aanvragen gaat nu alleen via de telefoon.',
      'Wie een taxi zoekt, zoekt op de telefoon en kiest de eerste die betrouwbaar en helder overkomt.',
      'Bij {{company}} viel me op dat tarieven en werkwijze online niet meteen duidelijk zijn.',
      'Vaste ritten komen vaak uit herhaalbezoek, en daar helpt een eigen site bij.',
      'Ik zag {{company}} in {{city}}; een eigen site maakt je minder afhankelijk van platformen die commissie rekenen.',
    ],
    tips: [
      'zet vaste tarieven voor veelgevraagde ritten online, dat scheelt telefoontjes en geeft vertrouwen.',
      'een aanvraagformulier voor een rit op datum en tijd vult je planning zonder extra werk.',
    ],
  },

  fotografie: {
    label: 'Fotografie',
    lines: [
      'Bij een fotograaf in {{city}} begint de keuze bij het werk zelf: een portfolio dat online goed te bekijken is.',
      'Ik keek naar {{company}}: het werk is mooi, maar op de site komt het niet goed tot zijn recht.',
      'Wie een fotograaf zoekt, wil in één oogopslag sfeer, prijzen en beschikbaarheid zien.',
      'Bij {{company}} valt op dat er geen duidelijke route is om een shoot aan te vragen.',
      'Ik zag {{company}} online; een rustige site met grote foto\'s laat je werk beter verkopen.',
      'Een fotograaf verkoopt sfeer, en dat begint met een site die zelf ook mooi is.',
    ],
    tips: [
      'laat per pakket een prijsindicatie zien; dat scheelt veel aanvragen die niet passen.',
      'comprimeer je foto\'s voordat je ze uploadt, dat scheelt seconde laadtijd en bezoekers op mobiel.',
    ],
  },

  fitness: {
    label: 'Sport & fitness',
    lines: [
      'Voor een sportschool of trainer in {{city}} is het eerste contact meestal online: proefles aanvragen en tarieven bekijken.',
      'Ik keek naar {{company}}: wie een proefles wil, vindt geen eenvoudige manier om zich aan te melden.',
      'Mensen die willen sporten, zoeken op hun telefoon naar iets dat bij hen past.',
      'Bij {{company}} viel me op dat het aanbod online niet duidelijk naar voren komt.',
      'Een gratis proefles is het beste verkoopargument, als mensen die makkelijk kunnen aanvragen.',
      'Ik zag {{company}} in {{city}} en dacht: met een scherpe site komen er meer leden bij.',
    ],
    tips: [
      'zet tarieven en abonnementsvormen online, dat scheelt vragen en trekt serieuzere leden aan.',
      'bied een proefles of dagpas aan via een kort formulier; zo groeit je ledenbestand vanzelf.',
    ],
  },

  dieren: {
    label: 'Dieren',
    lines: [
      'Baasjes zoeken een dierenarts in {{city}} vaak op het laatste moment, en kiezen de praktijk die meteen vertrouwd overkomt.',
      'Ik keek naar {{company}}: spoedinformatie en openingstijden zijn online niet direct te vinden.',
      'Een online afspraak aanvragen is een groot gemak voor klanten met een ziek huisdier.',
      'Bij {{company}} valt op dat er geen duidelijke route is voor een afspraak of een vraag.',
      'Wie bezorgd is om zijn dier, wil meteen kunnen bellen of aanvragen, dag en nacht.',
      'Ik zag {{company}} online; heldere spoedinformatie kost klanten minder stress.',
    ],
    tips: [
      'zet een duidelijke spoedroute en openingstijden bovenaan de site, dat is voor baasjes het belangrijkste.',
      'een online afspraakformulier met keuze uit behandeling scheelt de balie dagelijks telefoontjes.',
    ],
  },

  overig: {
    label: 'Overig / algemeen',
    lines: [
      'Ik zocht {{niche}} in {{city}} en kwam bij {{company}} uit; online viel me meteen iets op.',
      'Ondernemers in {{city}} krijgen hun eerste indruk vaak online, en bij {{company}} kan dat scherper.',
      'Ik keek naar de online aanwezigheid van {{company}} in {{city}} en zag een paar concrete verbeterpunten.',
      'Bij {{company}} viel me op dat nieuwe klanten online weinig over de zaak kunnen vinden.',
      'Ik liep als klant tegen de site van {{company}} aan en dacht: hier zit meer in.',
      'Voor een bedrijf als {{company}} in {{city}} is online goed gevonden worden vandaag het halve werk.',
    ],
    tips: [
      'zorg dat je openingstijden, telefoonnummer en werkgebied op elke pagina terugkomen.',
      'vraag tevreden klanten om een Google-review; dat is voor lokale vindbaarheid het meeste waard.',
    ],
  },
};

export default openings;
