/**
 * Rendering pipeline.
 *
 *   script + voiceover + visuals + music + captions  →  final MP4 (1080x1920)
 *
 * Design notes:
 *   - Each scene is encoded exactly once (subtitles are burned in per scene),
 *     then the clips are stream-concatenated and muxed with narration/music.
 *     That keeps rendering fast and the video timeline identical to the audio.
 *   - Output: H.264 yuv420p, faststart, AAC 128k — plays everywhere, uploads
 *     cleanly to YouTube Shorts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runFfmpeg, ensureDir, mediaDurationSec, wavInfoSync } from './ffmpeg.js';
import { fontInto } from './fonts.js';
import { renderSceneClip, renderCoverImage } from './visuals.js';
import { buildCues, writeAss, fontFamilyFromFontFile, DEFAULT_SUBTITLE_STYLE, type SubtitleStyle } from './subtitles.js';
import { synthesizeMusic } from './music.js';
import { CONFIG } from '../config.js';
import { log } from '../lib/logger.js';
import { usage } from '../services/usage.js';
import { getSetting } from '../engine/settings.js';
import { clamp } from '../lib/util.js';
import type { SceneSpec } from '../engine/scripts.js';
import type { VoiceoverResult } from './tts.js';

export type SceneAsset = { path: string; kind: 'image' | 'video' };

export type RenderRequest = {
  videoId: string;
  scenes: SceneSpec[];
  tts: VoiceoverResult;
  title: string;
  keyword: string;
  subtitleStyle?: SubtitleStyle;
  width?: number;
  height?: number;
  fps?: number;
  crf?: number;
  music?: boolean;
  musicVolume?: number;
  assets?: Record<number, SceneAsset>;
  generateCover?: boolean;
  onProgress?: (percent: number, message: string) => void;
};

export type RenderResult = {
  mp4: string;
  coverPath: string | null;
  durationSec: number;
  sizeBytes: number;
  width: number;
  height: number;
  sceneCount: number;
  renderMs: number;
};

function sceneStarts(tts: VoiceoverResult): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const s of tts.scenes) {
    starts.push(cursor);
    cursor += s.durationSec;
  }
  return starts;
}

export async function renderShort(req: RenderRequest): Promise<RenderResult> {
  const started = Date.now();
  const width = req.width ?? getSetting<number>('render.width', 1080);
  const height = req.height ?? getSetting<number>('render.height', 1920);
  const fps = req.fps ?? getSetting<number>('render.fps', 30);
  const crf = req.crf ?? getSetting<number>('render.crf', 18);
  const preset = getSetting<string>('render.preset', 'faster');
  const musicOn = req.music ?? getSetting<boolean>('voice.music_enabled', true);
  const musicVolume = req.musicVolume ?? getSetting<number>('voice.music_volume', 0.07);
  const style: SubtitleStyle = req.subtitleStyle ?? subtitleStyleFromSettings();
  const progress = req.onProgress ?? (() => {});

  const outDir = ensureDir(path.join(CONFIG.DIRS.video));
  const outFile = path.join(outDir, `${req.videoId}.mp4`);
  const workDir = path.join(CONFIG.DIRS.tmp, `render_${req.videoId}`);
  fs.rmSync(workDir, { recursive: true, force: true });
  ensureDir(workDir);
  const fontFile = fontInto(workDir, 'bold') ?? 'font_bold.ttf';
  const fontFamily = fontFamilyFromFontFile(path.join(workDir, fontFile)) ?? 'Arial';

  const starts = sceneStarts(req.tts);
  const totalSec = req.tts.totalDurationSec;
  progress(3, 'Preparing scene assets');

  // --- subtitles (one .ass per scene, times relative to the scene) -----
  const assFiles: (string | null)[] = [];
  if (style.style !== 'none' && req.tts.words.length) {
    const cues = buildCues(req.tts.words, style);
    for (let i = 0; i < req.scenes.length; i++) {
      const sceneStart = starts[i] ?? 0;
      const sceneDur = req.tts.scenes[i]?.durationSec ?? req.scenes[i]!.durationSec;
      const local = cues
        .filter((c) => c.end > sceneStart + 0.02 && c.start < sceneStart + sceneDur)
        .map((c) => ({
          ...c,
          start: clamp(c.start - sceneStart, 0, sceneDur),
          end: clamp(c.end - sceneStart, 0, sceneDur),
        }))
        .filter((c) => c.end - c.start > 0.02);
      const file = path.join(workDir, `subs_${i}.ass`);
      writeAss(file, local, style, { width, height, fontFamily, totalDurationSec: sceneDur });
      assFiles.push(path.basename(file));
    }
  } else {
    assFiles.push(...req.scenes.map(() => null));
  }

  // --- scene clips ------------------------------------------------------
  const clipPaths: string[] = [];
  const n = req.scenes.length;
  for (let i = 0; i < n; i++) {
    const scene = req.scenes[i]!;
    const dur = req.tts.scenes[i]?.durationSec ?? scene.durationSec;
    scene.durationSec = dur;
    const asset = req.assets?.[i];
    progress(5 + Math.round((i / n) * 65), `Rendering scene ${i + 1} of ${n}`);
    const clip = await renderSceneClip({
      scene,
      index: i,
      durationSec: dur,
      workDir,
      width,
      height,
      fps,
      crf,
      preset,
      fontFile,
      assetPath: asset?.path ?? null,
      assetKind: asset?.kind ?? null,
      subtitleFile: assFiles[i],
      seed: hashSeed(req.videoId) + i * 977,
    });
    clipPaths.push(clip);
  }

  // --- background music --------------------------------------------------
  let musicFile: string | null = null;
  if (musicOn) {
    try {
      progress(74, 'Composing background music');
      musicFile = await synthesizeMusic({ durationSec: totalSec, seed: req.videoId });
    } catch (err) {
      log.warn('music generation failed, continuing without', String(err));
      musicFile = null;
    }
  }

  // --- concat + mux ------------------------------------------------------
  progress(80, 'Muxing narration, music and subtitles');
  const listFile = path.join(workDir, 'clips.txt');
  fs.writeFileSync(listFile, clipPaths.map((c) => `file '${path.basename(c)}'`).join('\n'), 'utf8');

  const args: string[] = ['-y', '-f', 'concat', '-safe', '0', '-i', 'clips.txt', '-i', req.tts.combinedFile];
  const audioGraph: string[] = ['[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,aresample=48000[vo]'];
  if (musicFile) {
    args.push('-i', musicFile);
    audioGraph.push(`[2:a]volume=${clamp(musicVolume, 0, 0.5)}[mus]`);
    audioGraph.push('[vo][mus]amix=inputs=2:normalize=0:duration=first[aout]');
  } else {
    audioGraph.push('[vo]anull[aout]');
  }

  args.push(
    '-filter_complex',
    audioGraph.join(';'),
    '-map',
    '0:v',
    '-map',
    '[aout]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    getSetting<string>('render.audio_bitrate', '192k'),
    '-ar',
    '48000',
    '-movflags',
    '+faststart',
    '-shortest',
    outFile,
  );
  await runFfmpeg(args, { cwd: workDir, timeoutMs: 15 * 60 * 1000 });

  progress(90, 'Verifying output');
  const durationSec = await mediaDurationSec(outFile);
  const sizeBytes = fs.statSync(outFile).size;

  // --- cover -------------------------------------------------------------
  let coverPath: string | null = null;
  if (req.generateCover ?? getSetting<boolean>('generation.auto_cover', true)) {
    try {
      progress(94, 'Generating cover image');
      const colors = req.scenes[0]?.visual.colors ?? ['#0f172a', '#6366f1'];
      coverPath = await renderCoverImage({
        title: req.title || req.keyword,
        keyword: req.keyword,
        colors,
        workDir,
        fontFile,
        outFile: path.join(CONFIG.DIRS.covers, `${req.videoId}.png`),
      });
    } catch (err) {
      log.warn('cover generation failed', String(err));
    }
  }

  usage.record('render_sec', {
    provider: 'ffmpeg (free/local)',
    units: Math.round(durationSec),
    unitLabel: 'render-sec',
    costUsd: 0,
    meta: { videoId: req.videoId },
  });

  // clean intermediates (keep the folder when debugging)
  if (process.env.SF_KEEP_RENDER_TMP !== '1') {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (err) {
      log.debug('cleanup failed', String(err));
    }
  }

  progress(100, 'Render complete');
  return {
    mp4: outFile,
    coverPath,
    durationSec,
    sizeBytes,
    width,
    height,
    sceneCount: n,
    renderMs: Date.now() - started,
  };
}

export function subtitleStyleFromSettings(): SubtitleStyle {
  return {
    font: getSetting<string>('subtitles.font', 'auto'),
    size: getSetting<number>('subtitles.size', 104),
    bold: getSetting<boolean>('subtitles.bold', true),
    position: getSetting<number>('subtitles.position', 0.8),
    maxWords: getSetting<number>('subtitles.max_words', 4),
    style: getSetting<SubtitleStyle['style']>('subtitles.style', 'word_highlight'),
    primaryColor: getSetting<string>('subtitles.primary_color', '#ffffff'),
    highlightColor: getSetting<string>('subtitles.highlight_color', '#ffd60a'),
    outline: getSetting<number>('subtitles.outline', 7),
    marginV: getSetting<number>('subtitles.margin_v', 340),
    allCaps: getSetting<boolean>('subtitles.all_caps', true),
  };
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export { renderCoverImage, DEFAULT_SUBTITLE_STYLE, wavInfoSync };
