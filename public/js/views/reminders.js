/**
 * public/js/views/reminders.js
 * "Vandaag opvolgen": leads waarvan de follow-updatum is bereikt, met de
 * juiste mail al klaar (follow-up 1, follow-up 2 of het laatste bericht).
 */
import { html, on } from '../dom.js';
import { toastError, toastOk } from '../ui/toast.js';
import { store } from '../store.js';
import { buildEmail } from '../email/engine.js';
import { copyToClipboard, formatDate, openMailto, relativeDays, todayISO } from '../utils.js';

/** Welke mail hoort bij deze fase van de opvolging? */
function kindForLead(lead) {
  const stage = lead.followUpStage ?? 1;
  if (stage <= 1) return 'followup1';
  if (stage === 2) return 'followup2';
  return 'laatste';
}

const KIND_LABELS = {
  followup1: 'Follow-up 1 (vriendelijke herinnering)',
  followup2: 'Follow-up 2 (met extra tip)',
  laatste: 'Laatste bericht',
};

function progressBar(state) {
  const sent = store.emailsSentToday();
  const goal = state.settings.dailyGoal || 10;
  const percent = Math.min(100, Math.round((sent / goal) * 100));
  return html`
    <div class="goal">
      <div class="goal-head">
        <strong>Dagdoel: ${sent} / ${goal} mails</strong>
        <span class="muted small">${percent}%</span>
      </div>
      <div class="goal-track" role="progressbar" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${sent}">
        <span style="width:${percent}%"></span>
      </div>
      <p class="muted small">
        ${sent >= goal
          ? 'Dagdoel gehaald. Mooi werk - meer mag, hoeft niet.'
          : `Nog ${goal - sent} mail${goal - sent === 1 ? '' : 's'} te gaan vandaag.`}
      </p>
    </div>
  `;
}

export const remindersView = {
  id: 'reminders',
  label: 'Vandaag opvolgen',
  icon: '⏰',

  init(root) {
    on(root, 'click', '[data-action]', async (event, target) => {
      const lead = store.state.leads.find((item) => item.id === target.dataset.id);
      if (!lead) return;
      const kind = kindForLead(lead);
      const email = buildEmail({ lead, audit: lead.audit, settings: store.settings, kind });

      const action = target.dataset.action;
      if (action === 'copy-followup') {
        const ok = await copyToClipboard(`Onderwerp: ${email.subject}\n\n${email.body}`);
        return ok ? toastOk('Follow-up gekopieerd.') : toastError('Kopiëren lukte niet.');
      }
      if (action === 'open-followup') {
        return openMailto({ to: lead.contactEmail ?? '', subject: email.subject, body: email.body });
      }
      if (action === 'mark-followup-sent') {
        store.markEmailSent(lead.id, { kind, variantKey: email.variantKey, subject: email.subject });
        return toastOk('Follow-up geregistreerd.');
      }
      if (action === 'push-week') {
        const next = new Date();
        next.setDate(next.getDate() + 7);
        store.updateLead(lead.id, { followUpAt: next.toISOString().slice(0, 10) });
        store.emit();
        return toastOk('Een week vooruitgeschoven.');
      }
      if (action === 'mark-no-interest') {
        store.setStatus(lead.id, 'niet-geinteresseerd');
        return toastOk('Op "niet geïnteresseerd" gezet.');
      }
      if (action === 'goto-lead') {
        return store.setUi({ view: 'lead' });
      }
    });
  },

  render(state) {
    const today = todayISO();
    const due = store.dueFollowUps(today);
    const later = state.leads
      .filter((lead) => lead.followUpAt && lead.followUpAt > today)
      .filter((lead) => !['klant', 'niet-geinteresseerd', 'overgeslagen'].includes(lead.status))
      .sort((a, b) => String(a.followUpAt).localeCompare(String(b.followUpAt)))
      .slice(0, 10);

    return html`
      ${progressBar(state)}

      <h2>Vandaag opvolgen (${due.length})</h2>
      ${due.length === 0
        ? html`<div class="card empty-state">
            <h2>Niets te doen vandaag</h2>
            <p>Zodra je een mail verstuurt, plant LeadPilot automatisch een follow-up in. Die verschijnt hier op de juiste dag.</p>
          </div>`
        : due.map((lead) => {
            const kind = kindForLead(lead);
            const email = buildEmail({ lead, audit: lead.audit, settings: state.settings, kind });
            return html`
              <article class="card followup-card">
                <header>
                  <div>
                    <h3>${lead.name}</h3>
                    <p class="muted small">
                      ${lead.nicheLabel ?? ''} · ${lead.city || ''} ·
                      gepland ${formatDate(lead.followUpAt)} (${relativeDays(lead.followUpAt)})
                    </p>
                  </div>
                  <span class="chip">${KIND_LABELS[kind]}</span>
                </header>
                <p class="small"><strong>Onderwerp:</strong> ${email.subject}</p>
                <pre class="mail-preview">${email.body}</pre>
                <div class="lead-actions">
                  <button type="button" class="btn btn-primary btn-sm" data-action="copy-followup" data-id="${lead.id}">Kopieer follow-up</button>
                  <button type="button" class="btn btn-sm" data-action="open-followup" data-id="${lead.id}">Open in mailapp</button>
                  <button type="button" class="btn btn-sm" data-action="mark-followup-sent" data-id="${lead.id}">Markeer als verstuurd</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-action="push-week" data-id="${lead.id}">Week later</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-action="mark-no-interest" data-id="${lead.id}">Geen interesse</button>
                </div>
              </article>
            `;
          })}

      <h2>Gepland voor later (${later.length})</h2>
      ${later.length === 0
        ? html`<p class="muted">Geen geplande opvolgingen.</p>`
        : html`<div class="card table-wrap">
            <table class="lead-table">
              <thead>
                <tr><th scope="col">Bedrijf</th><th scope="col">Status</th><th scope="col">Opvolgdatum</th><th scope="col">Actie</th></tr>
              </thead>
              <tbody>
                ${later.map(
                  (lead) => html`<tr>
                    <td>${lead.name}<br /><span class="muted small">${lead.city || ''}</span></td>
                    <td>${lead.status}</td>
                    <td>${formatDate(lead.followUpAt)}<br /><span class="muted small">${relativeDays(lead.followUpAt)}</span></td>
                    <td><button type="button" class="btn btn-ghost btn-sm" data-action="goto-lead" data-id="${lead.id}">Naar lead</button></td>
                  </tr>`
                )}
              </tbody>
            </table>
          </div>`}
    `;
  },
};
