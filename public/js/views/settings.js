/**
 * public/js/views/settings.js
 * Alles wat je eenmalig instelt: niche, regio, filter, taal, toon, je eigen
 * gegevens, dagdoel en synchronisatie.
 *
 * Tekstvelden werken met `silent: true`: dat slaat direct op, maar rendert de
 * pagina niet opnieuw, zodat je cursor in het veld blijft staan.
 */
import { confirmDialog, html, on } from '../dom.js';
import { toastError, toastOk } from '../ui/toast.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { storage } from '../storage.js';
import { CATEGORY_LABELS, NICHES, allNiches, createCustomNiche } from '../config/niches.js';
import { RADIUS_OPTIONS, REGIONS, createCustomRegion, regionsForCountry } from '../config/regions.js';

const QUALITY_FILTERS = [
  ['alles', 'Alles (aanbevolen om te starten)'],
  ['geen-website', 'Alleen bedrijven zonder website (grootste kans)'],
  ['verouderde-website', 'Alleen verouderde websites (website-score onder 70)'],
  ['weinig-reviews', 'Alleen bedrijven met weinig reviews'],
];

function nicheOptions(settings) {
  const custom = settings.customNiches ?? [];
  return html`
    <optgroup label="Willekeurig">
      <option value="random" ${settings.nicheId === 'random' ? 'selected' : ''}>Willekeurige niche</option>
    </optgroup>
    <optgroup label="Vaste niches">          ${NICHES.map(
        (niche) => html`<option value="${niche.id}" ${settings.nicheId === niche.id ? 'selected' : ''}
          title="NL: ${niche.terms.nl}${niche.alt?.nl ? ` / ${niche.alt.nl}` : ''} · DE: ${niche.terms.de}${niche.alt?.de ? ` / ${niche.alt.de}` : ''}">
          ${niche.label} (${niche.terms.nl} / ${niche.terms.de})
        </option>`
      )}
    </optgroup>
    ${custom.length
      ? html`<optgroup label="Eigen niches">
          ${custom.map(
            (niche) => html`<option value="${niche.id}" ${settings.nicheId === niche.id ? 'selected' : ''}>${niche.label}</option>`
          )}
        </optgroup>`
      : ''}
  `;
}

function regionOptions(settings) {
  const custom = settings.customRegions ?? [];
  const nl = regionsForCountry('NL');
  const de = regionsForCountry('DE');
  const option = (region) => html`<option value="${region.id}" ${settings.regionId === region.id ? 'selected' : ''}>
    ${region.label}${region.lat ? '' : ' (heel het gebied)'}
  </option>`;
  return html`
    <optgroup label="Willekeurig">
      <option value="random" ${settings.regionId === 'random' ? 'selected' : ''}>Willekeurige regio</option>
    </optgroup>
    <optgroup label="Nederland">${nl.map(option)}</optgroup>
    <optgroup label="Duitsland">${de.map(option)}</optgroup>
    ${custom.length ? html`<optgroup label="Eigen plaatsen">${custom.map(option)}</optgroup>` : ''}
  `;
}

export const settingsView = {
  id: 'settings',
  label: 'Instellingen',
  icon: '⚙',

  init(root) {
    on(root, 'change', '[data-setting]', (event, target) => {
      const key = target.dataset.setting;
      let value = target.value;
      if (target.type === 'checkbox') value = target.checked;
      else if (target.type === 'number') value = Number(value) || 0;
      // Selects met ja/nee-opties geven tekst terug; die zetten we om naar een boolean.
      else if (key === 'autoAudit' || key === 'rememberPassword') value = value === 'true';
      store.updateSettings({ [key]: value });
    });

    on(root, 'input', '[data-setting-number]', (event, target) => {
      store.updateSettings({ [target.dataset.settingNumber]: Number(target.value) || 0 }, { silent: true });
    });

    on(root, 'input', '[data-sender]', (event, target) => {
      store.updateSender({ [target.dataset.sender]: target.value }, { silent: true });
    });

    on(root, 'click', '[data-action]', async (event, target) => {
      const action = target.dataset.action;

      if (action === 'add-niche') {
        const label = root.querySelector('[data-new-niche="label"]')?.value ?? '';
        const nl = root.querySelector('[data-new-niche="nl"]')?.value ?? '';
        const de = root.querySelector('[data-new-niche="de"]')?.value ?? '';
        const niche = createCustomNiche({ label, nl, de });
        if (!niche) {
          toastError('Vul in ieder geval een naam in voor de niche.');
          return;
        }
        if (allNiches(store.settings.customNiches ?? []).some((item) => item.id === niche.id)) {
          toastError('Deze niche bestaat al.');
          return;
        }
        store.updateSettings({
          customNiches: [...(store.settings.customNiches ?? []), niche],
          nicheId: niche.id,
        });
        toastOk(`Niche "${niche.label}" toegevoegd.`);
        return;
      }

      if (action === 'add-region') {
        const label = root.querySelector('[data-new-region="label"]')?.value ?? '';
        const country = root.querySelector('[data-new-region="country"]')?.value ?? 'NL';
        const radius = Number(root.querySelector('[data-new-region="radius"]')?.value ?? 10);
        const region = createCustomRegion({ label, country, radiusKm: radius });
        if (!region) {
          toastError('Vul een plaatsnaam in.');
          return;
        }
        store.updateSettings({
          customRegions: [...(store.settings.customRegions ?? []), region],
          regionId: region.id,
          radiusKm: radius,
        });
        toastOk(`Plaats "${region.label}" toegevoegd.`);
        return;
      }

      if (action === 'reset-seen') {
        const ok = await confirmDialog({
          title: 'Geziene leads wissen?',
          message: 'Je krijgt dan weer bedrijven te zien die je eerder al had.',
          confirmLabel: 'Wissen',
        });
        if (ok) {
          store.resetSeen();
          toastOk('Geziene lijst gewist.');
        }
        return;
      }

      if (action === 'test-sync') {
        try {
          const health = await api.health();
          if (health.checks?.kvSync === 'actief') toastOk('Synchronisatie is actief.');
          else toastError('Synchronisatie is nog niet ingesteld in Vercel (UPSTASH-variabelen).');
        } catch (error) {
          toastError(error.message);
        }
        return;
      }

      if (action === 'logout') {
        try {
          await api.logout();
        } catch {
          /* cookie wissen mag mislukken; we loggen lokaal alsnog uit */
        }
        api.clearPassword();
        toastOk('Uitgelogd op dit apparaat.');
        location.reload();
        return;
      }
    });
  },

  render(state) {
    const settings = state.settings;
    const storageInfo = storage.info();
    const auth = state.meta?.auth ?? { passwordRequired: false, authenticated: true };

    return html`
      <h2>Instellingen</h2>
      <p class="muted">Alles hier wordt automatisch bewaard en bij elke nieuwe lead gebruikt.</p>

      <section class="card">
        <h3>Zoeken</h3>
        <p class="muted small">
          Vindt een zoekopdracht niets bruikbaars, dan probeert LeadPilot automatisch de alternatieve branchenaam
          (bijvoorbeeld "Herrenfriseur" naast "Barbershop"), daarna dezelfde zoekopdracht zonder straalbeperking en
          als laatste heel het land. Je krijgt dus altijd te zien wat er geprobeerd is.
        </p>
        <div class="settings-grid">
          <label class="field">
            <span>Niche</span>
            <select data-setting="nicheId">${nicheOptions(settings)}</select>
          </label>
          <label class="field">
            <span>Regio</span>
            <select data-setting="regionId">${regionOptions(settings)}</select>
          </label>
          <label class="field">
            <span>Straal rond de regio</span>
            <select data-setting="radiusKm">
              ${RADIUS_OPTIONS.map(
                (radius) => html`<option value="${radius}" ${Number(settings.radiusKm) === radius ? 'selected' : ''}>${radius} km</option>`
              )}
            </select>
            <span class="muted small">Google staat maximaal 50 km toe; bij 100 km zoekt LeadPilot met 50 km.</span>
          </label>
          <label class="field">
            <span>Filter op lead-kwaliteit</span>
            <select data-setting="qualityFilter">
              ${QUALITY_FILTERS.map(
                ([value, label]) => html`<option value="${value}" ${settings.qualityFilter === value ? 'selected' : ''}>${label}</option>`
              )}
            </select>
          </label>
          <label class="field">
            <span>Taal van de e-mail</span>
            <select data-setting="languageMode">
              <option value="auto" ${settings.languageMode === 'auto' ? 'selected' : ''}>Automatisch (NL bij NL, Duits bij DE)</option>
              <option value="nl" ${settings.languageMode === 'nl' ? 'selected' : ''}>Altijd Nederlands</option>
              <option value="de" ${settings.languageMode === 'de' ? 'selected' : ''}>Altijd Duits</option>
            </select>
          </label>
          <label class="field">
            <span>Toon</span>
            <select data-setting="toneMode">
              <option value="auto" ${settings.toneMode === 'auto' ? 'selected' : ''}>Automatisch (NL informeel, DE formeel)</option>
              <option value="informeel" ${settings.toneMode === 'informeel' ? 'selected' : ''}>Informeel (je/du)</option>
              <option value="formeel" ${settings.toneMode === 'formeel' ? 'selected' : ''}>Formeel (u/Sie)</option>
            </select>
          </label>
          <label class="field">
            <span>Website automatisch analyseren</span>
            <select data-setting="autoAudit">
              <option value="true" ${settings.autoAudit ? 'selected' : ''}>Ja (aanbevolen)</option>
              <option value="false" ${settings.autoAudit ? '' : 'selected'}>Nee, alleen op verzoek</option>
            </select>
          </label>
          <label class="field">
            <span>Dagdoel (mails per dag)</span>
            <input type="number" min="1" max="100" data-setting-number="dailyGoal" value="${settings.dailyGoal}" />
          </label>
        </div>
      </section>

      <section class="card">
        <h3>Eigen niche toevoegen</h3>
        <p class="muted small">
          Handig voor een branche die er niet bij staat. Vul de zoekterm in het Nederlands en het Duits in, zodat de
          zoekopdracht per land klopt. Eigen niches gebruiken de algemene e-mailteksten.
        </p>
        <div class="settings-grid">
          <label class="field"><span>Naam</span><input type="text" data-new-niche="label" placeholder="bijv. rijschool" /></label>
          <label class="field"><span>Zoekterm NL</span><input type="text" data-new-niche="nl" placeholder="rijschool" /></label>
          <label class="field"><span>Zoekterm DE</span><input type="text" data-new-niche="de" placeholder="Fahrschule" /></label>
        </div>
        <button type="button" class="btn" data-action="add-niche">Niche toevoegen</button>
        ${(settings.customNiches ?? []).length
          ? html`<p class="muted small">Eigen niches: ${(settings.customNiches ?? []).map((niche) => niche.label).join(', ')}</p>`
          : ''}
      </section>

      <section class="card">
        <h3>Eigen plaats toevoegen</h3>
        <div class="settings-grid">
          <label class="field"><span>Plaatsnaam</span><input type="text" data-new-region="label" placeholder="bijv. Tegelen" /></label>
          <label class="field">
            <span>Land</span>
            <select data-new-region="country">
              <option value="NL">Nederland</option>
              <option value="DE">Duitsland</option>
            </select>
          </label>
          <label class="field">
            <span>Straal</span>
            <select data-new-region="radius">
              ${RADIUS_OPTIONS.map((radius) => html`<option value="${radius}" ${radius === 10 ? 'selected' : ''}>${radius} km</option>`)}
            </select>
          </label>
        </div>
        <button type="button" class="btn" data-action="add-region">Plaats toevoegen</button>
        <p class="muted small">Vrije plaatsen worden als tekst gezocht (bijv. "kapper in Tegelen"), niet met coördinaten.</p>
      </section>

      <section class="card">
        <h3>Mijn gegevens</h3>
        <p class="muted small">Deze gegevens komen onder elke e-mail te staan. Vul ze één keer goed in.</p>
        <div class="settings-grid">
          <label class="field"><span>Naam</span><input type="text" data-sender="name" value="${settings.sender.name}" placeholder="Eliyah" /></label>
          <label class="field"><span>Bedrijfsnaam</span><input type="text" data-sender="company" value="${settings.sender.company}" /></label>
          <label class="field"><span>Telefoon</span><input type="tel" data-sender="phone" value="${settings.sender.phone}" placeholder="+31 6 ..." /></label>
          <label class="field"><span>E-mailadres (afzender)</span><input type="email" data-sender="email" value="${settings.sender.email}" placeholder="info@..." /></label>
          <label class="field"><span>Website</span><input type="url" data-sender="website" value="${settings.sender.website}" /></label>
          <label class="field"><span>Portfolio-link (optioneel)</span><input type="url" data-sender="portfolio" value="${settings.sender.portfolio}" /></label>
        </div>
      </section>

      <section class="card">
        <h3>Weergave en toegang</h3>
        <div class="settings-grid">
          <label class="field">
            <span>Thema</span>
            <select data-setting="theme">
              <option value="system" ${settings.theme === 'system' ? 'selected' : ''}>Automatisch (systeem)</option>
              <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Licht</option>
              <option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>Donker</option>
            </select>
          </label>
          <label class="field">
            <span>Wachtwoord onthouden op dit apparaat</span>
            <select data-setting="rememberPassword">
              <option value="true" ${settings.rememberPassword ? 'selected' : ''}>Ja</option>
              <option value="false" ${settings.rememberPassword ? '' : 'selected'}>Nee, elke keer opnieuw intypen</option>
            </select>
          </label>
        </div>
        <p class="muted small">
          Toegang: ${auth.passwordRequired ? 'wachtwoord ingesteld (aanbevolen)' : html`<strong>geen wachtwoord ingesteld</strong> - zet APP_PASSWORD in Vercel, anders kan iedereen je API-tegoed gebruiken`}.
        </p>
        <div class="lead-actions">
          <button type="button" class="btn btn-ghost" data-action="logout">Uitloggen op dit apparaat</button>
          <button type="button" class="btn btn-ghost" data-action="reset-seen">Geziene leads wissen</button>
        </div>
      </section>

      <section class="card">
        <h3>Opslag en synchronisatie</h3>
        <ul class="plain">
          <li>Opslag: <strong>${storageInfo.driver}</strong></li>
          <li>Synchroniseren tussen apparaten: <strong>${storageInfo.sync === 'aan' ? 'aan' : 'uit'}</strong></li>
          <li>Gebruikte ruimte: <strong>${Math.round(storageInfo.bytes / 1024)} kB</strong></li>
          <li>Analyse-categorieën: ${Object.keys(CATEGORY_LABELS).length} (${Object.values(CATEGORY_LABELS).slice(0, 4).join(', ')}, enz.)</li>
        </ul>
        <p class="muted small">
          Wil je op je telefoon en laptop dezelfde pipeline? Zet dan in Vercel de variabelen
          UPSTASH_REDIS_REST_URL en UPSTASH_REDIS_REST_TOKEN (Vercel KV levert die automatisch).
        </p>
        <button type="button" class="btn btn-ghost" data-action="test-sync">Synchronisatie testen</button>
      </section>
    `;
  },
};
