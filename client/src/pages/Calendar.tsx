import { useCallback, useEffect, useState } from 'react';
import { api, type ScheduleState, type Video } from '../lib/api';
import { fmtDate, fmtDuration, navigate, poll } from '../lib/util';
import { Section, Spinner, StatusBadge, ErrorNote, EmptyState } from '../components/ui';

type CalendarItem = {
  id: string;
  videoId: string;
  title: string;
  runAt: number;
  kind: string;
  status: string;
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CalendarPage() {
  const [state, setState] = useState<ScheduleState | null>(null);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [pending, setPending] = useState<Video[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // draft settings
  const [perDay, setPerDay] = useState(1);
  const [times, setTimes] = useState('17:00');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [timezone, setTimezone] = useState('UTC');

  const load = useCallback(async () => {
    try {
      const [cal, vids] = await Promise.all([
        api<{ items: CalendarItem[]; state: ScheduleState }>('/schedule/calendar'),
        api<Video[]>('/videos?status=approved&limit=30'),
      ]);
      setItems(cal.items);
      setState(cal.state);
      setPerDay(cal.state.perDay);
      setTimes(cal.state.times.join(', '));
      setDays(cal.state.days);
      setTimezone(cal.state.timezone);
      setPending(vids);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schedule');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => poll(load, 8000), [load]);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api<ScheduleState>('/schedule/settings', {
        method: 'PUT',
        body: {
          perDay,
          times: times
            .split(',')
            .map((t) => t.trim())
            .filter((t) => /^\d{1,2}:\d{2}$/.test(t)),
          days,
          timezone,
          paused: state?.paused ?? false,
        },
      });
      setState(res);
      setNote('Schedule saved');
      setTimeout(() => setNote(''), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async () => {
    setBusy(true);
    try {
      const res = await api<ScheduleState>('/schedule/settings', {
        method: 'PUT',
        body: {
          perDay,
          times: times.split(',').map((t) => t.trim()),
          days,
          timezone,
          paused: !(state?.paused ?? false),
        },
      });
      setState(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Toggle failed');
    } finally {
      setBusy(false);
    }
  };

  const autoAssign = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ assigned: number }>('/schedule/auto-assign', { method: 'POST', body: {} });
      setNote(`Assigned ${res.assigned} video(s) to free slots`);
      setTimeout(() => setNote(''), 4000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Auto-assign failed');
    } finally {
      setBusy(false);
    }
  };

  const assignOne = async (videoId: string) => {
    try {
      await api('/schedule/video', { method: 'POST', body: { videoId } });
      setNote('Video scheduled');
      setTimeout(() => setNote(''), 3000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scheduling failed');
    }
  };

  const itemAction = async (id: string, op: 'cancel' | 'pause' | 'resume') => {
    try {
      await api(`/schedule/${id}/${op}`, { method: 'POST', body: {} });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    }
  };

  if (!state && !error) return <Spinner label="Loading schedule…" />;

  return (
    <div className="space-y-4 animate-fade">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Publishing Calendar</h1>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={togglePause} disabled={busy}>
            {state?.paused ? '▶ Resume schedule' : '⏸ Pause schedule'}
          </button>
          <button className="btn-primary" onClick={autoAssign} disabled={busy}>
            Auto-assign approved videos
          </button>
        </div>
      </div>

      <ErrorNote message={error} />
      {note && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
          {note}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Schedule settings">
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="perday">Videos per day</label>
              <input
                id="perday"
                className="input"
                type="number"
                min={1}
                max={10}
                value={perDay}
                onChange={(e) => setPerDay(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
              />
            </div>
            <div>
              <label className="label" htmlFor="times">Post times (comma separated, 24h)</label>
              <input id="times" className="input" value={times} onChange={(e) => setTimes(e.target.value)} placeholder="17:00, 20:00" />
            </div>
            <div>
              <span className="label">Active days</span>
              <div className="flex flex-wrap gap-1">
                {DAY_LABELS.map((d, i) => {
                  const num = i + 1;
                  const on = days.includes(num);
                  return (
                    <button
                      key={d}
                      onClick={() => setDays((cur) => (on ? cur.filter((x) => x !== num) : [...cur, num].sort()))}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                        on ? 'bg-accent-600 text-white' : 'bg-slate-200 text-slate-500 dark:bg-slate-800'
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="tz">Timezone (IANA)</label>
              <input id="tz" className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Europe/Amsterdam" />
            </div>
            <button className="btn-primary w-full" onClick={save} disabled={busy}>
              Save schedule
            </button>

            <div className="border-t border-slate-200 pt-3 text-xs dark:border-slate-800">
              <div className="mb-1 font-bold uppercase text-slate-400">Next slots</div>
              {(state?.nextSlots ?? []).slice(0, 5).map((s) => (
                <div key={s.runAt} className="flex justify-between py-0.5">
                  <span>{s.iso.slice(0, 10)}</span>
                  <span className="mono text-slate-400">{s.iso.slice(11, 16)}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        <div className="space-y-4 lg:col-span-2">
          <Section title={`Queued publications (${items.length})`}>
            {items.length === 0 ? (
              <EmptyState
                title="Nothing scheduled"
                hint="Approve videos in the Videos page, then auto-assign them to free slots. The dispatcher publishes automatically when YouTube is connected."
              />
            ) : (
              <div className="space-y-2">
                {items.map((it) => (
                  <div key={it.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                    <span className="mono w-36 shrink-0 text-xs text-slate-400">{fmtDate(it.runAt)}</span>
                    <button className="min-w-0 flex-1 truncate text-left hover:text-accent-500" onClick={() => navigate(`/videos/${it.videoId}`)}>
                      {it.title}
                    </button>
                    <span className="badge bg-slate-500/10 text-slate-500">{it.kind}</span>
                    <StatusBadge status={it.status} />
                    <div className="flex gap-1">
                      {it.status === 'paused' ? (
                        <button className="btn-ghost !px-2 !py-0.5 !text-xs" onClick={() => itemAction(it.id, 'resume')}>▶</button>
                      ) : (
                        <button className="btn-ghost !px-2 !py-0.5 !text-xs" onClick={() => itemAction(it.id, 'pause')}>⏸</button>
                      )}
                      <button className="btn-ghost !px-2 !py-0.5 !text-xs" onClick={() => itemAction(it.id, 'cancel')}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title={`Approved, waiting for a slot (${pending.length})`}>
            {pending.length === 0 ? (
              <p className="text-sm text-slate-400">No approved videos waiting. Approve some in the Videos page first.</p>
            ) : (
              <div className="space-y-2">
                {pending.map((v) => (
                  <div key={v.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                    <button className="min-w-0 flex-1 truncate text-left hover:text-accent-500" onClick={() => navigate(`/videos/${v.id}`)}>
                      {v.title}
                    </button>
                    <span className="text-xs text-slate-400">{fmtDuration(v.durationSec ?? v.durationTarget)}</span>
                    <button className="btn-ghost !py-1 !text-xs" onClick={() => assignOne(v.id)}>
                      Schedule
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
