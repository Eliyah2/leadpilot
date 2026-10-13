# LeadPilot

Leadgenerator voor **Eliyah Webdesign**. Elke keer dat je op **Nieuwe lead** klikt krijg je een
echt lokaal bedrijf, een analyse van hun online aanwezigheid en een kant-en-klare, persoonlijke
cold e-mail die je direct kunt versturen.

- **Frontend:** vanilla HTML, CSS en JavaScript (ES modules). Geen framework, geen build-stap.
- **Backend:** Vercel serverless functies in `/api` (Node.js 20, ES modules).
- **Opslag:** localStorage (werkt zonder account). Optioneel Redis/KV om tussen apparaten te synchroniseren.
- **Geheimen:** alleen in Vercel Environment Variables. Nooit in de code of in git.

---

## 1. Hoe het werkt

1. **Instellingen** - kies je niche, regio en filter. Vul eenmalig je eigen gegevens in.
2. **Nieuwe lead** - de app zoekt via de Google Places API (New) naar bedrijven die je nog niet
   eerder zag en analyseert de website van het eerste bedrijf dat door je filter komt.
3. **Beoordelen** - je ziet de lead-score met uitleg, de concrete bevindingen van de website-analyse
   en drie verkoopargumenten die bij dít bedrijf passen.
4. **Versturen** - kopieer de mail, open hem in je mailapp of kopieer alleen het onderwerp.
   LeadPilot plant daarna automatisch je follow-up in.

Onderweg houdt de app je pipeline bij (nieuw → gemaild → follow-up → reactie → afspraak → klant),
je dagdoel, je notities en de cijfers in het dashboard.

---

## 2. Bestandsstructuur

```
leadpilot/
├── .env.example                 # voorbeeld van alle environment variables
├── .gitignore                   # houdt .env, .vercel en node_modules buiten git
├── package.json                 # scripts: dev, test, push, deploy
├── vercel.json                  # statische map, security headers, limieten
├── README.md                    # dit bestand
│
├── .github/workflows/check.yml  # controleert elke push (syntax, templates, API)
│
├── api/                         # serverless functies
│   ├── _lib/                    # gedeelde code voor de functies
│   │   ├── audit-core.js        # website-analyse (HTTPS, mobiel, snelheid, veroudering, SEO)
│   │   ├── auth.js              # APP_PASSWORD via header of cookie
│   │   ├── cache.js             # cache 24 uur + optioneel Redis/KV
│   │   ├── config.js            # alle environment variables op één plek
│   │   ├── http.js              # JSON-responses, cookies, SSRF-bescherming
│   │   ├── places.js            # Google Places API (New) met veldmaskers
│   │   └── rate-limit.js        # limiet per minuut en per dag
│   ├── leads.js                 # POST/GET /api/leads
│   ├── audit.js                 # POST/GET /api/audit
│   ├── login.js                 # POST/GET/DELETE /api/login
│   ├── state.js                 # optionele sync /api/state
│   └── health.js                # /api/health (diagnose)
│
├── public/                      # de app zelf (statische bestanden)
│   ├── index.html
│   ├── manifest.webmanifest     # PWA-manifest
│   ├── sw.js                    # service worker (cachet alleen statische bestanden)
│   ├── css/styles.css           # licht + donker thema
│   ├── icons/                   # iconen (svg + gegenereerde png's)
│   └── js/
│       ├── app.js               # start de app: router, thema, toegang, sneltoetsen
│       ├── api.js               # praat met /api
│       ├── store.js             # alle state en acties (leads, statussen, statistieken)
│       ├── storage.js           # opslaglaag (localStorage + optionele sync)
│       ├── csv.js               # CSV importeren/exporteren
│       ├── dom.js               # veilige HTML-helpers (escapet alles standaard)
│       ├── lead-service.js      # zoekopdracht samenstellen, filteren, analyseren
│       ├── scoring.js           # lead-score en verkoopargumenten
│       ├── utils.js             # kleine hulpjes
│       ├── config/
│       │   ├── niches.js        # alle niches met NL/DE zoektermen
│       │   ├── regions.js       # regio's met coördinaten, land en taal
│       │   └── statuses.js      # pipeline-statussen
│       ├── email/
│       │   ├── engine.js        # bouwt de mail op (taal, toon, variant, max. 120 woorden)
│       │   └── templates/
│       │       ├── nl.js        # alle Nederlandse teksten
│       │       ├── de.js        # alle Duitse teksten (Sie-vorm)
│       │       ├── niches.nl.js # 6 openingszinnen + tips per niche (NL)
│       │       └── niches.de.js # 6 openingszinnen + tips per niche (DE)
│       ├── ui/toast.js          # meldingen
│       └── views/               # de schermen
│           ├── lead.js          # nieuwe lead + analyse + mail
│           ├── pipeline.js      # lijst en kanbanbord, notities, tijdlijn
│           ├── reminders.js     # "vandaag opvolgen" + dagdoel
│           ├── dashboard.js     # cijfers per niche, regio en mailvariant
│           ├── settings.js      # instellingen
│           ├── data.js          # import/export/wissen
│           └── avg.js           # regels voor koude acquisitie (NL/DE)
│
└── scripts/
    ├── dev-server.mjs           # lokaal draaien zonder Vercel CLI (npm run dev)
    ├── validate.mjs             # alle controles (npm test)
    ├── make-icons.mjs           # genereert de PWA-iconen
    ├── push.mjs                 # veilig committen en pushen (npm run push)
    └── deploy.mjs               # pushen + vercel --prod (npm run deploy)
```

---

## 3. Lokaal draaien

Je hebt alleen Node 20 of nieuwer nodig. Er zijn **geen dependencies**, dus geen `npm install`.

```bash
npm run dev          # start http://127.0.0.1:4321 (met de echte API-routes)
```

De app werkt meteen in **demo-modus**: zonder Google-sleutel krijg je Google Maps-zoeklinks en kun
je leads via CSV importeren. Alles (pipeline, notities, dashboard) werkt volledig.

Wil je de echte Google-koppeling lokaal testen, maak dan een `.env`-bestand:

```bash
cp .env.example .env      # vul daarna GOOGLE_PLACES_API_KEY in
npm run dev
```

Draaien met dezelfde omgeving als Vercel kan ook:

```bash
npm run dev:vercel        # vereist de Vercel CLI (npm i -g vercel)
```

**Testen:**

```bash
npm test
```

Dit controleert de syntax van alle bestanden, of alle imports bestaan, of de e-mailtemplates
compleet zijn (6+ varianten per niche per taal), of de mails binnen 120 woorden en 50 tekens blijven,
of CSV-import werkt, en of alle API-routes echt antwoorden - inclusief de wachtwoordbeveiliging,
de demo-modus en een echte website-analyse van een verouderde testpagina.

---

## 4. Eenmalig instellen: Google Places API-sleutel

1. Ga naar <https://console.cloud.google.com> en log in met je Google-account.
2. **Nieuw project** aanmaken (bijvoorbeeld `leadpilot`) en dat project selecteren.
3. **Facturering koppelen** (Billing). Google geeft maandelijks een tegoed; zonder facturering
   werkt de Places API niet.
4. Ga naar **APIs & Services → Library**, zoek op **Places API (New)** en klik op **Enable**.
   Let op: het moet de variant **"(New)"** zijn; de oude Places API werkt met dit veldmasker niet.
5. Ga naar **APIs & Services → Credentials → + Create credentials → API key**.
6. Beperk de sleutel meteen:
   - **Application restrictions:** *None* (de sleutel wordt alleen server-side gebruikt).
   - **API restrictions:** *Restrict key* → alleen **Places API (New)**.
7. Kopieer de sleutel. Deze gaat straks in Vercel, niet in de code.

### Kosten laag houden

- De app vraagt met een **veldmasker** alleen de velden op die nodig zijn.
- Zoekresultaten worden **24 uur gecachet** (ook in Redis als je dat koppelt).
- Er geldt een **daglimiet**: standaard 100 zoekopdrachten en 200 website-analyses per dag.
- Website-analyses worden een week bewaard en vragen geen Google-verkeer.
- Pas de limieten aan met `MAX_SEARCHES_PER_DAY` en `MAX_AUDITS_PER_DAY`.

---

## 5. Op GitHub zetten

De map is al een git-repository met een eerste commit. Nog te doen:

```bash
# 1. Inloggen bij GitHub (eenmalig)
gh auth login

# 2. De repository aanmaken en koppelen
gh repo create leadpilot --public --source=. --remote=origin --push

# Lukt dat niet, doe het dan handmatig:
git remote add origin https://github.com/Eliyah2/leadpilot.git
git branch -M main
git push -u origin main
```

Daarna gaat elke wijziging zo naar GitHub:

```bash
npm run push -- "feat: filter op reviews toegevoegd"
```

`npm run push` doet `git add -A` → `git commit` → `git push origin main`, en weigert te pushen als er
per ongeluk een `.env`-bestand in de staging staat. Er wordt **nooit** geforceerd gepusht.

---

## 6. Deployen op Vercel

1. Ga naar <https://vercel.com/new> en log in (bijvoorbeeld met je GitHub-account).
2. **Import Git Repository** → kies **`leadpilot`**. Geef Vercel toegang tot je account als dat nog niet zo is.
3. Instellingen bij het importeren:
   - **Framework Preset:** `Other`
   - **Root Directory:** `./`
   - **Build Command:** leeg laten (de app heeft geen build-stap)
   - **Output Directory:** `public` (staat al in `vercel.json`)
4. Klap **Environment Variables** open en vul in:
   | Naam | Waarde | Verplicht |
   | --- | --- | --- |
   | `GOOGLE_PLACES_API_KEY` | je Google-sleutel | ja, voor echte leads |
   | `APP_PASSWORD` | een zelfgekozen wachtwoord | sterk aanbevolen |
   | `MAX_SEARCHES_PER_DAY` | bijv. `100` | nee |
   | `MAX_AUDITS_PER_DAY` | bijv. `200` | nee |
   | `SEARCH_CACHE_TTL_SECONDS` | bijv. `86400` | nee |
   | `UPSTASH_REDIS_REST_URL` | alleen voor sync | nee |
   | `UPSTASH_REDIS_REST_TOKEN` | alleen voor sync | nee |
5. Klik op **Deploy**. Na ongeveer een halve minuut krijg je je live-URL,
   bijvoorbeeld `https://leadpilot.vercel.app`.
6. **Testen na de deploy:**
   - Open `https://jouw-url.vercel.app/api/health` → je ziet of de sleutel en het wachtwoord
     ingesteld zijn (er worden nooit waarden getoond, alleen "ingesteld" of "ontbreekt").
   - Open de app, log in met je `APP_PASSWORD`, kies niche en regio en klik op **Nieuwe lead**.
   - Verander je later een environment variable, doe dan **Redeploy** (Deployments → ⋯ → Redeploy).

Vanaf nu geldt:

- een push naar **main** → automatisch naar **productie**;
- een push naar een andere branch → een **preview-URL** in Vercel.

**De live-URL van dit project is <https://leadpilot-ten-blush.vercel.app>.**
(Let op: `leadpilot.vercel.app` is van iemand anders, dus die korte naam is niet beschikbaar.)

> **Deployment Protection:** de lange alias `leadpilot-eliyah-impelmans-projects.vercel.app` zit achter
> *Vercel Authentication* (je krijgt dan een inlogscherm van Vercel). Het hoofddomein
> `leadpilot-ten-blush.vercel.app` is gewoon openbaar. Wil je alles openbaar hebben, zet dan in Vercel
> **Settings → Deployment Protection → Vercel Authentication → Disabled**.

Handmatig deployen kan ook (als de Vercel CLI geïnstalleerd en ingelogd is):

```bash
npm run deploy
```

---

## 7. Beveiliging en toegang

Zet altijd `APP_PASSWORD`. Zonder wachtwoord is de app openbaar op internet en kan iedereen je
Google-tegoed opmaken.

- De API accepteert het wachtwoord via de header `x-app-password` of via het HttpOnly-cookie dat
  `/api/login` zet (30 dagen geldig).
- De app vraagt het wachtwoord één keer en bewaart het op je apparaat (uit te zetten in Instellingen).
- Verder: limieten per minuut en per dag, caching, een `same-origin`-controle op alle
  POST-aanvragen en een SSRF-controle op de website-analyse (geen interne adressen).

---

## 8. De lead-score

De score (0-100) is bewust simpel en staat volledig in `public/js/scoring.js`:

| Signaal | Punten |
| --- | --- |
| Geen website | +35 |
| Website in slechte staat (score < 40) | +25 |
| Website kan beter (score 40-70) | +15 |
| Geen mobiele weergave | +8 |
| Geen HTTPS | +6 |
| Geen online afspraak/reservering (in boekingsgevoelige branches) | +6 |
| Verouderde techniek (tabellen, oude jQuery, oud copyright) | +5 |
| Erg weinig reviews (< 10) | +10 |
| Hoge beoordeling (≥ 4,3) = bedrijf dat loopt | +8 |
| Actief volgens Google | +5 |
| Lage beoordeling (< 3,5) of geen telefoonnummer | -8 / -5 |

De app laat bij elke score zien welke regels meetelden. Regels aanpassen? Bewerk `scoring.js`.

---

## 9. Teksten aanpassen (zonder de code te snappen)

Alle teksten staan in losse data-bestanden:

- `public/js/email/templates/nl.js` - Nederlandse onderwerpregels, probleemzinnen, oplossingen,
  call-to-actions, afsluitingen, afmeldregel, follow-ups, WhatsApp, belscript en postkaarttekst.
- `public/js/email/templates/de.js` - hetzelfde in het Duits (Sie-vorm, natuurlijk Duits).
- `public/js/email/templates/niches.nl.js` en `niches.de.js` - per branche 6 openingszinnen en tips.

Variabelen die je in de teksten kunt gebruiken:
`{{company}}`, `{{city}}`, `{{niche}}`, `{{firstName}}`, `{{sender}}`, `{{senderCompany}}`,
`{{phone}}`, `{{website}}`, `{{year}}` en `{{tip}}`.

Draai na elke aanpassing `npm test`: dan weet je zeker dat elke niche nog 6 varianten heeft en dat
de mails binnen de grenzen blijven (max. 120 woorden, onderwerp max. 50 tekens).

**Nieuwe niche toevoegen?** Dat kan ook via de app zelf (Instellingen → *Eigen niche toevoegen*,
met zoekterm in het Nederlands en het Duits). Wil je een hele nieuwe categorie met eigen teksten,
voeg die dan toe in `niches.nl.js`, `niches.de.js` en `config/niches.js` (de test controleert of ze
alle drie compleet zijn).

---

## 10. Data, back-up en synchroniseren

- Alles staat standaard in **localStorage** op het apparaat waar je werkt.
- **Data & AVG → CSV exporteren** voor Excel, **JSON-back-up** voor alles (instellingen + leads + notities).
- Terugzetten doe je met dezelfde knoppen; dubbele leads worden herkend op `place_id`, website en telefoonnummer.
- **Verwijder alle data** wist alles op dit apparaat (voor de AVG).
- Synchroniseren tussen telefoon en laptop: zet in Vercel `UPSTASH_REDIS_REST_URL` en
  `UPSTASH_REDIS_REST_TOKEN` (Vercel KV levert die twee automatisch), zet in de app
  *Synchroniseren* aan en test met de knop in Instellingen. Bij het inschakelen worden je leads
  samengevoegd op basis van de laatste wijziging.

---

## 11. Regels voor koude acquisitie

In de app staat een tabblad **AVG & regels** met een checklist. De kern:

- Gebruik alleen **openbare zakelijke** gegevens. LeadPilot zoekt of raadt nooit een e-mailadres.
- **Nederland:** bij rechtspersonen (BV/NV) mag ongevraagd zakelijk mailen met een duidelijke
  afmeldmogelijkheid; bij eenmanszaken en natuurlijke personen geldt in principe voorafgaande
  toestemming. Respecteer een afmelding altijd en zet zo'n bedrijf op "niet geïnteresseerd".
- **Duitsland:** ongevraagde zakelijke e-mail is in beginsel onrechtmatig (UWG § 7) en het risico op
  een **Abmahnung** met kosten is reëel. Gebruik daar liever het contactformulier, bellen, WhatsApp
  of een postkaart - die teksten staan voor elke lead klaar onder *Extra kanalen*.
- Elke mail eindigt met jouw gegevens en een afmeldregel.

Dit is praktische uitleg en geen juridisch advies.

---

## 12. Sneltoetsen

| Toets | Actie |
| --- | --- |
| `N` | nieuwe lead zoeken |
| `C` | e-mail kopiëren |
| `S` | lead overslaan |

Werken niet terwijl je in een tekstveld staat, zodat typen nooit iets onbedoeld activeert.

---

## 13. Problemen oplossen

| Melding / probleem | Oorzaak en oplossing |
| --- | --- |
| "Geen GOOGLE_PLACES_API_KEY ingesteld" | Je ziet demo-modus. Zet de sleutel in Vercel en redeploy, of gebruik CSV-import. |
| "Google weigert de aanvraag" | Places API (New) staat niet aan, de sleutel is fout, of er zit een HTTP-referrer-beperking op de sleutel. Verwijder die beperking (server-side gebruik). |
| "De daglimiet van 100 zoekopdrachten is bereikt" | Verhoog `MAX_SEARCHES_PER_DAY` of wacht tot morgen (reset om 00:00 UTC). |
| "Dit wachtwoord klopt niet" | Controleer `APP_PASSWORD` in Vercel. Na een wijziging: redeploy en opnieuw inloggen. |
| Website "niet te analyseren" | De site is offline, blokkeert onze User-Agent of reageert niet binnen 10 seconden. De mail valt dan terug op algemene argumenten. |
| Push mislukt met "Authentication failed" | `gh auth login` uitvoeren, daarna `git push origin main`. |
| Push mislukt met "non-fast-forward" | `git pull --rebase origin main` en daarna opnieuw pushen. Er wordt nooit geforceerd. |
| Geen leads uit een zoekopdracht | Deze combinatie is op; kies een andere regio, een ruimere straal of wis de geziene lijst (Instellingen). |
| De app toont "Geen verbinding met de server" | Je gebruikt een statische server in plaats van `npm run dev` of Vercel. De lokale data blijft werken. |

---

## 14. Wat deze versie (nog) niet doet

- Pushberichten of e-mail versturen vanuit de app zelf: versturen doe je via je eigen mailapp.
- Meerdere gebruikers of teams: er is één wachtwoord.
- Google-analytics of cijfers over de bezoekers van je klanten.
- Automatisch een e-mailadres van een bedrijf opzoeken - dat doen we bewust niet (AVG én kwaliteit
  van je afzenderreputatie).

---

## 15. Ideeën voor v2

1. **AI-varianten op maat** - per lead een unieke openingszin laten schrijven op basis van hun
   reviews en website-inhoud, in plaats van de 6 vaste varianten.
2. **Preview-screenshot in de mail** - een visuele mock-up van hun nieuwe homepage meesturen met een
   publieke link, zodat je lead direct resultaat ziet.
3. **Planning en verzending** - mails via een echte provider (bijv. Resend) inplannen, geopend/geklikt
   bijhouden en follow-ups automatisch uitsturen, inclusief afmeldlink die zichzelf registreert.
4. **SEO-scan uitgebreid** - ook hun Google Bedrijfsprofiel volledig beoordelen (foto's, categorieën,
   openingstijden, vragen) en dat als verkoopargument gebruiken.
5. **Meerdere gebruikers en teams** - accounts met rollen, gedeelde pipeline en een geschiedenis per
   account, zodat je later iemand kunt laten meewerken.

---

## 16. Licentie

Privéproject van Eliyah Webdesign. Niet bedoeld voor herverkoop.
