/**
 * public/js/ui/toast.js
 * Kleine meldingen rechtsonder ("E-mail gekopieerd", "Zoeken mislukt").
 * Alles via textContent, dus geen HTML-injectie mogelijk.
 */
import { announce } from '../dom.js';

const MAX_TOASTS = 3;

export function toast(message, { type = 'info', duration = 4000 } = {}) {
  const container = document.getElementById('toasts');
  if (!container) return;
  announce(message);

  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  node.textContent = String(message ?? '');
  container.appendChild(node);

  while (container.children.length > MAX_TOASTS) {
    container.removeChild(container.firstElementChild);
  }

  const remove = () => {
    node.classList.add('toast-out');
    setTimeout(() => node.remove(), 220);
  };
  const timer = setTimeout(remove, duration);
  node.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
  return node;
}

export const toastOk = (message) => toast(message, { type: 'success' });
export const toastError = (message) => toast(message, { type: 'error', duration: 7000 });
export const toastInfo = (message) => toast(message, { type: 'info' });
