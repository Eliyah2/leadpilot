/**
 * public/js/views/pipeline.js
 * Je leadlijst: als kanbanbord (met drag & drop) of als tabel, met zoeken,
 * filteren, sorteren, notities en een tijdlijn per lead.
 */
import { confirmDialog, html, on, setContent } from '../dom.js';
import { toastError, toastOk } from '../ui/toast.js';
import { KANBAN_STATUSES, REPLY_STATUSES, STATUSES, STATUS_LABELS, store } from '../store.js';
import { buildEmail, buildWhatsApp } from '../email/engine.js';
import { copyToClipboard, formatDate, openMailto, relativeDays } from '../utils.js';

let selectedId = null;

function allLeads() {
  return [...store.state.leads].filter((lead) => lead.status !== 'overgeslagen');
}

/** Filters uit de UI-state toepassen. */
function filteredLeads(state) {
  const { search, status, niche, region } = state.ui.filters;
  const query = search.trim().toLowerCase();
  let leads = allLeads();

  if (status !== 'alle') leads = leads.filter((lead) => lead.status === status);
  if (niche !== 'alle') leads = leads.filter((lead) => lead.nicheLabel === niche);
  if (region !== 'alle') leads = leads.filter((lead) => lead.regionLabel === region);
  if (query) {
    leads = leads.filter((lead) =>
      [lead.name, lead.city, lead.nicheLabel, lead.contactEmail, lead.phone, lead.address]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }

  const sorters = {
    nieuwste: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
    oudste: (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)),
    score: (a, b) => (b.score ?? 0) - (a.score ?? 0),
    naam: (a, b) => String(a.name).localeCompare(String(b.name), 'nl'),
    followup: (a, b) => String(a.followUpAt ?? '9999').localeCompare(String(b.followUpAt ?? '9999')),
  };
  return leads.sort(sorters[state.ui.sort] ?? sorters.nieuwste);
}

function statusColor(statusId) {
  return STATUSES.find((status) => status.id === statusId)?.color ?? 'var(--border)';
}

function followUpLabel(lead) {
  if (!lead.followUpAt) return '';
  const late = lead.followUpAt <= new Date().toISOString().slice(0, 10);
  return html`<span class="chip ${late ? 'chip-warn' : ''}">Opvolgen ${formatDate(lead.followUpAt)} (${relativeDays(lead.followUpAt)})</span>`;
}

function kanbanCard(lead) {
  return html`
    <article class="kanban-card" draggable="true" data-id="${lead.id}" data-action="select" tabindex="0" aria-label="Lead ${lead.name}">
      <header>
        <strong>${lead.name}</strong>
        <span class="score-pill ${lead.scoreBand?.className ?? ''}">${lead.score ?? '-'}</span>
      </header>
      <p class="muted small">${lead.nicheLabel ?? ''} · ${lead.city || 'onbekend'}</p>
      ${lead.website ? '' : html`<p class="tag tag-warn">Geen website</p>`}
      ${followUpLabel(lead)}
    </article>
  `;
}

function kanban(state) {
  return html`
    <div class="kanban">
      ${KANBAN_STATUSES.map(
        (status) => html`
          <section class="kanban-column" data-drop-status="${status.id}">
            <header class="kanban-head" style="--status-color:${status.color}">
              <span>${status.label}</span>
              <span class="muted">${state.leads.filter((lead) => lead.status === status.id).length}</span>
            </header>
            <div class="kanban-body">
              ${state.leads
                .filter((lead) => lead.status === status.id)
                .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
                .slice(0, 40)
                .map(kanbanCard)}
            </div>
          </section>
        `
      )}
    </div>
  `;
}

function listView(state) {
  const leads = filteredLeads(state);
  if (!leads.length) {
    return html`<div class="card empty-state"><h2>Geen leads in deze selectie</h2><p>Pas je filters aan of haal eerst een nieuwe lead op.</p></div>`;
  }
  return html`
    <div class="card table-wrap">
      <table class="lead-table">
        <thead>
          <tr>
            <th scope="col">Bedrijf</th>
            <th scope="col">Niche / regio</th>
            <th scope="col">Score</th>
            <th scope="col">Status</th>
            <th scope="col">Follow-up</th>
            <th scope="col">Laatst bijgewerkt</th>
          </tr>
        </thead>
        <tbody>
          ${leads.map(
            (lead) => html`
              <tr data-action="select" data-id="${lead.id}" tabindex="0" class="${lead.id === selectedId ? 'is-selected' : ''}">
                <td>
                  <strong>${lead.name}</strong>
                  <br /><span class="muted small">${lead.city || ''}${lead.website ? '' : ' · geen website'}</span>
                </td>
                <td>${lead.nicheLabel ?? ''}<br /><span class="muted small">${lead.regionLabel ?? ''}</span></td>
                <td><span class="score-pill ${lead.scoreBand?.className ?? ''}">${lead.score ?? '-'}</span></td>
                <td><span class="status-dot" style="background:${statusColor(lead.status)}"></span>${STATUS_LABELS[lead.status] ?? lead.status}</td>
                <td>${lead.followUpAt ? html`${formatDate(lead.followUpAt)}<br /><span class="muted small">${relativeDays(lead.followUpAt)}</span>` : html`<span class="muted">-</span>`}</td>
                <td class="muted small">${formatDate(lead.updatedAt)}</td>
              </tr>
            `
          )}
        </tbody>
      </table>
    </div>
  `;
}

function detailPanel(state) {
  const lead = state.leads.find((item) => item.id === selectedId);
  if (!lead) return '';
  const email = buildEmail({ lead, audit: lead.audit, settings: state.settings, kind: 'eerste' });
  const whatsapp = buildWhatsApp({ lead, audit: lead.audit, settings: state.settings });
  const timeline = [...(lead.timeline ?? [])].reverse().slice(0, 25);

  return html`
    <section class="card lead-detail" aria-label="Details van ${lead.name}">
      <header class="lead-head">
        <div>
          <h2>${lead.name}</h2>
          <p class="muted">${lead.nicheLabel ?? ''} · ${lead.city || ''} · score ${lead.score ?? '-'}/100</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-action="close-detail" aria-label="Detail sluiten">Sluiten</button>
      </header>

      <div class="detail-grid">
        <div>
          <h3>Contactgegevens</h3>
          <ul class="plain">
            <li>${lead.phone ? html`<a href="tel:${lead.phone}">${lead.phone}</a>` : html`<span class="muted">Geen telefoonnummer</span>`}</li>
            <li>${lead.website ? html`<a href="${lead.website}" target="_blank" rel="noopener noreferrer">${lead.website}</a>` : html`<span class="muted">Geen website</span>`}</li>
            <li>${lead.mapsUrl ? html`<a href="${lead.mapsUrl}" target="_blank" rel="noopener noreferrer">Google Maps</a>` : ''}</li>
            <li>${lead.contactEmail ? html`Mail: ${lead.contactEmail}` : html`<span class="muted">Nog geen e-mailadres ingevuld</span>`}</li>
            <li>${lead.address || html`<span class="muted">Adres onbekend</span>`}</li>
          </ul>

          <h3>Notitie toevoegen</h3>
          <label class="field">
            <span class="sr-only">Notitie</span>
            <textarea rows="3" data-field="note" placeholder="Wat besproken? Welke offerte?"></textarea>
          </label>
          <button type="button" class="btn btn-sm" data-action="add-note">Notitie opslaan</button>

          <h3>Tijdlijn</h3>
          ${timeline.length
            ? html`<ul class="timeline">
                ${timeline.map(
                  (entry) => html`<li class="timeline-${entry.type}">
                    <span class="muted small">${new Date(entry.ts).toLocaleString('nl-NL')}</span><br />${entry.text}
                  </li>`
                )}
              </ul>`
            : html`<p class="muted small">Nog geen activiteit. Zodra je mailt of een notitie plaatst, verschijnt die hier.</p>`}
        </div>

        <div>
          <h3>Status en opvolging</h3>
          <label class="field">
            <span>Status</span>
            <select data-field="detail-status" data-id="${lead.id}">
              ${STATUSES.map((status) => html`<option value="${status.id}" ${status.id === lead.status ? 'selected' : ''}>${status.label}</option>`)}
            </select>
          </label>
          <div class="detail-actions">
            <button type="button" class="btn btn-sm" data-action="detail-copy-mail" data-id="${lead.id}">Kopieer e-mail</button>
            <button type="button" class="btn btn-sm" data-action="detail-open-mail" data-id="${lead.id}">Open in mailapp</button>
            <button type="button" class="btn btn-sm btn-primary" data-action="detail-mark-sent" data-id="${lead.id}">Markeer als gemaild</button>
            <button type="button" class="btn btn-sm" data-action="detail-copy-whatsapp" data-id="${lead.id}">WhatsApp-tekst</button>
            <button type="button" class="btn btn-sm btn-danger" data-action="delete-lead" data-id="${lead.id}">Verwijderen</button>
          </div>
          <p class="muted small">${lead.followUpAt ? html`Volgende opvolging: ${formatDate(lead.followUpAt)}` : 'Geen opvolging gepland.'}</p>
          <details>
            <summary>Onderwerp en tekst bekijken</summary>
            <p class="small"><strong>${email.subject}</strong></p>
            <pre class="mail-preview">${email.body}</pre>
          </details>
          <details>
            <summary>WhatsApp/DM-variant</summary>
            <pre class="mail-preview">${whatsapp.message}</pre>
          </details>
        </div>
      </div>
    </section>
  `;
}

function toolbar(state) {
  const niches = [...new Set(allLeads().map((lead) => lead.nicheLabel).filter(Boolean))].sort();
  const regions = [...new Set(allLeads().map((lead) => lead.regionLabel).filter(Boolean))].sort();
  return html`
    <div class="view-toolbar">
      <div class="segmented" role="group" aria-label="Weergave">
        <button type="button" class="btn btn-sm ${state.ui.pipelineMode === 'kanban' ? 'is-active' : ''}" data-action="mode" data-mode="kanban">Bord</button>
        <button type="button" class="btn btn-sm ${state.ui.pipelineMode === 'list' ? 'is-active' : ''}" data-action="mode" data-mode="list">Lijst</button>
      </div>
      <label class="field-inline">
        <span class="sr-only">Zoeken</span>
        <input type="search" data-field="filter-search" value="${state.ui.filters.search}" placeholder="Zoek op naam, stad, e-mail..." />
      </label>
      <label class="field-inline">
        <span class="sr-only">Status</span>
        <select data-field="filter-status">
          <option value="alle">Alle statussen</option>
          ${STATUSES.map((status) => html`<option value="${status.id}" ${state.ui.filters.status === status.id ? 'selected' : ''}>${status.label}</option>`)}
        </select>
      </label>
      <label class="field-inline">
        <span class="sr-only">Niche</span>
        <select data-field="filter-niche">
          <option value="alle">Alle niches</option>
          ${niches.map((niche) => html`<option value="${niche}" ${state.ui.filters.niche === niche ? 'selected' : ''}>${niche}</option>`)}
        </select>
      </label>
      <label class="field-inline">
        <span class="sr-only">Regio</span>
        <select data-field="filter-region">
          <option value="alle">Alle regio's</option>
          ${regions.map((region) => html`<option value="${region}" ${state.ui.filters.region === region ? 'selected' : ''}>${region}</option>`)}
        </select>
      </label>
      <label class="field-inline">
        <span class="sr-only">Sorteren</span>
        <select data-field="sort">
          ${[
            ['nieuwste', 'Nieuwste eerst'],
            ['oudste', 'Oudste eerst'],
            ['score', 'Hoogste score'],
            ['naam', 'Naam (A-Z)'],
            ['followup', 'Eerst opvolgen'],
          ].map(([value, label]) => html`<option value="${value}" ${state.ui.sort === value ? 'selected' : ''}>${label}</option>`)}
        </select>
      </label>
      <span class="spacer"></span>
      <span class="muted small">${filteredLeads(state).length} van ${allLeads().length} leads</span>
    </div>
  `;
}

export const pipelineView = {
  id: 'pipeline',
  label: 'Pipeline',
  icon: '▦',

  init(root) {
    on(root, 'click', '[data-action]', async (event, target) => {
      const action = target.dataset.action;
      const state = store.state;

      if (action === 'mode') return store.setUi({ pipelineMode: target.dataset.mode });
      if (action === 'select') {
        selectedId = target.dataset.id;
        return store.emit();
      }
      if (action === 'close-detail') {
        selectedId = null;
        return store.emit();
      }
      if (action === 'add-note') {
        const lead = state.leads.find((item) => item.id === selectedId);
        const textarea = root.querySelector('[data-field="note"]');
        if (!lead || !textarea) return;
        if (!textarea.value.trim()) {
          toastError('Typ eerst een notitie.');
          return;
        }
        store.addNote(lead.id, textarea.value);
        textarea.value = '';
        toastOk('Notitie opgeslagen.');
        return;
      }
      if (action === 'delete-lead') {
        const lead = state.leads.find((item) => item.id === target.dataset.id);
        if (!lead) return;
        const ok = await confirmDialog({
          title: `"${lead.name}" verwijderen?`,
          message: 'Deze lead en de notities verdwijnen uit je pipeline. Dit kan niet terug.',
          confirmLabel: 'Verwijderen',
        });
        if (!ok) return;
        store.removeLead(lead.id);
        selectedId = null;
        store.emit();
        toastOk('Lead verwijderd.');
        return;
      }
      if (action.startsWith('detail-')) {
        const lead = state.leads.find((item) => item.id === target.dataset.id);
        if (!lead) return;
        const email = buildEmail({ lead, audit: lead.audit, settings: state.settings, kind: 'eerste' });
        if (action === 'detail-copy-mail') {
          const ok = await copyToClipboard(email.body);
          return ok ? toastOk('E-mail gekopieerd.') : toastError('Kopiëren lukte niet.');
        }
        if (action === 'detail-copy-whatsapp') {
          const whatsapp = buildWhatsApp({ lead, audit: lead.audit, settings: state.settings });
          const ok = await copyToClipboard(whatsapp.message);
          return ok ? toastOk('WhatsApp-tekst gekopieerd.') : toastError('Kopiëren lukte niet.');
        }
        if (action === 'detail-open-mail') {
          return openMailto({ to: lead.contactEmail ?? '', subject: email.subject, body: email.body });
        }
        if (action === 'detail-mark-sent') {
          store.markEmailSent(lead.id, { kind: 'eerste', variantKey: email.variantKey, subject: email.subject });
          return toastOk('Gemarkeerd als gemaild. Follow-up staat ingepland.');
        }
      }
    });

    on(root, 'change', '[data-field="detail-status"]', (event, target) => {
      store.setStatus(target.dataset.id, target.value);
      toastOk('Status bijgewerkt.');
    });

    on(root, 'change', '[data-field^="filter-"]', (event, target) => {
      const key = target.dataset.field.replace('filter-', '');
      store.setUi({ filters: { ...store.state.ui.filters, [key]: target.value } });
    });

    on(root, 'change', '[data-field="sort"]', (event, target) => {
      store.setUi({ sort: target.value });
    });

    on(root, 'input', '[data-field="filter-search"]', (event, target) => {
      store.setUi({ filters: { ...store.state.ui.filters, search: target.value } });
    });

    // Drag & drop tussen kanbanskolommen.
    let draggingId = null;
    root.addEventListener('dragstart', (event) => {
      const card = event.target.closest('.kanban-card');
      if (!card) return;
      draggingId = card.dataset.id;
      card.classList.add('is-dragging');
      event.dataTransfer?.setData('text/plain', draggingId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    root.addEventListener('dragend', (event) => {
      event.target.closest('.kanban-card')?.classList.remove('is-dragging');
    });
    root.addEventListener('dragover', (event) => {
      const column = event.target.closest('[data-drop-status]');
      if (!column) return;
      event.preventDefault();
      column.classList.add('is-over');
    });
    root.addEventListener('dragleave', (event) => {
      event.target.closest('[data-drop-status]')?.classList.remove('is-over');
    });
    root.addEventListener('drop', (event) => {
      const column = event.target.closest('[data-drop-status]');
      if (!column) return;
      event.preventDefault();
      column.classList.remove('is-over');
      const id = draggingId ?? event.dataTransfer?.getData('text/plain');
      if (!id) return;
      const status = column.dataset.dropStatus;
      store.setStatus(id, status);
      toastOk(`Verplaatst naar "${STATUS_LABELS[status] ?? status}".`);
    });

    // Toegankelijkheid: kanban-kaarten kun je ook met het toetsenbord openen.
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const card = event.target.closest('.kanban-card, tr[data-action="select"]');
      if (!card) return;
      event.preventDefault();
      selectedId = card.dataset.id;
      store.emit();
    });
  },

  render(state) {
    const leads = allLeads();
    const body = html`
      ${toolbar(state)}
      ${leads.length === 0
        ? html`<div class="card empty-state">
            <h2>Je pipeline is nog leeg</h2>
            <p>Zodra je een lead bekijkt, verschijnt hij hier. Bewaar leads die je wilt opvolgen of mail ze direct.</p>
          </div>`
        : state.ui.pipelineMode === 'kanban'
          ? kanban(state)
          : listView(state)}
      ${detailPanel(state)}
      <p class="muted small">
        Tips: sleep kaarten tussen kolommen om de status te wijzigen. Statussen met een reactie:
        ${REPLY_STATUSES.map((status) => STATUS_LABELS[status]).join(', ')}.
      </p>
    `;
    return body;
  },
};
