import { Router, type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run } from '../db/index.js';
import { validate, v, HttpError } from '../lib/validate.js';
import { id, now, slugify, clamp } from '../lib/util.js';
import { requireAuth } from '../middleware/auth.js';
import { listVoices, detectProvider, previewVoice, pickVoiceFor, synthesizeVideo } from '../media/tts.js';
import { listSystemFonts } from '../media/fonts.js';
import { CONFIG } from '../config.js';
import { enqueue } from '../jobs/queue.js';
import { getSetting, setSetting } from '../engine/settings.js';
import { subtitleStyleFromSettings } from '../media/render.js';
import { subtitlePreview, buildCues, DEFAULT_SUBTITLE_STYLE } from '../media/subtitles.js';
import { runFfmpeg, mediaDurationSec } from '../media/ffmpeg.js';
import { usage } from '../services/usage.js';
import { LANGUAGES, type Lang } from '../engine/language.js';
import { log } from '../lib/logger.js';

export const mediaRouter = Router();

/* ---------------- voices ---------------- */

mediaRouter.get('/voices', async (req, res, next) => {
  try {
    const provider = await detectProvider();
    const voices = await listVoices(true);
    const preferred = typeof req.query.lang === 'string' ? req.query.lang : 'en';
    const match = await pickVoiceFor(preferred as Lang);
    const languageCodes = Array.from(new Set(voices.map((vo) => vo.language).filter(Boolean)));
    res.json({
      provider,
      voices: voices.map((vo) => ({ ...vo, recommended: vo.id === match.voice?.id })),
      languagesAvailable: languageCodes,
      missingLanguages: LANGUAGES.filter((l) => !languageCodes.includes(l.code)).map((l) => l.label),
      warning:
        provider === 'none'
          ? 'No local TTS found. Install espeak-ng (free) or run ShortForge on Windows/macOS.'
          : match.mismatch
            ? `No voice for "${preferred}" is installed locally — narration will use "${match.voice?.name ?? 'default'}". Add a free voice (e.g. espeak-ng languages) for natural ${preferred} speech.`
            : null,
      settings: {
        voice: getSetting<string>('voice.voice', ''),
        rate: getSetting<number>('voice.rate', 1.02),
        pitch: getSetting<number>('voice.pitch', 1),
        volume: getSetting<number>('voice.volume', 1),
        musicEnabled: getSetting<boolean>('voice.music_enabled', true),
        musicVolume: getSetting<number>('voice.music_volume', 0.07),
      },
    });
  } catch (err) {
    next(err);
  }
});

mediaRouter.post('/voice/preview', async (req, res, next) => {
  try {
    const body = validate(req.body, {
      voice: v.string({ max: 80, default: '' }),
      rate: v.num({ min: 0.5, max: 2, default: 1.02 }),
      pitch: v.num({ min: 0.5, max: 2, default: 1 }),
      text: v.string({ max: 400, default: '' }),
    });
    const out = await previewVoice(body.voice || 'default', { rate: body.rate, pitch: body.pitch }, body.text);
    res.json({
      url: `/media/audio/_previews/${path.basename(out.file)}`,
      durationSec: out.durationSec,
      provider: await detectProvider(),
    });
  } catch (err) {
    next(err);
  }
});

mediaRouter.post('/voice/settings', (req, res, next) => {
  try {
    const body = validate(req.body, {
      voice: v.string({ max: 80, default: getSetting<string>('voice.voice', '') }),
      rate: v.num({ min: 0.5, max: 2, default: getSetting<number>('voice.rate', 1.02) }),
      pitch: v.num({ min: 0.5, max: 2, default: getSetting<number>('voice.pitch', 1) }),
      volume: v.num({ min: 0, max: 2, default: getSetting<number>('voice.volume', 1) }),
      musicEnabled: v.bool({ default: getSetting<boolean>('voice.music_enabled', true) }),
      musicVolume: v.num({ min: 0, max: 0.5, default: getSetting<number>('voice.music_volume', 0.07) }),
    });
    setSetting('voice.voice', body.voice);
    setSetting('voice.rate', body.rate);
    setSetting('voice.pitch', body.pitch);
    setSetting('voice.volume', body.volume);
    setSetting('voice.music_enabled', body.musicEnabled);
    setSetting('voice.music_volume', body.musicVolume);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------------- subtitles ---------------- */

mediaRouter.get('/videos/:id/subtitles', (req, res, next) => {
  try {
    const video = get<any>('SELECT * FROM videos WHERE id = ?', req.params.id);
    if (!video) throw new HttpError(404, 'Video not found');
    const vo = get<any>('SELECT * FROM voiceovers WHERE video_id = ? ORDER BY created_at DESC LIMIT 1', video.id);
    const scenes = all<any>('SELECT * FROM scenes WHERE video_id = ? ORDER BY idx', video.id);
    if (!vo?.file_path || !fs.existsSync(vo.file_path)) {
      return res.json({ available: false, reason: 'Generate the voiceover first to see subtitle timing.', cues: [], style: subtitleStyleFromSettings() });
    }
    // Reconstruct word timings from scene durations (per-scene synthesis)
    const words: { text: string; start: number; end: number }[] = [];
    let cursor = 0;
    for (const s of scenes) {
      const text: string = s.voiceover ?? '';
      const dur = Number(s.duration_sec ?? 3);
      const spoken = Math.max(0.2, dur - 0.14);
      const parts = text.split(/\s+/).filter(Boolean);
      const weights = parts.map((w) => w.replace(/[^\p{L}\p{N}']/gu, '').length + 2.2);
      const total = weights.reduce((a, b) => a + b, 0) || 1;
      let local = 0;
      parts.forEach((w, i) => {
        const span = (weights[i]! / total) * spoken;
        words.push({ text: w, start: cursor + local, end: cursor + local + span });
        local += span;
      });
      cursor += dur;
    }
    const style = subtitleStyleFromSettings();
    res.json({ available: true, cues: subtitlePreview(words, style), style, totalSec: cursor });
  } catch (err) {
    next(err);
  }
});

mediaRouter.post('/subtitles/settings', (req, res, next) => {
  try {
    const body = validate(req.body, {
      size: v.int({ min: 40, max: 180, default: getSetting<number>('subtitles.size', 104) }),
      bold: v.bool({ default: getSetting<boolean>('subtitles.bold', true) }),
      position: v.num({ min: 0.3, max: 0.95, default: getSetting<number>('subtitles.position', 0.8) }),
      maxWords: v.int({ min: 2, max: 8, default: getSetting<number>('subtitles.max_words', 4) }),
      style: v.string({ max: 20, default: getSetting<string>('subtitles.style', 'word_highlight'), oneOf: ['word_highlight', 'phrase', 'none'] }),
      primaryColor: v.string({ max: 20, default: getSetting<string>('subtitles.primary_color', '#ffffff') }),
      highlightColor: v.string({ max: 20, default: getSetting<string>('subtitles.highlight_color', '#ffd60a') }),
      outline: v.int({ min: 0, max: 16, default: getSetting<number>('subtitles.outline', 7) }),
      marginV: v.int({ min: 100, max: 700, default: getSetting<number>('subtitles.margin_v', 340) }),
      allCaps: v.bool({ default: getSetting<boolean>('subtitles.all_caps', true) }),
    });
    setSetting('subtitles.size', body.size);
    setSetting('subtitles.bold', body.bold);
    setSetting('subtitles.position', body.position);
    setSetting('subtitles.max_words', body.maxWords);
    setSetting('subtitles.style', body.style);
    setSetting('subtitles.primary_color', body.primaryColor);
    setSetting('subtitles.highlight_color', body.highlightColor);
    setSetting('subtitles.outline', body.outline);
    setSetting('subtitles.margin_v', body.marginV);
    setSetting('subtitles.all_caps', body.allCaps);
    res.json({ ok: true, style: subtitleStyleFromSettings() });
  } catch (err) {
    next(err);
  }
});

/* ---------------- render / voiceover jobs ---------------- */

mediaRouter.post('/videos/:id/voiceover', (req, res, next) => {
  try {
    const video = get('SELECT id FROM videos WHERE id = ?', req.params.id);
    if (!video) throw new HttpError(404, 'Video not found');
    const jobId = enqueue('video_voiceover', { videoId: req.params.id }, { videoId: String(req.params.id), userId: req.user!.id, dedupeKey: `vo:${req.params.id}`, priority: 58 });
    res.status(202).json({ jobId });
  } catch (err) {
    next(err);
  }
});

mediaRouter.post('/videos/:id/render', (req, res, next) => {
  try {
    const video = get('SELECT id FROM videos WHERE id = ?', req.params.id);
    if (!video) throw new HttpError(404, 'Video not found');
    const jobId = enqueue('video_render', { videoId: req.params.id }, { videoId: String(req.params.id), userId: req.user!.id, dedupeKey: `render:${req.params.id}`, priority: 55 });
    res.status(202).json({ jobId });
  } catch (err) {
    next(err);
  }
});

/* ---------------- assets ---------------- */

const ALLOWED_ASSETS: Record<string, { ext: string[]; kind: 'image' | 'video' | 'audio' | 'font' }> = {
  'image/png': { ext: ['.png'], kind: 'image' },
  'image/jpeg': { ext: ['.jpg', '.jpeg'], kind: 'image' },
  'image/webp': { ext: ['.webp'], kind: 'image' },
  'video/mp4': { ext: ['.mp4'], kind: 'video' },
  'video/webm': { ext: ['.webm'], kind: 'video' },
  'audio/wav': { ext: ['.wav'], kind: 'audio' },
  'audio/mpeg': { ext: ['.mp3'], kind: 'audio' },
  'audio/x-wav': { ext: ['.wav'], kind: 'audio' },
  'font/ttf': { ext: ['.ttf'], kind: 'font' },
  'font/otf': { ext: ['.otf'], kind: 'font' },
  'application/x-font-ttf': { ext: ['.ttf'], kind: 'font' },
};

mediaRouter.post('/assets/upload', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = validate(req.body, {
      filename: v.string({ min: 3, max: 160, pattern: /^[A-Za-z0-9._ -]+$/ }),
      contentType: v.string({ min: 3, max: 80 }),
      dataBase64: v.string({ min: 10, max: Math.round(CONFIG.MAX_UPLOAD_BYTES * 1.4) }),
      license: v.string({ max: 120, default: 'own' }),
      sourceUrl: v.string({ max: 400, default: '' }),
      tags: v.array(v.string({ max: 30 }), { max: 20, default: [] as string[] }) as any,
    });
    const allowed = ALLOWED_ASSETS[body.contentType.split(';')[0]!.trim()];
    if (!allowed) throw new HttpError(415, `Unsupported file type "${body.contentType}". Allowed: png, jpg, webp, mp4, webm, wav, mp3, ttf, otf.`);
    const ext = path.extname(body.filename).toLowerCase();
    if (!allowed.ext.includes(ext)) throw new HttpError(400, `Extension "${ext}" does not match the content type`);
    if (allowed.kind === 'font' && !fs.existsSync(path.join(CONFIG.DIRS.fonts, body.filename))) {
      // fonts land in the shared fonts dir so renders can use them
    }
    const buf = Buffer.from(body.dataBase64, 'base64');
    if (buf.length > CONFIG.MAX_UPLOAD_BYTES) throw new HttpError(413, 'File is too large');
    if (buf.length < 100) throw new HttpError(400, 'File is empty or truncated');
    if (!magicOk(buf, body.contentType)) throw new HttpError(400, 'File content does not match its declared type');

    const destDir = allowed.kind === 'font' ? CONFIG.DIRS.fonts : CONFIG.DIRS.assets;
    const safeName = `${Date.now().toString(36)}_${body.filename.replace(/[^A-Za-z0-9._ -]/g, '')}`;
    const dest = path.join(destDir, safeName);
    fs.writeFileSync(dest, buf);

    const assetId = id('ast');
    run(
      `INSERT INTO assets (id, user_id, kind, name, path, license, source_url, size_bytes, tags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      assetId,
      req.user!.id,
      allowed.kind,
      body.filename,
      dest,
      body.license,
      body.sourceUrl,
      buf.length,
      JSON.stringify(body.tags ?? []),
      now(),
    );
    usage.record('storage_bytes', { provider: 'local', units: buf.length, unitLabel: 'bytes', costUsd: 0 });
    res.status(201).json({ id: assetId, kind: allowed.kind, name: body.filename, sizeBytes: buf.length, url: `/media/assets/${safeName}` });
  } catch (err) {
    next(err);
  }
});

mediaRouter.get('/assets', (_req, res) => {
  const rows = all<any>('SELECT * FROM assets ORDER BY created_at DESC LIMIT 200');
  res.json(
    rows.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      license: a.license,
      sourceUrl: a.source_url,
      sizeBytes: a.size_bytes,
      url: `/media/assets/${path.basename(a.path)}`,
      createdAt: a.created_at,
    })),
  );
});

mediaRouter.delete('/assets/:id', (req, res, next) => {
  try {
    const asset = get<any>('SELECT * FROM assets WHERE id = ?', req.params.id);
    if (!asset) throw new HttpError(404, 'Asset not found');
    run('DELETE FROM assets WHERE id = ?', asset.id);
    try {
      if (fs.existsSync(asset.path)) fs.rmSync(asset.path, { force: true });
    } catch {}
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

mediaRouter.get('/fonts', (_req, res) => {
  res.json(listSystemFonts());
});

/* ---------------- cover regeneration ---------------- */

mediaRouter.post('/videos/:id/cover', async (req, res, next) => {
  try {
    const video = get<any>('SELECT * FROM videos WHERE id = ?', req.params.id);
    if (!video) throw new HttpError(404, 'Video not found');
    const body = validate(req.body, { title: v.string({ max: 120, default: video.title }) });
    const { renderCoverImage } = await import('../media/visuals.js');
    const workDir = path.join(CONFIG.DIRS.tmp, `cover_${video.id}`);
    fs.mkdirSync(workDir, { recursive: true });
    const scenes = all<any>('SELECT visual FROM scenes WHERE video_id = ? ORDER BY idx LIMIT 1', video.id);
    let colors: [string, string] = ['#0f172a', '#6366f1'];
    try {
      const parsed = JSON.parse(scenes[0]?.visual ?? '{}');
      if (parsed?.colors) colors = parsed.colors;
    } catch {}
    const out = await renderCoverImage({
      title: body.title,
      keyword: video.hook_text ? video.hook_text.split(/\s+/).slice(-1)[0] : 'shorts',
      colors,
      workDir,
      fontFile: 'font_bold.ttf',
      outFile: path.join(CONFIG.DIRS.covers, `${video.id}.png`),
    });
    run('UPDATE videos SET cover_path = ?, updated_at = ? WHERE id = ?', out, now(), video.id);
    fs.rmSync(workDir, { recursive: true, force: true });
    res.json({ ok: true, url: `/media/covers/${video.id}.png` });
  } catch (err) {
    next(err);
  }
});

function magicOk(buf: Buffer, contentType: string): boolean {
  const type = contentType.split(';')[0]!.trim();
  if (type === 'image/png') return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8;
  if (type === 'image/webp') return buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  if (type === 'video/mp4' || type === 'font/ttf' || type === 'application/x-font-ttf') return buf.subarray(4, 8).toString('ascii') === 'ftyp' || buf.subarray(0, 4).toString('ascii') === '\x00\x01\x00\x00' || buf.subarray(0, 4).toString('ascii') === 'OTTO' || buf.length > 100;
  if (type === 'audio/wav' || type === 'audio/x-wav') return buf.subarray(0, 4).toString('ascii') === 'RIFF';
  if (type === 'audio/mpeg') return buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0;
  return true;
}

export { slugify, clamp };
