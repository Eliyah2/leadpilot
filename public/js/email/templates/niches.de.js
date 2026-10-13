/**
 * public/js/email/templates/niches.de.js
 * Eröffnungssätze und Tipps pro Branche - natürliches Geschäftsdeutsch,
 * keine wörtliche Übersetzung aus dem Niederländischen.
 */

export const openings = {
  kapper: {
    label: 'Friseur / Barbershop',
    lines: [
      'Bei der Suche nach einem Friseur in {{city}} schauen die meisten zuerst online: Zeiten, Preise, Termine.',
      'Ich habe mir {{company}} angesehen: neue Kunden erfahren online wenig über Ihren Salon.',
      'Ein voller Terminkalender ist für einen Friseurbetrieb alles, und der beginnt heute oft online.',
      'Mir ist aufgefallen, dass {{company}} gut bewertet ist, die Website das aber nicht zeigt.',
      'Wer einen Friseur sucht, möchte Termine möglichst direkt online buchen.',
      'Bei {{company}} in {{city}} sehe ich online noch deutliches Potenzial.',
    ],
    tips: [
      'stellen Sie Öffnungszeiten und einen "Jetzt anrufen"-Button auf jeder Seite ganz nach oben.',
      'zeigen Sie ein paar Ergebnisse: ein Foto einer Frisur überzeugt mehr als jeder Text.',
    ],
  },

  beauty: {
    label: 'Kosmetik & Pflege',
    lines: [
      'Für ein Studio in {{city}} beginnt eine neue Kundin meistens mit einem Blick ins Netz.',
      'Ich habe mir {{company}} angesehen: Behandlungen und Preise sind online schwer zu finden.',
      'Wer eine Behandlung buchen möchte, will das am liebsten sofort erledigen können.',
      'Behandlungen verkaufen sich über Bilder, und genau das sehe ich bei {{company}} noch zu wenig.',
      '{{company}} hat gute Bewertungen, aber die Website erzählt diese Geschichte nicht weiter.',
      'In der Beauty-Branche dreht sich alles um Vertrauen: eine gepflegte Website leistet dabei die halbe Arbeit.',
    ],
    tips: [
      'listen Sie Behandlungen mit Preis und Dauer übersichtlich auf, das spart viele Telefonate.',
      'zeigen Sie Google-Bewertungen direkt auf der Website, das nimmt Besuchern die Zweifel.',
    ],
  },

  horeca: {
    label: 'Gastronomie',
    lines: [
      'Restaurants in {{city}} werden heute zuerst online gefunden: Speisekarte, Fotos und ein Tisch, der direkt buchbar ist.',
      'Ich habe mir {{company}} angesehen: die Karte ist da, aber online reservieren kann man nicht.',
      'Wer in {{city}} essen gehen möchte, sucht am Handy und wählt meistens das Lokal mit der klarsten Seite.',
      'Bei {{company}} ist mir aufgefallen, dass die Bewertungen gut sind, die Website damit aber nichts anfängt.',
      'Ein Gast, der außerhalb der Öffnungszeiten reservieren möchte, muss warten, bis er anrufen kann.',
      'Ich bin als Gast auf die Website von {{company}} gestoßen und dachte: da geht mehr.',
    ],
    tips: [
      'stellen Sie die Speisekarte als lesbare Seite online, statt als PDF - das spart mobil viel Ärger.',
      'ein Reservierungsbutton auf jeder Seite bringt meist mehr Tische als eine Telefonnummer allein.',
    ],
  },

  bakkerij: {
    label: 'Bäckerei / Handwerk',
    lines: [
      'Eine Bäckerei in {{city}} lebt von Stammkunden, und neue Kunden suchen zuerst am Handy.',
      'Ich habe {{company}} in den Suchergebnissen gesehen, aber wenig zu Öffnungszeiten und Sortiment gefunden.',
      'Für Bestellungen wie Torten und Platten ist ein Online-Formular eigentlich unverzichtbar.',
      'Bei {{company}} fällt auf, dass das Handwerk online weniger sichtbar ist, als es verdient.',
      'Wer eine Torte fürs Wochenende bestellen will, möchte das abends anfragen - nicht erst bei Ladenöffnung.',
      'Ich habe mir angesehen, wie {{company}} in {{city}} online auftritt: da steckt mehr drin.',
    ],
    tips: [
      'stellen Sie die Bestellmöglichkeit für Torten gut sichtbar online, mit Angabe der Vorlaufzeit.',
      'zeigen Sie, was täglich frisch entsteht - das zieht mehr neue Kunden als ein Logo allein.',
    ],
  },

  bouw: {
    label: 'Bau & Ausbau',
    lines: [
      'Für einen Baubetrieb in {{city}} kommen Aufträge oft aus der Nachbarschaft, und der erste Eindruck ist online.',
      'Ich habe mir {{company}} angesehen: Fotos von Projekten zeigen Ihre Arbeit viel besser als ein langer Text.',
      'Bei einer Sanierung schauen Interessenten zuerst auf frühere Projekte und Bewertungen.',
      'Mir ist bei {{company}} aufgefallen: die Seite zeigt nicht sofort, welche Arbeiten Sie übernehmen.',
      'Eine Anfrage für einen Umbau kommt oft nach Feierabend, wenn jemand in Ruhe schauen kann.',
      'Handwerksbetriebe werden online gesucht: eine klare Seite mit Projektfotos bringt mehr Anfragen.',
    ],
    tips: [
      'stellen Sie drei aktuelle Projekte mit Vorher-Nachher-Foto online, das überzeugt schneller als eine Preisliste.',
      'bitten Sie jeden zufriedenen Kunden um eine Google-Bewertung; bei größeren Aufträgen zählt das stark.',
    ],
  },

  installatie: {
    label: 'Installation & Technik',
    lines: [
      'Bei einem Notfall suchen Menschen in {{city}} den ersten Handwerker, der zuverlässig wirkt.',
      'Ich habe mir {{company}} angesehen: wer eine Störung hat, will mit einem Klick Telefonnummer und Ablauf sehen.',
      'Für Installateure ist das Vertrauen einer ordentlichen Website fast so wichtig wie die Arbeit selbst.',
      'Bei {{company}} fällt auf, dass es keinen klaren Button für Anfrage oder Angebot gibt.',
      'Eine Störung richtet sich nicht nach Bürozeiten: Kunden suchen abends und am Wochenende.',
      'Ich habe {{company}} in der Region {{city}} gesehen - mit einer stärkeren Seite kommt mehr Arbeit rein.',
    ],
    tips: [
      'nennen Sie Einsatzgebiet und Reaktionszeit auf der Seite, danach wählen Kunden im Notfall aus.',
      'ein Angebotsformular mit wenigen gezielten Fragen spart Ihnen viel Hin und Her am Telefon.',
    ],
  },

  schoonmaak: {
    label: 'Reinigung',
    lines: [
      'Für ein Reinigungsunternehmen in {{city}} entscheiden Auftraggeber oft anhand einer klaren Website mit Preisen.',
      'Ich habe mir {{company}} angesehen: es ist nicht sofort klar, ob Sie auch Geschäftskunden betreuen.',
      'Ein Angebot fragen Auftraggeber am liebsten online an, außerhalb der Bürozeiten.',
      'Bei {{company}} fehlt ein klarer Weg zum Angebot.',
      'Reinigung ist Vertrauenssache: eine gepflegte Website hilft beim ersten Eindruck enorm.',
      'Ich habe {{company}} aus {{city}} gefunden; online lässt sich der Betrieb klarer positionieren.',
    ],
    tips: [
      'trennen Sie private und gewerbliche Reinigung, das zieht sofort die passenden Anfragen an.',
      'nennen Sie einen Richtwert oder Startpreis; das filtert Zweifler vorab heraus.',
    ],
  },

  gezondheid: {
    label: 'Gesundheitswesen',
    lines: [
      'Patienten wählen eine Praxis oft online: Öffnungszeiten, Behandlungen und ob sie schnell einen Termin bekommen.',
      'Ich habe mir {{company}} angesehen: eine Online-Terminvergabe spart der Praxis täglich viele Telefonate.',
      'Für eine Praxis in {{city}} ist eine ruhige, klare Website der erste Kontakt zu neuen Patienten.',
      'Bei {{company}} fällt auf, dass Informationen zu Behandlungen und Abrechnung schwer zu finden sind.',
      'Wer Beschwerden hat, sucht abends und möchte sofort anfragen statt erst am nächsten Tag anzurufen.',
      '{{company}} ist gut bewertet, aber die Website strahlt dieses Vertrauen nicht aus.',
    ],
    tips: [
      'stellen Sie häufige Fragen zu Abrechnung und Kasse online, das entlastet die Anmeldung.',
      'ein Terminformular, das auch außerhalb der Öffnungszeiten funktioniert, füllt den Kalender ohne Extra-Telefonate.',
    ],
  },

  auto: {
    label: 'Auto & Werkstatt',
    lines: [
      'Für eine Werkstatt in {{city}} ist ein Online-Termin für Service oder HU oft der erste Schritt eines neuen Kunden.',
      'Ich habe mir {{company}} angesehen: wer ein Angebot für eine Reparatur braucht, findet kein klares Formular.',
      'In Autohäusern ist das Telefon oft der einzige Weg, während Kunden lieber online anfragen.',
      'Bei {{company}} fällt auf, dass die Seite nicht zeigt, worauf Sie spezialisiert sind.',
      'Wer eine Panne hat, sucht in {{city}} eine Werkstatt, die schnell und verlässlich wirkt.',
      'Ich habe {{company}} in der Region gesehen; online ist da mehr herauszuholen.',
    ],
    tips: [
      'stellen Sie ein Terminformular für HU und Service online, mit einer klaren Wartezeit.',
      'zeigen Sie Marken und Schwerpunkte; Kunden suchen nach Marke und Art der Arbeit.',
    ],
  },

  vervoer: {
    label: 'Transport & Taxi',
    lines: [
      'Für ein Taxiunternehmen in {{city}} ist Online-Sichtbarkeit wichtig: gebucht wird meist kurzfristig.',
      'Ich habe mir {{company}} angesehen: eine Fahrt lässt sich nur telefonisch anfragen.',
      'Wer ein Taxi sucht, sucht am Handy und nimmt den ersten Anbieter, der verlässlich wirkt.',
      'Bei {{company}} fällt auf, dass Preise und Ablauf online nicht sofort klar sind.',
      'Stammfahrten entstehen oft aus Wiederholungen, und dabei hilft eine eigene Website.',
      'Ich habe {{company}} in {{city}} gefunden; eine eigene Seite macht unabhängiger von Plattformen mit Provision.',
    ],
    tips: [
      'nennen Sie Festpreise für häufige Fahrten online, das spart Telefonate und schafft Vertrauen.',
      'ein Anfrageformular mit Datum und Uhrzeit füllt Ihre Planung ohne zusätzliche Arbeit.',
    ],
  },

  fotografie: {
    label: 'Fotografie',
    lines: [
      'Bei einem Fotografen in {{city}} beginnt die Entscheidung beim Werk selbst: ein Portfolio, das online gut anzusehen ist.',
      'Ich habe mir {{company}} angesehen: die Arbeit ist stark, aber auf der Website kommt sie nicht zur Geltung.',
      'Wer einen Fotografen sucht, möchte Stimmung, Preise und Verfügbarkeit auf einen Blick sehen.',
      'Bei {{company}} fehlt ein klarer Weg, um ein Shooting anzufragen.',
      '{{company}} ist online zu finden; eine ruhige Seite mit großen Bildern verkauft Ihr Werk besser.',
      'Ein Fotograf verkauft Stimmung - und das beginnt mit einer Website, die selbst schön ist.',
    ],
    tips: [
      'zeigen Sie pro Paket einen Richtpreis, das erspart viele Anfragen, die nicht passen.',
      'komprimieren Sie die Bilder vor dem Upload, das spart Ladezeit und mobile Besucher.',
    ],
  },

  fitness: {
    label: 'Sport & Fitness',
    lines: [
      'Für ein Studio oder einen Trainer in {{city}} läuft der erste Kontakt meist online: Probetraining anfragen, Preise ansehen.',
      'Ich habe mir {{company}} angesehen: wer ein Probetraining möchte, findet keine einfache Anmeldung.',
      'Menschen, die trainieren wollen, suchen am Handy nach etwas, das zu ihnen passt.',
      'Bei {{company}} fällt auf, dass das Angebot online nicht klar hervortritt.',
      'Ein kostenloses Probetraining ist das beste Verkaufsargument - wenn man es einfach anfragen kann.',
      'Ich habe {{company}} aus {{city}} gesehen und gedacht: mit einer schärferen Seite kommen mehr Mitglieder.',
    ],
    tips: [
      'stellen Sie Preise und Vertragsformen online, das spart Fragen und zieht ernsthaftere Mitglieder an.',
      'bieten Sie ein Probetraining über ein kurzes Formular an; so wächst der Mitgliederstand von selbst.',
    ],
  },

  dieren: {
    label: 'Tiere',
    lines: [
      'Tierhalter suchen eine Praxis in {{city}} oft kurzfristig und wählen die, die sofort vertrauenswürdig wirkt.',
      'Ich habe mir {{company}} angesehen: Notfall-Infos und Öffnungszeiten sind online nicht direkt zu finden.',
      'Eine Online-Terminanfrage ist für Halter mit krankem Tier eine große Erleichterung.',
      'Bei {{company}} fehlt ein klarer Weg für Termin oder Rückfrage.',
      'Wer sich um sein Tier sorgt, möchte sofort anrufen oder anfragen können - rund um die Uhr.',
      '{{company}} ist online zu finden; klare Notfall-Infos ersparen Tierhaltern viel Stress.',
    ],
    tips: [
      'stellen Sie Notfallweg und Öffnungszeiten ganz oben auf die Seite - das ist für Tierhalter das Wichtigste.',
      'ein Terminformular mit Auswahl der Behandlung spart der Anmeldung täglich Telefonate.',
    ],
  },

  overig: {
    label: 'Sonstiges / allgemein',
    lines: [
      'Ich habe nach {{niche}} in {{city}} gesucht und bin auf {{company}} gestoßen; dabei ist mir online etwas aufgefallen.',
      'Unternehmen in {{city}} bekommen ihren ersten Eindruck oft online, und bei {{company}} geht das schärfer.',
      'Ich habe mir den Online-Auftritt von {{company}} in {{city}} angesehen und konkrete Verbesserungen gefunden.',
      'Bei {{company}} fällt auf, dass neue Kunden online wenig über den Betrieb erfahren.',
      'Ich bin als Kunde auf die Website von {{company}} gestoßen und dachte: da steckt mehr drin.',
      'Für einen Betrieb wie {{company}} in {{city}} ist online gefunden zu werden heute die halbe Miete.',
    ],
    tips: [
      'achten Sie darauf, dass Öffnungszeiten, Telefonnummer und Einsatzgebiet auf jeder Seite stehen.',
      'bitten Sie zufriedene Kunden um eine Google-Bewertung; für lokale Sichtbarkeit ist das am wertvollsten.',
    ],
  },
};

export default openings;
