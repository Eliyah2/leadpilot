/**
 * public/js/storage.js
 * Opslaglaag. Standaard localStorage (werkt zonder account).
 *
 * Wil je later synchroniseren tussen apparaten, dan koppelt de app hier twee
 * functies aan (`storage.remote.load` en `storage.remote.save`) die naar
 * /api/state praten. De rest van de app merkt daar niets van: alles blijft
 * via storage.get() en storage.set() lopen.
 */
import { safeParse } from './utils.js';

const NAMESPACE = 'leadpilot.v1.';
const KEYS = ['settings', 'leads', 'seen', 'meta'];

let memoryFallback = new Map(); // als localStorage geblokkeerd is (privémodus)
let localAvailable = null;

function hasLocalStorage() {
  if (localAvailable !== null) return localAvailable;
  try {
    const testKey = `${NAMESPACE}__test__`;
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    localAvailable = true;
  } catch {
    localAvailable = false;
  }
  return localAvailable;
}

const fullKey = (key) => `${NAMESPACE}${key}`;

/** Aantal bytes dat we nu gebruiken (voor de UI). */
export function usedBytes() {
  if (!hasLocalStorage()) return 0;
  return KEYS.reduce((total, key) => total + (window.localStorage.getItem(fullKey(key))?.length ?? 0), 0);
}

export const storage = {
  /** Remote-hooks: app.js vult deze als synchronisatie aan staat. */
  remote: {
    enabled: false,
    load: null,
    save: null,
  },

  get(key, fallback = null) {
    const raw = hasLocalStorage() ? window.localStorage.getItem(fullKey(key)) : memoryFallback.get(fullKey(key));
    return safeParse(raw, fallback);
  },

  set(key, value) {
    const raw = JSON.stringify(value ?? null);
    if (hasLocalStorage()) {
      try {
        window.localStorage.setItem(fullKey(key), raw);
      } catch (error) {
        // Opslag vol of geblokkeerd: nooit stil falen.
        throw new Error(`opslaan_mislukt: ${error?.name ?? 'onbekend'}`);
      }
    } else {
      memoryFallback.set(fullKey(key), raw);
    }
    if (this.remote.enabled && typeof this.remote.save === 'function') {
      // Bewust "fire and forget": een trage sync mag de UI nooit ophouden.
      Promise.resolve(this.remote.save(key, value)).catch(() => {});
    }
    return true;
  },

  remove(key) {
    if (hasLocalStorage()) window.localStorage.removeItem(fullKey(key));
    else memoryFallback.delete(fullKey(key));
    return true;
  },

  /** Alles in één keer lezen (voor back-up en voor sync bij opstarten). */
  readAll() {
    const out = {};
    KEYS.forEach((key) => {
      out[key] = this.get(key, null);
    });
    return out;
  },

  /** Alles in één keer terugzetten (restore van een JSON-back-up). */
  writeAll(data = {}) {
    KEYS.forEach((key) => {
      if (data[key] !== undefined) this.set(key, data[key]);
    });
    return true;
  },

  /** Volledige wis-actie voor de AVG-knop. */
  clearAll() {
    KEYS.forEach((key) => this.remove(key));
    if (hasLocalStorage()) {
      // Ook eventuele oude sleutels van deze app opruimen.
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith(NAMESPACE))
        .forEach((key) => window.localStorage.removeItem(key));
    }
    memoryFallback = new Map();
    return true;
  },

  /** Waar staan de gegevens nu? */
  info() {
    return {
      driver: hasLocalStorage() ? 'localStorage' : 'geheugen (tijdelijk)',
      sync: this.remote.enabled ? 'aan' : 'uit',
      bytes: usedBytes(),
      keys: KEYS,
    };
  },
};

export { KEYS as STORAGE_KEYS };
