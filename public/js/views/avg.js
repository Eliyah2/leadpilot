/**
 * public/js/views/avg.js
 * De regels voor koude acquisitie per land, kort en bruikbaar in de praktijk.
 *
 * Let op: dit is praktische uitleg, geen juridisch advies. Regels veranderen en
 * de details hangen van je situatie af. Twijfel je bij grotere campagnes? Vraag
 * dan juridisch advies.
 */
import { html, on } from '../dom.js';
import { toastOk } from '../ui/toast.js';
import { store } from '../store.js';

const Check = (text) => html`<li class="check">${text}</li>`;

export const avgView = {
  id: 'avg',
  label: 'AVG & regels',
  icon: '§',

  init(root) {
    on(root, 'click', '[data-action="ack"]', () => {
      store.updateSettings({ legalChecklist: { ...store.settings.legalChecklist, acknowledged: true } });
      toastOk('Bedankt. De basisregels staan nu op je netvlies.');
    });
    on(root, 'click', '[data-action="unack"]', () => {
      store.updateSettings({ legalChecklist: { ...store.settings.legalChecklist, acknowledged: false } });
    });
  },

  render(state) {
    const acknowledged = Boolean(state.settings.legalChecklist?.acknowledged);
    const doNotMail = state.leads.filter((lead) => ['niet-geinteresseerd', 'overgeslagen'].includes(lead.status));

    return html`
      <h2>AVG &amp; regels voor koude acquisitie</h2>
      <p class="notice notice-warn">
        Dit is praktische uitleg, geen juridisch advies. Gebruik alleen openbaar vermelde <strong>zakelijke</strong>
        gegevens, verstuur nooit massaal, en respecteer altijd een afmeldverzoek.
      </p>

      <section class="card">
        <h3>Wat LeadPilot wel en niet doet</h3>
        <ul class="checks">
          ${Check('Alle bedrijfsgegevens komen uit de Google Places API, de website-analyse of jouw eigen CSV-import. Er wordt niets verzonnen.')}
          ${Check('LeadPilot zoekt of raadt nooit een e-mailadres. Je vult zelf in wat openbaar op hun site staat of wat je al hebt.')}
          ${Check('Elke mail eindigt met een afmeldregel en jouw bedrijfsgegevens.')}
          ${Check('Er worden geen trackingpixels, cookies of analytics gebruikt.')}
          ${Check('Je kunt met één knop alle opgeslagen data verwijderen (tabblad Data &amp; AVG).')}
        </ul>
      </section>

      <section class="card">
        <h3>Nederland</h3>
        <ul class="checks">
          ${Check('Bij <strong>rechtspersonen</strong> (BV, NV, stichting) mag je ongevraagd zakelijk mailen als je je identificeert en een duidelijke afmeldmogelijkheid biedt (opt-out).')}
          ${Check('Bij <strong>natuurlijke personen</strong> - denk aan een eenmanszaak of ZZP\'er - geldt in principe voorafgaande toestemming (opt-in). Twijfel je? Bel of gebruik het contactformulier.')}
          ${Check('Onder de AVG verwerk je zakelijke contactgegevens op basis van gerechtvaardigd belang: houd het doel beperkt, bewaar niet meer dan nodig en stop direct na een afmeldverzoek.')}
          ${Check('Zet een afmeldverzoek altijd in je "niet geïnteresseerd"-lijst hieronder. Nooit opnieuw mailen.')}
          ${Check('Handhaving gebeurt onder meer door de ACM; herhaald negeren van afmeldingen is een risico dat je niet wilt lopen.')}
        </ul>
      </section>

      <section class="card">
        <h3>Duitsland (strenger)</h3>
        <ul class="checks">
          ${Check('<strong>Ongevraagde zakelijke e-mail is in Duitsland in beginsel onrechtmatig</strong> (UWG § 7). Alleen bij voorafgaande toestemming of een bestaande klantrelatie is het zonder meer toegestaan.')}
          ${Check('Het risico is niet theoretisch: concurrenten kunnen een <strong>Abmahnung</strong> sturen, met kosten die kunnen oplopen tot honderden euro\'s per geval.')}
          ${Check('Mail naar een algemeen info@-adres is in de praktijk omstreden. Kies voor Duitse leads daarom een ander kanaal.')}
          ${Check('Bruikbare alternatieven: <strong>contactformulier op hun site</strong>, <strong>bellen</strong> (zakelijk mag bij een vermoeden van interesse, houd het kort), een <strong>postkaart</strong>, of een bezoek ter plaatse.')}
          ${Check('In de leadweergave vind je voor Duitse leads automatisch een WhatsApp-tekst, een belscript en een postkaarttekst.')}
          ${Check('Ook onder de DSGVO: verwerk zo weinig persoonsgegevens mogelijk en verwijder ze als ze niet meer nodig zijn.')}
        </ul>
      </section>

      <section class="card">
        <h3>Checklist voor elke mail (30 seconden)</h3>
        <ul class="checks">
          ${Check('Is dit een zakelijk, openbaar gegeven adres - geen privéadres?')}
          ${Check('Staat mijn naam, bedrijf en telefoonnummer eronder?')}
          ${Check('Maximaal 120 woorden, geen hoofdletters, geen overdreven beloftes?')}
          ${Check('Eén duidelijke vraag aan het eind en een afmeldregel eronder?')}
          ${Check('Heb je dit bedrijf al eerder gemaild? Dan is het nu een follow-up - niet opnieuw de eerste mail.')}
          ${Check('Duitse lead? Dan liever bellen, WhatsApp, het contactformulier of post.')}
        </ul>
        ${acknowledged
          ? html`<p class="notice notice-good">Je hebt deze regels gelezen. Bedankt!</p>
              <button type="button" class="btn btn-ghost btn-sm" data-action="unack">Toch markeren als ongelezen</button>`
          : html`<button type="button" class="btn btn-primary" data-action="ack">Ik heb dit gelezen</button>`}
      </section>

      <section class="card">
        <h3>Niet meer mailen (${doNotMail.length})</h3>
        <p class="muted small">
          Deze bedrijven heb je als "niet geïnteresseerd" of "overgeslagen" gemarkeerd. Respecteer dat: stuur ze geen
          nieuwe eerste mail. Bellen mag bij een echt verzoek om contact uiteraard nog wel.
        </p>
        ${doNotMail.length === 0
          ? html`<p class="muted small">Nog geen bedrijven op deze lijst.</p>`
          : html`<ul class="plain">
              ${doNotMail.slice(0, 25).map((lead) => html`<li>${lead.name} ${lead.city ? html`<span class="muted">· ${lead.city}</span>` : ''}</li>`)}
            </ul>`}
      </section>
    `;
  },
};
