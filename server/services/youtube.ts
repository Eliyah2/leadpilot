/**
 * Official YouTube integration (YouTube Data API v3).
 *
 * Compliance notes:
 *   - OAuth 2.0 with PKCE; refresh tokens are encrypted at rest (AES-256-GCM).
 *   - No passwords are ever stored or transmitted by ShortForge.
 *   - Uploads use the official resumable upload endpoint; statistics use the
 *     official videos.list endpoint.
 *   - Quota is tracked: video insert = 1 600 units of the free 10 000/day.
 *   - Without credentials the whole app still works via "Export for YouTube".
 *
 * This module is OPTIONAL: set youtube.clientId / youtube.clientSecret in
 * Settings after creating free OAuth credentials in Google Cloud Console.
 */
import fs from 'node:fs';
import { get, run, all } from '../db/index.js';
import { now, id, clamp } from '../lib/util.js';
import { encrypt, decrypt, randomToken, sha256 } from '../lib/crypto.js';
import { getSetting, setSetting } from '../engine/settings.js';
import { CONFIG } from '../config.js';
import { fetchText, fetchJson } from '../lib/net.js';
import { usage } from './usage.js';
import { log } from '../lib/logger.js';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
].join(' ');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/youtube/v3';

export type OAuthTokens = {
  refresh_token: string;
  access_token: string;
  expiry: number;
  scope: string;
  token_type?: string;
  expires_in?: number;
};

export type ChannelRow = any;

export function oauthConfigured(): boolean {
  return Boolean(getSetting<string>('youtube.clientId', '') && getSetting<string>('youtube.clientSecret', ''));
}

export function redirectUri(): string {
  const configured = getSetting<string>('youtube.redirectUri', '');
  if (configured) return configured;
  return `http://127.0.0.1:${CONFIG.PORT}/api/youtube/callback`;
}

export type AuthUrlResult = { url: string; state: string; redirectUri: string };

/** Step 1: build the Google consent URL with PKCE + state. */
export function createAuthUrl(): AuthUrlResult {
  if (!oauthConfigured()) {
    throw Object.assign(new Error('YouTube OAuth credentials are not configured. Add your free Google Cloud client ID and secret in Settings → YouTube.'), { status: 400 });
  }
  const verifier = randomToken(64);
  const challenge = sha256(verifier);
  const state = randomToken(24);
  setSetting(
    'youtube.oauthPending',
    encrypt(JSON.stringify({ verifier, state, createdAt: now() })),
  );
  const params = new URLSearchParams({
    client_id: getSetting<string>('youtube.clientId', ''),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return { url: `${AUTH_URL}?${params.toString()}`, state, redirectUri: redirectUri() };
}

/** Step 2: exchange the callback code for tokens. */
export async function handleCallback(params: Record<string, string>): Promise<{ channelId: string; title: string }> {
  if (params.error) throw new Error(`Google sign-in failed: ${params.error_description || params.error}`);
  const pendingRaw = getSetting<string>('youtube.oauthPending', '');
  if (!pendingRaw) throw new Error('No sign-in in progress. Start again from Settings → YouTube.');
  const pending = JSON.parse(decrypt(pendingRaw)) as { verifier: string; state: string; createdAt: number };
  if (!params.state || params.state !== pending.state) throw new Error('OAuth state mismatch — please retry the connection.');
  if (now() - pending.createdAt > 10 * 60 * 1000) throw new Error('Sign-in link expired. Start again.');
  if (!params.code) throw new Error('Google did not return an authorization code.');

  const body = new URLSearchParams({
    client_id: getSetting<string>('youtube.clientId', ''),
    client_secret: getSetting<string>('youtube.clientSecret', ''),
    code: params.code,
    code_verifier: pending.verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
  });
  const tokens = await postForm<OAuthTokens & { refresh_token?: string }>(TOKEN_URL, body);
  setSetting('youtube.oauthPending', '');
  if (!tokens.refresh_token) {
    log.warn('Google did not return a refresh token; re-connect with prompt=consent to store one.');
  }

  const channelInfo = await fetchChannelInfo(tokens.access_token);
  const oauth: OAuthTokens = {
    refresh_token: tokens.refresh_token ?? '',
    access_token: tokens.access_token,
    expiry: now() + (tokens.expires_in ?? 3500) * 1000,
    scope: tokens.scope ?? SCOPES,
    token_type: tokens.token_type,
  };

  // upsert channel for the current user
  const userId = getSetting<string>('youtube.pendingUserId', '') || firstUserId();
  let channel = get<ChannelRow>('SELECT * FROM channels WHERE user_id = ? AND youtube_channel_id = ?', userId, channelInfo.id);
  const channelId = channel?.id ?? id('ch');
  run(
    `INSERT INTO channels (id, user_id, name, language, timezone, youtube_channel_id, youtube_title, oauth, connected_at, created_at)
     VALUES (?, ?, ?, 'en', 'UTC', ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET youtube_channel_id = excluded.youtube_channel_id, youtube_title = excluded.youtube_title,
       oauth = excluded.oauth, connected_at = excluded.connected_at`,
    channelId,
    userId,
    channelInfo.title || 'My channel',
    channelInfo.id,
    channelInfo.title || 'My channel',
    encrypt(JSON.stringify(oauth)),
    now(),
    now(),
  );
  if (!channel) {
    // insert didn't hit ON CONFLICT since id was new — ensure row exists
    channel = get<ChannelRow>('SELECT * FROM channels WHERE id = ?', channelId);
  }
  usage.record('api_call', { provider: 'youtube oauth', units: 1, unitLabel: 'token-exchange', costUsd: 0 });
  return { channelId, title: channelInfo.title };
}

function firstUserId(): string {
  const u = get<{ id: string }>('SELECT id FROM users ORDER BY created_at ASC LIMIT 1');
  if (!u) throw new Error('No user account exists yet.');
  return u.id;
}

async function postForm<T>(url: string, body: URLSearchParams): Promise<T> {
  const text = await fetchText(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    timeoutMs: 30000,
  });
  return JSON.parse(text) as T;
}

/** Refresh (and persist) a channel's access token when expired. */
async function accessTokenFor(channel: ChannelRow): Promise<string> {
  if (!channel.oauth) throw new Error('This channel is not connected to YouTube.');
  let tokens: OAuthTokens;
  try {
    tokens = JSON.parse(decrypt(channel.oauth));
  } catch {
    throw new Error('Stored YouTube tokens are unreadable. Reconnect the channel.');
  }
  if (tokens.access_token && tokens.expiry - now() > 60_000) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error('No refresh token stored. Reconnect YouTube from Settings.');
  if (!oauthConfigured()) throw new Error('YouTube OAuth credentials missing in Settings.');

  const res = await postForm<OAuthTokens>(TOKEN_URL, new URLSearchParams({
    client_id: getSetting<string>('youtube.clientId', ''),
    client_secret: getSetting<string>('youtube.clientSecret', ''),
    refresh_token: tokens.refresh_token,
    grant_type: 'refresh_token',
  }));
  const updated: OAuthTokens = {
    ...tokens,
    access_token: res.access_token,
    expiry: now() + (res.expires_in ?? 3500) * 1000,
  };
  run('UPDATE channels SET oauth = ? WHERE id = ?', encrypt(JSON.stringify(updated)), channel.id);
  return updated.access_token;
}

async function ytFetch<T>(channel: ChannelRow, url: string, init: RequestInit = {}): Promise<T> {
  let token = await accessTokenFor(channel);
  const doFetch = (t: string) =>
    fetchJson<T>(url, {
      ...(init as any),
      headers: { Authorization: `Bearer ${t}`, ...(init.headers ?? {}) },
      timeoutMs: 60000,
      retries: 0,
    });
  try {
    return await doFetch(token);
  } catch (err: any) {
    const message = String(err?.message ?? err);
    if (/401|HTTP 401/.test(message)) {
      // force refresh once
      const fresh: ChannelRow = { ...channel, oauth: encrypt(JSON.stringify({ ...JSON.parse(decrypt(channel.oauth)), expiry: 0 })) };
      run('UPDATE channels SET oauth = ? WHERE id = ?', fresh.oauth, channel.id);
      const reloaded = get<ChannelRow>('SELECT * FROM channels WHERE id = ?', channel.id)!;
      token = await accessTokenFor(reloaded);
      return await doFetch(token);
    }
    if (/403/.test(message) && /quota/i.test(message)) {
      throw new Error('YouTube API daily quota exceeded (free tier: 10 000 units/day ≈ 6 uploads). Try again after midnight Pacific time.');
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Channel info                                                        */
/* ------------------------------------------------------------------ */

export async function fetchChannelInfo(accessToken: string): Promise<{ id: string; title: string; subs: number; videos: number }> {
  const data = await fetchJson<any>(`${API}/channels?part=snippet,statistics&mine=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeoutMs: 30000,
  });
  usage.record('api_call', { provider: 'youtube', units: 1, unitLabel: 'channels.list (1 unit)', costUsd: 0 });
  const item = data.items?.[0];
  if (!item) throw new Error('Google returned no YouTube channel for this account. Create one at youtube.com first.');
  return {
    id: item.id,
    title: item.snippet?.title ?? 'My channel',
    subs: Number(item.statistics?.subscriberCount ?? 0),
    videos: Number(item.statistics?.videoCount ?? 0),
  };
}

export function getConnectedChannel(userId?: string): ChannelRow | undefined {
  if (userId) {
    return get<ChannelRow>('SELECT * FROM channels WHERE user_id = ? AND youtube_channel_id IS NOT NULL ORDER BY connected_at DESC LIMIT 1', userId);
  }
  return get<ChannelRow>('SELECT * FROM channels WHERE youtube_channel_id IS NOT NULL ORDER BY connected_at DESC LIMIT 1');
}

export function connectionStatus(userId?: string): {
  configured: boolean;
  connected: boolean;
  channelTitle: string | null;
  channelId: string | null;
  subs: number | null;
  redirectUri: string;
  quotaHint: string;
} {
  const ch = getConnectedChannel(userId);
  return {
    configured: oauthConfigured(),
    connected: Boolean(ch?.youtube_channel_id),
    channelTitle: ch?.youtube_title ?? null,
    channelId: ch?.youtube_channel_id ?? null,
    subs: null,
    redirectUri: redirectUri(),
    quotaHint: 'Free quota: 10 000 units/day. One upload = 1 600 units (≈ 6 uploads/day); stats sync = 1 unit per video.',
  };
}

export function disconnectChannel(channelId: string): void {
  run('UPDATE channels SET oauth = NULL, youtube_channel_id = NULL, connected_at = NULL WHERE id = ?', channelId);
}

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

export type UploadResult = {
  uploaded: boolean;
  videoId?: string;
  url?: string;
  reason?: string;
  quotaUsed?: number;
};

export async function uploadToYouTube(
  videoId: string,
  opts: { onProgress?: (percent: number, message: string) => void; channelId?: string } = {},
): Promise<UploadResult> {
  const progress = opts.onProgress ?? (() => {});
  const video = get<any>('SELECT * FROM videos WHERE id = ?', videoId);
  if (!video) throw new Error(`Video ${videoId} not found`);
  if (!video.mp4_path || !fs.existsSync(video.mp4_path)) {
    return { uploaded: false, reason: 'Render the Short first — no MP4 found. Use Render, then publish.' };
  }
  const channel = opts.channelId
    ? get<ChannelRow>('SELECT * FROM channels WHERE id = ?', opts.channelId)
    : getConnectedChannel(video.user_id);
  if (!channel?.youtube_channel_id) {
    return {
      uploaded: false,
      reason: 'No YouTube channel connected. Connect one in Settings → YouTube, or use "Export for YouTube" for a manual upload.',
    };
  }

  const tags = safeParseArr(video.tags);
  const metadata = {
    snippet: {
      title: clampStr(video.title || video.hook_text, 100),
      description: clampStr(video.description || '', 4900),
      tags: tags.slice(0, 25),
      categoryId: getSetting<string>('youtube.category', '28'),
      defaultLanguage: video.language || 'en',
    },
    status: {
      privacyStatus: getSetting<string>('youtube.privacy', 'private'),
      selfDeclaredMadeForKids: Boolean(getSetting<boolean>('youtube.made_for_kids', false)),
      ...(video.scheduled_at && video.scheduled_at > now()
        ? { publishAt: new Date(video.scheduled_at).toISOString(), privacyStatus: 'private' }
        : {}),
    },
  };

  progress(5, 'Starting resumable upload');
  const token = await accessTokenFor(channel);
  const fileSize = fs.statSync(video.mp4_path).size;
  const initRes = await fetch(
    `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&notifySubscribers=true&part=snippet,status`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(fileSize),
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!initRes.ok) {
    const text = await initRes.text();
    throw new Error(`YouTube rejected the upload session (${initRes.status}): ${text.slice(0, 400)}`);
  }
  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) throw new Error('YouTube did not return an upload URL.');

  // chunked upload (8 MB chunks) so large files are safe
  const CHUNK = 8 * 1024 * 1024;
  const buf = fs.readFileSync(video.mp4_path);
  let offset = 0;
  let youtubeId: string | null = null;
  while (offset < buf.length) {
    const end = Math.min(offset + CHUNK, buf.length);
    const chunk = buf.subarray(offset, end);
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Range': `bytes ${offset}-${end - 1}/${buf.length}`,
        'Content-Length': String(chunk.length),
        'Content-Type': 'video/mp4',
      },
      body: chunk as unknown as BodyInit,
    });
    if (res.status === 308) {
      offset = end;
      progress(Math.round((offset / buf.length) * 90), `Uploading ${Math.round((offset / buf.length) * 100)}%`);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upload chunk failed (${res.status}): ${text.slice(0, 400)}`);
    }
    const body = await res.json();
    youtubeId = body.id ?? null;
    offset = end;
    progress(92, 'Finalising upload');
  }

  if (!youtubeId) throw new Error('Upload finished without a video id from YouTube.');

  // record
  const publishedId = id('pub');
  run(
    `INSERT INTO published_videos (id, video_id, channel_id, youtube_video_id, title, visibility, published_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    publishedId,
    videoId,
    channel.id,
    youtubeId,
    video.title,
    metadata.status.privacyStatus,
    video.scheduled_at && video.scheduled_at > now() ? video.scheduled_at : now(),
    now(),
  );
  run("UPDATE videos SET status = 'published', published_at = ?, updated_at = ?, error = NULL WHERE id = ?",
    metadata.status.privacyStatus === 'public' && !(video.scheduled_at && video.scheduled_at > now()) ? now() : video.published_at,
    now(),
    videoId,
  );
  usage.record('api_call', { provider: 'youtube', units: 1600, unitLabel: 'videos.insert (1 600 units)', costUsd: 0, meta: { videoId } });
  progress(100, 'Uploaded');
  return { uploaded: true, videoId: youtubeId, url: `https://youtube.com/shorts/${youtubeId}`, quotaUsed: 1600 };
}

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

export async function fetchVideoStats(channel: ChannelRow, youtubeIds: string[]): Promise<Record<string, any>> {
  if (!youtubeIds.length) return {};
  const out: Record<string, any> = {};
  for (let i = 0; i < youtubeIds.length; i += 50) {
    const batch = youtubeIds.slice(i, i + 50);
    const data = await ytFetch<any>(channel, `${API}/videos?part=statistics,snippet,contentDetails,status&id=${batch.join(',')}`);
    usage.record('api_call', { provider: 'youtube', units: 1, unitLabel: 'videos.list (1 unit)', costUsd: 0 });
    for (const item of data.items ?? []) {
      out[item.id] = {
        views: Number(item.statistics?.viewCount ?? 0),
        likes: Number(item.statistics?.likeCount ?? 0),
        comments: Number(item.statistics?.commentCount ?? 0),
        publishedAt: item.snippet?.publishedAt,
        duration: item.contentDetails?.duration,
        privacyStatus: item.status?.privacyStatus,
      };
    }
  }
  return out;
}

export async function fetchChannelStats(channel: ChannelRow): Promise<{ subs: number; views: number; videos: number }> {
  const data = await ytFetch<any>(channel, `${API}/channels?part=statistics&id=${channel.youtube_channel_id}`);
  usage.record('api_call', { provider: 'youtube', units: 1, unitLabel: 'channels.list (1 unit)', costUsd: 0 });
  const item = data.items?.[0];
  return {
    subs: Number(item?.statistics?.subscriberCount ?? 0),
    views: Number(item?.statistics?.viewCount ?? 0),
    videos: Number(item?.statistics?.videoCount ?? 0),
  };
}

/** Delete a video we uploaded (only ever our own uploads). */
export async function deleteYouTubeVideo(channel: ChannelRow, youtubeId: string): Promise<void> {
  await ytFetch(channel, `${API}/videos?id=${youtubeId}&method=DELETE`, { method: 'DELETE' } as any);
  usage.record('api_call', { provider: 'youtube', units: 50, unitLabel: 'videos.delete (50 units)', costUsd: 0 });
}

function clampStr(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function safeParseArr(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const v = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Revenue (YouTube Analytics API)                                     */
/* ------------------------------------------------------------------ */

const ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2/reports';

export type RevenueReport = {
  available: boolean;
  reason?: string;
  days: number;
  estimatedRevenue: number;
  views: number;
};

/**
 * Estimated revenue for the last N days. Only YouTube Partner Program channels
 * have monetary metrics; other channels get available=false, never a made-up value.
 */
export async function fetchRevenue(channel: ChannelRow, days = 28): Promise<RevenueReport> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400_000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const params = new URLSearchParams({
    ids: 'channel==MINE',
    startDate: ymd(start),
    endDate: ymd(end),
    metrics: 'estimatedRevenue,views',
  });
  try {
    const data = await ytFetch<any>(channel, `${ANALYTICS_API}?${params.toString()}`);
    usage.record('api_call', { provider: 'youtube analytics', units: 1, unitLabel: 'reports.query', costUsd: 0 });
    const row = data.rows?.[0] ?? [0, 0];
    return { available: true, days, estimatedRevenue: Number(row[0] ?? 0), views: Number(row[1] ?? 0) };
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    if (/403/.test(message)) {
      return {
        available: false,
        reason: 'Revenue is shown only for YouTube Partner Program channels. If you connected before this update, reconnect YouTube to grant the revenue permission.',
        days,
        estimatedRevenue: 0,
        views: 0,
      };
    }
    throw err;
  }
}

export { ytFetch };
