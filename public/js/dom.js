/**
 * public/js/dom.js
 * Veilig HTML bouwen.
 *
 * De `html` tagged template escapet ALLE waarden automatisch. Daardoor kan er
 * nooit ongefilterde data (bedrijfsnamen, notities, CSV-import) als HTML in de
 * pagina belanden. Wil je expres HTML invoegen, gebruik dan `raw()` en alleen
 * met HTML die je zelf in de code hebt geschreven.
 */

const RAW = Symbol('raw-html');

/** Alles escapen wat de gebruiker of een API aanlevert. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Markeer tekst als "veilige HTML". We gebruiken hiervoor een String-object
 * met een verborgen merkteken: het gedraagt zich als een gewone string, maar
 * de html-tag weet dat hij hem niet hoeft te escapen.
 */
function markSafe(text) {
  const boxed = new String(text);
  boxed[RAW] = true;
  return boxed;
}

/** Handmatig HTML als veilig markeren (alleen voor eigen, statische markup). */
export function raw(value) {
  return markSafe(String(value ?? ''));
}

function isSafe(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && value[RAW] === true;
}

function render(value) {
  if (value == null || value === false || value === true) return '';
  if (Array.isArray(value)) return value.map(render).join('');
  if (isSafe(value)) return String(value);
  return escapeHtml(value);
}

/**
 * Gebruik: html`<h2>${lead.name}</h2>`
 *
 * - Waarden uit data (bedrijfsnamen, notities, CSV) worden geëscaped.
 * - Resultaten van een andere html``-aanroep blijven HTML, zodat je netjes
 *   onderdelen kunt samenstellen.
 * - Arrays (bijv. van .map()) worden samengevoegd.
 */
export function html(strings, ...values) {
  let out = '';
  for (let i = 0; i < strings.length; i += 1) {
    out += strings[i];
    if (i < values.length) out += render(values[i]);
  }
  return markSafe(out);
}

/**
 * Vervang de inhoud van een element met (reeds geëscapete) HTML.
 * Een array wordt samengevoegd zonder komma's ertussen.
 */
export function setContent(node, content) {
  if (!node) return;
  node.innerHTML = Array.isArray(content) ? content.map((part) => String(part ?? '')).join('') : String(content ?? '');
}

/** Element aanmaken met tekst (nooit HTML) - handig voor dynamische lijsten. */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Event-delegatie: één listener op een container voor veel elementen. */
export function on(root, type, selector, handler) {
  root.addEventListener(type, (event) => {
    const target = event.target.closest(selector);
    if (target && root.contains(target)) handler(event, target);
  });
}

/** Zet aria-busy en een laadclass aan/uit. */
export function setBusy(node, busy) {
  if (!node) return;
  node.setAttribute('aria-busy', busy ? 'true' : 'false');
  node.classList.toggle('is-busy', Boolean(busy));
}

/** Toegankelijke statusmelding voor screenreaders en zichtbare meldingen. */
export function announce(message) {
  const live = document.getElementById('live-region');
  if (live) live.textContent = String(message ?? '');
}

/** Bevestigingsdialoog met eigen styling (werkt ook op mobiel). */
export function confirmDialog({ title = 'Weet je het zeker?', message = '', confirmLabel = 'Ja', cancelLabel = 'Annuleren' } = {}) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('app-dialog');
    if (!dialog) {
      resolve(window.confirm(message || title));
      return;
    }
    setContent(
      dialog,
      html`
        <div class="dialog-backdrop" data-close></div>
        <div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
          <h2 id="dialog-title">${title}</h2>
          ${message ? html`<p class="dialog-message">${message}</p>` : ''}
          <div class="dialog-actions">
            <button type="button" class="btn btn-ghost" data-cancel>${cancelLabel}</button>
            <button type="button" class="btn btn-danger" data-confirm>${confirmLabel}</button>
          </div>
        </div>
      `
    );
    dialog.showModal?.();
    const cleanup = (result) => {
      dialog.close?.();
      setContent(dialog, '');
      resolve(result);
    };
    dialog.querySelector('[data-confirm]').addEventListener('click', () => cleanup(true), { once: true });
    dialog.querySelector('[data-cancel]').addEventListener('click', () => cleanup(false), { once: true });
    dialog.querySelector('[data-close]').addEventListener('click', () => cleanup(false), { once: true });
    dialog.addEventListener('cancel', () => cleanup(false), { once: true });
  });
}
