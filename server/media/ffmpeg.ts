import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { CONFIG } from '../config.js';
import { log } from '../lib/logger.js';

export class FfmpegError extends Error {
  stderr: string;
  args: string[];
  constructor(message: string, args: string[], stderr: string) {
    super(message);
    this.name = 'FfmpegError';
    this.args = args;
    this.stderr = stderr;
  }
}

export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  if (ffmpegStatic && fs.existsSync(ffmpegStatic)) return ffmpegStatic;
  // fall back to a system ffmpeg if the static build is missing
  return 'ffmpeg';
}

export function ffprobePath(): string {
  const p = (ffprobeStatic as unknown as { path: string })?.path;
  if (p && fs.existsSync(p)) return p;
  return 'ffprobe';
}

export type RunOpts = {
  cwd?: string;
  timeoutMs?: number;
  onProgress?: (outTimeSec: number) => void;
  signal?: AbortSignal;
};

export function runFfmpeg(args: string[], opts: RunOpts = {}): Promise<{ stdout: string; stderr: string }> {
  const { cwd = CONFIG.DIRS.tmp, timeoutMs = 15 * 60 * 1000, onProgress } = opts;
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath();
    const child = spawn(bin, ['-hide_banner', '-nostdin', ...args], { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new FfmpegError(`ffmpeg timed out after ${timeoutMs}ms`, args, stderr.slice(-4000)));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      if (onProgress) {
        const m = /out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
        if (m) onProgress(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
      }
      stderr += text;
      if (stderr.length > 200000) stderr = stderr.slice(-100000);
    };

    child.stdout.on('data', (c) => {
      stdout += c.toString();
      if (onProgress) {
        const m = /out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(c.toString());
        if (m) onProgress(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
      }
    });
    child.stderr.on('data', onData);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.on('error', (err) => finish(() => reject(new FfmpegError(`failed to start ffmpeg: ${err.message}`, args, stderr))));
    child.on('close', (code) => {
      if (code === 0) finish(() => resolve({ stdout, stderr }));
      else
        finish(() =>
          reject(
            new FfmpegError(
              `ffmpeg exited with code ${code}: ${lastLines(stderr)}`,
              args,
              stderr.slice(-6000),
            ),
          ),
        );
    });
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => {
        try {
          child.kill('SIGKILL');
        } catch {}
      });
    }
  });
}

function lastLines(s: string): string {
  const lines = s.split(/\r?\n/).filter((l) => l.trim());
  return lines.slice(-4).join(' | ').slice(0, 500);
}

/** Duration in seconds via ffprobe (works for mp4, wav, mp3, ...). */
export async function mediaDurationSec(file: string): Promise<number> {
  const abs = path.resolve(file);
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobePath(), [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      abs,
    ], { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c.toString()));
    child.stderr.on('data', (c) => (err += c.toString()));
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      const dur = Number(out.trim());
      if (code === 0 && Number.isFinite(dur)) resolve(dur);
      else reject(new Error(`ffprobe failed for ${file}: ${err.slice(0, 300)}`));
    });
  });
}

export type WavInfo = { sampleRate: number; channels: number; bits: number; durationSec: number };

/** Parse a PCM WAV header without any dependency. */
export function wavInfoSync(file: string): WavInfo {
  const buf = fs.readFileSync(file);
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error(`Not a WAV file: ${file}`);
  }
  let offset = 12;
  let sampleRate = 22050;
  let channels = 1;
  let bits = 16;
  let dataLen = buf.length - 44;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bits = buf.readUInt16LE(offset + 22);
    } else if (id === 'data') {
      dataLen = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  const bytesPerFrame = (bits / 8) * channels;
  const durationSec = bytesPerFrame > 0 ? dataLen / (sampleRate * bytesPerFrame) : 0;
  return { sampleRate, channels, bits, durationSec };
}

export async function wavDurationSec(file: string): Promise<number> {
  try {
    return wavInfoSync(file).durationSec;
  } catch {
    return mediaDurationSec(file);
  }
}

/**
 * Escape a value used inside a drawtext/ass filter option.
 * Callers should prefer relative paths (cwd) to avoid Windows drive colons.
 */
export function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/%/g, '\\%');
}

/** Write a UTF-8 text file for drawtext `textfile=` (avoids all escaping issues). */
export function writeTextFile(dir: string, name: string, text: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text.replace(/\r/g, ''), 'utf8');
  return file;
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export { log };
