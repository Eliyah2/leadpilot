import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { poll as pollUtil, fmtNum, fmtDuration } from '../lib/util';
import { Section, Spinner, ErrorNote, EmptyState } from '../components/ui';

type Daily = { date: string; views: number; likes: number; comments: number; watchTimeSec?: number };
type Performance = Record<string, unknown> & { videoId: string; title: string; views: number; likes: number; retention: number };
type Breakdown = { dimension: string; values: { key: string; views: number; count: number }[] };
type AnalyticsData = { daily: Daily[]; performance: Performance[]; breakdown: Breakdown[]; demoMode: boolean };

type Learning = {
  summary: {
    trackedVideos: number;
    enoughData: boolean;
    need: number;
    best: { label: string; lift: number } | null;
    worst: { label: string; lift: number } | null;
    topHooks: { archetype: string; wins: number }[];
  };
  insights: { id: string; kind: string; key: string; lift: number; sample: number; note?: string }[];
  weights: Record<string, Record<string, number>>;
  disclaimer: string;
};

export function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [learning, setLearning] = useState<Learning | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [a, l] = await Promise.all([api<AnalyticsData>('/analytics'), api<Learning>('/learning')]);
      setData(a);
      setLearning(l);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => pollUtil(load, 12000), [load]);

  const act = async (label: string, path: string, method: 'POST' = 'POST') => {
    setBusy(label);
    setError('');
    try {
      await api(path, { method, body: {} });
      setNote(`${label} — done/queued`);
      setTimeout(() => setNote(''), 4000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label} failed`);
    } finally {
      setBusy('');
    }
  };

  if (!data || !learning) return <Spinner label="Loading analytics…" />;

  const maxViews = Math.max(...data.daily.map((d) => d.views), 1);
  const sumViews = data.daily.reduce((s, d) => s + d.views, 0);
  const sumLikes = data.daily.reduce((s, d) => s + d.likes, 0);
  const sumWatch = data.daily.reduce((s, d) => s + (d.watchTimeSec ?? 0), 0);

  return (
    <div className="space-y-4 animate-fade">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Analytics & Learning</h1>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" disabled={busy !== ''} onClick={() => act('Sync', '/analytics/sync-now')}>
            ↻ Sync now
          </button>
          <button className="btn-ghost" disabled={busy !== ''} onClick={() => act('Recompute', '/learning/recompute')}>
            ⌁ Recompute learning
          </button>
          {data.demoMode ? (
            <button className="btn-ghost" disabled={busy !== ''} onClick={() => act('Clear demo', '/analytics/demo/clear')}>
              Clear demo data
            </button>
          ) : (
            <button className="btn-ghost" disabled={busy !== ''} onClick={() => act('Seed demo', '/analytics/demo/seed')}>
              Seed demo data
            </button>
          )}
        </div>
      </div>

      <ErrorNote message={error} />
      {note && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
          {note}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Views (30d)" value={fmtNum(sumViews)} />
        <Tile label="Likes (30d)" value={fmtNum(sumLikes)} />
        <Tile label="Watch time" value={fmtDuration(sumWatch)} />
        <Tile label="Tracked videos" value={learning.summary.trackedVideos} />
      </div>

      <Section
        title="Daily views (30 days)"
        right={data.demoMode ? <span className="badge bg-amber-500/15 text-amber-500">demo data — excluded from learning</span> : undefined}
      >
        {data.daily.length === 0 ? (
          <EmptyState
            title="No performance data yet"
            hint="Connect YouTube (or add manual stats) and the daily chart fills in. Seed demo data to explore the dashboard — demo rows never influence the learning engine."
          />
        ) : (
          <div className="flex h-40 items-end gap-1">
            {data.daily.map((d) => (
              <div
                key={d.date}
                className="group relative flex-1 rounded-t bg-accent-500/70 transition hover:bg-accent-400"
                style={{ height: `${Math.max(3, (d.views / maxViews) * 100)}%` }}
                title={`${d.date}: ${d.views} views`}
              >
                <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-white group-hover:block">
                  {d.views}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="What works on your channel">
          {!learning.summary.enoughData ? (
            <div className="space-y-2 text-sm">
              <span className="badge bg-amber-500/15 text-amber-500">
                needs {learning.summary.need}+ tracked videos
              </span>
              <p className="text-slate-500 dark:text-slate-400">
                Until your own channel has enough data, all weights stay neutral (1.0) — ShortForge never invents
                performance claims.
              </p>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              {learning.summary.best && (
                <div>
                  <div className="text-xs font-bold uppercase text-emerald-500">Best performing</div>
                  <div>
                    {learning.summary.best.label} · +{Math.round((learning.summary.best.lift - 1) * 100)}% vs baseline
                  </div>
                </div>
              )}
              {learning.summary.worst && (
                <div>
                  <div className="text-xs font-bold uppercase text-rose-500">Underperforming</div>
                  <div>
                    {learning.summary.worst.label} · {Math.round((learning.summary.worst.lift - 1) * 100)}% vs baseline
                  </div>
                </div>
              )}
              {learning.summary.topHooks.length > 0 && (
                <div>
                  <div className="text-xs font-bold uppercase text-slate-400">Hook archetypes</div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {learning.summary.topHooks.map((h) => (
                      <span key={h.archetype} className="badge bg-accent-500/10 text-accent-500">
                        {h.archetype}: {h.wins} wins
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <p className="border-t border-slate-200 pt-2 text-[11px] text-slate-400 dark:border-slate-800">
            {learning.disclaimer}
          </p>
        </Section>

        <Section title="Insights">
          {learning.insights.length === 0 ? (
            <p className="text-sm text-slate-400">No insights yet — publish and sync a few Shorts first.</p>
          ) : (
            <div className="space-y-1.5 text-sm">
              {learning.insights.slice(0, 10).map((i) => (
                <div key={i.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
                  <span className="badge bg-slate-500/10">{i.kind}</span>
                  <span className="min-w-0 flex-1 truncate">{i.key}</span>
                  <span className={`text-xs font-bold ${i.lift >= 1 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {i.lift >= 1 ? '+' : ''}
                    {Math.round((i.lift - 1) * 100)}%
                  </span>
                  <span className="text-[11px] text-slate-400">n={i.sample}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <Section title="Breakdown by dimension">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.breakdown.map((b) => (
            <div key={b.dimension}>
              <div className="mb-1.5 text-xs font-bold uppercase text-slate-400">{b.dimension}</div>
              {b.values.length === 0 ? (
                <p className="text-xs text-slate-400">no data</p>
              ) : (
                <div className="space-y-1">
                  {b.values.slice(0, 6).map((v) => {
                    const max = Math.max(...b.values.map((x) => x.views), 1);
                    return (
                      <div key={v.key} className="text-xs">
                        <div className="flex justify-between">
                          <span className="truncate pr-2">{v.key}</span>
                          <span className="shrink-0 text-slate-400">{fmtNum(v.views)}</span>
                        </div>
                        <div className="mt-0.5 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800">
                          <div className="h-full rounded-full bg-accent-500" style={{ width: `${(v.views / max) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Top videos by views">
        {data.performance.length === 0 ? (
          <p className="text-sm text-slate-400">No tracked videos yet.</p>
        ) : (
          <div className="space-y-1.5">
            {data.performance.slice(0, 10).map((p) => (
              <div key={p.videoId} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                <span className="text-xs text-slate-400">{fmtNum(p.views)} views</span>
                <span className="text-xs text-slate-400">{fmtNum(p.likes)} likes</span>
                <span className="text-xs text-slate-400">{Math.round(Number(p.retention ?? 0))}% ret.</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
