/**
 * public/js/views/lead.js
 * De belangrijkste pagina: één echte lead met analyse en kant-en-klare mail.
 *
 * Werking: de view rendert HTML uit de state, en alle kliks/typen worden via
 * event-delegatie op de container afgehandeld. De container zelf blijft staan,
 * dus listeners blijven werken na elke re-render.
 */
import { confirmDialog, html, on, setContent } from '../dom.js';
import { toast, toastError, toastInfo, toastOk } from '../ui/toast.js';
import { STATUSES, store } from '../store.js';
import { fetchNextLead, auditLead, enrichLead } from '../lead-service.js';
import { buildCallScript, buildEmail, buildPostcard, buildWhatsApp, variantLabel } from '../email/engine.js';
import { copyToClipboard, countWords, formatDateTime, openMailto } from '../utils.js';

let searching = false;

/** Is de e-mail nog niet gegenereerd voor deze lead? Dan maken we hem nu. */
function ensureEmail(state, kind = 'eerste') {
  const lead = state.current.lead;
  if (!lead) return null;
  if (state.current.email?.leadId === lead.id && state.current.email?.kind === kind) return state.current.email;
  const email = buildEmail({ lead, audit: state.current.audit, settings: state.settings, kind });
  store.setCurrent({ email: { ...email, leadId: lead.id, bodyDraft: email.body } }, { silent: true });
  return { ...email, leadId: lead.id, bodyDraft: email.body };
}

function leadEmail(state) {
  return state.current.email?.bodyDraft ?? state.current.email?.body ?? '';
}

/** Zoek een nieuwe lead en analyseer die. */
async function newLead() {
  if (searching) return;
  searching = true;
  store.setCurrent({ loading: true, error: null, demo: null }, { silent: false });
  store.setUi({ scanProgress: 'Zoeken naar bedrijven...' });

  try {
    const settings = store.settings;
    const result = await fetchNextLead({
      settings,
      seenPlaceIds: store.seenPlaceIds(),
      onProgress: ({ message }) => store.setUi({ scanProgress: message }, { silent: false }),
    });

    if (result.kind === 'demo') {
      store.setCurrent({
        loading: false,
        lead: null,
        audit: null,
        email: null,
        demo: result.message,
        searchLinks: result.searchLinks ?? [],
        search: result.search,
      });
      store.setUi({ scanProgress: null });
      return;
    }

    if (result.kind === 'empty') {
      store.setCurrent({
        loading: false,
        lead: null,
        audit: null,
        email: null,
        demo: null,
        searchLinks: [],
        search: result.search,
        error: null,
        empty: { message: result.message, exhausted: result.exhausted, filteredOut: result.filteredOut, allSeen: result.allSeen },
      });
      store.setUi({ scanProgress: null });
      return;
    }

    // Lead gevonden: in de pipeline zetten, als gezien markeren en tonen.
    const saved = store.addLead(result.lead);
    store.markSeen(result.lead.placeId);
    store.setCurrent({
      lead: saved,
      audit: result.audit,
      email: null,
      demo: null,
      searchLinks: [],
      search: result.search,
      loading: false,
      error: null,
      empty: null,
    });
    store.setUi({ scanProgress: null });
    const email = ensureEmail(store.state, 'eerste');
    store.setCurrent({ email }, { silent: true });
    store.emit();
  } catch (error) {
    store.setUi({ scanProgress: null });
    store.setCurrent({ loading: false, error: error.message ?? 'Er ging iets mis bij het zoeken.' });
    toastError(error.message ?? 'Er ging iets mis bij het zoeken.');
  } finally {
    searching = false;
  }
}

/** Huidige lead bijwerken in de pipeline. */
function patchCurrentLead(patch) {
  const lead = store.state.current.lead;
  if (!lead) return null;
  const updated = store.updateLead(lead.id, patch);
  if (updated) store.setCurrent({ lead: updated }, { silent: true });
  return updated;
}

/** Contactvelden aanpassen: mail direct opnieuw opbouwen, zonder de UI te herladen. */
function updateContact(field, value) {
  const lead = store.state.current.lead;
  if (!lead) return;
  const patch = field === 'contactName' ? { contactName: value } : { contactEmail: value };
  const updated = patchCurrentLead(patch);
  if (!updated) return;
  const email = store.state.current.email;
  if (email) {
    // De aanhef en de handtekening kunnen veranderen, dus opnieuw opbouwen...
    const rebuilt = buildEmail({ lead: updated, audit: store.state.current.audit, settings: store.settings, kind: email.kind });
    store.setCurrent({ email: { ...rebuilt, leadId: updated.id, bodyDraft: rebuilt.body } }, { silent: true });
  }
  refreshEmailPreview();
}

/** Alleen het mailpaneel opnieuw tekenen (zodat je focus in het invoerveld blijft). */
function refreshEmailPreview() {
  const target = document.getElementById('email-preview');
  if (!target) return;
  setContent(target, renderEmailPreview(store.state));
}

// ── HTML-onderdelen ───────────────────────────────────────────────────────

function scoreBar(lead) {
  const band = lead.scoreBand ?? { label: '', className: '' };
  return html`
    <div class="score ${band.className}">
      <div class="score-value">
        <span class="score-number">${lead.score ?? '-'}</span>
        <span class="score-max">/100</span>
      </div>
      <div class="score-meta">
        <strong>${band.label}</strong>
        <div class="score-track"><span style="width:${Math.max(0, Math.min(100, lead.score ?? 0))}%"></span></div>
      </div>
    </div>
  `;
}

function scoreReasons(lead) {
  if (!lead.scoreReasons?.length) return '';
  return html`
    <details class="reasons" open>
      <summary>Waarom deze score?</summary>
      <ul>
        ${lead.scoreReasons.map(
          (reason) => html`<li class="reason reason-${reason.kind}"><strong>${reason.label}</strong> ${reason.detail}</li>`
        )}
      </ul>
    </details>
  `;
}

function auditSummary(lead, audit) {
  if (!lead.website) {
    return html`
      <div class="audit-block">
        <h3>Website-analyse</h3>
        <p class="notice notice-warn">Geen website gevonden in Google Maps. Dat is geen gemis in de mail: het is je sterkste verkoopargument.</p>
      </div>
    `;
  }
  if (!audit || audit.status !== 'ok') {
    return html`
      <div class="audit-block">
        <h3>Website-analyse</h3>
        <p class="notice notice-muted">${audit?.message ?? 'Deze website is nog niet geanalyseerd.'}</p>
        <button type="button" class="btn btn-ghost btn-sm" data-action="reaudit">Opnieuw analyseren</button>
      </div>
    `;
  }

  const findings = audit.problems?.length ? audit.problems : [];
  return html`
    <div class="audit-block">
      <h3>Website-analyse <span class="muted">(score ${audit.websiteScore}/100)</span></h3>
      ${findings.length
        ? html`<ul class="findings">
            ${audit.checks
              .filter((check) => check.status === 'bad' || check.status === 'warn')
              .map(
                (check) => html`<li class="finding finding-${check.status}">
                  <span class="finding-icon" aria-hidden="true">${check.status === 'bad' ? '✕' : '!'}</span>
                  <span><strong>${check.label}</strong><br /><span class="muted">${check.detail}</span></span>
                </li>`
              )}
          </ul>`
        : html`<p class="notice notice-good">Geen technische problemen gevonden in deze controle.</p>`}
      ${audit.publicEmails?.length
        ? html`<p class="muted small">Publiek e-mailadres op de site: ${audit.publicEmails.join(', ')} (overgenomen van de site zelf.)</p>`
        : html`<p class="muted small">Geen openbaar e-mailadres op de site gevonden. Vul hieronder zelf in wat je hebt.</p>`}
      <p class="muted small">
        Gemeten op ${formatDateTime(audit.metrics?.analysedAt)}: laadtijd ${audit.metrics?.loadMs ?? '?'} ms,
        ${audit.metrics?.sizeKb ?? '?'} kB HTML. Bron: de website zelf.
      </p>
      <button type="button" class="btn btn-ghost btn-sm" data-action="reaudit">Opnieuw analyseren</button>
    </div>
  `;
}

function salesArgs(lead) {
  if (!lead.salesArguments?.length) return '';
  return html`
    <div class="args-block">
      <h3>Verkoopargumenten voor dit bedrijf</h3>
      <ol>
        ${lead.salesArguments.map(
          (argument) => html`<li><strong>${argument.title}</strong><br /><span class="muted">${argument.body}</span></li>`
        )}
      </ol>
    </div>
  `;
}

function leadCard(state) {
  const lead = state.current.lead;
  const audit = state.current.audit;
  if (!lead) return '';
  return html`
    <article class="card lead-card">
      <header class="lead-head">
        <div>
          <h2>${lead.name}</h2>
          <p class="muted">
            ${lead.nicheLabel ?? lead.category ?? 'Bedrijf'} · ${lead.city || 'stad onbekend'}${lead.country ? `, ${lead.country}` : ''}
            ${lead.category ? html` · <span class="muted">${lead.category}</span>` : ''}
          </p>
        </div>
        <div class="lead-head-right">
          <label class="field-inline">
            <span>Status</span>
            <select data-field="status" aria-label="Status van deze lead">
              ${storeStatusOptions(lead.status)}
            </select>
          </label>
        </div>
      </header>

      <dl class="lead-meta">
        <div>
          <dt>Beoordeling</dt>
          <dd>${lead.rating ? html`${lead.rating} / 5 <span class="muted">(${lead.reviews ?? 0} reviews)</span>` : html`<span class="muted">Onbekend</span>`}</dd>
        </div>
        <div>
          <dt>Telefoon</dt>
          <dd>${lead.phone ? html`<a href="tel:${lead.phone}">${lead.phone}</a>` : html`<span class="muted">Geen telefoonnummer gevonden</span>`}</dd>
        </div>
        <div>
          <dt>Website</dt>
          <dd>
            ${lead.website
              ? html`<a href="${lead.website}" target="_blank" rel="noopener noreferrer">${lead.website}</a>`
              : html`<span class="muted">Geen website gevonden</span>`}
          </dd>
        </div>
        <div>
          <dt>Adres</dt>
          <dd>${lead.address || html`<span class="muted">Onbekend</span>`}</dd>
        </div>
      </dl>

      <div class="lead-links">
        ${lead.mapsUrl ? html`<a class="btn btn-ghost btn-sm" href="${lead.mapsUrl}" target="_blank" rel="noopener noreferrer">Google Maps</a>` : ''}
        ${lead.website ? html`<a class="btn btn-ghost btn-sm" href="${lead.website}" target="_blank" rel="noopener noreferrer">Website openen</a>` : ''}
        ${lead.phone ? html`<a class="btn btn-ghost btn-sm" href="tel:${lead.phone}">Bellen</a>` : ''}
        ${lead.regionLabel ? html`<span class="chip">${lead.regionLabel}</span>` : ''}
        ${lead.radiusKm ? html`<span class="chip">${lead.radiusKm} km</span>` : ''}
      </div>

      ${scoreBar(lead)}
      ${scoreReasons(lead)}
      ${auditSummary(lead, audit)}
      ${salesArgs(lead)}

      <div class="lead-actions">
        <button type="button" class="btn btn-ghost" data-action="save-later">Bewaar voor later</button>
        <button type="button" class="btn btn-ghost" data-action="skip">Sla over (S)</button>
      </div>
    </article>
  `;
}

function storeStatusOptions(current) {
  return STATUSES.map(
    (status) => html`<option value="${status.id}" ${status.id === current ? 'selected' : ''}>${status.label}</option>`
  );
}

function renderEmailPreview(state) {
  const lead = state.current.lead;
  const email = state.current.email;
  if (!lead || !email) return '';
  const body = leadEmail(state);
  const words = countWords(body);
  const tooLong = words > 120;
  return html`
    <div class="email-subject">
      <label for="email-subject">Onderwerp <span class="muted">(max. 50 tekens, nu ${email.subject.length})</span></label>
      <input id="email-subject" type="text" value="${email.subject}" readonly />
    </div>
    <div class="email-body">
      <label for="email-body">E-mailtekst</label>
      <textarea id="email-body" rows="16" data-field="emailBody">${body}</textarea>
      <p class="muted small">
        ${words} woorden ${tooLong ? html`<strong class="warn-text">- te lang, kort hem in tot 120</strong>` : ''} ·
        variant: ${variantLabel(email.variantKey)} · toon: ${email.tone} · taal: ${email.language}
      </p>
    </div>
    <div class="email-actions">
      <button type="button" class="btn btn-primary" data-action="copy-email">Kopieer e-mail (C)</button>
      <button type="button" class="btn" data-action="copy-subject">Kopieer onderwerp</button>
      <button type="button" class="btn" data-action="open-mail">Open in mailapp</button>
      <button type="button" class="btn btn-ghost" data-action="mark-sent">Markeer als gemaild</button>
    </div>
  `;
}

function channelsBlock(state) {
  const lead = state.current.lead;
  if (!lead) return '';
  const whatsapp = buildWhatsApp({ lead, audit: state.current.audit, settings: state.settings });
  const script = buildCallScript({ lead, audit: state.current.audit, settings: state.settings });
  const postcard = buildPostcard({ lead, audit: state.current.audit, settings: state.settings });
  const isGerman = (lead.country === 'DE' || lead.regionCountry === 'DE');
  return html`
    <details class="card channels">
      <summary>Extra kanalen: WhatsApp, bellen en post${isGerman ? ' (aanbevolen voor Duitse leads)' : ''}</summary>
      ${isGerman
        ? html`<p class="notice notice-warn">
            In Duitsland is ongevraagde zakelijke e-mail aan een bedrijf juridisch riskant. Gebruik bij voorkeur WhatsApp,
            bellen of een postkaart - of het contactformulier op hun site.
          </p>`
        : ''}
      <div class="channel">
        <h4>WhatsApp / DM</h4>
        <p class="channel-text">${whatsapp.message}</p>
        <button type="button" class="btn btn-sm" data-action="copy-whatsapp">Kopieer WhatsApp-tekst</button>
      </div>
      <div class="channel">
        <h4>Belscript (30 seconden)</h4>
        <p class="channel-text">${script.text}</p>
        <button type="button" class="btn btn-sm" data-action="copy-callscript">Kopieer belscript</button>
      </div>
      <div class="channel">
        <h4>Postkaart</h4>
        <p class="channel-text">${postcard.text}</p>
        <button type="button" class="btn btn-sm" data-action="copy-postcard">Kopieer postkaarttekst</button>
      </div>
    </details>
  `;
}

function emptyState(state) {
  const empty = state.current.empty;
  return html`
    <div class="card empty-state">
      <h2>Geen lead gevonden</h2>
      <p>${empty?.message ?? 'Er zijn geen resultaten gevonden.'}</p>
      <div class="lead-actions">
        <button type="button" class="btn btn-primary" data-action="new-lead">Opnieuw zoeken (N)</button>
        ${empty?.allSeen || empty?.exhausted
          ? html`<button type="button" class="btn btn-ghost" data-action="reset-seen">Geziene leads wissen</button>`
          : ''}
        <button type="button" class="btn btn-ghost" data-action="goto-settings">Instellingen aanpassen</button>
      </div>
    </div>
  `;
}

function demoState(state) {
  return html`
    <div class="card empty-state">
      <h2>Demo-modus</h2>
      <p>${state.current.demo}</p>
      <p class="muted">
        Zoekopdracht: <strong>${state.current.search?.q ?? ''}</strong>. Open een zoeklink, zoek je leads en importeer ze
        daarna via CSV - of zet je Google Places API-sleutel in Vercel voor automatische leads.
      </p>
      <div class="lead-actions">
        ${(state.current.searchLinks ?? []).map(
          (link) => html`<a class="btn btn-primary btn-sm" href="${link.url}" target="_blank" rel="noopener noreferrer">${link.label}</a>`
        )}
        <button type="button" class="btn btn-ghost btn-sm" data-action="goto-data">CSV importeren</button>
      </div>
    </div>
  `;
}

function loadingState(state) {
  return html`
    <div class="card empty-state">
      <p class="spinner" aria-hidden="true"></p>
      <p>${state.ui.scanProgress ?? 'Bezig...'}</p>
    </div>
  `;
}

function toolbar(state) {
  const search = state.current.search;
  const quota = state.current.quota;
  const stats = store.state.settings;
  return html`
    <div class="view-toolbar">
      <button type="button" class="btn btn-primary" data-action="new-lead" ${searching ? 'disabled' : ''}>
        Nieuwe lead <kbd>N</kbd>
      </button>
      <span class="muted">
        ${search ? html`${search.nicheLabel} in ${search.regionLabel} (${search.country}${search.radius ? `, ${Math.round(search.radius / 1000)} km` : ''})` : 'Nog geen zoekopdracht'}
      </span>
      <span class="spacer"></span>
      <span class="muted small">Dagdoel: ${stats.dailyGoal} mails</span>
      ${quota?.searchLimit ? html`<span class="chip">Zoekopdrachten vandaag: ${quota.searchesToday}/${quota.searchLimit}</span>` : ''}
    </div>
  `;
}

function legalWarning(state) {
  const lead = state.current.lead;
  const isGerman = lead && (lead.country === 'DE' || lead.regionCountry === 'DE');
  if (!state.settings.legalChecklist?.acknowledged && !isGerman) return '';
  return html`
    <div class="notice notice-warn legal">
      <strong>${isGerman ? 'Let op: Duitse lead' : 'Check jezelf even'}</strong>
      ${isGerman
        ? html`<span>
            In Duitsland is ongevraagde zakelijke e-mail strenger gereguleerd (UWG). Overweeg WhatsApp, telefoon, post of
            het contactformulier. Zie het tabblad AVG &amp; regels.
          </span>`
        : html`<span>Gebruik alleen openbare zakelijke gegevens, houd het kort en bied altijd een afmeldmogelijkheid. Zie het tabblad AVG &amp; regels.</span>`}
    </div>
  `;
}

export const leadView = {
  id: 'lead',
  label: 'Nieuwe lead',
  icon: '+',

  init(root, ctx) {
    on(root, 'click', '[data-action]', async (event, target) => {
      const action = target.dataset.action;
      const state = store.state;
      const lead = state.current.lead;

      if (action === 'new-lead') return newLead();
      if (action === 'goto-settings') return ctx.navigate('settings');
      if (action === 'goto-data') return ctx.navigate('data');
      if (action === 'reset-seen') {
        const ok = await confirmDialog({
          title: 'Geziene leads wissen?',
          message: 'Je krijgt dan weer leads te zien die je eerder al had. Je pipeline blijft gewoon bestaan.',
          confirmLabel: 'Wissen',
        });
        if (ok) {
          store.resetSeen();
          toastOk('Geziene lijst gewist.');
        }
        return;
      }
      if (!lead) return;

      if (action === 'skip') {
        store.setStatus(lead.id, 'overgeslagen');
        toast('Lead overgeslagen.', { type: 'info' });
        return newLead();
      }
      if (action === 'save-later') {
        store.setStatus(lead.id, 'bewaard');
        toastOk('Bewaard in je pipeline.');
        return;
      }
      if (action === 'copy-email') {
        const ok = await copyToClipboard(leadEmail(state));
        if (ok) toastOk('E-mail gekopieerd.');
        else toastError('Kopiëren lukte niet. Selecteer de tekst handmatig.');
        return;
      }
      if (action === 'copy-subject') {
        const ok = await copyToClipboard(state.current.email?.subject ?? '');
        if (ok) toastOk('Onderwerp gekopieerd.');
        else toastError('Kopiëren lukte niet.');
        return;
      }
      if (action === 'open-mail') {
        openMailto({
          to: lead.contactEmail ?? '',
          subject: state.current.email?.subject ?? '',
          body: leadEmail(state),
        });
        return;
      }
      if (action === 'mark-sent') {
        store.markEmailSent(lead.id, {
          kind: state.current.email?.kind ?? 'eerste',
          variantKey: state.current.email?.variantKey,
          subject: state.current.email?.subject,
        });
        const followUp = store.findById(lead.id)?.followUpAt;
        toastOk(`Gemaild. Follow-up ingepland op ${followUp ?? 'de geplande datum'}.`);
        const fresh = store.findById(lead.id);
        store.setCurrent({ lead: fresh, email: null }, { silent: true });
        return newLead();
      }
      if (action === 'reaudit') {
        if (!lead.website) {
          toastInfo('Deze lead heeft geen website om te analyseren.');
          return;
        }
        toastInfo('Website opnieuw analyseren...');
        const audit = await auditLead(lead, { force: true });
        const refreshed = enrichLead({
          lead,
          audit,
          search: {
            niche: { id: lead.nicheId, category: lead.categoryKey },
            region: { id: lead.regionId, label: lead.regionLabel, radius: lead.radiusKm },
            nicheLabel: lead.nicheLabel,
            regionLabel: lead.regionLabel,
            categoryKey: lead.categoryKey,
            country: lead.regionCountry,
            lang: lead.language,
            q: lead.query,
          },
          settings: state.settings,
        });
        const savedLead = store.updateLead(lead.id, refreshed);
        store.setCurrent({ lead: savedLead, audit, email: null });
        toastOk('Analyse bijgewerkt.');
        return;
      }
      if (action.startsWith('copy-')) {
        const builders = {
          'copy-whatsapp': buildWhatsApp,
          'copy-callscript': buildCallScript,
          'copy-postcard': buildPostcard,
        };
        const builder = builders[action];
        if (builder) {
          const built = builder({ lead, audit: state.current.audit, settings: state.settings });
          const ok = await copyToClipboard(built.message ?? built.text);
          if (ok) toastOk('Gekopieerd.');
          else toastError('Kopiëren lukte niet.');
        }
      }
    });

    // Typen in de contactvelden en in de mailtekst zelf.
    on(root, 'input', '[data-field]', (event, target) => {
      const field = target.dataset.field;
      if (field === 'contactName' || field === 'contactEmail') {
        updateContact(field, target.value);
        return;
      }
      if (field === 'emailBody') {
        const email = store.state.current.email;
        if (!email) return;
        store.setCurrent({ email: { ...email, bodyDraft: target.value } }, { silent: true });
        const counter = target.parentElement?.querySelector('.muted.small');
        const words = countWords(target.value);
        if (counter) {
          counter.textContent = `${words} woorden ${words > 120 ? '- te lang, kort hem in tot 120' : ''}`;
        }
      }
    });

    on(root, 'change', '[data-field="status"]', (event, target) => {
      const lead = store.state.current.lead;
      if (!lead) return;
      store.setStatus(lead.id, target.value);
      const fresh = store.findById(lead.id);
      store.setCurrent({ lead: fresh }, { silent: true });
      toastOk(`Status: ${target.options[target.selectedIndex]?.text ?? target.value}`);
    });
  },

  render(state) {
    const lead = state.current.lead;
    if (lead) ensureEmail(state, 'eerste');

    const body = html`
      ${toolbar(state)}
      ${legalWarning(state)}
      ${state.current.loading ? loadingState(state) : ''}
      ${!state.current.loading && state.current.error ? html`<div class="card empty-state"><h2>Er ging iets mis</h2><p>${state.current.error}</p>
        <button type="button" class="btn btn-primary" data-action="new-lead">Opnieuw proberen</button></div>` : ''}
      ${!state.current.loading && !state.current.error && state.current.demo ? demoState(state) : ''}
      ${!state.current.loading && !state.current.error && !state.current.demo && !lead && state.current.empty ? emptyState(state) : ''}
      ${!state.current.loading && !state.current.error && !state.current.demo && !lead && !state.current.empty
        ? html`<div class="card empty-state">
            <h2>Klaar voor je eerste lead</h2>
            <p>Kies je niche en regio in de instellingen en klik op "Nieuwe lead". Je krijgt dan een echt bedrijf met analyse en een kant-en-klare mail.</p>
            <button type="button" class="btn btn-primary" data-action="new-lead">Nieuwe lead</button>
            <button type="button" class="btn btn-ghost" data-action="goto-settings">Instellingen</button>
          </div>`
        : ''}
      ${lead
        ? html`
            <div class="lead-layout">
              ${leadCard(state)}
              <section class="card email-card">
                <h3>Kant-en-klare e-mail</h3>
                <div class="contact-fields">
                  <label class="field">
                    <span>Voornaam contactpersoon</span>
                    <input type="text" data-field="contactName" value="${lead.contactName ?? ''}" placeholder="bijv. Jan" autocomplete="off" />
                  </label>
                  <label class="field">
                    <span>E-mailadres</span>
                    <input type="email" data-field="contactEmail" value="${lead.contactEmail ?? ''}" placeholder="info@bedrijf.nl" autocomplete="off" />
                  </label>
                </div>
                <p class="muted small">
                  Vul alleen in wat je zelf hebt of wat openbaar op hun site staat. LeadPilot raadt nooit een adres.
                </p>
                <div id="email-preview">${renderEmailPreview(state)}</div>
              </section>
            </div>
            ${channelsBlock(state)}
          `
        : ''}
    `;
    return body;
  },
};
