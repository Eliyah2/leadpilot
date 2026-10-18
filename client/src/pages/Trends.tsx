import { useCallback, useEffect, useState } from 'react';
import { api, type Niche, type Trend } from '../lib/api';
import { fmtAgo, fmtNum, navigate, poll } from '../lib/util';
import { Section, Spinner, ErrorNote, EmptyState } from '../components/ui';

export function TrendsPage() {
  const [niches, setNiches] = useState<Niche[]>([]);
  const [nicheId, setNicheId] = useState('');
  const [trends, setTrends] = useState<Trend[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    try {
      const [n, t] = await Promise.all([
        niches.length ? Promise.resolve(niches) : api<Niche[]>('/niches'),
        api<{ items: Trend[]; sources: string[]; notice: string }>(`/trends${nicheId ? `?nicheId=${nicheId}` : ''}`),
      ]);
      setNiches(n);
      setNicheId((cur) => cur || n[0]?.id || '');
      setTrends(t.items);
      setSources(t.sources);
      setNotice(t.notice);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trends');
    } finally {
      setLoading(false);
    }
  }, [nicheId, niches.length]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => poll(load, 10000), [load]);

  const scan = async () => {
    if (!nicheId) return;
    setScanning(true);
    setError('');
    try {
      await api('/trends/discover', { method: 'POST', body: { nicheId, limit: 20, sync: true } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Trend scan failed');
    } finally {
      setScanning(false);
    }
  };

  const byKeyword = new Map<string, Trend[]>();
  for (const t of trends) {
    const key = t.keyword.toLowerCase();
    byKeyword.set(key, [...(byKeyword.get(key) ?? []), t]);
  }

  return (
    <div className="space-y-4 animate-fade">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Trend Finder</h1>
        <button className="btn-primary" onClick={scan} disabled={scanning || !nicheId}>
          {scanning ? 'Scanning free sources…' : '↻ Scan free sources'}
        </button>
      </div>

      <ErrorNote message={error} />

      <div className="flex flex-wrap items-center gap-2">
        <select className="input max-w-[220px]" value={nicheId} onChange={(e) => setNicheId(e.target.value)}>
          {niches.map((n) => (
            <option key={n.id} value={n.id}>{n.name}</option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1">
          {sources.map((s) => (
            <span key={s} className="badge bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              free: {s}
            </span>
          ))}
        </div>
      </div>

      {notice && <p className="text-xs text-slate-400">{notice}</p>}

      {loading ? (
        <Spinner label="Loading trends…" />
      ) : trends.length === 0 ? (
        <EmptyState
          title="No trend snapshots yet"
          hint="Run a scan to pull free public signals: Wikipedia pageviews, Hacker News and Google Trends RSS. No API key needed."
          action={<button className="btn-primary" onClick={scan} disabled={scanning}>Scan now</button>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[...byKeyword.entries()].map(([kw, list]) => {
            const latest = list[0]!;
            const maxInterest = Math.max(...list.map((x) => x.interest ?? 0), 1);
            const velocity = list.length > 1 ? ((list[0]!.interest ?? 0) - (list[list.length - 1]!.interest ?? 0)) : 0;
            return (
              <div key={kw} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold capitalize">{latest.keyword}</div>
                  <span className={`badge ${velocity > 0 ? 'bg-emerald-500/15 text-emerald-500' : 'bg-slate-500/15 text-slate-400'}`}>
                    {velocity > 0 ? '↗' : '→'} {velocity > 0 ? `+${velocity}` : fmtNum(latest.interest ?? 0)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {latest.source} · {latest.region || 'worldwide'} · {fmtAgo(latest.captured_at)}
                </div>

                {/* mini history sparkline */}
                <div className="mt-2 flex h-10 items-end gap-0.5">
                  {[...list].reverse().slice(-20).map((p, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-sm bg-accent-500/60"
                      style={{ height: `${Math.max(6, ((p.interest ?? 0) / maxInterest) * 100)}%` }}
                      title={`${p.interest}`}
                    />
                  ))}
                </div>

                {latest.related?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {latest.related.slice(0, 4).map((r) => (
                      <span key={r} className="badge bg-slate-500/10 text-slate-500">{r}</span>
                    ))}
                  </div>
                )}

                <button
                  className="btn-ghost mt-3 w-full !text-xs"
                  onClick={() => navigate('/topics')}
                >
                  Turn into topics →
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Section title="How this works">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          ShortForge reads <strong>free public signals</strong> — Wikipedia pageviews, Hacker News Algolia and Google Trends
          RSS — and ranks them against your niche keywords. Interest numbers are inspiration for original, sourced content;
          they are never presented as predicted views, and no scraping or paid API is involved.
        </p>
      </Section>
    </div>
  );
}
