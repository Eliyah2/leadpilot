/**
 * public/js/app.js
 * Start de applicatie: thema, router, toegangspoort, synchronisatie en
 * sneltoetsen. Alle views worden hier aan elkaar geknoopt.
 */
import { html, on, setContent } from './dom.js';
import { toastError, toastInfo, toastOk } from './ui/toast.js';
import { store } from './store.js';
import { storage } from './storage.js';
import { api } from './api.js';
import { leadView } from './views/lead.js';
import { todayView } from './views/today.js';
import { pipelineView } from './views/pipeline.js';
import { remindersView } from './views/reminders.js';
import { dashboardView } from './views/dashboard.js';
import { settingsView } from './views/settings.js';
import { dataView } from './views/data.js';
import { avgView } from './views/avg.js';

const VIEWS = [todayView, leadView, pipelineView, remindersView, dashboardView, settingsView, dataView, avgView];
const DEFAULT_VIEW = 'today';

let currentView = null;
let syncApplied = false;

// ── Thema ────────────────────────────────────────────────────────────────

function applyTheme() {
  const theme = store.settings.theme ?? 'system';
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  const button = document.getElementById('theme-toggle');
  if (button) {
    const labels = { system: 'Thema: systeem', light: 'Thema: licht', dark: 'Thema: donker' };
    button.textContent = theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐';
    button.setAttribute('aria-label', `${labels[theme]} - klik om te wisselen`);
    button.title = labels[theme];
  }
}

function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(store.settings.theme ?? 'system') + 1) % order.length];
  store.updateSettings({ theme: next });
}

// ── Router ───────────────────────────────────────────────────────────────

function navigate(viewId) {
  const view = VIEWS.find((item) => item.id === viewId) ?? VIEWS[0];
  currentView = view;
  store.setUi({ view: view.id }, { silent: true });
  if (location.hash !== `#/${view.id}`) history.replaceState(null, '', `#/${view.id}`);
  render();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function viewFromHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  return VIEWS.some((view) => view.id === hash) ? hash : DEFAULT_VIEW;
}

// ── Renderen ─────────────────────────────────────────────────────────────

function renderNav() {
  const nav = document.getElementById('main-nav');
  if (!nav) return;
  setContent(
    nav,
    VIEWS.map(
      (view) => html`<button type="button" class="nav-item ${view.id === currentView?.id ? 'is-active' : ''}"
        data-nav="${view.id}" ${view.id === currentView?.id ? 'aria-current="page"' : ''}>
        <span class="nav-icon" aria-hidden="true">${view.icon}</span><span>${view.label}</span>
      </button>`
    )
  );
}

function render() {
  const viewRoot = document.getElementById('view-root');
  if (!viewRoot || !currentView) return;
  const state = store.state;
  setContent(viewRoot, currentView.render(state));
  renderNav();
  document.title = `LeadPilot · ${currentView.label}`;
  applyTheme();
}

// ── Toegangspoort ────────────────────────────────────────────────────────

function showLogin(message = '') {
  const overlay = document.getElementById('login');
  if (!overlay) return;
  setContent(
    overlay,
    html`
      <form class="login-card" id="login-form">
        <h1>LeadPilot</h1>
        <p class="muted">Deze app is beveiligd met een wachtwoord (APP_PASSWORD).</p>
        ${message ? html`<p class="notice notice-warn">${message}</p>` : ''}
        <label class="field">
          <span>Wachtwoord</span>
          <input type="password" id="login-password" autocomplete="current-password" required />
        </label>
        <label class="checkbox">
          <input type="checkbox" id="login-remember" ${store.settings.rememberPassword ? 'checked' : ''} />
          <span>Onthouden op dit apparaat</span>
        </label>
        <button type="submit" class="btn btn-primary">Inloggen</button>
        <p class="muted small">
          Zet APP_PASSWORD in Vercel (Settings → Environment Variables) en deel het met niemand.
        </p>
      </form>
    `,
  );
  overlay.hidden = false;
  const form = document.getElementById('login-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = document.getElementById('login-password')?.value ?? '';
    const remember = document.getElementById('login-remember')?.checked ?? true;
    try {
      await api.login(password);
      api.setPassword(password, { remember });
      store.updateSettings({ rememberPassword: remember }, { silent: true });
      overlay.hidden = true;
      setContent(overlay, '');
      toastOk('Welkom terug.');
      render();
    } catch (error) {
      showLogin(error.message);
    }
  });
}

async function checkAccess() {
  try {
    const session = await api.session();
    store.state.meta = { ...store.state.meta, auth: { passwordRequired: session.passwordRequired, authenticated: session.authenticated } };
    // Een wachtwoord nodig maar (nog) niet binnen? Dan proberen we het bewaarde
    // wachtwoord opnieuw, zodat ook het HttpOnly-cookie gezet wordt.
    if (session.passwordRequired && !session.authenticated) {
      const stored = api.getPassword();
      if (!stored) {
        showLogin();
        return false;
      }
      try {
        await api.login(stored);
      } catch {
        api.clearPassword();
        showLogin('Je opgeslagen wachtwoord klopt niet meer. Vul het opnieuw in.');
        return false;
      }
    }
    return true;
  } catch (error) {
    if (error.code === 'unauthorized') {
      showLogin(error.message);
      return false;
    }
    // Server niet bereikbaar: de app blijft werken met lokale data.
    toastInfo('Geen verbinding met de server. Je lokale leads blijven beschikbaar.');
    return true;
  }
}

// ── Synchronisatie tussen apparaten ──────────────────────────────────────

function mergeLeads(localLeads, remoteLeads) {
  const byId = new Map();
  [...remoteLeads, ...localLeads].forEach((lead) => {
    const key = lead?.id ?? lead?.placeId ?? lead?.name;
    if (!key) return;
    const existing = byId.get(key);
    if (!existing || String(lead.updatedAt ?? '') > String(existing.updatedAt ?? '')) byId.set(key, lead);
  });
  return [...byId.values()];
}

async function enableSync() {
  storage.remote.enabled = true;
  storage.remote.save = (key, value) => api.statePut(key, value);

  try {
    const remote = await api.stateGet('leads');
    const remoteLeads = Array.isArray(remote.value) ? remote.value : [];
    const merged = mergeLeads(store.state.leads, remoteLeads);
    if (merged.length !== store.state.leads.length) {
      store.replaceAll({ leads: merged });
      toastInfo('Leads van je andere apparaat samengevoegd.');
    }
    await api.statePut('leads', store.state.leads);
    await api.statePut('settings', store.settings);
    syncApplied = true;
  } catch (error) {
    if (error.code === 'kv_not_configured') {
      storage.remote.enabled = false;
      toastError('Synchronisatie is niet ingesteld in Vercel. Voeg de KV-variabelen toe.');
    } else {
      toastError(`Synchroniseren mislukt: ${error.message}`);
    }
  }
}

function watchSyncSetting() {
  const wanted = Boolean(store.settings.syncEnabled);
  if (wanted && !syncApplied) enableSync();
  if (!wanted && syncApplied) {
    storage.remote.enabled = false;
    storage.remote.save = null;
    syncApplied = false;
  }
}

// ── Sneltoetsen ──────────────────────────────────────────────────────────

function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function setupShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTyping(event.target)) return;
    const key = event.key.toLowerCase();

    if (key === 'n') {
      event.preventDefault();
      navigate('lead');
      document.querySelector('[data-action="new-lead"]')?.click();
      return;
    }
    if (key === 'c') {
      event.preventDefault();
      const button = document.querySelector('[data-action="copy-email"]');
      if (button) button.click();
      else toastInfo('Ga naar een lead om de mail te kopiëren.');
      return;
    }
    if (key === 's') {
      event.preventDefault();
      const button = document.querySelector('[data-action="skip"]');
      if (button) button.click();
    }
  });
}

// ── Starten ──────────────────────────────────────────────────────────────

function setupNav() {
  const nav = document.getElementById('main-nav');
  if (!nav) return;
  on(nav, 'click', '[data-nav]', (event, target) => navigate(target.dataset.nav));
  const themeButton = document.getElementById('theme-toggle');
  themeButton?.addEventListener('click', cycleTheme);
  window.addEventListener('hashchange', () => navigate(viewFromHash()));
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('Service worker niet geregistreerd:', error);
    });
  });
}

function showConnectionState() {
  const banner = document.getElementById('offline-banner');
  const update = () => {
    if (!banner) return;
    banner.hidden = navigator.onLine;
  };
  window.addEventListener('online', () => {
    update();
    toastOk('Weer online.');
  });
  window.addEventListener('offline', () => {
    update();
    toastInfo('Offline: je lokale leads blijven werken.');
  });
  update();
}

async function start() {
  setupNav();
  setupShortcuts();
  showConnectionState();
  registerServiceWorker();

  const allowed = await checkAccess();
  if (!allowed) {
    render();
    return;
  }

  currentView = VIEWS.find((view) => view.id === viewFromHash()) ?? VIEWS[0];
  VIEWS.forEach((view) => view.init(document.getElementById('view-root'), { navigate, render }));
  store.subscribe(() => {
    render();
    watchSyncSetting();
  });
  watchSyncSetting();
  render();
}

start().catch((error) => {
  console.error(error);
  const viewRoot = document.getElementById('view-root');
  if (viewRoot) {
    setContent(viewRoot, html`<div class="card empty-state"><h2>De app kon niet starten</h2><p>${error.message}</p></div>`);
  }
});
