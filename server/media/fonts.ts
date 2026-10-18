import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import { log } from '../lib/logger.js';

const FONT_CANDIDATES: Record<'bold' | 'regular', string[]> = {
  bold: [
    'C:/Windows/Fonts/arialbd.ttf',
    'C:/Windows/Fonts/segoeuib.ttf',
    'C:/Windows/Fonts/verdanab.ttf',
    'C:/Windows/Fonts/tahomabd.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/Library/Fonts/Arial Bold.ttf',
  ],
  regular: [
    'C:/Windows/Fonts/arial.ttf',
    'C:/Windows/Fonts/segoeui.ttf',
    'C:/Windows/Fonts/verdana.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/Library/Fonts/Arial.ttf',
  ],
};

let cache: Partial<Record<'bold' | 'regular', string | null>> = {};

/** Absolute path of a usable TTF font, or null when the system has none. */
export function resolveFont(weight: 'bold' | 'regular' = 'bold'): string | null {
  if (cache[weight] !== undefined) return cache[weight];
  const userDir = CONFIG.DIRS.fonts;
  const userFonts = fs.existsSync(userDir)
    ? fs.readdirSync(userDir).filter((f) => /\.(ttf|otf)$/i.test(f))
    : [];
  const preferred = userFonts.filter((f) => (weight === 'bold' ? /bold|black|heavy/i.test(f) : /regular|book|normal/i.test(f)));
  const others = userFonts.filter((f) => !preferred.includes(f));
  for (const f of [...preferred, ...others]) {
    const p = path.join(userDir, f);
    if (fs.existsSync(p)) {
      cache[weight] = p;
      return p;
    }
  }
  for (const p of FONT_CANDIDATES[weight]) {
    if (fs.existsSync(p)) {
      cache[weight] = p;
      return p;
    }
  }
  log.warn('No system font found for weight', weight);
  cache[weight] = null;
  return null;
}

/** Copy the chosen font into a render work dir so filter args stay relative. */
export function fontInto(workDir: string, weight: 'bold' | 'regular' = 'bold'): string | null {
  const src = resolveFont(weight);
  if (!src) return null;
  const dest = path.join(workDir, `font_${weight}.ttf`);
  try {
    if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
    return path.basename(dest);
  } catch (err) {
    log.warn('font copy failed', String(err));
    return null;
  }
}

export function listSystemFonts(): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  for (const w of ['bold', 'regular'] as const) {
    const p = resolveFont(w);
    if (p) out.push({ name: path.basename(p), path: p });
  }
  const userDir = CONFIG.DIRS.fonts;
  if (fs.existsSync(userDir)) {
    for (const f of fs.readdirSync(userDir)) {
      if (/\.(ttf|otf)$/i.test(f)) out.push({ name: f, path: path.join(userDir, f) });
    }
  }
  return out;
}
