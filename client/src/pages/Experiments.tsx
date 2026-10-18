import { useCallback, useEffect, useState } from 'react';
import { api, type Niche } from '../lib/api';
import { poll as pollUtil, fmtAgo } from '../lib/util';
import { Section, Spinner, StatusBadge, ErrorNote, EmptyState, Modal } from '../components/ui';

type Variant = { key: string; label: string; payload: string };

type Experiment = {
  id: string;
  name: string;
  hypothesis: string;
  nicheId: string | null;
  metric: string;
  minSamples: number;
  status: string;
  createdAt: number;
  variants: { id: string; key: string; label: string; payload: string }[];
  results?: { key: string; label: string; sample: number; value: number; lift: number }[];
  winner?: string | null;
};

export function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [niches, setNiches] = useState<Niche[]>([]);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [e, n] = await Promise.all([api<Experiment[]>('/experiments'), api<Niche[]>('/niches')]);
      setExperiments(e);
      setNiches(n);
      setError('');
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Failed to load experiments');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => pollUtil(load, 10000), [load]);

  const evaluate = async (id: string) => {
    setBusy(id);
    try {
      await api(`/experiments/${id}/evaluate`, { method: 'POST', body: {} });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Evaluate failed');
    } finally {
      setBusy('');
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this experiment?')) return;
    try {
      await api(`/experiments/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  return (
    <div className="space-y-4 animate-fade">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Experiments</h1>
        <button className="btn-primary" onClick={() => setShowNew(true)}>
          + New experiment
        </button>
      </div>

      <ErrorNote message={error} />

      {experiments.length === 0 ? (
        <EmptyState
          title="No experiments yet"
          hint="Test a hypothesis against your own channel: e.g. curiosity titles vs question titles. Variants are assigned evenly and evaluated only after enough real samples — minimum sample size is respected, never gut feelings."
          action={<button className="btn-primary" onClick={() => setShowNew(true)}>Create experiment</button>}
        />
      ) : (
        <div className="space-y-3">
          {experiments.map((e) => (
            <Section
              key={e.id}
              title={e.name}
              right={
                <div className="flex gap-1.5">
                  <StatusBadge status={e.status} />
                  <button className="btn-ghost !py-0.5 !text-xs" disabled={busy === e.id} onClick={() => evaluate(e.id)}>
                    Evaluate
                  </button>
                  <button className="btn-ghost !py-0.5 !text-xs" onClick={() => remove(e.id)}>
                    Delete
                  </button>
                </div>
              }
            >
              <div className="space-y-2 text-sm">
                {e.hypothesis && <p className="italic text-slate-500 dark:text-slate-400">“{e.hypothesis}”</p>}
                <div className="text-xs text-slate-400">
                  metric: <strong>{e.metric}</strong> · min samples/variant: {e.minSamples} · created {fmtAgo(e.createdAt)}
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {(e.results ?? e.variants.map((v) => ({ key: v.key, label: v.label, sample: 0, value: 0, lift: 1 }))).map(
                    (vr) => (
                      <div
                        key={vr.key}
                        className={`rounded-lg border p-3 ${
                          e.winner && (vr as { key: string }).key === e.winner
                            ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/30'
                            : 'border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{vr.label}</span>
                          {e.winner && (vr as { key: string }).key === e.winner && (
                            <span className="badge bg-emerald-500/15 text-emerald-500">winner</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400">
                          n={vr.sample} · {e.metric}={typeof vr.value === 'number' ? vr.value.toFixed(1) : vr.value}
                          {e.results && (
                            <span className={vr.lift >= 1 ? 'text-emerald-500' : 'text-rose-500'}>
                              {' '}
                              {vr.lift >= 1 ? '+' : ''}
                              {Math.round((vr.lift - 1) * 100)}%
                            </span>
                          )}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </Section>
          ))}
        </div>
      )}

      {showNew && (
        <NewExperimentModal
          niches={niches}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function NewExperimentModal({
  niches,
  onClose,
  onCreated,
}: {
  niches: Niche[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [nicheId, setNicheId] = useState('');
  const [metric, setMetric] = useState('views');
  const [minSamples, setMinSamples] = useState(3);
  const [variants, setVariants] = useState<Variant[]>([
    { key: 'a', label: 'Variant A — control', payload: '{}' },
    { key: 'b', label: 'Variant B — challenger', payload: '{}' },
  ]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/experiments', {
        method: 'POST',
        body: { name, hypothesis, nicheId, metric, minSamples, variants },
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New experiment" onClose={onClose}>
      <div className="space-y-3">
        <ErrorNote message={error} />
        <div>
          <label className="label" htmlFor="ename">Name</label>
          <input id="ename" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Curiosity vs question titles" />
        </div>
        <div>
          <label className="label" htmlFor="ehyp">Hypothesis</label>
          <textarea
            id="ehyp"
            className="input min-h-[60px]"
            value={hypothesis}
            onChange={(e) => setHypothesis(e.target.value)}
            placeholder="Curiosity titles get more views than question titles for this niche."
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="eniche">Niche (optional)</label>
            <select id="eniche" className="input" value={nicheId} onChange={(e) => setNicheId(e.target.value)}>
              <option value="">All niches</option>
              {niches.map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="emetric">Metric</label>
            <select id="emetric" className="input" value={metric} onChange={(e) => setMetric(e.target.value)}>
              <option value="views">views</option>
              <option value="likes">likes</option>
              <option value="comments">comments</option>
              <option value="retention">retention</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="emins">Minimum samples per variant</label>
          <input
            id="emins"
            className="input"
            type="number"
            min={1}
            max={50}
            value={minSamples}
            onChange={(e) => setMinSamples(Math.max(1, Math.min(50, Number(e.target.value) || 3)))}
          />
        </div>

        <div>
          <span className="label">Variants (2–6)</span>
          <div className="space-y-2">
            {variants.map((vr, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="input !w-16"
                  value={vr.key}
                  maxLength={10}
                  onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                />
                <input
                  className="input"
                  value={vr.label}
                  onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                />
                {variants.length > 2 && (
                  <button className="btn-ghost !px-2" onClick={() => setVariants(variants.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          {variants.length < 6 && (
            <button
              className="btn-ghost mt-2 !text-xs"
              onClick={() => setVariants([...variants, { key: String.fromCharCode(97 + variants.length), label: `Variant ${String.fromCharCode(65 + variants.length)}`, payload: '{}' }])}
            >
              + Add variant
            </button>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={create} disabled={busy || name.trim().length < 3}>
            {busy ? 'Creating…' : 'Create experiment'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
