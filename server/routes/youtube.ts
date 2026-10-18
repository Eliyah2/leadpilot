import { Router } from 'express';
import { validate, v } from '../lib/validate.js';
import { requireAuth, optionalAuth, requireOwner } from '../middleware/auth.js';
import { get, run, all } from '../db/index.js';
import { now } from '../lib/util.js';
import {
  createAuthUrl,
  handleCallback,
  connectionStatus,
  disconnectChannel,
  getConnectedChannel,
  fetchChannelStats,
  fetchRevenue,
  oauthConfigured,
} from '../services/youtube.js';
import { enqueue } from '../jobs/queue.js';
import { getSetting, setSetting, SECRET_MASK } from '../engine/settings.js';
import { usage } from '../services/usage.js';
import { HttpError } from '../lib/validate.js';

export const youtubeRouter = Router();

youtubeRouter.get('/status', requireAuth, (req, res, next) => {
  try {
    const status = connectionStatus(req.user!.id);
    const uploads = all<any>(
      `SELECT p.youtube_video_id id, p.title, p.yt_views views, p.published_at, v.id local_id
         FROM published_videos p JOIN videos v ON v.id = p.video_id
        ORDER BY p.created_at DESC LIMIT 10`,
    );
    res.json({ ...status, recentUploads: uploads, autoPublish: getSetting<boolean>('youtube.auto_publish', false) });
  } catch (err) {
    next(err);
  }
});

youtubeRouter.post('/settings', requireAuth, requireOwner, (req, res, next) => {
  try {
    const body = validate(req.body, {
      clientId: v.string({ max: 300, default: '' }),
      clientSecret: v.string({ max: 300, default: '' }),
      redirectUri: v.string({ max: 300, default: '' }),
      privacy: v.string({ max: 20, default: getSetting<string>('youtube.privacy', 'private'), oneOf: ['public', 'unlisted', 'private'] }),
      category: v.string({ max: 10, default: getSetting<string>('youtube.category', '28') }),
      madeForKids: v.bool({ default: getSetting<boolean>('youtube.made_for_kids', false) }),
      autoPublish: v.bool({ default: getSetting<boolean>('youtube.auto_publish', false) }),
      tags: v.array(v.string({ max: 40 }), { max: 30, default: getSetting<string[]>('youtube.tags', []) }) as any,
    });
    if (body.clientId) setSetting('youtube.clientId', body.clientId.trim());
    // A masked value round-tripped from the settings form must not clobber the stored secret.
    if (body.clientSecret && body.clientSecret !== SECRET_MASK) setSetting('youtube.clientSecret', body.clientSecret.trim());
    if (body.redirectUri) setSetting('youtube.redirectUri', body.redirectUri.trim());
    setSetting('youtube.privacy', body.privacy);
    setSetting('youtube.category', body.category);
    setSetting('youtube.made_for_kids', body.madeForKids);
    setSetting('youtube.auto_publish', body.autoPublish);
    setSetting('youtube.tags', body.tags);
    res.json({ ok: true, configured: oauthConfigured() });
  } catch (err) {
    next(err);
  }
});

youtubeRouter.post('/auth-url', requireAuth, (req, res, next) => {
  try {
    setSetting('youtube.pendingUserId', req.user!.id);
    res.json(createAuthUrl());
  } catch (err) {
    next(err);
  }
});

/** OAuth redirect target (Google calls this in the browser). */
youtubeRouter.get('/callback', optionalAuth, async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).send('You must be signed in to ShortForge before connecting YouTube. Sign in and try again.');
    }
    const params: Record<string, string> = {};
    for (const [k, val] of Object.entries(req.query)) params[k] = String(val);
    const result = await handleCallback(params);
    res.send(`<html><body style="font-family:system-ui;max-width:520px;margin:60px auto">
      <h2>YouTube connected</h2>
      <p>Channel <b>${escapeHtml(result.title)}</b> is linked. You can close this tab.</p>
      <p><a href="/">Return to ShortForge</a></p></body></html>`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).send(`<html><body style="font-family:system-ui;max-width:520px;margin:60px auto">
      <h2>Connection failed</h2><p>${escapeHtml(message)}</p><p><a href="/">Back to ShortForge</a></p></body></html>`);
  }
});

youtubeRouter.post('/disconnect', requireAuth, (req, res, next) => {
  try {
    const channel = getConnectedChannel(req.user!.id);
    if (!channel) throw new HttpError(400, 'No channel connected');
    disconnectChannel(channel.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

youtubeRouter.post('/upload', requireAuth, (req, res, next) => {
  try {
    const body = validate(req.body, { videoId: v.string({ min: 3, max: 60 }) });
    const video = get('SELECT id, render_status FROM videos WHERE id = ?', body.videoId);
    if (!video) throw new HttpError(404, 'Video not found');
    const jobId = enqueue('publish_video', { videoId: body.videoId }, { videoId: body.videoId, userId: req.user!.id, priority: 40, dedupeKey: `publish:${body.videoId}` });
    res.status(202).json({ jobId });
  } catch (err) {
    next(err);
  }
});

youtubeRouter.post('/sync', requireAuth, (req, res, next) => {
  try {
    const jobId = enqueue('analytics_sync', {}, { userId: req.user!.id, dedupeKey: `sync:${Math.floor(now() / 30000)}`, priority: 65 });
    res.status(202).json({ jobId });
  } catch (err) {
    next(err);
  }
});

youtubeRouter.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const channel = getConnectedChannel(req.user!.id);
    if (!channel) throw new HttpError(400, 'No channel connected');
    const stats = await fetchChannelStats(channel);
    setSetting('analytics.channel_subs', stats.subs);
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

youtubeRouter.get('/revenue', requireAuth, async (req, res, next) => {
  try {
    const channel = getConnectedChannel(req.user!.id);
    if (!channel) {
      // Not an error: the dashboard simply shows "connect YouTube". No numbers are invented.
      return res.json({ available: false, reason: 'Connect YouTube to see revenue.', days: 28, estimatedRevenue: 0, views: 0 });
    }
    res.json(await fetchRevenue(channel, 28));
  } catch (err) {
    next(err);
  }
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
