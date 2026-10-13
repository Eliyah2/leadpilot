/**
 * public/js/store.js
 * Het hart van de app: instellingen, leads, de lead die je nu bekijkt en alle
 * acties daarop. Alles wordt direct in de storage-laag bewaard.
 *
 * Views luisteren met store.subscribe() en renderen opnieuw na elke wijziging.
 * Dat is voor deze hoeveelheid data ruim snel genoeg en houdt de code simpel.
 */
import { storage } from './storage.js';
import { addDays, dedupeKeys, deepClone, todayISO, uid } from './utils.js';
import { STATUSES, STATUS_LABELS, REPLY_STATUSES, WON_STATUSES } from './config/statuses.js';

// De statussen staan in een eigen, DOM-vrij bestand zodat de CSV-import en de
// tests exact dezelfde lijst gebruiken. Hier her-exporteren we ze voor de UI.
export {
  KANBAN_STATUSES,
  REPLY_STATUSES,
  STATUS_LABELS,
  STATUSES,
  WON_STATUSES,
} from './config/statuses.js';

/** Alles wat je eenmalig instelt en daarna overal gebruikt. */
export const DEFAULT_SETTINGS = {
  theme: 'system', // system | light | dark
  nicheId: 'kapper',
  regionId: 'venlo',
  radiusKm: 10,
  customNiches: [],
  customRegions: [],
  qualityFilter: 'alles', // alles | geen-website | verouderde-website | weinig-reviews
  languageMode: 'auto', // auto | nl | de
  toneMode: 'auto', // auto | informeel | formeel
  dailyGoal: 10,
  autoAudit: true,
  syncEnabled: false,
  rememberPassword: true,
  sender: {
    name: '',
    company: 'Eliyah Webdesign',
    phone: '',
    website: 'https://eliyah-webdesign.vercel.app',
    email: '',
    portfolio: '',
  },
  variantHistory: [],
  legalChecklist: {
    acknowledged: false,
    showForGermany: true,
  },
};

/** Standaardinstellingen samenvoegen met wat er al bewaard is. */
function mergeSettings(saved) {
  const merged = deepClone(DEFAULT_SETTINGS);
  if (!saved || typeof saved !== 'object') return merged;
  Object.entries(saved).forEach(([key, value]) => {
    if (value === undefined) return;
    if (key === 'sender' && value && typeof value === 'object') {
      merged.sender = { ...merged.sender, ...value };
    } else if (key === 'legalChecklist' && value && typeof value === 'object') {
      merged.legalChecklist = { ...merged.legalChecklist, ...value };
    } else if (Array.isArray(value)) {
      merged[key] = value;
    } else if (value !== null) {
      merged[key] = value;
    }
  });
  return merged;
}

const listeners = new Set();
let saveTimer = null;

/** Alle app-state op één plek. `current` gaat NIET naar de opslag (vluchtig). */
const state = {
  settings: mergeSettings(storage.get('settings', null)),
  leads: storage.get('leads', []) ?? [],
  seen: storage.get('seen', { placeIds: [] }) ?? { placeIds: [] },
  meta: storage.get('meta', { createdAt: new Date().toISOString(), version: 1 }) ?? {},
  current: {
    lead: null,
    audit: null,
    loading: false,
    error: null,
    demo: null,
    searchLinks: [],
    variantKey: null,
  },
  ui: {
    view: 'lead',
    pipelineMode: 'kanban',
    filters: { search: '', status: 'alle', niche: 'alle', region: 'alle' },
    sort: 'nieuwste',
    busy: false,
    authRequired: false,
    scanProgress: null,
  },
};

export const store = {
  get state() {
    return state;
  },

  get settings() {
    return state.settings;
  },

  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Alle views opnieuw laten renderen. */
  emit() {
    listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (error) {
        console.error('UI-fout bij renderen:', error);
      }
    });
  },

  // ── Opslag ────────────────────────────────────────────────────────────

  /** Instellingen bewaren (met kleine vertraging zodat typen soepel blijft). */
  saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        storage.set('settings', state.settings);
      } catch (error) {
        console.warn('Instellingen opslaan mislukt:', error);
      }
    }, 150);
  },

  saveLeads() {
    try {
      storage.set('leads', state.leads);
    } catch (error) {
      console.warn('Leads opslaan mislukt (opslag vol?):', error);
    }
  },

  saveSeen() {
    try {
      storage.set('seen', state.seen);
    } catch (error) {
      console.warn('Gezien-lijst opslaan mislukt:', error);
    }
  },

  // ── Instellingen ──────────────────────────────────────────────────────

  /**
   * Instellingen aanpassen. Met `silent: true` slaan we alleen op, zonder de
   * hele UI opnieuw te renderen - handig terwijl je in een tekstveld typt.
   */
  updateSettings(patch, { silent = false } = {}) {
    state.settings = mergeSettings({ ...state.settings, ...patch });
    this.saveSettings();
    if (!silent) this.emit();
  },

  updateSender(patch, { silent = false } = {}) {
    state.settings.sender = { ...state.settings.sender, ...patch };
    this.saveSettings();
    if (!silent) this.emit();
  },

  /** Onthoud welke e-mailvarianten je al gebruikt hebt (voor rotatie + A/B). */
  rememberVariant(variantKey) {
    const history = [variantKey, ...(state.settings.variantHistory ?? [])].slice(0, 8);
    state.settings.variantHistory = history;
    this.saveSettings();
  },

  // ── Gezien / dubbele leads ────────────────────────────────────────────

  seenPlaceIds() {
    return new Set(state.seen.placeIds ?? []);
  },

  markSeen(placeId) {
    if (!placeId) return;
    const ids = state.seen.placeIds ?? [];
    if (!ids.includes(placeId)) {
      // Alleen de laatste 3000 bewaren, anders groeit de opslag onbeperkt.
      state.seen.placeIds = [...ids, placeId].slice(-3000);
      this.saveSeen();
    }
  },

  resetSeen() {
    state.seen = { placeIds: [] };
    this.saveSeen();
    this.emit();
  },

  /** Bestaat deze lead al? Controle op place_id, website en telefoonnummer. */
  findDuplicate(lead) {
    const keys = new Set(dedupeKeys(lead));
    return (
      state.leads.find((existing) => dedupeKeys(existing).some((key) => keys.has(key))) ?? null
    );
  },

  findById(id) {
    return state.leads.find((lead) => lead.id === id) ?? null;
  },

  // ── Leads ─────────────────────────────────────────────────────────────

  /** Nieuwe lead in de pipeline zetten (of de bestaande bijwerken). */
  addLead(lead) {
    const duplicate = this.findDuplicate(lead);
    if (duplicate) {
      this.updateLead(duplicate.id, { lastSeenAt: new Date().toISOString() });
      return duplicate;
    }
    const now = new Date().toISOString();
    const record = {
      ...lead,
      id: lead.id ?? uid('lead'),
      status: lead.status ?? 'nieuw',
      notes: lead.notes ?? [],
      timeline: lead.timeline ?? [],
      variantKey: lead.variantKey ?? null,
      createdAt: lead.createdAt ?? now,
      updatedAt: now,
    };
    state.leads = [record, ...state.leads];
    this.saveLeads();
    this.emit();
    return record;
  },

  updateLead(id, patch) {
    let updated = null;
    state.leads = state.leads.map((lead) => {
      if (lead.id !== id) return lead;
      updated = { ...lead, ...patch, updatedAt: new Date().toISOString() };
      return updated;
    });
    if (updated) this.saveLeads();
    return updated;
  },

  /**
   * Status wijzigen. Bij "gemaild" plannen we automatisch de follow-up in
   * (4 dagen later), bij follow-up 1 zes dagen later, enzovoort.
   */
  setStatus(id, status, { note = '' } = {}) {
    const lead = this.findById(id);
    if (!lead) return null;
    const patch = { status };
    let followUpAt = lead.followUpAt ?? null;
    let followUpStage = lead.followUpStage ?? 0;

    if (status === 'gemaild') {
      followUpAt = addDays(4);
      followUpStage = 1;
    } else if (status === 'followup1') {
      followUpAt = addDays(6);
      followUpStage = 2;
    } else if (status === 'followup2') {
      followUpAt = addDays(5);
      followUpStage = 3;
    } else if (REPLY_STATUSES.includes(status) || status === 'niet-geinteresseerd') {
      followUpAt = null;
      followUpStage = 0;
    }
    patch.followUpAt = followUpAt;
    patch.followUpStage = followUpStage;

    let timeline = lead.timeline ?? [];
    timeline = [
      ...timeline,
      {
        ts: new Date().toISOString(),
        type: 'status',
        text: `Status gewijzigd naar "${STATUS_LABELS[status] ?? status}".${note ? ` ${note}` : ''}`,
      },
    ];
    patch.timeline = timeline;
    if (followUpAt) {
      patch.timeline = [
        ...timeline,
        { ts: new Date().toISOString(), type: 'reminder', text: `Follow-up gepland op ${followUpAt}.` },
      ];
    }

    const updated = this.updateLead(id, patch);
    this.emit();
    return updated;
  },

  addNote(id, text) {
    const clean = String(text ?? '').trim().slice(0, 2000);
    if (!clean) return null;
    const lead = this.findById(id);
    if (!lead) return null;
    const entry = { ts: new Date().toISOString(), type: 'note', text: clean };
    const updated = this.updateLead(id, { notes: [...(lead.notes ?? []), entry], timeline: [...(lead.timeline ?? []), entry] });
    this.emit();
    return updated;
  },

  addTimeline(id, type, text, extra = {}) {
    const lead = this.findById(id);
    if (!lead) return null;
    const entry = { ts: new Date().toISOString(), type, text: String(text ?? '').slice(0, 500), ...extra };
    const updated = this.updateLead(id, { timeline: [...(lead.timeline ?? []), entry] });
    this.emit();
    return updated;
  },

  /** Registreer dat je een mail (of follow-up) verstuurd hebt. */
  markEmailSent(id, { kind = 'eerste', variantKey = null, subject = '' } = {}) {
    const lead = this.findById(id);
    if (!lead) return null;
    const label = kind === 'followup1' ? 'Follow-up 1' : kind === 'followup2' ? 'Follow-up 2' : kind === 'laatste' ? 'Laatste bericht' : 'Eerste e-mail';
    const timeline = [
      ...(lead.timeline ?? []),
      {
        ts: new Date().toISOString(),
        type: 'email',
        kind,
        variantKey,
        subject: String(subject ?? '').slice(0, 120),
        text: `${label} verstuurd${subject ? `: "${subject}"` : ''}.`,
      },
    ];
    const status = kind === 'eerste' ? 'gemaild' : kind === 'followup1' ? 'followup1' : 'followup2';
    const nextStage = kind === 'eerste' ? { days: 4, stage: 1 } : kind === 'followup1' ? { days: 6, stage: 2 } : { days: 5, stage: 3 };

    const updated = this.updateLead(id, {
      timeline,
      status,
      variantKey: variantKey ?? lead.variantKey,
      emailedAt: new Date().toISOString(),
      followUpAt: addDays(nextStage.days),
      followUpStage: nextStage.stage,
      emailsSent: (lead.emailsSent ?? 0) + 1,
    });
    if (variantKey) this.rememberVariant(variantKey);
    this.emit();
    return updated;
  },

  /** Contactgegevens (voornaam / e-mailadres) die je zelf invult. */
  setContact(id, { contactName, contactEmail } = {}) {
    const patch = {};
    if (contactName !== undefined) patch.contactName = String(contactName).slice(0, 80);
    if (contactEmail !== undefined) patch.contactEmail = String(contactEmail).slice(0, 160);
    const updated = this.updateLead(id, patch);
    this.emit();
    return updated;
  },

  removeLead(id) {
    state.leads = state.leads.filter((lead) => lead.id !== id);
    this.saveLeads();
    this.emit();
  },

  /** Leads die vandaag (of eerder) opgevolgd moeten worden. */
  dueFollowUps(date = todayISO()) {
    return state.leads
      .filter((lead) => lead.followUpAt && lead.followUpAt <= date)
      .filter((lead) => !['klant', 'niet-geinteresseerd', 'overgeslagen'].includes(lead.status))
      .sort((a, b) => String(a.followUpAt).localeCompare(String(b.followUpAt)));
  },

  /** Hoeveel e-mails heb je vandaag verstuurd (voor het dagdoel)? */
  emailsSentToday(date = todayISO()) {
    return state.leads.reduce((total, lead) => {
      const entries = (lead.timeline ?? []).filter((entry) => entry.type === 'email');
      return total + entries.filter((entry) => entry.ts?.slice(0, 10) === date).length;
    }, 0);
  },

  // ── De lead die je nu bekijkt ─────────────────────────────────────────

  setCurrent(patch, { silent = false } = {}) {
    state.current = { ...state.current, ...patch };
    if (!silent) this.emit();
  },

  /** Alleen de vluchtige UI-status (filters, sortering, actieve view). */
  setUi(patch, { silent = false } = {}) {
    state.ui = { ...state.ui, ...patch };
    if (!silent) this.emit();
  },

  // ── Import / export / wissen ─────────────────────────────────────────

  replaceAll({ settings, leads, seen, meta } = {}) {
    if (settings) state.settings = mergeSettings(settings);
    if (Array.isArray(leads)) state.leads = leads;
    if (seen?.placeIds) state.seen = { placeIds: seen.placeIds };
    if (meta) state.meta = { ...state.meta, ...meta };
    this.saveSettings();
    this.saveLeads();
    this.saveSeen();
    this.emit();
  },

  wipeAll() {
    state.leads = [];
    state.seen = { placeIds: [] };
    state.current = { lead: null, audit: null, loading: false, error: null, demo: null, searchLinks: [], variantKey: null };
    storage.clearAll();
    this.saveSettings();
    this.saveLeads();
    this.saveSeen();
    this.emit();
  },
};

/**
 * Statistieken voor het dashboard. Alles wordt uit de echte leaddata gerekend,
 * nooit geschat of verzonnen.
 */
export function computeStats(leads = state.leads) {
  const total = leads.length;
  // "Gemaild" geldt ook voor een lead die je als gemaild hebt geïmporteerd
  // (bijvoorbeeld uit een oud overzicht), en niet alleen voor leads waarvoor
  // je in LeadPilot zelf op "verzenden" hebt geklikt.
  const wasEmailed = (lead) =>
    (lead.emailsSent ?? 0) > 0 || ['gemaild', 'followup1', 'followup2', ...REPLY_STATUSES].includes(lead.status);
  const emailed = leads.filter(wasEmailed);
  const replies = leads.filter((lead) => REPLY_STATUSES.includes(lead.status));
  const meetings = leads.filter((lead) => lead.status === 'afspraak');
  const customers = leads.filter((lead) => WON_STATUSES.includes(lead.status));
  const emailsTotal = leads.reduce((sum, lead) => sum + (lead.emailsSent ?? 0), 0);

  const groupBy = (key) => {
    const map = new Map();
    leads.forEach((lead) => {
      const label = lead[key] || 'Onbekend';
      if (!map.has(label)) map.set(label, { label, total: 0, emailed: 0, replies: 0, customers: 0 });
      const row = map.get(label);
      row.total += 1;
      if (wasEmailed(lead)) row.emailed += 1;
      if (REPLY_STATUSES.includes(lead.status)) row.replies += 1;
      if (WON_STATUSES.includes(lead.status)) row.customers += 1;
    });
    return [...map.values()].sort((a, b) => b.total - a.total);
  };

  // A/B: welke variant levert reacties op? We kijken naar de laatste e-mail
  // per lead, zodat de reactie aan één variant gekoppeld wordt.
  const variantMap = new Map();
  leads.forEach((lead) => {
    const emails = (lead.timeline ?? []).filter((entry) => entry.type === 'email' && entry.variantKey);
    if (!emails.length) return;
    const last = emails[emails.length - 1];
    if (!variantMap.has(last.variantKey)) variantMap.set(last.variantKey, { variant: last.variantKey, sent: 0, replies: 0 });
    const row = variantMap.get(last.variantKey);
    row.sent += 1;
    if (REPLY_STATUSES.includes(lead.status)) row.replies += 1;
  });

  const todaySent = store.emailsSentToday();

  return {
    total,
    emailed: emailed.length,
    emailsTotal,
    replies: replies.length,
    meetings: meetings.length,
    customers: customers.length,
    replyRate: emailed.length ? Math.round((replies.length / emailed.length) * 1000) / 10 : 0,
    conversionRate: emailed.length ? Math.round((customers.length / emailed.length) * 1000) / 10 : 0,
    todaySent,
    dailyGoal: state.settings.dailyGoal,
    byNiche: groupBy('nicheLabel'),
    byRegion: groupBy('regionLabel'),
    byVariant: [...variantMap.values()].sort((a, b) => b.sent - a.sent).slice(0, 10),
    byStatus: STATUSES.map((status) => ({
      ...status,
      count: leads.filter((lead) => lead.status === status.id).length,
    })),
  };
}
