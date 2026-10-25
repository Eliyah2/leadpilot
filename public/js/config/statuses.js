/**
 * public/js/config/statuses.js
 * Alle pipeline-statussen. Bewust in een eigen bestand zonder DOM-afhankelijk-
 * heden, zodat zowel de UI als de CSV-import en de tests dezelfde lijst gebruiken.
 */

export const STATUSES = [
  { id: 'nieuw', label: 'Nieuw', color: 'var(--status-new)' },
  { id: 'bewaard', label: 'Bewaard', color: 'var(--status-saved)' },
  { id: 'gemaild', label: 'Gemaild', color: 'var(--status-mailed)' },
  { id: 'followup1', label: 'Follow-up 1', color: 'var(--status-follow1)' },
  { id: 'followup2', label: 'Follow-up 2', color: 'var(--status-follow2)' },
  { id: 'reactie', label: 'Reactie', color: 'var(--status-reply)' },
  { id: 'afspraak', label: 'Afspraak', color: 'var(--status-meeting)' },
  { id: 'klant', label: 'Klant', color: 'var(--status-customer)' },
  { id: 'niet-geinteresseerd', label: 'Niet geïnteresseerd', color: 'var(--status-no)' },
  { id: 'overgeslagen', label: 'Overgeslagen', color: 'var(--status-skipped)' },
];

/** Statussen die op het kanbanbord staan ("overgeslagen" niet: die verberg je). */
export const KANBAN_STATUSES = STATUSES.filter((status) => status.id !== 'overgeslagen');

export const STATUS_LABELS = Object.fromEntries(STATUSES.map((status) => [status.id, status.label]));

/** Statussen die als "gewonnen" tellen (voor het dashboard). */
export const WON_STATUSES = ['klant'];

/** Statussen die een reactie van het bedrijf betekenen. */
export const REPLY_STATUSES = ['reactie', 'afspraak', 'klant'];
