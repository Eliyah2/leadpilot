import { useCallback, useEffect, useState } from 'react';
import { api, type Niche, type Topic } from '../lib/api';
import { navigate, poll } from '../lib/util';
import { Section, Spinner, StatusBadge, ErrorNote, EmptyState } from '../components/ui';

type Hook = { id: string; text: string; archetype: string; score: number; supported: boolean };

export function TopicsPage() {
  const [niches, setNiches] = useState<Niche[]>([]);
  const [nicheId, setNicheId] = useState('');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  const [hooks, setHooks] = useState<Record<string, Hook[]>>({});

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (nicheId) params.set('nicheId', nicheId);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const [n, t] = await Promise.all([
        niches.length ? Promise.resolve(niches) : api<Niche[]>('/niches'),
        api<Topic[]>(`/topics?${params.toString()}`),
      ]);
      setNiches(n);
      setNicheId((cur) => cur || n[0]?.id || '');
      setTopics(t);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load topics');
    } finally {
      setLoading(false);
    }
  }, [nicheId, statusFilter, niches.length]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => poll(load, 8000), [load]);

  const generate = async () => {
    if (!nicheId) return;
    setBusy('generate');
    setError('');
    try {
      await api('/topics/generate', { method: 'POST', body: { nicheId, count: 12, includeTrends: true } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Topic generation failed');
    } finally {
      setBusy('');
    }
  };

  const setStatus = async (id: string, status: string) => {
    try {
      await api(`/topics/${id}/status`, { method: 'POST', body: { status } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status update failed');
    }
  };

  const openHooks = async (topic: Topic) => {
    if (openTopic === topic.id) {
      setOpenTopic(null);
      return;
    }
    setOpenTopic(topic.id);
    if (hooks[topic.id]) return;
    try {
      const list = await api<Hook[]>(`/topics/${topic.id}/hooks`);
      setHooks((h) => ({ ...h, [topic.id]: list }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load hooks');
    }
  };

  const generateHooks = async (topic: Topic) => {
    setBusy(topic.id);
    try {
      const res = await api<{ hooks: Hook[] }>('/hooks/generate', {
        method: 'POST',
        body: { topicId: topic.id, count: 7 },
      });
      setHooks((h) => ({ ...h, [topic.id]: res.hooks }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hook generation failed');
    } finally {
      setBusy('');
    }
  };

  const createVideo = async (topic: Topic) => {
    setBusy(topic.id);
    setError('');
    try {
      const res = await api<{ videoId: string }>('/videos', {
        method: 'POST',
        body: { nicheId, topicId: topic.id },
      });
      navigate(`/videos/${res.videoId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Video creation failed');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-4 animate-fade">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Topics & Hooks</h1>
        <button className="btn-primary" onClick={generate} disabled={busy === 'generate' || !nicheId}>
          {busy === 'generate' ? 'Generating…' : '+ Generate topics'}
        </button>
      </div>

      <ErrorNote message={error} />

      <div className="flex flex-wrap items-center gap-2">
        <select className="input max-w-[220px]" value={nicheId} onChange={(e) => setNicheId(e.target.value)}>
          {niches.map((n) => (
            <option key={n.id} value={n.id}>{n.name}</option>
          ))}
        </select>
        <select className="input max-w-[160px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="available">Available</option>
          <option value="used">Used</option>
          <option value="retired">Retired</option>
        </select>
        <span className="ml-auto text-xs text-slate-400">{topics.length} topics</span>
      </div>

      {loading ? (
        <Spinner label="Loading topics…" />
      ) : topics.length === 0 ? (
        <EmptyState
          title="No topics yet"
          hint="Generate topics from your knowledge base, optional LLM ideas and free trend signals."
          action={<button className="btn-primary" onClick={generate}>Generate topics</button>}
        />
      ) : (
        <div className="space-y-2">
          {topics.map((t) => (
            <div key={t.id} className="card p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <button className="text-left font-semibold hover:text-accent-500" onClick={() => openHooks(t)}>
                    {t.title}
                  </button>
                  <div className="mt-0.5 line-clamp-1 text-xs text-slate-400">{t.mainAngle}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                    <StatusBadge status={t.status} />
                    <span className="badge bg-slate-500/10 text-slate-500">{t.category}</span>
                    <span className="badge bg-slate-500/10 text-slate-500">{t.origin}</span>
                    <span className="text-slate-400">score {t.score.toFixed(2)} · used {t.useCount}×</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button className="btn-primary !py-1 !text-xs" disabled={busy === t.id} onClick={() => createVideo(t)}>
                    Make video
                  </button>
                  <select
                    className="input !w-auto !py-1 !text-xs"
                    value={t.status}
                    onChange={(e) => setStatus(t.id, e.target.value)}
                  >
                    <option value="available">available</option>
                    <option value="used">used</option>
                    <option value="retired">retired</option>
                  </select>
                </div>
              </div>

              {openTopic === t.id && (
                <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-slate-400">Hooks</span>
                    <button className="btn-ghost !py-0.5 !text-xs" onClick={() => generateHooks(t)} disabled={busy === t.id}>
                      Generate hooks
                    </button>
                  </div>
                  {(hooks[t.id] ?? []).length === 0 ? (
                    <p className="text-xs text-slate-400">No hooks yet — generate them to see options.</p>
                  ) : (
                    <ul className="space-y-1">
                      {(hooks[t.id] ?? []).map((h) => (
                        <li key={h.id} className="flex items-start gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm dark:bg-slate-800/60">
                          <span className="badge mt-0.5 bg-accent-500/10 text-accent-500">{h.archetype}</span>
                          <span className="min-w-0 flex-1">{h.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
