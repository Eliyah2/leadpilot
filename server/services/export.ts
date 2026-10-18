/**
 * "Export for YouTube" — prepares everything needed for a manual upload:
 * final MP4, title, description, tags, hashtags, cover, subtitles, metadata.json
 * and a step-by-step README. Works with zero API credentials.
 */
import fs from 'node:fs';
import path from 'node:path';
import { get, all } from '../db/index.js';
import { CONFIG } from '../config.js';
import { ensureDir } from '../media/ffmpeg.js';
import { getSetting } from '../engine/settings.js';
import { log } from '../lib/logger.js';

export type ExportResult = {
  videoId: string;
  dir: string;
  zipPath: string | null;
  files: string[];
  missing: string[];
  title: string;
};

function safeFileName(s: string): string {
  return (s || 'short').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'short';
}

export async function buildExportPackage(videoId: string): Promise<ExportResult> {
  const video = get<any>('SELECT * FROM videos WHERE id = ?', videoId);
  if (!video) throw new Error(`Video ${videoId} not found`);
  const dir = ensureDir(path.join(CONFIG.DIRS.exports, videoId));
  const files: string[] = [];
  const missing: string[] = [];
  const base = safeFileName(video.title || video.hook_text || 'short');

  // video file
  if (video.mp4_path && fs.existsSync(video.mp4_path)) {
    const dest = path.join(dir, `${base}.mp4`);
    fs.copyFileSync(video.mp4_path, dest);
    files.push(path.basename(dest));
  } else {
    missing.push('MP4 (render the video first)');
  }

  // cover
  const cover = video.cover_path ?? path.join(CONFIG.DIRS.covers, `${videoId}.png`);
  if (cover && fs.existsSync(cover)) {
    fs.copyFileSync(cover, path.join(dir, 'cover.png'));
    files.push('cover.png');
  } else {
    missing.push('cover.png');
  }

  // subtitles (srt) from stored word timings if the render produced them
  const srt = buildSrt(videoId);
  if (srt) {
    fs.writeFileSync(path.join(dir, 'subtitles.srt'), srt, 'utf8');
    files.push('subtitles.srt');
  }

  // text assets
  const title = video.title ?? '';
  const description = video.description ?? '';
  const tags = parseArr(video.tags);
  const hashtags = parseArr(video.hashtags);
  fs.writeFileSync(path.join(dir, 'title.txt'), title, 'utf8');
  fs.writeFileSync(path.join(dir, 'description.txt'), description, 'utf8');
  fs.writeFileSync(path.join(dir, 'tags.txt'), tags.join(', '), 'utf8');
  fs.writeFileSync(path.join(dir, 'hashtags.txt'), hashtags.join(' '), 'utf8');
  files.push('title.txt', 'description.txt', 'tags.txt', 'hashtags.txt');

  const metadata = {
    videoId,
    title,
    description,
    tags,
    hashtags,
    language: video.language,
    category: getSetting<string>('youtube.category', '28'),
    privacy: getSetting<string>('youtube.privacy', 'private'),
    scheduledAt: video.scheduled_at ? new Date(video.scheduled_at).toISOString() : null,
    durationSec: video.duration_sec,
    niche: video.niche_id,
    format: video.format,
    hook: video.hook_text,
    qcStatus: video.qc_status,
    sources: all<{ url: string; title: string }>(
      `SELECT s.url, s.title FROM sources s JOIN video_sources vs ON vs.source_id = s.id WHERE vs.video_id = ?`,
      videoId,
    ),
    exportedAt: new Date().toISOString(),
    generator: 'ShortForge',
  };
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
  files.push('metadata.json');

  fs.writeFileSync(path.join(dir, 'README.txt'), readme(metadata), 'utf8');
  files.push('README.txt');

  let zipPath: string | null = null;
  try {
    zipPath = await zipDirectory(dir, path.join(CONFIG.DIRS.exports, `${safeFileName(base)}.zip`));
    files.push(path.basename(zipPath));
  } catch (err) {
    log.warn('zip creation failed; folder export still available', String(err));
  }

  return { videoId, dir, zipPath, files, missing, title };
}

function readme(m: any): string {
  return `ShortForge export — manual YouTube upload
==========================================

Files
-----
${m.title}.mp4   vertical 1080x1920 (9:16), H.264 + AAC
cover.png        Shorts cover image
title.txt        video title
description.txt  description (hashtags included)
tags.txt         comma separated tags for the "Tags" box
subtitles.srt    caption file (optional; captions are already burned in)
metadata.json    everything in one place

How to upload
-------------
1. Open https://studio.youtube.com → Create → Upload video
2. Drag in the MP4.
3. Paste title.txt into Title and description.txt into Description.
4. Paste tags.txt content into the Tags box.
5. Set Shorts category, visibility and schedule.
6. Under "Thumbnail"/cover, upload cover.png (or pick a frame).
7. Publish.

Notes
-----
- The subtitles are already rendered into the video, so the SRT is optional.
- Uploads made through ShortForge's YouTube integration do this automatically.
- This package contains only your own generated content.
`;
}

function parseArr(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const v = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Build an SRT from stored scene timings + word timings (best effort). */
function buildSrt(videoId: string): string | null {
  const scenes = all<any>('SELECT * FROM scenes WHERE video_id = ? ORDER BY idx', videoId);
  if (!scenes.length) return null;
  const words = scenes
    .map((s) => {
      try {
        const visual = JSON.parse(s.visual || '{}');
        return visual;
      } catch {
        return {};
      }
    })
    .length;
  if (!words) return null;
  // Reconstruct cue text from the narration with fixed 3.5-second windows
  const narration = scenes.map((s) => String(s.voiceover ?? '')).join(' ').trim();
  if (!narration) return null;
  const allWords = narration.split(/\s+/);
  const totalDur = scenes.reduce((sum, s) => sum + Number(s.duration_sec ?? 3), 0);
  const perWord = totalDur / Math.max(1, allWords.length);
  const out: string[] = [];
  const GROUP = 5;
  let idx = 1;
  for (let i = 0; i < allWords.length; i += GROUP) {
    const chunk = allWords.slice(i, i + GROUP);
    const start = i * perWord;
    const end = Math.min(totalDur, (i + chunk.length) * perWord);
    out.push(`${idx}\n${srtTime(start)} --> ${srtTime(end)}\n${chunk.join(' ')}\n`);
    idx++;
  }
  return out.join('\n');
}

function srtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms).padStart(3, '0')}`;
}
const pad = (n: number) => String(n).padStart(2, '0');

/* ------------------------------------------------------------------ */
/* Minimal ZIP writer (STORE method) — no external dependency           */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export async function zipDirectory(dir: string, outFile: string): Promise<string> {
  const entries: { name: string; data: Buffer }[] = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isFile()) entries.push({ name, data: fs.readFileSync(p) });
  }
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // utf-8 flag
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    locals.push(local, e.data);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);
    offset += local.length + e.data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  fs.writeFileSync(outFile, Buffer.concat([...locals, centralBuf, end]));
  return outFile;
}
