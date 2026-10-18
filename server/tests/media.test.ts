import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { migrate } from '../db/schema.js';
import { db } from '../db/index.js';
import { seed } from '../db/seed.js';
import { detectProvider, listVoices, synthesizeVideo, previewVoice } from '../media/tts.js';
import { buildCues, buildAss, DEFAULT_SUBTITLE_STYLE, subtitlePreview, fontFamilyFromFontFile } from '../media/subtitles.js';
import { synthesizeMusic } from '../media/music.js';
import { renderShort } from '../media/render.js';
import { mediaDurationSec, runFfmpeg } from '../media/ffmpeg.js';
import { resolveFont, fontInto } from '../media/fonts.js';
import { CONFIG } from '../config.js';
import type { SceneSpec } from '../engine/scripts.js';

const provider = await detectProvider();

const scenes: SceneSpec[] = [
  {
    kind: 'hook',
    voiceover: 'Almost nobody knows this about Venus.',
    textOnScreen: 'A day on Venus lasts longer than its year',
    visual: { style: 'radial', colors: ['#0b1026', '#8b5cf6'], keyword: 'venus', motion: 'zoom_in' },
    transition: 'fade',
    durationSec: 3,
  },
  {
    kind: 'value',
    voiceover: 'Venus takes two hundred forty three Earth days to spin just once.',
    textOnScreen: '243 Earth days to spin once',
    visual: { style: 'bands', colors: ['#0b1026', '#8b5cf6'], keyword: 'rotation', motion: 'pan_left' },
    transition: 'slideleft',
    durationSec: 4,
  },
  {
    kind: 'payoff',
    voiceover: 'So a single day outlasts an entire year there.',
    textOnScreen: 'A day beats a year',
    visual: { style: 'grid', colors: ['#0b1026', '#8b5cf6'], keyword: 'venus', motion: 'zoom_out' },
    transition: 'circleopen',
    durationSec: 3,
  },
];

before(() => {
  migrate(db);
  seed();
});

test('a local TTS provider is detected on this machine', { skip: provider === 'none' }, async () => {
  assert.notEqual(provider, 'none');
  const voices = await listVoices(true);
  assert.ok(Array.isArray(voices));
});

test('per-scene synthesis produces audio, timings and a combined track', { skip: provider === 'none' }, async () => {
  const result = await synthesizeVideo('test_vo', scenes, { rate: 1.0, pitch: 1.0 }, 'en');
  assert.equal(result.scenes.length, 3);
  for (const s of result.scenes) {
    assert.ok(fs.existsSync(s.file), `missing ${s.file}`);
    assert.ok(s.durationSec > 0.4, `scene duration too small: ${s.durationSec}`);
  }
  assert.ok(fs.existsSync(result.combinedFile));
  assert.ok(result.totalDurationSec > 3 && result.totalDurationSec < 30, `total ${result.totalDurationSec}`);
  assert.ok(result.words.length >= 15, `expected word timings, got ${result.words.length}`);

  // word timeline must be monotonic and inside the total duration
  let prev = -1;
  for (const w of result.words) {
    assert.ok(w.start >= prev - 0.001, 'word timings must be monotonic');
    assert.ok(w.end <= result.totalDurationSec + 0.35, 'word ends inside track');
    prev = w.start;
  }

  const voDuration = await mediaDurationSec(result.combinedFile);
  assert.ok(Math.abs(voDuration - result.totalDurationSec) < 0.5, `voiceover ${voDuration} vs ${result.totalDurationSec}`);
});

test('subtitle cues group words and highlight the active word', { skip: provider === 'none' }, async () => {
  const result = await synthesizeVideo('test_vo2', scenes, {}, 'en');
  const style = { ...DEFAULT_SUBTITLE_STYLE };
  const cues = buildCues(result.words, style);
  assert.ok(cues.length > 3, `expected several cues, got ${cues.length}`);
  for (let i = 1; i < cues.length; i++) {
    assert.ok(cues[i]!.start >= cues[i - 1]!.start - 0.001, 'cues must be ordered');
  }
  const highlighted = cues.filter((c) => c.activeIndex >= 0);
  assert.ok(highlighted.length >= cues.length * 0.8, 'most cues should carry a highlight');

  const workDir = path.join(CONFIG.DIRS.tmp, 'sub_test');
  fs.mkdirSync(workDir, { recursive: true });
  const fontFile = fontInto(workDir, 'bold');
  assert.ok(fontFile, 'expected a system font');
  const family = fontFamilyFromFontFile(path.join(workDir, fontFile!));
  assert.ok(family && family.length > 1, `could not read font family, got ${family}`);

  const ass = buildAss(cues, style, { width: 1080, height: 1920, fontFamily: family!, totalDurationSec: result.totalDurationSec });
  assert.ok(ass.includes('[V4+ Styles]'));
  assert.ok(ass.includes('Dialogue:'));
  assert.ok(ass.includes('PlayResX: 1080'));
  const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
  assert.equal(dialogueLines.length, cues.length);
  // timings formatted as H:MM:SS.CC
  assert.ok(/^Dialogue: 0,\d:\d{2}:\d{2}\.\d{2},\d:\d{2}:\d{2}\.\d{2}/.test(dialogueLines[0]!), 'bad ass time format');

  const preview = subtitlePreview(result.words, style);
  assert.ok(preview.length > 3);
  assert.ok(typeof preview[0]!.start === 'number');
});

test('voice preview generates a short sample file', { skip: provider === 'none' }, async () => {
  const voices = await listVoices();
  const target = voices[0]?.id ?? 'default';
  const out = await previewVoice(target, { rate: 1 });
  assert.ok(fs.existsSync(out.file));
  assert.ok(out.durationSec > 0.3 && out.durationSec < 15, `preview duration ${out.durationSec}`);
});

test('procedural background music renders a wav of the requested length', async () => {
  const file = await synthesizeMusic({ durationSec: 6, seed: 'music-test' });
  assert.ok(fs.existsSync(file));
  const dur = await mediaDurationSec(file);
  assert.ok(Math.abs(dur - 6) < 0.6, `music duration ${dur}`);
});

test('full render produces a valid 1080x1920 MP4 with burned subtitles and audio', { skip: provider === 'none' }, async () => {
  const result = await synthesizeVideo('test_render_vo', scenes, {}, 'en');
  const progress: number[] = [];
  const out = await renderShort({
    videoId: 'test_render_vo',
    scenes: scenes.map((s, i) => ({ ...s, durationSec: result.scenes[i]!.durationSec })),
    tts: result,
    title: 'A day on Venus lasts longer than its year',
    keyword: 'venus',
    music: true,
    onProgress: (p) => progress.push(p),
  });

  assert.ok(fs.existsSync(out.mp4), 'mp4 missing');
  assert.ok(out.sizeBytes > 40_000, `file suspiciously small: ${out.sizeBytes}`);
  const duration = await mediaDurationSec(out.mp4);
  const expected = result.totalDurationSec;
  assert.ok(Math.abs(duration - expected) < 0.75, `duration ${duration} vs audio ${expected}`);
  assert.ok(progress.length > 3, 'expected progress callbacks');
  assert.equal(progress[progress.length - 1], 100);

  // stream properties via ffprobe
  const probe = await probeJson(out.mp4);
  const v = probe.streams.find((s: any) => s.codec_type === 'video');
  const a = probe.streams.find((s: any) => s.codec_type === 'audio');
  assert.ok(v, 'no video stream');
  assert.ok(a, 'no audio stream');
  assert.equal(v.width, 1080);
  assert.equal(v.height, 1920);
  assert.equal(v.codec_name, 'h264');
  assert.equal(a.codec_name, 'aac');
  assert.equal(probe.format.format_name, 'mov,mp4,m4a,3gp,3g2,mj2');

  // cover image
  assert.ok(out.coverPath && fs.existsSync(out.coverPath), 'cover missing');
});

test('render works without music and without subtitles', { skip: provider === 'none' }, async () => {
  const result = await synthesizeVideo('test_render_min', scenes.slice(0, 2), {}, 'en');
  const out = await renderShort({
    videoId: 'test_render_min',
    scenes: scenes.slice(0, 2).map((s, i) => ({ ...s, durationSec: result.scenes[i]!.durationSec })),
    tts: result,
    title: 'Minimal render',
    keyword: 'test',
    music: false,
    subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE, style: 'none' },
    generateCover: false,
  });
  assert.ok(fs.existsSync(out.mp4));
  assert.equal(out.coverPath, null);
  const probe = await probeJson(out.mp4);
  const a = probe.streams.find((s: any) => s.codec_type === 'audio');
  assert.equal(a.codec_name, 'aac');
});

test('landscape 16:9 render produces a 1920x1080 MP4', { skip: provider === 'none' }, async () => {
  const result = await synthesizeVideo('test_render_land', scenes.slice(0, 2), {}, 'en');
  const out = await renderShort({
    videoId: 'test_render_land',
    width: 1920,
    height: 1080,
    scenes: scenes.slice(0, 2).map((s, i) => ({ ...s, durationSec: result.scenes[i]!.durationSec })),
    tts: result,
    title: 'Landscape render',
    keyword: 'test',
    music: false,
    subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE, style: 'none' },
    generateCover: false,
  });
  assert.ok(fs.existsSync(out.mp4));
  const probe = await probeJson(out.mp4);
  const v = probe.streams.find((s: any) => s.codec_type === 'video');
  assert.equal(v.width, 1920);
  assert.equal(v.height, 1080);
});

async function probeJson(file: string): Promise<any> {
  const { execFileSync } = await import('node:child_process');
  const { default: ffprobeStatic } = await import('ffprobe-static');
  const out = execFileSync(ffprobeStatic.path, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {
    encoding: 'utf8',
  });
  return JSON.parse(out);
}
