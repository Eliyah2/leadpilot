/**
 * Subtitles — cue grouping, styling and ASS generation.
 *
 * Cues are grouped into short, mobile-legible phrases (max N words) with an
 * active-word highlight window per word, so the highlight tracks narration
 * without needing a full forced-alignment pass. Timing comes from exact
 * per-scene synthesis plus character-weighted word distribution.
 *
 * Output is a libass .ass file burned into the video by FFmpeg.
 */
import fs from 'node:fs';
import { words as splitWords, clamp } from '../lib/util.js';
import type { WordTiming } from './tts.js';

export type SubtitleStyle = {
  font: string; // family name, or 'auto'
  size: number; // px at 1080x1920
  bold: boolean;
  position: number; // 0..1 from top (0.8 = lower third)
  maxWords: number;
  style: 'word_highlight' | 'phrase' | 'none';
  primaryColor: string; // #rrggbb base
  highlightColor: string; // #rrggbb active word
  outline: number;
  marginV: number;
  allCaps: boolean;
};

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  font: 'auto',
  size: 104,
  bold: true,
  position: 0.8,
  maxWords: 4,
  style: 'word_highlight',
  primaryColor: '#ffffff',
  highlightColor: '#ffd60a',
  outline: 7,
  marginV: 340,
  allCaps: true,
};

export type Cue = {
  start: number;
  end: number;
  text: string; // full cue text, active word wrapped in a colour override
  plain: string; // cue text without overrides
  words: string[];
  activeIndex: number;
};

/** Group words into phrase cues with an active-word highlight. */
export function buildCues(wordTimings: WordTiming[], style: SubtitleStyle, breakAt: number[] = []): Cue[] {
  if (!wordTimings.length || style.style === 'none') return [];
  const maxW = clamp(style.maxWords || 4, 2, 8);
  const cues: Cue[] = [];

  let group: WordTiming[] = [];
  const flush = () => {
    if (!group.length) return;
    const start = group[0]!.start;
    const end = group[group.length - 1]!.end;
    const plainWords = group.map((g) => g.text);
    const display = style.allCaps ? plainWords.map((w) => w.toLocaleUpperCase()) : plainWords;

    if (style.style === 'phrase') {
      cues.push({
        start,
        end,
        plain: display.join(' '),
        text: display.join(' '),
        words: display,
        activeIndex: -1,
      });
    } else {
      for (let i = 0; i < group.length; i++) {
        // ASS overrides MUST live inside { } — without them libass renders the
        // codes as literal text on screen.
        const parts = display.map((w, wi) =>
          wi === i
            ? `{\\c&H${toAssColor(style.highlightColor)}&\\b1${w}\\b0\\c&H${toAssColor(style.primaryColor)}&}`
            : w,
        );
        cues.push({
          start: group[i]!.start,
          end: group[i]!.end,
          plain: display.join(' '),
          text: parts.join(' '),
          words: display,
          activeIndex: i,
        });
      }
    }
    group = [];
  };

  for (let i = 0; i < wordTimings.length; i++) {
    const w = wordTimings[i]!;
    group.push(w);
    const endsPhrase = /[.!?…:;]$/.test(w.text) || (group.length >= maxW && group.length > 0);
    const forcedBreak = breakAt.includes(i);
    if (endsPhrase || forcedBreak || i === wordTimings.length - 1) flush();
  }
  flush();
  return cues;
}

/** Merge adjacent highlight windows of the same phrase into a stepped timeline. */

/* ------------------------------------------------------------------ */
/* ASS rendering                                                        */
/* ------------------------------------------------------------------ */

export function hexToAss(hex: string): string {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = full.slice(0, 2);
  const g = full.slice(2, 4);
  const b = full.slice(4, 6);
  return `&H00${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}`;
}
const toAssColor = hexToAss;

function assTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = (s % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${ss}`;
}

export type AssOptions = {
  width: number;
  height: number;
  fontFamily: string;
  totalDurationSec: number;
};

export function buildAss(cues: Cue[], style: SubtitleStyle, opts: AssOptions): string {
  const effectiveMargin = style.marginV && style.marginV !== DEFAULT_SUBTITLE_STYLE.marginV
    ? style.marginV
    : Math.round(opts.height * (1 - style.position));

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${opts.width}
PlayResY: ${opts.height}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Short,${opts.fontFamily},${style.size},${hexToAss(style.primaryColor)},${hexToAss(style.highlightColor)},&H00000000,&H80000000,${style.bold ? -1 : 0},0,0,0,100,100,0,0,1,${style.outline},0,2,70,70,${effectiveMargin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  // Long phrases get an automatic per-line font shrink so text never runs
  // past the 9:16 safe area on a phone.
  const usableWidth = opts.width - 180;
  const lines = cues.map((c) => {
    const estimate = c.plain.length * style.size * 0.58;
    const fs = estimate > usableWidth ? Math.max(44, Math.round((style.size * usableWidth) / estimate)) : style.size;
    const prefix = fs < style.size ? `{\\fs${fs}}` : '';
    return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Short,,0,0,0,,${prefix}${c.text.replace(/\r?\n/g, '\\N')}`;
  });
  return header + lines.join('\n') + '\n';
}

export function writeAss(file: string, cues: Cue[], style: SubtitleStyle, opts: AssOptions): string {
  fs.writeFileSync(file, buildAss(cues, style, opts), 'utf8');
  return file;
}

/** JSON-able cue list for the subtitle preview UI. */
export function subtitlePreview(wordTimings: WordTiming[], style: SubtitleStyle, breakAt: number[] = []) {
  return buildCues(wordTimings, style, breakAt).map((c) => ({
    start: Math.round(c.start * 100) / 100,
    end: Math.round(c.end * 100) / 100,
    text: c.plain,
    active: c.activeIndex >= 0 ? c.words[c.activeIndex] : null,
  }));
}

/* ------------------------------------------------------------------ */
/* Font family discovery (minimal TTF/OTF name-table reader)            */
/* ------------------------------------------------------------------ */

export function fontFamilyFromFontFile(file: string): string | null {
  try {
    const buf = fs.readFileSync(file);
    if (buf.length < 12) return null;
    const tag = buf.toString('ascii', 0, 4);
    if (tag !== '\x00\x01\x00\x00' && tag !== 'OTTO' && tag !== 'true' && tag !== 'ttcf') return null;
    const numTables = buf.readUInt16BE(4);
    let nameOffset = -1;
    let nameLength = 0;
    for (let i = 0; i < numTables; i++) {
      const off = 12 + i * 16;
      const t = buf.toString('ascii', off, off + 4);
      if (t === 'name') {
        nameOffset = buf.readUInt32BE(off + 8);
        nameLength = buf.readUInt32BE(off + 12);
        break;
      }
    }
    if (nameOffset < 0) return null;
    const count = buf.readUInt16BE(nameOffset + 2);
    const stringOffset = nameOffset + buf.readUInt16BE(nameOffset + 4);
    let best: { platform: number; value: string } | null = null;
    for (let i = 0; i < count; i++) {
      const rec = nameOffset + 6 + i * 12;
      const platformId = buf.readUInt16BE(rec);
      const nameId = buf.readUInt16BE(rec + 6);
      const length = buf.readUInt16BE(rec + 8);
      const offset = buf.readUInt16BE(rec + 10);
      if (nameId !== 1) continue; // family name
      let value = '';
      if (platformId === 3 || platformId === 0) {
        for (let c = 0; c < length; c += 2) value += String.fromCharCode(buf.readUInt16BE(stringOffset + offset + c));
      } else {
        value = buf.toString('ascii', stringOffset + offset, stringOffset + offset + length);
      }
      value = value.split('\x00')[0]!.trim();
      if (!value) continue;
      if (platformId === 3) return value; // prefer Windows family name (what libass matches)
      if (!best) best = { platform: platformId, value };
    }
    return best?.value ?? null;
  } catch {
    return null;
  }
}


