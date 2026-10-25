/**
 * public/js/views/dashboard.js
 * Cijfers uit je eigen leaddata: hoeveel je mailde, wat het opleverde,
 * per niche, per regio en welke e-mailvariant het beste werkt (A/B).
 *
 * Alles wordt berekend uit je opgeslagen leads - er wordt nooit iets geschat
 * of verzonnen. Zijn er nog geen gegevens, dan zie je dat duidelijk.
 */
import { html } from '../dom.js';
import { computeStats, store } from '../store.js';
import { variantLabel } from '../email/engine.js';
import { formatDate } from '../utils.js';

function kpi(label, value, extra = '') {
  return html`
    <div class="kpi">
      <span class="kpi-value">${value}</span>
      <span class="kpi-label">${label}</span>
      ${extra ? html`<span class="kpi-extra">${extra}</span>` : ''}
    </div>
  `;
}

function groupTable(title, rows, emptyText) {
  const visible = rows.filter((row) => row.total > 0).slice(0, 8);
  return html`
    <section class="card">
      <h3>${title}</h3>
      ${visible.length === 0
        ? html`<p class="muted small">${emptyText}</p>`
        : html`<table class="lead-table compact">
            <thead>
              <tr><th scope="col">${title.includes('regio') ? 'Regio' : 'Niche'}</th><th scope="col">Leads</th><th scope="col">Gemaild</th><th scope="col">Reacties</th><th scope="col">Klanten</th></tr>
            </thead>
            <tbody>
              ${visible.map(
                (row) => html`<tr>
                  <td>${row.label}</td>
                  <td>${row.total}</td>
                  <td>${row.emailed}</td>
                  <td>${row.replies}</td>
                  <td>${row.customers}</td>
                </tr>`
              )}
            </tbody>
          </table>`}
    </section>
  `;
}

export const dashboardView = {
  id: 'dashboard',
  label: 'Dashboard',
  icon: '📊',

  init() {},

  render(state) {
    const stats = computeStats(state.leads);
    const percent = stats.dailyGoal ? Math.min(100, Math.round((stats.todaySent / stats.dailyGoal) * 100)) : 0;

    return html`
      <h2>Cijfers uit je eigen pipeline</h2>
      <div class="kpi-grid">
        ${kpi('Leads bekeken', stats.total)}
        ${kpi('Leads gemaild', stats.emailed)}
        ${kpi('Mails verstuurd', stats.emailsTotal)}
        ${kpi('Reacties', stats.replies, stats.replyRate ? `${stats.replyRate}% van gemaild` : '')}
        ${kpi('Afspraken', stats.meetings)}
        ${kpi('Klanten', stats.customers, stats.conversionRate ? `${stats.conversionRate}% conversie` : '')}
      </div>

      <section class="card">
        <h3>Dagdoel</h3>
        <div class="goal-track" role="progressbar" aria-valuemin="0" aria-valuemax="${stats.dailyGoal}" aria-valuenow="${stats.todaySent}">
          <span style="width:${percent}%"></span>
        </div>
        <p class="muted small">Vandaag ${stats.todaySent} van ${stats.dailyGoal} mails verstuurd.</p>
      </section>

      <section class="card">
        <h3>Verdeling over de pipeline</h3>
        ${stats.total === 0
          ? html`<p class="muted small">Nog geen leads. Begin met "Nieuwe lead" en de cijfers verschijnen hier vanzelf.</p>`
          : html`<ul class="status-bars">
              ${stats.byStatus
                .filter((status) => status.count > 0)
                .map(
                  (status) => html`<li>
                    <span class="status-name"><span class="status-dot" style="background:${status.color}"></span>${status.label}</span>
                    <span class="status-bar"><span style="width:${Math.round((status.count / stats.total) * 100)}%"></span></span>
                    <span class="muted">${status.count}</span>
                  </li>`
                )}
            </ul>`}
      </section>

      <div class="two-col">
        ${groupTable('Niche-prestaties', stats.byNiche, 'Nog geen leads per niche.')}
        ${groupTable('Regio-prestaties', stats.byRegion, 'Nog geen leads per regio.')}
      </div>

      <section class="card">
        <h3>Welke mailvariant werkt? (A/B)</h3>
        ${stats.byVariant.length === 0
          ? html`<p class="muted small">
              Nog geen mailvarianten verstuurd. Elke keer dat je een mail als verstuurd markeert, onthoudt LeadPilot welke
              variant het was. Zo zie je na verloop van tijd welke openingen het beste werken.
            </p>`
          : html`<table class="lead-table compact">
              <thead><tr><th scope="col">Variant</th><th scope="col">Verstuurd</th><th scope="col">Reacties</th><th scope="col">Reactie %</th></tr></thead>
              <tbody>
                ${stats.byVariant.map(
                  (row) => html`<tr>
                    <td>${variantLabel(row.variant)}</td>
                    <td>${row.sent}</td>
                    <td>${row.replies}</td>
                    <td>${row.sent ? `${Math.round((row.replies / row.sent) * 1000) / 10}%` : '-'}</td>
                  </tr>`
                )}
              </tbody>
            </table>`}
      </section>

      <p class="muted small">
        Alle cijfers komen uit je eigen opgeslagen leads (${formatDate(new Date().toISOString())}). Reacties tel je door de status
        van een lead op "Reactie", "Afspraak" of "Klant" te zetten.
      </p>
    `;
  },
};
