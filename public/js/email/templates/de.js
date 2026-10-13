/**
 * public/js/email/templates/de.js
 * ALLE Duitse e-mailteksten op één plek.
 *
 * Bewust geen letterlijke vertaling uit het Nederlands: dit is natuurlijk
 * klinkend zakelijk Duits. Standaard in de Sie-vorm (gebruikelijk in Duitsland),
 * met een du-variant voor informele branches.
 *
 * Variabelen tussen dubbele accolades:
 *   {{company}} {{city}} {{niche}} {{firstName}} {{sender}} {{senderCompany}}
 *   {{phone}} {{website}} {{year}} {{tip}}
 */

export const lang = {
  code: 'de',
  name: 'Duits',
  locale: 'de-DE',

  subjects: [
    'Kurz zur Website von {{company}}',
    'Idee für {{company}} in {{city}}',
    'Frage zu {{company}}',
    '{{company}} online in {{city}}',
    'Neue Website für {{company}}?',
    'Eine kurze Frage von einem Webdesigner',
    '{{company}}: ein Punkt ist mir aufgefallen',
    'Habe mir Ihre Website angesehen',
    'Ein Tipp für {{company}}',
  ],

  problems: {
    noWebsite: [
      'Bei der Suche nach {{niche}} in {{city}} finde ich {{company}} nur bei Google Maps, ohne eigene Website. Wer sich vorher informieren möchte, landet nirgendwo.',
      'Ich finde keine Website zu {{company}}. Kundinnen und Kunden, die sich vor dem Anruf informieren wollen, springen dadurch ab.',
      'Ohne eigene Website sind Sie für Neukunden in {{city}} nur über Maps zu finden - Wettbewerber mit Website stehen weiter oben.',
    ],
    notMobile: [
      'Auf dem Handy ist die Website von {{company}} kaum lesbar: Besucher müssen zoomen und steigen dann aus.',
      'Die meisten suchen mobil, aber die Seite passt sich nicht an die Bildschirmgröße an.',
    ],
    noHttps: [
      'Die Seite läuft nicht über HTTPS, daher zeigt der Browser Besuchern eine Warnung.',
      'Ohne HTTPS erscheint vor dem Inhalt eine Sicherheitswarnung - das kostet Vertrauen.',
    ],
    outdated: [
      'Die Seite wirkt einige Jahre alt: © {{year}} im Fußbereich und Tabellen-Layout statt eines modernen Aufbaus.',
      'Technisch ist die Seite nicht mehr auf dem aktuellen Stand, was auch die Sichtbarkeit bei Google kostet.',
    ],
    noBooking: [
      'Auf der Seite kann man nicht online reservieren oder einen Termin buchen - alles läuft über das Telefon.',
      'Es fehlt ein Buchungsbutton. Wer außerhalb der Öffnungszeiten sucht, kann nichts hinterlassen.',
    ],
    noContactForm: [
      'Es gibt kein Kontaktformular, Besucher müssen selbst herausfinden, wie sie Sie erreichen.',
      'Auf der Seite fehlt eine einfache Möglichkeit, eine kurze Frage zu hinterlassen.',
    ],
    slow: [
      'Die Seite lädt langsam, und ein Teil der Besucher springt ab, bevor überhaupt etwas zu sehen ist.',
      'Die Seite ist relativ schwer und lädt gerade mobil nur zäh.',
    ],
    noSeo: [
      'Es fehlen Titel und Beschreibung, dadurch weiß Google nicht, wann {{company}} angezeigt werden soll.',
      'In den Suchergebnissen fehlen die Informationen, die Google für eine ordentliche Darstellung braucht.',
    ],
    lowReviews: [
      'Online sind bisher wenige Bewertungen zu finden - dabei ist die Arbeit, die Sie machen, genau das, was neue Kunden überzeugt.',
      'Mit wenigen Bewertungen bei Google ist es schwer, sich gegen die Konkurrenz um die Ecke durchzusetzen.',
    ],
    generic: [
      'Ich habe nach {{niche}} in {{city}} gesucht und bin dabei auf {{company}} gestoßen. Online gibt es bei Ihnen noch Luft nach oben.',
      'Ich habe mir angesehen, wie {{company}} in {{city}} online zu finden ist - und dabei einige Punkte entdeckt, die Kunden kosten.',
    ],
  },

  valueProps: [
    'Ich erstelle schnelle, mobil optimierte Websites für lokale Betriebe, in {{city}} und Umgebung.',
    'Ich baue Seiten, auf denen Kunden direkt anrufen, buchen oder eine Nachricht hinterlassen können.',
    'Eine übersichtliche Website, die zeigt, was {{company}} macht - mit Bewertungen, Öffnungszeiten und klaren Buttons.',
    'Ich sorge dafür, dass Sie nicht nur eine gepflegte Seite haben, sondern bei der Suche nach {{niche}} in {{city}} auch gefunden werden.',
  ],

  ctas: {
    formeel: [
      'Hätten Sie 10 Minuten für ein kurzes Telefonat? Dann erkläre ich, was ich ändern würde.',
      'Darf ich Ihnen unverbindlich einen Entwurf für Ihre Startseite erstellen? Dann sehen Sie direkt, was ich meine.',
      'Haben Sie diese Woche 10 Minuten? Ich gehe die Seite gerne kurz mit Ihnen durch.',
      'Wenn es für Sie interessant klingt, zeige ich Ihnen gerne unverbindlich, was besser laufen könnte.',
      'Ich kann Ihnen einen kostenlosen Entwurf der Startseite schicken - ganz unverbindlich.',
      'Ein kurzes Gespräch von 10 Minuten reicht, um zu sehen, ob das für Sie passt.',
    ],
    informeel: [
      'Hast du 10 Minuten für einen kurzen Anruf? Dann sage ich dir, was ich anders machen würde.',
      'Darf ich dir unverbindlich einen Entwurf für deine Startseite machen? Dann siehst du direkt, was ich meine.',
      'Hast du diese Woche 10 Minuten? Ich gehe die Seite gerne kurz mit dir durch.',
      'Wenn du magst, zeige ich dir unverbindlich, was besser laufen könnte.',
      'Ich schicke dir gerne einen kostenlosen Entwurf der Startseite - ganz unverbindlich.',
      'Ein kurzes Gespräch von 10 Minuten reicht, um zu sehen, ob das für dich passt.',
    ],
  },

  closings: {
    formeel: ['Ich freue mich über Ihre Rückmeldung.', 'Sagen Sie mir gerne, ob das für Sie sinnvoll klingt.', 'Kein Stress - ich freue mich über eine kurze Antwort.'],
    informeel: ['Ich freue mich über deine Rückmeldung.', 'Sag mir gerne, ob das für dich sinnvoll klingt.', 'Kein Stress - ich freue mich über eine kurze Antwort.'],
  },

  optOut: {
    formeel: 'Kein Interesse? Schreiben Sie mir kurz, dann melde ich mich nicht wieder.',
    informeel: 'Kein Interesse? Schreib mir kurz, dann melde ich mich nicht wieder.',
  },

  signature: {
    formeel: 'Mit freundlichen Grüßen\n{{sender}}\n{{senderCompany}}\n{{phone}}\n{{website}}',
    informeel: 'Viele Grüße\n{{sender}}\n{{senderCompany}}\n{{phone}}\n{{website}}',
  },

  followUps: {
    followup1: {
      subjects: ['Kurze Nachfrage zu {{company}}', 'Haben Sie meine Mail gesehen?', 'Kurz zu meiner letzten Mail'],
      openings: [
        'letzte Woche hatte ich Ihnen kurz zur Website von {{company}} geschrieben.',
        'Ich weiß, dass es gerade viel ist - deshalb ganz kurz: ich hatte Ihnen zur Website von {{company}} geschrieben.',
        'Vielleicht ist meine letzte Mail untergegangen.',
      ],
      bodies: [
        'Falls das Thema gerade nicht passt, ist das völlig in Ordnung - sagen Sie einfach kurz Bescheid.',
        'Wenn es im Moment keine Priorität hat, ist das kein Problem. Eine kurze Rückmeldung genügt.',
        'Es eilt nicht: ich würde mich freuen zu hören, ob ein Gespräch für Sie sinnvoll wäre.',
      ],
    },
    followup2: {
      subjects: ['Noch ein Tipp für {{company}}', 'Eine Kleinigkeit, die helfen könnte'],
      openings: [
        'Ein konkreter Tipp, auch wenn Sie mit meinem Angebot nichts zu tun haben wollen:',
        'Ich habe mir die Seite von {{company}} noch einmal angesehen.',
      ],
      bodies: [
        'Sorgen Sie dafür, dass Öffnungszeiten und Telefonnummer auf jeder Seite sichtbar sind - für lokale Betriebe ist das meist der schnellste Gewinn. Ergänzend: {{tip}}',
        'Zeigen Sie Ihre Google-Bewertungen direkt auf der Website. Besucher entscheiden schneller, wenn sie sehen, wie andere {{company}} bewerten. Ergänzend: {{tip}}',
      ],
    },
    laatste: {
      subjects: ['Letzte Nachricht zu {{company}}', 'Ich lasse es dabei'],
      openings: [
        'Ich möchte Sie nicht weiter zumailen, deshalb ist das meine letzte Nachricht.',
        'Das ist meine letzte Mail zu diesem Thema, versprochen.',
      ],
      bodies: [
        'Wenn Sie später eine neue Website brauchen, wissen Sie, wo Sie mich finden. Viel Erfolg mit {{company}}!',
        'Falls es irgendwann aktuell wird, melden Sie sich gerne. Weiterhin viel Erfolg!',
      ],
    },
  },

  whatsapp: [
    'Guten Tag! Ich bin Eliyah und erstelle Websites für lokale Betriebe in {{city}}. Mir ist aufgefallen, dass {{company}} online noch schwer zu finden ist - ich habe schon eine Idee für eine Startseite. Darf ich sie zeigen?',
    'Guten Tag! Ich habe mir die Website von {{company}} angesehen. Ein Punkt fällt auf: {{tip}} Das lässt sich meist schnell verbessern. Soll ich Ihnen einen kostenlosen Entwurf schicken?',
  ],

  callScript: `Guten Tag, hier spricht {{sender}} von {{senderCompany}}, ich erstelle Websites für lokale Betriebe in {{city}}.
Ich rufe an, weil {{company}} online noch nicht so gut zu finden ist.
Ich habe mir schon angesehen, was sich verbessern lässt - das kostet Sie keine Zeit.
Darf ich Ihnen das in zehn Minuten zeigen? Sie erreichen mich sonst auch unter {{phone}}.`,

  postcard: `Sehr geehrte Damen und Herren,

bei einer Recherche bin ich auf Ihr Unternehmen gestoßen: {{problem}}
Ich erstelle Websites für lokale Betriebe in {{city}} und habe mir bereits angesehen, was sich verbessern lässt.

Darf ich Sie zehn Minuten anrufen? Sie erreichen mich auch unter {{phone}} oder {{website}}.

{{sender}} - {{senderCompany}}`,
};

export default lang;
