/**
 * Voiceover — free, local TTS.
 *
 * Providers (auto-detected, in order):
 *   1. windows-sapi : Windows built-in System.Speech (no install, offline)
 *   2. espeak-ng    : free/open-source, 100+ languages (if on PATH)
 *   3. say          : macOS built-in
 *
 * Paid providers (ElevenLabs, Azure, Google) are intentionally NOT called here.
 * They can be added by the operator; nothing in ShortForge spends money by
 * default, and every synthesis is recorded in the usage ledger.
 *
 * Per-scene synthesis gives exact scene boundaries for subtitles and editing;
 * word timings inside a scene are estimated by character weight (SAPI does not
 * expose word timestamps for file output).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import { log } from '../lib/logger.js';
import { runFfmpeg, wavInfoSync, ensureDir, FfmpegError } from './ffmpeg.js';
import { words as splitWords, clamp } from '../lib/util.js';
import { usage } from '../services/usage.js';
import { getSetting } from '../engine/settings.js';
import type { SceneSpec } from '../engine/scripts.js';
import type { Lang } from '../engine/language.js';

export type TtsVoice = {
  id: string;
  name: string;
  culture: string;
  language: string;
  provider: TtsProvider;
  recommended: boolean;
};

export type TtsProvider = 'windows-sapi' | 'espeak' | 'say' | 'none';

export type TtsOptions = {
  provider?: 'auto' | TtsProvider;
  voice?: string;
  rate?: number; // 0.5 .. 2.0
  pitch?: number; // 0.5 .. 2.0
  volume?: number; // 0 .. 2
  gapSec?: number; // pause after each scene
};

export type WordTiming = { text: string; start: number; end: number };
export type SceneAudio = { idx: number; file: string; durationSec: number; text: string };

export type VoiceoverResult = {
  provider: TtsProvider;
  voice: string;
  voiceLabel: string;
  voiceMismatch: boolean;
  languagesAvailable: string[];
  scenes: SceneAudio[];
  words: WordTiming[];
  totalDurationSec: number;
  combinedFile: string;
};

let cachedProvider: TtsProvider | null = null;

function which(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const probe = spawn(isWin ? 'where' : 'which', [cmd], { windowsHide: true });
    let out = '';
    probe.stdout.on('data', (c) => (out += c.toString()));
    probe.on('error', () => resolve(null));
    probe.on('close', (code) => resolve(code === 0 && out.trim() ? out.trim().split(/\r?\n/)[0]! : null));
  });
}

export async function detectProvider(): Promise<TtsProvider> {
  if (cachedProvider) return cachedProvider;
  if (process.env.SF_TTS_PROVIDER && process.env.SF_TTS_PROVIDER !== 'auto') {
    cachedProvider = process.env.SF_TTS_PROVIDER as TtsProvider;
    return cachedProvider;
  }
  if (process.platform === 'win32') {
    const ps = await which('powershell.exe');
    if (ps) {
      cachedProvider = 'windows-sapi';
      return cachedProvider;
    }
  }
  if (await which('espeak-ng')) {
    cachedProvider = 'espeak';
    return cachedProvider;
  }
  if (process.platform === 'darwin' && (await which('say'))) {
    cachedProvider = 'say';
    return cachedProvider;
  }
  if (await which('espeak')) {
    cachedProvider = 'espeak';
    return cachedProvider;
  }
  cachedProvider = 'none';
  return cachedProvider;
}

/* ------------------------------------------------------------------ */
/* Voice listing                                                        */
/* ------------------------------------------------------------------ */

let voiceCache: TtsVoice[] | null = null;

const CULTURE_LANG: Record<string, Lang> = {
  'en': 'en', 'en-us': 'en', 'en-gb': 'en', 'nl': 'nl', 'nl-nl': 'nl',
  'de': 'de', 'de-de': 'de', 'es': 'es', 'es-es': 'es', 'es-mx': 'es',
  'fr': 'fr', 'fr-fr': 'fr',
};

export function languageOfCulture(culture: string): Lang | null {
  const key = culture.toLowerCase();
  for (const [prefix, lang] of Object.entries(CULTURE_LANG)) {
    if (key === prefix || key.startsWith(prefix)) return lang;
  }
  return null;
}

const SAPI_LIST_PS = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
foreach ($v in $s.GetInstalledVoices()) {
  $i = $v.VoiceInfo
  Write-Output ($i.Name + '|' + $i.Culture + '|' + $i.Gender + '|' + $v.Enabled)
}
$s.SetOutputToNull()
$s.Dispose()
`;

export async function listVoices(force = false): Promise<TtsVoice[]> {
  if (voiceCache && !force) return voiceCache;
  const provider = await detectProvider();
  const out: TtsVoice[] = [];
  if (provider === 'windows-sapi') {
    try {
      const res = await powershell(SAPI_LIST_PS, [], 20000);
      for (const line of res.stdout.split(/\r?\n/)) {
        const [name, culture, gender, enabled] = line.trim().split('|');
        if (!name || enabled === 'False') continue;
        out.push({
          id: name,
          name,
          culture: culture ?? '',
          language: languageOfCulture(culture ?? '') ?? '',
          provider: 'windows-sapi',
          recommended: false,
        });
      }
    } catch (err) {
      log.warn('voice listing failed', String(err));
    }
  } else if (provider === 'espeak') {
    for (const [name, culture] of [
      ['English (US)', 'en-US'], ['Dutch', 'nl-NL'], ['German', 'de-DE'], ['Spanish', 'es-ES'], ['French', 'fr-FR'],
    ] as const) {
      out.push({ id: culture.split('-')[0]!, name: `espeak-ng: ${name}`, culture, language: culture.split('-')[0] as Lang, provider: 'espeak', recommended: false });
    }
  } else if (provider === 'say') {
    for (const [name, culture] of [
      ['Samantha', 'en-US'], ['Xander', 'en-US'], ['Xander', 'nl-NL'], ['Anna', 'de-DE'], ['Monica', 'es-ES'], ['Thomas', 'fr-FR'],
    ] as const) {
      out.push({ id: name, name: `say: ${name} (${culture})`, culture, language: culture.split('-')[0] as Lang, provider: 'say', recommended: false });
    }
  }
  voiceCache = out;
  return out;
}

/** Best voice for a language; falls back to the first available voice. */
export async function pickVoiceFor(lang: Lang): Promise<{ voice: TtsVoice | null; mismatch: boolean }> {
  const voices = await listVoices();
  if (!voices.length) return { voice: null, mismatch: true };
  const exact = voices.filter((v) => v.language === lang);
  if (exact.length) return { voice: { ...exact[0]!, recommended: true }, mismatch: false };
  const cultureMatch = voices.find((v) => v.culture.toLowerCase().startsWith(lang));
  if (cultureMatch) return { voice: cultureMatch, mismatch: false };
  return { voice: voices[0]!, mismatch: true };
}

/* ------------------------------------------------------------------ */
/* Synthesis                                                            */
/* ------------------------------------------------------------------ */

const SAPI_SCRIPT = `
param([string]$TextFile, [string]$OutFile, [string]$Voice, [int]$Rate, [double]$Volume)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($Voice -ne '') { try { $s.SelectVoice($Voice) } catch { } }
$s.Rate = $Rate
try { $s.Volume = [int]([Math]::Max(0, [Math]::Min(100, $Volume * 100))) } catch { }
$text = [IO.File]::ReadAllText($TextFile)
$s.SetOutputToWaveFile($OutFile)
$s.Speak($text)
$s.SetOutputToNull()
$s.Dispose()
Write-Output 'OK'
`;

function powershell(script: string, extraArgs: string[] = [], timeoutMs = 60000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const file = path.join(CONFIG.DIRS.tmp, `ps_${Math.random().toString(36).slice(2)}.ps1`);
    fs.writeFileSync(file, script, 'utf8');
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...extraArgs], {
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      reject(new Error('PowerShell TTS timed out'));
    }, timeoutMs);
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        fs.rmSync(file, { force: true });
      } catch {}
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`PowerShell exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

/** Raw synthesis of one text chunk to a WAV file. Returns duration. */
async function synthRaw(text: string, outFile: string, opts: TtsOptions, voice: TtsVoice | null): Promise<number> {
  const provider = opts.provider && opts.provider !== 'auto' ? opts.provider : await detectProvider();
  const rate = clamp(opts.rate ?? 1, 0.5, 2);
  const volume = clamp(opts.volume ?? 1, 0, 2);
  ensureDir(path.dirname(outFile));

  if (provider === 'windows-sapi') {
    const textFile = outFile + '.txt';
    fs.writeFileSync(textFile, text, 'utf8');
    const sapiRate = Math.round((rate - 1) * 10);
    try {
      await powershell(SAPI_SCRIPT, [
        '-TextFile', textFile,
        '-OutFile', outFile,
        '-Voice', voice?.id ?? '',
        '-Rate', String(clamp(sapiRate, -10, 10)),
        '-Volume', String(clamp(volume, 0, 1)),
      ], 120000);
    } finally {
      try {
        fs.rmSync(textFile, { force: true });
      } catch {}
    }
    if (!fs.existsSync(outFile)) throw new Error('TTS produced no output file');
    return wavInfoSync(outFile).durationSec;
  }

  if (provider === 'espeak') {
    const bin = (await which('espeak-ng')) ?? (await which('espeak'))!;
    const lang = voice?.language || 'en';
    const wpm = Math.round(175 * rate);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, ['-v', lang, '-s', String(wpm), '-w', outFile, '--', text], { windowsHide: true });
      let err = '';
      child.stderr.on('data', (c) => (err += c.toString()));
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`espeak failed: ${err.slice(0, 300)}`))));
    });
    return wavInfoSync(outFile).durationSec;
  }

  if (provider === 'say') {
    await new Promise<void>((resolve, reject) => {
      const args = ['-o', outFile, '--data-format=LEI16@22050'];
      if (voice?.id) args.push('-v', voice.id);
      args.push('-r', String(Math.round(180 * rate)), text);
      const child = spawn('say', args, { windowsHide: true });
      let err = '';
      child.stderr.on('data', (c) => (err += c.toString()));
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`say failed: ${err}`))));
    });
    return wavInfoSync(outFile).durationSec;
  }

  throw new Error('No TTS provider available. Install espeak-ng, or run on Windows/macOS.');
}

/** Apply pitch/volume/pad to a raw WAV, producing the final scene audio. */
async function postProcess(inFile: string, outFile: string, opts: TtsOptions, padSec: number): Promise<number> {
  const pitch = clamp(opts.pitch ?? 1, 0.5, 2);
  const volume = clamp(opts.volume ?? 1, 0, 2);
  const inRate = (() => {
    try {
      return wavInfoSync(inFile).sampleRate;
    } catch {
      return 22050;
    }
  })();
  const filters: string[] = [];
  if (Math.abs(pitch - 1) > 0.01) {
    filters.push(`asetrate=${Math.round(inRate * pitch)}`, `aresample=${inRate}`, `atempo=${(1 / pitch).toFixed(4)}`);
  }
  if (Math.abs(volume - 1) > 0.01) filters.push(`volume=${volume}`);
  filters.push('aresample=48000', 'aformat=channel_layouts=mono');
  if (padSec > 0) filters.push(`apad=pad_dur=${padSec.toFixed(3)}`);

  await runFfmpeg(['-y', '-i', inFile, '-af', filters.join(','), '-c:a', 'pcm_s16le', outFile], { cwd: path.dirname(inFile), timeoutMs: 120000 });
  return wavInfoSync(outFile).durationSec;
}

/**
 * Synthesize every scene of a script and build the word timeline.
 * Scene audio files land in storage/audio/<videoId>/scene_<n>.wav
 */
export async function synthesizeVideo(
  videoId: string,
  scenes: SceneSpec[],
  opts: TtsOptions = {},
  lang: Lang = 'en',
): Promise<VoiceoverResult> {
  const provider = opts.provider && opts.provider !== 'auto' ? opts.provider : await detectProvider();
  if (provider === 'none') throw new Error('No local TTS provider found. Install espeak-ng (free) or run on Windows/macOS.');

  const picked = await pickVoiceFor(lang);
  let voice: TtsVoice | null = picked.voice;
  if (opts.voice) {
    const found = (await listVoices()).find((x) => x.id === opts.voice);
    voice = found ?? { id: opts.voice, name: opts.voice, culture: '', language: lang, provider, recommended: false };
  }
  const gap = clamp(opts.gapSec ?? getSetting<number>('voice.scene_gap_sec', 0.14), 0, 1.5);
  const dir = ensureDir(path.join(CONFIG.DIRS.audio, videoId));

  const scenesOut: SceneAudio[] = [];
  const words: WordTiming[] = [];
  let cursor = 0;
  let chars = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!;
    const raw = path.join(dir, `scene_${i}_raw.wav`);
    const final = path.join(dir, `scene_${i}.wav`);
    const text = scene.voiceover.trim();
    if (!text) {
      const empty = path.join(dir, `scene_${i}_silence.wav`);
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '1', '-c:a', 'pcm_s16le', empty], {
        cwd: dir,
        timeoutMs: 30000,
      });
      scenesOut.push({ idx: i, file: empty, durationSec: 1, text: '' });
      cursor += 1;
      continue;
    }

    await synthRaw(text, raw, opts, voice);
    const dur = await postProcess(raw, final, opts, gap);
    try {
      fs.rmSync(raw, { force: true });
    } catch {}
    scenesOut.push({ idx: i, file: final, durationSec: dur, text });

    // Word timing inside the scene (character-weighted, padded tail excluded)
    const spoken = Math.max(0.2, dur - gap);
    const sceneWords = splitWords(text);
    const weights = sceneWords.map((w) => w.replace(/[^\p{L}\p{N}']/gu, '').length + 2.2);
    const totalW = weights.reduce((s, x) => s + x, 0) || 1;
    let local = 0;
    for (let wi = 0; wi < sceneWords.length; wi++) {
      const span = (weights[wi]! / totalW) * spoken;
      words.push({ text: sceneWords[wi]!, start: cursor + local, end: cursor + local + span });
      local += span;
    }
    chars += text.length;
    cursor += dur;
    scene.durationSec = dur;
  }

  // Concatenate scene audio into a single narration track
  const listFile = path.join(dir, 'concat.txt');
  fs.writeFileSync(listFile, scenesOut.map((s) => `file '${path.basename(s.file)}'`).join('\n'), 'utf8');
  const combined = path.join(dir, 'voiceover.wav');
  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c:a', 'pcm_s16le', combined], {
    cwd: dir,
    timeoutMs: 120000,
  });

  usage.record('tts_chars', {
    provider: provider === 'windows-sapi' ? 'windows-sapi (free/local)' : `${provider} (free/local)`,
    units: chars,
    unitLabel: 'chars',
    costUsd: 0,
    meta: { voice: voice?.id ?? 'default', videoId },
  });

  return {
    provider,
    voice: voice?.id ?? '',
    voiceLabel: voice?.name ?? String(provider),
    voiceMismatch: picked.mismatch,
    languagesAvailable: Array.from(new Set((await listVoices()).map((v) => v.language).filter(Boolean))),
    scenes: scenesOut,
    words,
    totalDurationSec: cursor,
    combinedFile: combined,
  };
}

/** Small preview clip for the voice picker (never costs money). */
export async function previewVoice(voiceId: string, opts: TtsOptions = {}, text?: string): Promise<{ file: string; durationSec: number }> {
  const dir = ensureDir(path.join(CONFIG.DIRS.audio, '_previews'));
  const sample = text?.trim() || 'This is how your ShortForge voiceover will sound. One, two, three.';
  const raw = path.join(dir, `${sanitize(voiceId)}_raw.wav`);
  const out = path.join(dir, `${sanitize(voiceId)}.wav`);
  const voice = (await listVoices()).find((v) => v.id === voiceId) ?? null;
  await synthRaw(sample, raw, opts, voice);
  const dur = await postProcess(raw, out, opts, 0.1);
  try {
    fs.rmSync(raw, { force: true });
  } catch {}
  return { file: out, durationSec: dur };
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'voice';
}

export { FfmpegError, powershell };
