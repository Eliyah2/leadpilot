import { useCallback, useEffect, useState } from 'react';
import { api, type DashboardData, type Video } from '../lib/api';
import { fmtAgo, fmtBytes, fmtDuration, fmtNum, navigate, poll } from '../lib/util';
import { Section, Stat, Spinner, StatusBadge, EmptyState, ErrorNote } from '../components/ui';

type Revenue = {
  available: boolean;
  reason?: string;
  days: number;
  estimatedRevenue: number;
  views: number;
};

type YtStatus = {
  connected: boolean;
  configured: boolean;
  channelTitle: string | null;
  autoPublish: boolean;
};

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [yt, setYt] = useState<YtStatus | null>(null);
  const [revenue, setRevenue] = useState<Revenue | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [dash, vids, ytStatus] = await Promise.all([
        api<DashboardData>('/dashboard'),
        api<Video[]>('/videos?limit=8'),
        api<YtStatus>('/youtube/status').catch(() => null),
      ]);
      setData(dash);
      setVideos(vids);
      setYt(ytStatus);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => poll(load, 5000), [load]);

  // Revenue is an external API call: refresh once a minute, not with the 5s poll.
  useEffect(() => {
    const loadRevenue = () =>
      api<Revenue>('/youtube/revenue')
        .then(setRevenue)
        .catch(() => setRevenue(null));
    void loadRevenue();
    return poll(loadRevenue, 60000);
  }, []);

  if (!data && !error) return <Spinner label="Loading dashboard…" />;

  const s = data?.stats;
  const q = data?.queue;

  return (
    <div className="space-y-4 animate-fade">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Dashboard</h1>
        <button className="btn-primary" onClick={() => navigate('/factory')}>
          + Generate Shorts
        </button>
      </div>

      <ErrorNote message={error} />

      {yt && !yt.connected && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-amber-600 dark:text-amber-400">
              YouTube not linked yet
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {yt.configured
                ? 'OAuth is configured — finish the Google consent screen to start publishing.'
                : 'Add your Google OAuth client once, then ShortForge publishes at your best slot automatically (free quota ≈ 6 uploads/day).'}
            </div>
          </div>
          <button className="btn-primary" onClick={() => navigate('/youtube')}>
            Connect YouTube
          </button>
        </div>
      )}
      {yt?.connected && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs">
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
            ◉ Linked{yt.channelTitle ? `: ${yt.channelTitle}` : ''}
          </span>
          <span className="text-slate-500 dark:text-slate-400">
            auto-publish {yt.autoPublish ? 'on' : 'off'}
          </span>
          <button className="btn-ghost ml-auto" onClick={() => navigate('/youtube')}>
            Manage
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Generated today" value={s?.generatedToday ?? 0} />
        <Stat label="Published" value={s?.publishedTotal ?? 0} />
        <Stat label="Scheduled" value={s?.scheduled ?? 0} />
        <Stat label="Total views" value={fmtNum(s?.totalViews ?? 0)} />
        <Stat label="Avg views" value={fmtNum(s?.averageViews ?? 0)} />
        <Stat label="Subs gained" value={fmtNum(s?.subscribersGained ?? 0)} />
        <Stat
          label="Est. revenue (28d)"
          value={revenue?.available ? revenue.estimatedRevenue.toFixed(2) : '—'}
          sub={
            !yt?.connected
              ? 'Connect YouTube'
              : revenue && !revenue.available
                ? 'Partner Program only'
                : 'YouTube Analytics'
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section
          title="Job queue"
          right={
            q ? (
              <span className="text-xs text-slate-400">
                {q.done}/{q.total} done · {q.failed} failed
              </span>
            ) : undefined
          }
        >
          {q ? (
            <div className="space-y-3">
              <div className="flex h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className="bg-emerald-500 transition-all"
                  style={{ width: `${q.total ? (q.done / q.total) * 100 : 0}%` }}
                />
                <div className="bg-sky-500" style={{ width: `${q.total ? (q.running / q.total) * 100 : 0}%` }} />
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div>
                  <div className="text-lg font-bold text-emerald-500">{q.done}</div>done
                </div>
                <div>
                  <div className="text-lg font-bold text-sky-500">{q.running}</div>running
                </div>
                <div>
                  <div className="text-lg font-bold">{q.queued}</div>queued
                </div>
                <div>
                  <div className="text-lg font-bold text-rose-500">{q.failed}</div>failed
                </div>
              </div>
              <div className="space-y-1 border-t border-slate-200 pt-2 dark:border-slate-800">
                {(data?.recentJobs ?? []).slice(0, 5).map((j) => (
                  <div key={j.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate mono">{j.type}</span>
                    <StatusBadge status={j.status} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Spinner />
          )}
        </Section>

        <Section title="Learning engine">
          {data?.learning && 'enoughData' in data.learning ? (
            <LearningPanel learning={data.learning as Record<string, never>} />
          ) : (
            <Spinner />
          )}
        </Section>

        <Section title="Top performers">
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Best topic</div>
              <div className="font-medium">{s?.bestTopic?.title ?? 'No data yet'}</div>
              {s?.bestTopic && <div className="text-xs text-slate-400">{fmtNum(s.bestTopic.views)} views</div>}
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-400">Best hook</div>
              <div className="line-clamp-2 font-medium">{s?.bestHook?.text ?? 'No data yet'}</div>
              {s?.bestHook && <div className="text-xs text-slate-400">{fmtNum(s.bestHook.views)} views</div>}
            </div>
            <div className="border-t border-slate-200 pt-2 text-xs text-slate-400 dark:border-slate-800">
              Watch time: {fmtDuration(s?.totalWatchTimeSec ?? 0)} · Retention avg:{' '}
              {Math.round(s?.retentionAvg ?? 0)}%
              {s?.demoMode && <span className="ml-1 badge bg-amber-500/15 text-amber-500">demo data</span>}
            </div>
          </div>
        </Section>
      </div>

      <Section title="Recent videos" right={<button className="btn-ghost" onClick={() => navigate('/videos')}>View all</button>}>
        {videos.length === 0 ? (
          <EmptyState
            title="No videos yet"
            hint="Generate your first batch in the Content Factory — trend research, script, voiceover and render are all automatic."
            action={<button className="btn-primary" onClick={() => navigate('/factory')}>Open Content Factory</button>}
          />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {videos.map((v) => (
              <button
                key={v.id}
                onClick={() => navigate(`/videos/${v.id}`)}
                className="flex w-full items-center gap-3 px-1 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <div
                  className="h-10 w-7 shrink-0 rounded bg-cover bg-center"
                  style={{
                    backgroundColor: v.nicheColor ?? '#6366f1',
                    backgroundImage: v.cover ? `url(/media/covers/${v.id}.png)` : undefined,
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{v.title}</div>
                  <div className="text-xs text-slate-400">
                    {v.nicheName ?? '—'} · {fmtDuration(v.durationSec ?? v.durationTarget)} · {fmtAgo(v.createdAt)}
                  </div>
                </div>
                <div className="hidden gap-1.5 sm:flex">
                  <StatusBadge status={v.qcStatus} />
                  <StatusBadge status={v.renderStatus} />
                </div>
                <div className="w-16 text-right text-xs text-slate-400">
                  {v.mp4 ? fmtBytes(v.sizeBytes) : '—'}
                </div>
              </button>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function LearningPanel({ learning }: { learning: Record<string, never> }) {
  const enough = Boolean(learning.enoughData);
  const summary = learning.summary as { trackedVideos?: number; best?: unknown } | undefined;
  const tracked = (summary?.trackedVideos as number | undefined) ?? (learning.trackedVideos as number | undefined) ?? 0;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className={`badge ${enough ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500'}`}>
          {enough ? 'learning active' : `needs ${learning.need ?? 5}+ videos`}
        </span>
        <span className="text-xs text-slate-400">{tracked} tracked</span>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{learning.disclaimer as string}</p>
      {!enough && (
        <p className="text-xs text-slate-400">
          Publish and track a few Shorts — weights stay neutral until your own channel has real data.
        </p>
      )}
    </div>
  );
}
