/**
 * Visual generation.
 *
 * Everything is generated locally with FFmpeg (open source) or taken from your
 * own uploaded assets. Nothing here downloads copyrighted footage:
 *   - procedural animated gradients / grain / grids as backgrounds,
 *   - optional user-uploaded image or video assets (licensed by you),
 *   - drawtext typography with wrapping, outline and accent badge,
 *   - Ken Burns-style crop motion (zoom / pan).
 */
import fs from 'node:fs';
import path from 'node:path';
import { runFfmpeg, ensureDir, escapeFilterValue } from './ffmpeg.js';
import { fontInto } from './fonts.js';
import type { SceneSpec, VisualSpec } from '../engine/scripts.js';
import { capitalize } from '../lib/util.js';
import { log } from '../lib/logger.js';

export type SceneRenderOpts = {
  scene: SceneSpec;
  index: number;
  durationSec: number;
  workDir: string;
  width: number;
  height: number;
  fps: number;
  crf?: number;
  /** libx264 speed/efficiency trade-off: veryfast … medium. */
  preset?: string;
  fontFile: string; // relative to workDir (e.g. "font_bold.ttf")
  assetPath?: string | null;
  assetKind?: 'image' | 'video' | null;
  accentColor?: string;
  seed?: number;
  /** Optional pre-built .ass subtitle file (relative to workDir) burned into this clip. */
  subtitleFile?: string | null;
};

const hexToFf = (hex: string) => '0x' + hex.replace('#', '').toLowerCase();

/** Greedy word wrap by estimated character width. */
export function wrapText(text: string, maxChars: number, maxLines = 4): string {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1]!.replace(/\s+\S*$/, '') + '…';
    return kept.join('\n');
  }
  return lines.join('\n');
}

function styleFilters(style: VisualSpec['style'], accent: string): string[] {
  const a = hexToFf(accent);
  switch (style) {
    case 'radial':
      return ['vignette=PI/4.5'];
    case 'bands':
      return [
        `drawbox=x=0:y=ih*0.18:w=iw:h=ih*0.1:color=${a}@0.10:t=fill`,
        `drawbox=x=0:y=ih*0.46:w=iw:h=ih*0.1:color=black@0.14:t=fill`,
        `drawbox=x=0:y=ih*0.74:w=iw:h=ih*0.1:color=${a}@0.10:t=fill`,
      ];
    case 'grid':
      return [
        `drawbox=x=iw*0.16:y=0:w=2:h=ih:color=${a}@0.16:t=fill`,
        `drawbox=x=iw*0.5:y=0:w=2:h=ih:color=${a}@0.16:t=fill`,
        `drawbox=x=iw*0.84:y=0:w=2:h=ih:color=${a}@0.16:t=fill`,
        `drawbox=x=0:y=ih*0.25:w=iw:h=2:color=${a}@0.16:t=fill`,
        `drawbox=x=0:y=ih*0.5:w=iw:h=2:color=${a}@0.16:t=fill`,
        `drawbox=x=0:y=ih*0.75:w=iw:h=2:color=${a}@0.16:t=fill`,
      ];
    case 'particles':
      return ['noise=alls=10:allf=t+u'];
    case 'noise':
      return ['noise=alls=16:allf=t+u'];
    case 'image':
    case 'gradient':
    default:
      return [];
  }
}

function motionFilter(motion: VisualSpec['motion'], dur: number, fps = 30, width = 1080, height = 1920): string[] {
  const d = Math.max(0.5, dur);
  const step = 0.12 / (d * fps); // per-frame zoom delta (~12% over the scene)
  switch (motion) {
    case 'zoom_in':
      return [
        `zoompan=z='min(zoom+${step.toFixed(6)},1.12)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${width}x${height}:fps=${fps}`,
        `scale=${width}:${height}:flags=lanczos`,
      ];
    case 'zoom_out':
      return [
        `zoompan=z='if(eq(on,1),1.12,max(zoom-${step.toFixed(6)},1.0))':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${width}x${height}:fps=${fps}`,
        `scale=${width}:${height}:flags=lanczos`,
      ];
    case 'pan_left':
      return [
        `crop=w='iw*0.94':h='ih*0.94':x='(iw-ow)*(0.10+0.80*t/${d.toFixed(3)})':y='(ih-oh)/2'`,
        `scale=${width}:${height}:flags=lanczos`,
      ];
    case 'pan_right':
      return [
        `crop=w='iw*0.94':h='ih*0.94':x='(iw-ow)*(0.90-0.80*t/${d.toFixed(3)})':y='(ih-oh)/2'`,
        `scale=${width}:${height}:flags=lanczos`,
      ];
    case 'none':
    default:
      return [`scale=${width}:${height}:flags=lanczos`];
  }
}

function textConfig(kind: SceneSpec['kind'], width: number, height: number) {
  switch (kind) {
    case 'hook':
      return { size: 96, y: Math.round(height * 0.30), box: false, color: '0xFFFFFF' };
    case 'payoff':
      return { size: 86, y: Math.round(height * 0.30), box: false, color: '0xFFFFFF' };
    case 'cta':
      return { size: 68, y: Math.round(height * 0.30), box: true, color: '0xFFFFFF' };
    case 'list':
      return { size: 76, y: Math.round(height * 0.26), box: true, color: '0xFFFFFF' };
    default:
      return { size: 74, y: Math.round(height * 0.26), box: true, color: '0xFFFFFF' };
  }
}

/** Render one scene to an MP4 clip. Returns the clip path. */
export async function renderSceneClip(opts: SceneRenderOpts): Promise<string> {
  const { scene, durationSec, workDir, width, height, fps } = opts;
  ensureDir(workDir);
  let fontFile = opts.fontFile;
  if (!fs.existsSync(path.join(workDir, fontFile))) fontFile = fontInto(workDir, 'bold') ?? fontFile;
  const out = path.join(workDir, `scene_${opts.index}.mp4`);
  const dur = Math.max(1.0, durationSec);

  // --- inputs -------------------------------------------------------
  const args: string[] = ['-y'];
  const filters: string[] = [];
  const accent = opts.accentColor ?? scene.visual.colors[1];

  if (opts.assetPath && fs.existsSync(opts.assetPath)) {
    if (opts.assetKind === 'video') {
      args.push('-stream_loop', '-1', '-i', opts.assetPath);
      filters.push(
        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1[bg]`,
      );
    } else {
      args.push('-loop', '1', '-framerate', String(fps), '-i', opts.assetPath);
      filters.push(
        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[bg]`,
      );
    }
    // darken slightly so typography stays readable over photos
    filters.push('[bg]drawbox=x=0:y=0:w=iw:h=ih:color=black@0.32:t=fill[bgd]');
    filters.push('[bgd]eq=brightness=-0.05:saturation=0.95[base]');
  } else {
    const [c0, c1] = scene.visual.colors;
    const c2 = (scene.visual.colors as string[])[2] ?? c0;
    const seed = opts.seed ?? opts.index * 977 + 13;
    args.push(
      '-f',
      'lavfi',
      '-i',
      `gradients=s=${width}x${height}:r=${fps}:c0=${hexToFf(c0)}:c1=${hexToFf(c1)}:c2=${hexToFf(c2)}:n=3:speed=0.03:seed=${seed}:d=${dur.toFixed(3)}`,
    );
    // slightly deeper colour + a corner vignette gives the flat gradient depth
    filters.push(`[0:v]scale=${width}:${height},setsar=1,eq=brightness=-0.03:saturation=1.06,vignette=PI/6[base]`);
  }

  // --- style + motion ------------------------------------------------
  const chain: string[] = [];
  styleFilters(opts.scene.visual.style, accent).forEach((f) => chain.push(f));
  motionFilter(opts.scene.visual.motion, dur, fps, width, height).forEach((f) => chain.push(f));
  if (opts.scene.visual.style !== 'radial') chain.push('vignette=PI/7');
  filters.push(`[base]${chain.join(',')}[proc]`);

  // --- typography -----------------------------------------------------
  const cfg = textConfig(scene.kind, width, height);
  const usableChars = Math.floor((width * 0.82) / (cfg.size * 0.54));
  const wrapped = wrapText(scene.textOnScreen, usableChars, 4);
  const textFile = path.join(workDir, `text_${opts.index}.txt`);
  fs.writeFileSync(textFile, wrapped, 'utf8');
  const textStyle = [
    `fontfile=${fontFile}`,
    `textfile=${path.basename(textFile)}`,
    `fontsize=${cfg.size}`,
    `fontcolor=${cfg.color}`,
    'borderw=6',
    'bordercolor=0x000000@0.45',
    'shadowx=0',
    'shadowy=3',
    'shadowcolor=0x000000@0.35',
    'line_spacing=16',
    'expansion=none',
    'x=(w-text_w)/2',
    `y=${cfg.y}`,
    cfg.box ? 'box=1:boxcolor=0x05070D@0.55:boxborderw=32' : 'box=0',
  ].join(':');
  filters.push(`[proc]drawtext=${textStyle}[withtext]`);

  if (scene.visual.keyword && scene.visual.keyword.trim()) {
    const badgeFile = path.join(workDir, `badge_${opts.index}.txt`);
    fs.writeFileSync(badgeFile, capitalize(scene.visual.keyword.trim()), 'utf8');
    const badgeStyle = [
      `fontfile=${fontFile}`,
      `textfile=${path.basename(badgeFile)}`,
      'fontsize=42',
      'fontcolor=0xFFFFFF',
      'box=1',
      `boxcolor=${hexToFf(accent)}@0.95`,
      'boxborderw=20',
      'borderw=2',
      'bordercolor=0x000000@0.35',
      'expansion=none',
      'x=(w-text_w)/2',
      `y=${Math.round(height * 0.15)}`,
    ].join(':');
    filters.push(`[withtext]drawtext=${badgeStyle}[outv]`);
  } else {
    filters.push('[withtext]null[outv]');
  }

  const subtitleChain = opts.subtitleFile ? `ass=${opts.subtitleFile}:fontsdir=.,` : '';
  filters.push(`[outv]fade=t=in:st=0:d=0.22,${subtitleChain}format=yuv420p,fps=${fps}[final]`);

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[final]',
    '-t',
    dur.toFixed(3),
    '-c:v',
    'libx264',
    '-preset',
    opts.preset ?? 'faster',
    '-crf',
    String(opts.crf ?? 18),
    '-pix_fmt',
    'yuv420p',
    '-an',
    out,
  );

  try {
    await runFfmpeg(args, { cwd: workDir, timeoutMs: 180000 });
  } catch (err) {
    log.error('scene render failed', { index: opts.index, error: String(err) });
    throw err;
  }
  return out;
}

export type CoverOpts = {
  title: string;
  keyword: string;
  colors: [string, string];
  workDir: string;
  fontFile: string;
  width?: number;
  height?: number;
  outFile: string;
};

/** Generate a 9:16 Shorts cover PNG locally (no image API needed). */
export async function renderCoverImage(opts: CoverOpts): Promise<string> {
  const width = opts.width ?? 1080;
  const height = opts.height ?? 1920;
  ensureDir(opts.workDir);
  let fontFile = opts.fontFile;
  if (!fs.existsSync(path.join(opts.workDir, fontFile))) fontFile = fontInto(opts.workDir, 'bold') ?? fontFile;
  const [c0, c1] = opts.colors;
  const fontSize = 112;
  const usable = Math.floor((width * 0.86) / (fontSize * 0.54));
  const wrapped = wrapText(opts.title, usable, 4);
  const textFile = path.join(opts.workDir, 'cover_text.txt');
  fs.writeFileSync(textFile, wrapped, 'utf8');

  const badge = path.join(opts.workDir, 'cover_badge.txt');
  fs.writeFileSync(badge, capitalize(opts.keyword || 'shorts'), 'utf8');

  const filters = [
    `gradients=s=${width}x${height}:r=1:c0=${hexToFf(c0)}:c1=${hexToFf(c1)}:c2=${hexToFf(c0)}:n=3:speed=0.02:seed=7:d=1[bg]`,
    `[bg]vignette=PI/5,drawbox=x=0:y=0:w=iw:h=ih:color=black@0.22:t=fill,` +
      `drawtext=fontfile=${fontFile}:textfile=${path.basename(badge)}:fontsize=48:fontcolor=0xFFFFFF:box=1:` +
      `boxcolor=${hexToFf(c1)}@0.95:boxborderw=22:borderw=2:bordercolor=0x000000@0.35:expansion=none:x=(w-text_w)/2:y=${Math.round(height * 0.15)}[b1]`,
    `[b1]drawtext=fontfile=${fontFile}:textfile=${path.basename(textFile)}:fontsize=${fontSize}:fontcolor=0xFFFFFF:` +
      `borderw=10:bordercolor=0x05070D@0.6:shadowx=0:shadowy=6:shadowcolor=0x000000@0.45:line_spacing=24:expansion=none:x=(w-text_w)/2:y=${Math.round(height * 0.36)}[final]`,
  ];

  await runFfmpeg(
    ['-y', '-filter_complex', filters.join(';'), '-map', '[final]', '-frames:v', '1', '-pix_fmt', 'yuv420p', opts.outFile],
    { cwd: opts.workDir, timeoutMs: 60000 },
  );
  return opts.outFile;
}

export { escapeFilterValue };
