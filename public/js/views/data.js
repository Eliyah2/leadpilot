/**
 * public/js/views/data.js
 * Importeren, exporteren en wissen.
 *
 * - CSV: handig om leads uit een spreadsheet of handmatige zoekactie te halen
 *   (en om je lijst in Excel te openen).
 * - JSON: volledige back-up van instellingen, leads en geschiedenis.
 * - Wissen: de knop voor "verwijder alle data" (AVG).
 */
import { confirmDialog, html, on } from '../dom.js';
import { toastError, toastOk } from '../ui/toast.js';
import { STATUSES, store } from '../store.js';
import { storage } from '../storage.js';
import { CSV_COLUMNS, csvFilename, csvToLeads, leadsToCsv } from '../csv.js';
import { downloadFile, safeParse, todayISO } from '../utils.js';

function readFile(input) {
  return new Promise((resolve, reject) => {
    const file = input.files?.[0];
    if (!file) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Het bestand kon niet gelezen worden.'));
    reader.readAsText(file, 'utf-8');
  });
}

export const dataView = {
  id: 'data',
  label: 'Data & AVG',
  icon: '⇄',

  init(root) {
    on(root, 'click', '[data-action]', async (event, target) => {
      const action = target.dataset.action;
      const state = store.state;

      if (action === 'export-csv') {
        if (!state.leads.length) {
          toastError('Er zijn nog geen leads om te exporteren.');
          return;
        }
        downloadFile(csvFilename(), leadsToCsv(state.leads), 'text/csv;charset=utf-8');
        toastOk(`${state.leads.length} leads geëxporteerd.`);
        return;
      }

      if (action === 'export-json') {
        const backup = {
          app: 'LeadPilot',
          version: 1,
          exportedAt: new Date().toISOString(),
          settings: state.settings,
          leads: state.leads,
          seen: state.seen,
          today: storage.get('today', null),
          meta: state.meta,
        };
        downloadFile(`leadpilot-backup-${todayISO()}.json`, JSON.stringify(backup, null, 2), 'application/json');
        toastOk('Back-up gedownload.');
        return;
      }

      if (action === 'import-csv') {
        const input = root.querySelector('[data-file="csv"]');
        input?.click();
        return;
      }

      if (action === 'import-json') {
        const input = root.querySelector('[data-file="json"]');
        input?.click();
        return;
      }

      if (action === 'wipe') {
        const ok = await confirmDialog({
          title: 'Alle data verwijderen?',
          message: 'Je leads, notities, instellingen en geschiedenis worden definitief van dit apparaat verwijderd. Exporteer eerst een back-up als je die wilt bewaren.',
          confirmLabel: 'Alles verwijderen',
        });
        if (!ok) return;
        store.wipeAll();
        toastOk('Alle data verwijderd.');
        return;
      }

      if (action === 'cleanup-duplicates') {
        const seen = new Map();
        let removed = 0;
        state.leads.forEach((lead) => {
          const key = lead.placeId || lead.website || lead.phone || lead.id;
          if (seen.has(key)) removed += 1;
          else seen.set(key, lead.id);
        });
        if (removed === 0) {
          toastOk('Geen dubbele leads gevonden.');
          return;
        }
        const kept = state.leads.filter((lead, position) => {
          const key = lead.placeId || lead.website || lead.phone || lead.id;
          return state.leads.findIndex((item) => (item.placeId || item.website || item.phone || item.id) === key) === position;
        });
        store.replaceAll({ leads: kept });
        toastOk(`${removed} dubbele lead(s) verwijderd.`);
      }
    });

    on(root, 'change', '[data-file]', async (event, target) => {
      const kind = target.dataset.file;
      try {
        const text = await readFile(target);
        target.value = '';
        if (!text) return;

        if (kind === 'csv') {
          const { leads, skipped } = csvToLeads(text);
          if (!leads.length) {
            toastError('Geen bruikbare rijen gevonden. Controleer of de kolom "bedrijfsnaam" bestaat.');
            return;
          }
          const existing = store.state.leads;
          const merged = [];
          let duplicates = 0;
          leads.forEach((lead) => {
            const isDuplicate = existing.some(
              (item) =>
                (lead.placeId && item.placeId === lead.placeId) ||
                (lead.website && item.website === lead.website) ||
                (lead.phone && item.phone === lead.phone)
            );
            if (isDuplicate) duplicates += 1;
            else merged.push(lead);
          });
          store.replaceAll({ leads: [...merged, ...existing] });
          toastOk(`${merged.length} lead(s) geïmporteerd${duplicates ? `, ${duplicates} dubbel overgeslagen` : ''}${skipped ? `, ${skipped} rij(en) zonder naam` : ''}.`);
          return;
        }

        if (kind === 'json') {
          const backup = safeParse(text);
          if (!backup || typeof backup !== 'object') {
            toastError('Dit lijkt geen geldig back-upbestand.');
            return;
          }
          const ok = await confirmDialog({
            title: 'Back-up terugzetten?',
            message: `Dit vervangt je huidige gegevens door de back-up van ${backup.exportedAt ? new Date(backup.exportedAt).toLocaleString('nl-NL') : 'onbekende datum'} (${backup.leads?.length ?? 0} leads).`,
            confirmLabel: 'Terugzetten',
          });
          if (!ok) return;
          if (backup.today) storage.set('today', backup.today);
          else storage.remove('today');
          store.replaceAll({
            settings: backup.settings,
            leads: Array.isArray(backup.leads) ? backup.leads : [],
            seen: backup.seen,
            meta: backup.meta,
          });
          toastOk('Back-up teruggezet.');
        }
      } catch (error) {
        toastError(error.message ?? 'Het bestand kon niet verwerkt worden.');
      }
    });
  },

  render(state) {
    const info = storage.info();
    const statusCounts = STATUSES.map((status) => ({
      label: status.label,
      count: state.leads.filter((lead) => lead.status === status.id).length,
    })).filter((row) => row.count > 0);

    return html`
      <h2>Data & AVG</h2>
      <p class="muted">
        Je gegevens staan in <strong>${info.driver}</strong> op dit apparaat (${Math.round(info.bytes / 1024)} kB).
        Er gaat niets naar buiten, behalve de zoekopdracht naar Google Places en de website-analyse.
      </p>

      <section class="card">
        <h3>Exporteren</h3>
        <p class="muted small">Een CSV-bestand opent in Excel of Google Sheets. Een JSON-back-up bevat álles: instellingen, leads, notities en geschiedenis.</p>
        <div class="lead-actions">
          <button type="button" class="btn btn-primary" data-action="export-csv">CSV exporteren (${state.leads.length} leads)</button>
          <button type="button" class="btn" data-action="export-json">JSON-back-up maken</button>
        </div>
      </section>

      <section class="card">
        <h3>Importeren</h3>
        <p class="muted small">
          CSV-kolommen die herkend worden: ${CSV_COLUMNS.map(([label]) => label).join(', ')}. Alleen "bedrijfsnaam" is verplicht.
          Dubbele leads (zelfde website of telefoonnummer) worden overgeslagen.
        </p>
        <div class="lead-actions">
          <button type="button" class="btn" data-action="import-csv">CSV importeren</button>
          <button type="button" class="btn" data-action="import-json">JSON-back-up terugzetten</button>
        </div>
        <input type="file" accept=".csv,text/csv" data-file="csv" class="sr-only" aria-label="CSV-bestand kiezen" />
        <input type="file" accept=".json,application/json" data-file="json" class="sr-only" aria-label="JSON-back-up kiezen" />
      </section>

      <section class="card">
        <h3>Opschonen</h3>
        ${statusCounts.length
          ? html`<ul class="plain">${statusCounts.map((row) => html`<li>${row.label}: <strong>${row.count}</strong></li>`)}</ul>`
          : html`<p class="muted small">Nog geen leads opgeslagen.</p>`}
        <div class="lead-actions">
          <button type="button" class="btn btn-ghost" data-action="cleanup-duplicates">Dubbele leads opruimen</button>
        </div>
      </section>

      <section class="card danger-zone">
        <h3>Alles verwijderen</h3>
        <p class="muted small">
          Verwijdert je leads, notities, instellingen en geziene bedrijven van dit apparaat. Gebruik je synchronisatie,
          wis dan ook de opgeslagen gegevens in Vercel KV. Deze actie kan niet ongedaan worden gemaakt.
        </p>
        <button type="button" class="btn btn-danger" data-action="wipe">Verwijder alle data</button>
      </section>
    `;
  },
};

export { CSV_COLUMNS };
