import { html, on } from '../dom.js';
import { api } from '../api.js';
import { buildSearchQuery, auditLead, enrichLead } from '../lead-service.js';
import { storage } from '../storage.js';
import { store } from '../store.js';
import { copyToClipboard, openMailto, todayISO } from '../utils.js';
import { toastError, toastOk } from '../ui/toast.js';

const KEY = 'today';
let busy = false;
let message = '';

function load() {
  const saved = storage.get(KEY, null);
  return saved && Array.isArray(saved.seen) && Array.isArray(saved.leads)
    ? saved : { date: '', seen: [], leads: [] };
}

function save(data) {
  if (storage.info().driver !== 'localStorage') throw new Error('Lokale opslag is niet beschikbaar. Gebruik geen privémodus en schakel opslag in.');
  storage.set(KEY, data);
}

export function dailyEmail(lead) {
  const name = String(lead.name || 'uw bedrijf').trim().slice(0, 100);
  const city = String(lead.city || lead.regionLabel || '').trim().slice(0, 60);
  const place = city ? ` in ${city}` : '';
  const viewport = lead.audit?.status === 'ok' && lead.audit.checks?.some((check) => check.id === 'viewport' && check.status === 'bad');
  const german = (lead.country || lead.regionCountry) === 'DE';
  const observation = !lead.website
    ? (german ? 'Im Branchenverzeichnis habe ich keinen Website-Eintrag gefunden.' : 'In de bedrijvengids vond ik geen websitevermelding.')
    : viewport
      ? (german ? 'Bei einer technischen Prüfung Ihrer Website fehlte die Viewport-Angabe für Mobilgeräte.' : 'Bij een technische controle van jullie website ontbrak de viewport-instelling voor mobiele schermen.')
      : (german ? 'Im Branchenverzeichnis ist Ihre Website angegeben.' : 'In de bedrijvengids staat jullie website vermeld.');
  const subject = german ? `Website-Idee für ${name}` : `Website-idee voor ${name}`;
  const body = german
    ? `Guten Tag,\n\nich bin auf ${name}${place} aufmerksam geworden. ${observation}\n\nIch bin Eliyah von Eliyah Webdesign und unterstütze lokale Unternehmen bei ihrer Website. Darf ich Ihnen einen kostenlosen Entwurf für eine mögliche Verbesserung zeigen?\n\nViele Grüße\nEliyah\nEliyah Webdesign\nhttps://eliyah-webdesign.vercel.app`
    : `Hallo,\n\nik kwam ${name}${place} tegen. ${observation}\n\nIk ben Eliyah van Eliyah Webdesign en help lokale bedrijven met hun website. Mag ik jullie een gratis voorbeeldontwerp voor een mogelijke verbetering laten zien?\n\nGroetjes\nEliyah\nEliyah Webdesign\nhttps://eliyah-webdesign.vercel.app`;
  return { subject, body };
}

function websiteRank(lead) {
  if (!lead.website) return 0;
  if (lead.audit?.status === 'ok' && lead.audit.checks?.some((check) => ['viewport', 'layout', 'copyright'].includes(check.id) && check.status === 'bad')) return 1;
  return 2;
}

export async function findDailyLeads({ settings, excluded, isDuplicate = () => false, fetchLeads = (params) => api.fetchLeads(params), audit = auditLead }) {
  const search = buildSearchQuery(settings);
  const candidates = [];
  const seen = new Set(excluded);
  // Bounded paging keeps results local to the selected region and avoids sending
  // the complete history to the server. Filter all historic IDs locally.
  for (let offset = 0; offset < 100 && candidates.length < 20; offset += 20) {
    const response = await fetchLeads({ q: search.q, city: search.regionLabel, nicheId: search.niche.id, niche: search.nicheLabel,
      lat: search.lat, lng: search.lng, radius: search.radius, country: search.country, lang: search.lang,
      provider: 'geoapify', want: 20, pages: 1, offset });
    if (response.mode === 'demo') throw new Error(response.message || 'Geoapify is nog niet ingesteld.');
    const page = response.leads ?? [];
    for (const lead of page) {
      if (!lead.placeId || seen.has(lead.placeId) || isDuplicate(lead)) continue;
      seen.add(lead.placeId);
      candidates.push(lead);
    }
    if (page.length < 20) break;
  }
  // Analyseer maximaal vijf websites; afwezigheid van een analyse is geen bewijs.
  const websites = candidates.filter((lead) => lead.website).slice(0, 5);
  await Promise.all(websites.map(async (lead) => { lead.audit = await audit(lead); }));
  return candidates.sort((a, b) => websiteRank(a) - websiteRank(b)).slice(0, 5)
    .map((lead) => enrichLead({ lead, audit: lead.audit ?? null, search, settings }));
}

async function generate() {
  if (busy) return;
  busy = true;
  message = 'Bedrijven zoeken en websites controleren...';
  store.emit();
  try {
    const data = load();
    const existing = store.state.leads.map((lead) => lead.placeId).filter(Boolean);
    const leads = await findDailyLeads({ settings: store.settings, excluded: [...data.seen, ...existing, ...store.seenPlaceIds()], isDuplicate: (lead) => Boolean(store.findDuplicate(lead)) });
    // Bewaar de lijst en volledige historie samen, voordat de kaarten zichtbaar worden.
    const next = { date: todayISO(), seen: [...new Set([...data.seen, ...leads.map((lead) => lead.placeId)])], leads: leads.map((lead) => ({ ...lead, dailyStatus: 'getoond' })) };
    save(next);
    for (const lead of next.leads) {
      store.markSeen(lead.placeId);
      store.addLead(lead);
    }
    message = leads.length < 3 ? `Er zijn ${leads.length} nieuwe bedrijven gevonden. Probeer een andere niche of regio voor meer resultaten.` : `${leads.length} nieuwe bedrijven gevonden.`;
  } catch (error) {
    message = error.message || 'Zoeken is mislukt. Probeer het opnieuw.';
    toastError(message);
  } finally {
    busy = false;
    store.emit();
  }
}

function setDailyStatus(placeId, status) {
  const data = load();
  const lead = data.leads.find((item) => item.placeId === placeId);
  if (!lead) return;
  save({ ...data, leads: data.leads.map((item) => item.placeId === placeId ? { ...item, dailyStatus: status } : item) });
  const existing = store.state.leads.find((item) => item.placeId === placeId);
  if (existing) store.setStatus(existing.id, status === 'benaderd' ? 'benaderd' : status === 'geen-interesse' ? 'niet-geinteresseerd' : 'overgeslagen');
  store.emit();
}

function card(lead) {
  const email = dailyEmail(lead);
  const address = lead.contactEmail || lead.publicEmails?.[0] || '';
  const websiteStatus = !lead.website ? 'Geen website vermeld' : websiteRank(lead) === 1 ? 'Website met aandachtspunt (controleer zelf)' : lead.audit?.status === 'ok' ? 'Website gecontroleerd' : 'Website niet gecontroleerd';
  return html`<article class="card today-card">
    <h3>${lead.name}</h3><p>${lead.city || 'Plaats onbekend'}${lead.address ? ` · ${lead.address}` : ''}</p>
    <p><strong>${websiteStatus}</strong>${lead.website ? html` · <a href="${lead.website}" target="_blank" rel="noopener noreferrer">Website bekijken</a>` : ''}</p>
    <p>Telefoon: ${lead.phone || 'niet vermeld'}<br />${address ? html`E-mail: ${address}` : html`<strong>Geen e-mail, bel of bezoek</strong>`}</p>
    <details><summary>Bekijk persoonlijke e-mail</summary><p><strong>Onderwerp:</strong> ${email.subject}</p><p class="today-email">${email.body}</p></details>
    <div class="today-actions"><button class="btn btn-primary" type="button" data-today-action="mail" data-id="${lead.placeId}" ${address ? '' : 'disabled'}>Open mail</button>
      <button class="btn btn-ghost" type="button" data-today-action="copy" data-id="${lead.placeId}">Kopieer mail</button>
      <button class="btn btn-ghost" type="button" data-today-action="no" data-id="${lead.placeId}">Geen interesse</button>
      <button class="btn btn-ghost" type="button" data-today-action="skip" data-id="${lead.placeId}">Overslaan</button></div>
    <label class="checkbox"><input type="checkbox" data-today-contacted="${lead.placeId}" /> <span>Benaderd</span></label>
  </article>`;
}

export const todayView = {
  id: 'today', label: 'Vandaag', icon: '☀',
  init(root, ctx) {
    on(root, 'click', '[data-today-action]', async (event, target) => {
      const action = target.dataset.todayAction;
      if (action === 'generate') return generate();
      if (action === 'settings') return ctx.navigate('settings');
      const lead = load().leads.find((item) => item.placeId === target.dataset.id && item.dailyStatus === 'getoond');
      if (!lead) return;
      const email = dailyEmail(lead);
      if (action === 'mail') return openMailto({ to: lead.contactEmail || lead.publicEmails?.[0] || '', ...email });
      if (action === 'copy') return (await copyToClipboard(`Onderwerp: ${email.subject}\n\n${email.body}`)) ? toastOk('E-mail gekopieerd.') : toastError('Kopiëren lukte niet.');
      try {
        if (action === 'no') setDailyStatus(lead.placeId, 'geen-interesse');
        if (action === 'skip') setDailyStatus(lead.placeId, 'overgeslagen');
      } catch (error) { toastError(`Niet opgeslagen: ${error.message}`); }
    });
    on(root, 'change', '[data-today-contacted]', (event, target) => {
      if (!target.checked) return;
      try { setDailyStatus(target.dataset.todayContacted, 'benaderd'); }
      catch (error) { target.checked = false; toastError(`Niet opgeslagen: ${error.message}`); }
    });
  },
  render(state) {
    const data = load();
    const leads = data.date === todayISO() ? data.leads.filter((lead) => lead.dailyStatus === 'getoond' && !state.leads.some((item) => item.placeId === lead.placeId && !['nieuw', 'bewaard'].includes(item.status))) : [];
    const search = buildSearchQuery(state.settings);
    return html`<section><h2>Vandaag</h2><p class="muted">${search.nicheLabel} · ${search.regionLabel}. Zoekinstellingen wijzig je bij Instellingen.</p>
      <div class="today-actions"><button class="btn btn-primary" type="button" data-today-action="generate" ${busy ? 'disabled' : ''}>${busy ? 'Bezig met zoeken...' : 'Vandaag 5 nieuwe leads'}</button>
      <button class="btn btn-ghost" type="button" data-today-action="settings">Niche en regio</button></div>
      <p class="muted small">De lijst en historie staan alleen op dit apparaat. Verwijder browsergegevens niet; maak regelmatig een back-up. Controleer zelf de gegevens en of je contact mag opnemen.</p>
      ${message ? html`<p role="status">${message}</p>` : ''}
      ${leads.length ? leads.map(card) : html`<p class="card">Nog geen openstaande leads voor vandaag. Vraag nieuwe leads aan met de knop hierboven.</p>`}
      <p class="muted small">Bron: <a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">Geoapify</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></p>
    </section>`;
  },
};
