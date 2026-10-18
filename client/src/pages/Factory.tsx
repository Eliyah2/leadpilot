import { useCallback, useEffect, useState } from 'react';
import { api, type Batch, type Niche, type Job } from '../lib/api';
import { fmtAgo, navigate, poll } from '../lib/util';
import { Section, Spinner, StatusBadge, ErrorNote, EmptyState } from '../components/ui';

type Meta = { id: string; label: string; description: string };

export function FactoryPage() {
  const [niches, setNiches] = useState<Niche[]>([]);
  const [formats, setFormats] = useState<Meta[]>([]);
  const [languages, setLanguages] = useState<Meta[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState('');

  const [request, setRequest] = useState('');
  const [nicheId, setNicheId] = useState('');
  const [language, setLanguage] = useState('en');
  const [count, setCount] = useState(3);
  const [durationSec, setDurationSec] = useState(40);
  const [format, setFormat] = useState('auto');
  const [research, setResearch] = useState(true);
  const [autoRender, setAutoRender] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastBatch, setLastBatch] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [n, f, l, b, j] = await Promise.all([
        api<Niche[]>('/niches'),
        api<Meta[]>('/meta/formats'),
        api<Meta[]>('/meta/languages'),
        api<Batch[]>('/batches?limit=12'),
        api<{ jobs: Job[] }>('/jobs?limit=8'),
      ]);
      setNiches(n);
      setFormats(f);
      setLanguages(l);
      setBatches(b);
      setJobs(j.jobs);
      setNicheId((cur) => cur || n[0]?.id || '');
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => poll(load, 3000), [load]);

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ batchId: string }>('/generate', {
        method: 'POST',
        body: {
          request,
          nicheId,
          language,
          count,
          durationSec,
          format,
          research,
          autoRender,
        },
      });
      setLastBatch(res.batchId);
      setRequest('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setBusy(false);
    }
  };

  const cancelBatch = async (id: string) => {
    try {
      await api(`/batches/${id}/cancel`, { method: 'POST' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancel failed');
    }
  };

  const active = batches.filter((b) => b.status === 'running' || b.status === 'queued' || b.status === 'pending');

  return (
    <div className="space-y-4 animate-fade">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Content Factory</h1>
        <span className="text-xs text-slate-400">trend → topic → hook → script → QC → voice → render</span>
      </div>

      <ErrorNote message={error} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="New batch" >
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="req">Free-text request (optional)</label>
              <textarea
                id="req"
                className="input min-h-[70px]"
                placeholder="e.g. “Generate 3 shorts about surprising space facts, 35s each”"
                value={request}
                onChange={(e) => setRequest(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="niche">Niche</label>
                <select id="niche" className="input" value={nicheId} onChange={(e) => setNicheId(e.target.value)}>
                  {niches.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="lang">Language</label>
                <select id="lang" className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {languages.map((l) => (
                    <option key={l.id} value={l.id}>{l.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="count">How many</label>
                <input
                  id="count"
                  className="input"
                  type="number"
                  min={1}
                  max={20}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                />
              </div>
              <div>
                <label className="label" htmlFor="dur">Target length (s)</label>
                <input
                  id="dur"
                  className="input"
                  type="number"
                  min={15}
                  max={90}
                  value={durationSec}
                  onChange={(e) => setDurationSec(Math.max(15, Math.min(90, Number(e.target.value) || 40)))}
                />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="fmt">Format</label>
              <select id="fmt" className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="auto">Auto (picked per topic)</option>
                {formats.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={research} onChange={(e) => setResearch(e.target.checked)} />
                Free web research
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={autoRender} onChange={(e) => setAutoRender(e.target.checked)} />
                Auto-render MP4
              </label>
            </div>
            <button className="btn-primary w-full" onClick={generate} disabled={busy || !nicheId}>
              {busy ? 'Queueing…' : `Generate ${count} Short${count > 1 ? 's' : ''}`}
            </button>
            <p className="text-xs text-slate-400">
              Each Short gets: original script from sourced facts, hook, fact-check, narration, visuals, subtitles, cover,
              title, description and hashtags.
            </p>
          </div>
        </Section>

        <div className="space-y-4 lg:col-span-2">
          <Section title={active.length ? `In progress (${active.length})` : 'Batches'}>
            {batches.length === 0 ? (
              <EmptyState title="No batches yet" hint="Generate your first batch — it runs fully in the background." />
            ) : (
              <div className="space-y-2">
                {batches.map((b) => {
                  const pct = b.total ? Math.min(100, Math.round((b.completed / b.total) * 100)) : 0;
                  const isLast = b.id === lastBatch;
                  return (
                    <div
                      key={b.id}
                      className={`rounded-lg border p-3 ${
                        isLast ? 'border-accent-500' : 'border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-sm">
                        <div className="min-w-0">
                          <span className="font-medium">{b.niche_name ?? 'Mixed'}</span>
                          <span className="ml-2 text-xs text-slate-400">
                            {b.language.toUpperCase()} · {fmtAgo(b.created_at)}
                          </span>
                          {b.request && <span className="ml-2 text-xs italic text-slate-400">“{b.request}”</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={b.status} />
                          {(b.status === 'running' || b.status === 'queued') && (
                            <button className="btn-ghost !py-0.5 !text-xs" onClick={() => cancelBatch(b.id)}>
                              Cancel
                            </button>
                          )}
                          <button className="btn-ghost !py-0.5 !text-xs" onClick={() => navigate('/videos')}>
                            View
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                          <div
                            className={`h-full transition-all ${b.failed ? 'bg-amber-500' : 'bg-accent-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-slate-400">
                          {b.completed}/{b.total}
                          {b.failed > 0 && <span className="text-rose-500"> · {b.failed} failed</span>}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title="Recent jobs">
            {jobs.length === 0 ? (
              <p className="text-sm text-slate-400">No jobs yet.</p>
            ) : (
              <div className="space-y-1.5">
                {jobs.map((j) => (
                  <div key={j.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-800">
                    <span className="mono w-40 shrink-0 truncate">{j.type}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className="h-full bg-accent-500 transition-all"
                        style={{ width: `${j.total ? (j.progress / j.total) * 100 : j.status === 'done' ? 100 : 0}%` }}
                      />
                    </div>
                    <span className="w-28 truncate text-slate-400">{j.message}</span>
                    <StatusBadge status={j.status} />
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
