/**
 * public/js/csv.js
 * CSV importeren en exporteren, zonder DOM-afhankelijkheden.
 * Zo kan dezelfde code gebruikt worden in de UI én in de tests.
 *
 * We gebruiken puntkomma als scheiding en zetten een BOM vooraan, zodat Excel
 * en Google Sheets het bestand in het Nederlands meteen goed openen.
 * Bij het importeren wordt de scheiding automatisch bepaald.
 */
import { STATUSES, STATUS_LABELS } from './config/statuses.js';
import { todayISO, uid } from './utils.js';

/** Kolommen van het CSV-bestand: [kolomkop, veld op de lead]. */
export const CSV_COLUMNS = [
  ['bedrijfsnaam', 'name'],
  ['niche', 'nicheLabel'],
  ['categorie', 'category'],
  ['stad', 'city'],
  ['land', 'country'],
  ['adres', 'address'],
  ['telefoon', 'phone'],
  ['website', 'website'],
  ['googlemaps', 'mapsUrl'],
  ['rating', 'rating'],
  ['reviews', 'reviews'],
  ['leadscore', 'score'],
  ['status', 'statusLabel'],
  ['contactpersoon', 'contactName'],
  ['email', 'contactEmail'],
  ['opvolgen', 'followUpAt'],
  ['notitie', 'noteText'],
  ['laatstbijgewerkt', 'updatedAt'],
];

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Leads als CSV-tekst (met BOM en puntkomma's). */
export function leadsToCsv(leads) {
  const header = CSV_COLUMNS.map(([label]) => label).join(';');
  const rows = leads.map((lead) => {
    const flat = {
      ...lead,
      statusLabel: STATUS_LABELS[lead.status] ?? lead.status,
      noteText: (lead.notes ?? []).map((note) => note.text).join(' | '),
    };
    return CSV_COLUMNS.map(([, key]) => csvEscape(flat[key])).join(';');
  });
  return `\uFEFF${[header, ...rows].join('\r\n')}`;
}

/** CSV-tekst parsen naar rijen met cellen (ondersteunt quotes en beide scheidingstekens). */
export function parseCsv(text) {
  const clean = String(text ?? '').replace(/^\uFEFF/, '');
  const firstLineEnd = clean.indexOf('\n');
  const firstLine = firstLineEnd === -1 ? clean : clean.slice(0, firstLineEnd);
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (inQuotes) {
      if (char === '"') {
        if (clean[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ''));
}

/** Status-id opzoeken op basis van een label (Nederlands of het id zelf). */
export function statusIdFromLabel(value) {
  const text = String(value ?? '').trim().toLowerCase();
  const match = STATUSES.find((status) => status.id === text || status.label.toLowerCase() === text);
  return match?.id ?? 'nieuw';
}

/** CSV-tekst omzetten naar lead-objecten. Onbekende kolommen worden genegeerd. */
export function csvToLeads(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { leads: [], skipped: 0 };

  const header = rows[0].map((cell) => String(cell).trim().toLowerCase());
  const index = {};
  CSV_COLUMNS.forEach(([label, key]) => {
    const position = header.indexOf(label);
    if (position !== -1) index[key] = position;
  });

  const leads = [];
  let skipped = 0;

  rows.slice(1).forEach((cells) => {
    const value = (key) => (index[key] === undefined ? '' : String(cells[index[key]] ?? '').trim());
    const name = value('name');
    if (!name) {
      skipped += 1;
      return;
    }
    const rating = Number(value('rating').replace(',', '.'));
    const reviews = Number(value('reviews'));
    const score = Number(value('score'));
    const website = value('website');
    const now = new Date().toISOString();
    leads.push({
      id: uid('lead'),
      placeId: '',
      name,
      nicheId: '',
      nicheLabel: value('nicheLabel') || 'Geïmporteerd',
      categoryKey: 'overig',
      category: value('category'),
      city: value('city'),
      country: value('country') || 'NL',
      address: value('address'),
      phone: value('phone'),
      website,
      mapsUrl: value('mapsUrl'),
      rating: value('rating') !== '' && Number.isFinite(rating) ? rating : null,
      reviews: value('reviews') !== '' && Number.isFinite(reviews) ? reviews : null,
      score: value('score') !== '' && Number.isFinite(score) ? score : null,
      scoreBand: null,
      scoreReasons: [],
      salesArguments: [],
      websiteStatus: website ? 'unavailable' : 'none',
      status: statusIdFromLabel(value('statusLabel')),
      contactName: value('contactName'),
      contactEmail: value('contactEmail'),
      followUpAt: value('followUpAt') || null,
      notes: value('noteText') ? [{ ts: now, type: 'note', text: value('noteText') }] : [],
      timeline: [{ ts: now, type: 'created', text: 'Geïmporteerd uit CSV-bestand.' }],
      importSource: 'csv',
      createdAt: now,
      updatedAt: now,
    });
  });

  return { leads, skipped };
}

/** Bestandsnaam voor een export. */
export function csvFilename(prefix = 'leadpilot-leads') {
  return `${prefix}-${todayISO()}.csv`;
}
