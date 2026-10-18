import { Router } from 'express';
import { validate, v } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { get, all, run } from '../db/index.js';
import { now, clamp } from '../lib/util.js';
import {
  scheduleState,
  scheduleSettings,
  assignScheduleToVideo,
  cancelSchedule,
  pauseSchedule,
  resumeSchedule,
  autoAssignPending,
  calendarRange,
  nextSlots,
} from '../services/scheduler.js';
import { setSetting, getSetting } from '../engine/settings.js';
import { HttpError } from '../lib/validate.js';

export const scheduleRouter = Router();

scheduleRouter.get('/state', (_req, res) => {
  res.json(scheduleState());
});

scheduleRouter.put('/settings', (req, res, next) => {
  try {
    const body = validate(req.body, {
      perDay: v.int({ min: 1, max: 10, default: scheduleSettings().perDay }),
      times: v.array(v.string({ max: 5, pattern: /^\d{1,2}:\d{2}$/ }), { min: 1, max: 10, default: scheduleSettings().times }) as any,
      days: v.array(v.int({ min: 1, max: 7 }), { min: 1, max: 7, default: scheduleSettings().days }) as any,
      timezone: v.string({ max: 60, default: scheduleSettings().timezone }),
      paused: v.bool({ default: scheduleSettings().paused }),
    });
    // validate timezone
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: body.timezone });
    } catch {
      throw new HttpError(400, `Unknown timezone "${body.timezone}" — use an IANA name like Europe/Amsterdam`);
    }
    setSetting('schedule.per_day', body.perDay);
    setSetting('schedule.times', body.times);
    setSetting('schedule.days', body.days);
    setSetting('schedule.timezone', body.timezone);
    setSetting('schedule.paused', body.paused);
    res.json(scheduleState());
  } catch (err) {
    next(err);
  }
});

scheduleRouter.get('/calendar', (req, res) => {
  const from = Number(req.query.from ?? now() - 7 * 86400000);
  const to = Number(req.query.to ?? now() + 45 * 86400000);
  res.json({ items: calendarRange(from, to), state: scheduleState() });
});

scheduleRouter.post('/video', (req, res, next) => {
  try {
    const body = validate(req.body, {
      videoId: v.string({ min: 3, max: 60 }),
      runAt: v.int({ min: 0, default: 0 }),
      kind: v.string({ max: 10, default: 'publish', oneOf: ['publish', 'render', 'sync'] }),
    });
    const video = get('SELECT id FROM videos WHERE id = ?', body.videoId);
    if (!video) throw new HttpError(404, 'Video not found');
    const result = assignScheduleToVideo(body.videoId, { runAt: body.runAt || undefined, kind: body.kind as any, force: true });
    if (!result) throw new HttpError(409, 'No free slot — the schedule is paused or fully booked for the coming weeks.');
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

scheduleRouter.post('/auto-assign', (req, res) => {
  const assigned = autoAssignPending(50);
  res.json({ assigned, preview: nextSlots(10) });
});

scheduleRouter.post('/:id/cancel', (req, res) => {
  res.json({ ok: cancelSchedule(String(req.params.id)) });
});
scheduleRouter.post('/:id/pause', (req, res) => {
  pauseSchedule(String(req.params.id));
  res.json({ ok: true });
});
scheduleRouter.post('/:id/resume', (req, res) => {
  resumeSchedule(String(req.params.id));
  res.json({ ok: true });
});
