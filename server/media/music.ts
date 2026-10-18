/**
 * Background music — generated locally, so it is original by construction
 * (no third-party tracks, no licensing risk).
 *
 * Produces a soft ambient pad on a chosen chord with slow tremolo, a gentle
 * low-pass and fade in/out, mixed under narration at a low level.
 * Users may instead supply their own licensed audio asset.
 */
import path from 'node:path';
import { runFfmpeg, ensureDir } from './ffmpeg.js';
import { CONFIG } from '../config.js';
import { hashStr } from '../lib/util.js';

const SCALES: Record<string, number[]> = {
  minor: [0, 3, 7, 12],
  major: [0, 4, 7, 12],
  dorian: [0, 3, 7, 10],
};

const ROOTS: Record<string, number> = {
  A: 220.0, B: 246.94, C: 261.63, D: 293.66, E: 329.63, F: 349.23, G: 392.0,
};

export type MusicOpts = {
  durationSec: number;
  outFile?: string;
  root?: keyof typeof ROOTS;
  scale?: keyof typeof SCALES;
  seed?: string;
  volume?: number;
};

/** Render an ambient pad to a 48 kHz stereo WAV. */
export async function synthesizeMusic(opts: MusicOpts): Promise<string> {
  const dur = Math.max(4, opts.durationSec);
  const dir = ensureDir(path.join(CONFIG.DIRS.audio, '_music'));
  const outFile = opts.outFile ?? path.join(dir, `pad_${Math.abs(hashStr(opts.seed ?? String(dur)))}.wav`);

  const keys = Object.keys(ROOTS);
  const scaleKeys = Object.keys(SCALES);
  const r = hashStr(opts.seed ?? 'shortforge');
  const rootName = opts.root ?? (keys[r % keys.length] as keyof typeof ROOTS);
  const scaleName = opts.scale ?? (scaleKeys[(r >>> 3) % scaleKeys.length] as keyof typeof SCALES);
  const root = ROOTS[rootName] ?? 220;
  const intervals = SCALES[scaleName] ?? SCALES.minor!;
  const freqs = intervals.map((semi) => root * Math.pow(2, semi / 12));

  const args: string[] = ['-y'];
  for (const f of freqs) {
    args.push('-f', 'lavfi', '-i', `sine=f=${f.toFixed(2)}:d=${dur.toFixed(2)}:r=48000`);
  }

  const inputs = freqs.map((_, i) => `[${i}:a]`).join('');
  const weights = freqs.map((_, i) => (i === 0 ? '1' : i === 1 ? '0.7' : i === 2 ? '0.5' : '0.35')).join('|');
  const fadeOutStart = Math.max(0, dur - 2);
  const filter =
    `${inputs}amix=inputs=${freqs.length}:normalize=0:weights='${weights}'[mix];` +
    `[mix]tremolo=f=0.13:d=0.45,lowpass=f=1500:poles=2,volume=0.34,` +
    `afade=t=in:st=0:d=1.6,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=2.0,` +
    `aformat=sample_rates=48000:channel_layouts=stereo[out]`;

  await runFfmpeg([...args, '-filter_complex', filter, '-map', '[out]', '-t', dur.toFixed(2), '-c:a', 'pcm_s16le', outFile], {
    cwd: dir,
    timeoutMs: 180000,
  });
  return outFile;
}

/** Whether the free procedural music generator is active (it always is). */
export const MUSIC_ENABLED = true;
