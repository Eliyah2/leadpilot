import { useCallback, useEffect, useState } from 'react';
import { api, type Video, type VideoDetail, type QcReport, ApiError } from '../lib/api';
import { fmtAgo, fmtBytes, fmtDate, fmtDuration, fmtNum, navigate, poll } from '../lib/util';
import { Section, Spinner, StatusBadge, ErrorNote, EmptyState, Modal } from '../components/ui';

const STATUSES = ['all', 'draft', 'review', 'approved', 'scheduled', 'published'] as const;

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

export function VideosPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);
      if (q.trim()) params.set('q', q.trim());
      const rows = await api<Video[]>(`/videos?${params.toString()}`);
      setVideos(rows);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load videos');
    } finally {
      setLoading(false);
    }
  }, [status, q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0); // debounce typing
    return () => clearTimeout(t);
  }, [load, q]);

  const remove = async (id: string) => {
    if (!confirm('Delete this video? The MP4 and cover are removed too.')) return;
    try {
      await api(`/videos/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  return (
    <div className="space-y-4 animate-fade">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Videos</h1>
        <button className="btn-primary" onClick={() => navigate('/factory')}>
          + Generate
        </button>
      </div>

      <ErrorNote message={error} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-lg px-3 py-1.5 text-sm capitalize transition ${
                status === s
                  ? 'bg-accent-600 text-white'
                  : 'bg-slate-200/70 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <input
          className="input max-w-xs"
          placeholder="Search title or hook…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="ml-auto text-xs text-slate-400">{videos.length} videos</span>
      </div>

      {loading ? (
        <Spinner label="Loading videos…" />
      ) : videos.length === 0 ? (
        <EmptyState
          title="Nothing here"
          hint="Adjust the filters, or generate a new batch in the Content Factory."
          action={<button className="btn-primary" onClick={() => navigate('/factory')}>Open Factory</button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {videos.map((v) => (
            <div key={v.id} className="card group overflow-hidden">
              <button className="block w-full text-left" onClick={() => navigate(`/videos/${v.id}`)}>
                <div
                  className="relative aspect-[9/16] max-h-52 w-full bg-cover bg-center transition group-hover:brightness-105"
                  style={{
                    backgroundColor: v.nicheColor ?? '#6366f1',
                    backgroundImage: v.cover ? `url(/media/covers/${v.id}.png)` : undefined,
                  }}
                >
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                    <div className="line-clamp-2 text-xs font-semibold text-white">{v.title}</div>
                  </div>
                  <span className="absolute right-1.5 top-1.5 badge bg-black/60 text-white">
                    {fmtDuration(v.durationSec ?? v.durationTarget)}
                  </span>
                  {v.mp4 && (
                    <span className="absolute left-1.5 top-1.5 badge bg-emerald-600 text-white">MP4</span>
                  )}
                </div>
              </button>
              <div className="space-y-2 p-3">
                <div className="flex flex-wrap gap-1.5">
                  <StatusBadge status={v.status} />
                  <StatusBadge status={v.qcStatus} />
                  <StatusBadge status={v.renderStatus} />
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>
                    {v.nicheName ?? '—'} · {fmtAgo(v.createdAt)}
                  </span>
                  <span>
                    {fmtNum(v.views)} views{v.mp4 ? ` · ${fmtBytes(v.sizeBytes)}` : ''}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <button className="btn-ghost flex-1 !py-1 !text-xs" onClick={() => navigate(`/videos/${v.id}`)}>
                    Open
                  </button>
                  <button className="btn-ghost !py-1 !text-xs" onClick={() => remove(v.id)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

export function VideoDetailPage({ id }: { id: string }) {
  const [video, setVideo] = useState<VideoDetail | null>(null);
  const qcFetched = useState(() => new Set<string>())[0];
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState<'preview' | 'script' | 'qc' | 'sources' | 'activity'>('preview');

  // editable metadata
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [showMeta, setShowMeta] = useState(false);

  const load = useCallback(async () => {
    try {
      let v = await api<VideoDetail>(`/videos/${id}`);
      if (!v.qc && !qcFetched.has(id)) {
        // QC report is computed on demand the first time it is viewed (not persisted).
        qcFetched.add(id);
        v = await api<VideoDetail>(`/videos/${id}?recheck=1`);
      }
      setVideo((prev) => {
        // Keep the computed QC report across background polls (recheck is not persisted).
        if (!v.qc && prev && prev.id === v.id && prev.qc) return { ...v, qc: prev.qc };
        return v;
      });
      setTitle(v.title);
      setDescription(v.description ?? '');
      setHashtags(v.hashtags ?? []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load video');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => poll(load, 4000), [load]);

  const recheck = async () => {
    setBusy('qc');
    setError('');
    try {
      const v = await api<VideoDetail>(`/videos/${id}?recheck=1`);
      setVideo((prev) => (prev && prev.id === v.id ? { ...v, qc: v.qc ?? prev.qc } : v));
      setNote('Quality check complete');
      setTimeout(() => setNote(''), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recheck failed');
    } finally {
      setBusy('');
    }
  };

  const action = async (label: string, path: string, method: 'POST' | 'PATCH' | 'GET' = 'POST', body?: unknown) => {
    setBusy(label);
    setError('');
    try {
      await api(path, { method, body });
      setNote(`${label} — queued`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `${label} failed`);
    } finally {
      setBusy('');
      setTimeout(() => setNote(''), 4000);
    }
  };

  if (!video && !error) return <Spinner label="Loading video…" />;
  if (!video) {
    return (
      <div className="space-y-3">
        <ErrorNote message={error} />
        <button className="btn-ghost" onClick={() => navigate('/videos')}>← Back to videos</button>
      </div>
    );
  }

  const v = video;
  const qc = v.qc;

  return (
    <div className="space-y-4 animate-fade">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost" onClick={() => navigate('/videos')}>← Videos</button>
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge status={v.status} />
          <StatusBadge status={v.qcStatus} />
          <StatusBadge status={v.renderStatus} />
        </div>
        <span className="ml-auto text-xs text-slate-400">{fmtAgo(v.createdAt)}</span>
      </div>

      <ErrorNote message={error} />
      {note && <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">{note}</div>}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Preview column */}
        <div className="space-y-3 lg:col-span-2">
          <div className="card overflow-hidden">
            {v.mp4 ? (
              <video controls playsInline className="aspect-[9/16] w-full bg-black" poster={v.cover ? `/media/covers/${v.id}.png` : undefined}>
                <source src={`/media/video/${v.id}.mp4`} type="video/mp4" />
              </video>
            ) : (
              <div
                className="grid aspect-[9/16] w-full place-items-center text-sm text-white/80"
                style={{ backgroundColor: v.nicheColor ?? '#6366f1' }}
              >
                {v.renderStatus === 'rendering' ? 'Rendering…' : v.renderStatus === 'failed' ? 'Render failed' : 'Not rendered yet'}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {v.mp4 && (
              <a className="btn-ghost" href={`/api/videos/${v.id}/download`} download>
                ↓ MP4
              </a>
            )}
            <button
              className="btn-ghost"
              disabled={busy !== ''}
              onClick={() => action('Render', `/videos/${v.id}/render`)}
            >
              {v.renderStatus === 'done' ? 'Re-render' : 'Render'}
            </button>
            <button className="btn-ghost" disabled={busy !== ''} onClick={() => action('Voiceover', `/videos/${v.id}/voiceover`)}>
              Voiceover
            </button>
            <button className="btn-ghost" disabled={busy !== ''} onClick={() => action('Export', `/videos/${v.id}/export`)}>
              Export package
            </button>
            <button className="btn-ghost" disabled={busy !== ''} onClick={() => action('Cover', `/videos/${v.id}/cover`)}>
              Cover
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              className="btn-primary flex-1"
              disabled={busy !== '' || v.qcStatus === 'failed'}
              onClick={() => action('Approve', `/videos/${v.id}/approve`)}
            >
              ✓ Approve & schedule
            </button>
            <button className="btn-ghost" disabled={busy !== ''} onClick={() => action('Regenerate', `/videos/${v.id}/regenerate`)}>
              ↻ Regenerate script
            </button>
            <button
              className="btn-ghost"
              disabled={busy !== '' || !v.mp4}
              onClick={() => action('Upload queued', `/youtube/upload`, 'POST', { videoId: v.id })}
              title={v.mp4 ? 'Uploads privately by default; needs a connected YouTube channel' : 'Render the MP4 first'}
            >
              ⬆ Upload to YouTube
            </button>
          </div>

          {v.published && (
            <div className="card p-3 text-sm">
              <div className="mb-1 text-xs font-bold uppercase text-slate-400">Published</div>
              <a
                className="text-accent-500 hover:underline"
                href={`https://www.youtube.com/watch?v=${v.published.youtubeVideoId}`}
                target="_blank"
                rel="noreferrer"
              >
                youtube.com/watch?v={v.published.youtubeVideoId}
              </a>
              <div className="mt-1 text-xs text-slate-400">
                {fmtNum(v.published.views)} views · {fmtNum(v.published.likes)} likes · {fmtDate(v.published.publishedAt)}
              </div>
            </div>
          )}
        </div>

        {/* Info column */}
        <div className="space-y-3 lg:col-span-3">
          <Section
            title="Metadata"
            right={
              <button className="btn-ghost !py-1 !text-xs" onClick={() => setShowMeta((s) => !s)}>
                {showMeta ? 'Close' : 'Edit'}
              </button>
            }
          >
            {showMeta ? (
              <div className="space-y-3">
                <div>
                  <label className="label" htmlFor="vtitle">Title ({title.length}/100)</label>
                  <input id="vtitle" className="input" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="vdesc">Description</label>
                  <textarea id="vdesc" className="input min-h-[140px]" value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="vhash">Hashtags (space separated)</label>
                  <input
                    id="vhash"
                    className="input"
                    value={hashtags.join(' ')}
                    onChange={(e) => setHashtags(e.target.value.split(/\s+/).filter(Boolean))}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn-primary"
                    disabled={busy !== ''}
                    onClick={async () => {
                      await action('Saved', `/videos/${v.id}`, 'PATCH', {
                        title,
                        description,
                        hashtags,
                      });
                      setShowMeta(false);
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="text-lg font-bold leading-snug">{v.title}</div>
                <div className="text-xs text-slate-400">
                  {v.format} · {v.language} · target {v.durationTarget}s · actual {fmtDuration(v.durationSec)} ·{' '}
                  {v.visibility}
                </div>
                {v.hook && (
                  <div className="rounded-lg bg-slate-100 p-2 text-sm italic dark:bg-slate-800">“{v.hook}”</div>
                )}
                {v.hashtags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {v.hashtags.map((h) => (
                      <span key={h} className="badge bg-accent-500/10 text-accent-500">{h}</span>
                    ))}
                  </div>
                )}
                <details className="text-xs text-slate-500 dark:text-slate-400">
                  <summary className="cursor-pointer">Description</summary>
                  <pre className="mt-2 whitespace-pre-wrap">{v.description || '—'}</pre>
                </details>
              </div>
            )}
          </Section>

          {/* tabs */}
          <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
            {(
              [
                ['preview', 'Scenes'],
                ['script', 'Script'],
                ['qc', 'Quality'],
                ['sources', 'Sources'],
                ['activity', 'Activity'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
                  tab === key
                    ? 'border-accent-500 font-semibold text-accent-600 dark:text-accent-300'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'preview' && (
            <Section title={`Scenes (${v.scenes.length})`}>
              <div className="space-y-2">
                {v.scenes.map((s) => (
                  <div key={s.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
                    <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                      <span className="badge bg-slate-500/10 uppercase">{s.kind}</span>
                      <span>
                        {fmtDuration(s.startSec)} → {fmtDuration(s.startSec + s.durationSec)} · {s.transition}
                      </span>
                    </div>
                    <div className="font-medium">{s.textOnScreen}</div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{s.voiceover}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {tab === 'script' && (
            <Section title="Voiceover script">
              {v.script ? (
                <div className="space-y-2 text-sm">
                  <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                    <span className="badge bg-slate-500/10">{v.script.format}</span>
                    <span>{v.script.wordCount} words</span>
                    <span>≈ {Math.round(v.script.estDurationSec)}s</span>
                    <StatusBadge status={v.script.status} />
                  </div>
                  <pre className="whitespace-pre-wrap rounded-lg bg-slate-100 p-3 text-sm leading-relaxed dark:bg-slate-800/70">
                    {v.script.voiceoverText}
                  </pre>
                </div>
              ) : (
                <p className="text-sm text-slate-400">No script generated yet.</p>
              )}
            </Section>
          )}

          {tab === 'qc' && <QcPanel qc={qc} notes={v.reviewNotes} onRecheck={recheck} busy={busy === 'qc'} />}

          {tab === 'sources' && (
            <Section title={`Sources (${v.sources.length})`}>
              {v.sources.length === 0 ? (
                <p className="text-sm text-slate-400">No sources recorded.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {v.sources.map((s) => (
                    <li key={s.id} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                      <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-accent-500 hover:underline">
                        {s.title || s.url}
                      </a>
                      <div className="text-xs text-slate-400">
                        {s.publisher} · {s.kind}
                      </div>
                      {s.snippet && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{s.snippet}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {tab === 'activity' && (
            <Section title="Jobs & logs">
              <div className="space-y-1 text-xs">
                {v.logs.length === 0 && <p className="text-slate-400">No activity yet.</p>}
                {v.logs.map((l) => (
                  <div key={l.id} className="flex gap-2 rounded px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <span className={`mono shrink-0 ${l.level === 'warn' ? 'text-amber-500' : l.level === 'error' ? 'text-rose-500' : 'text-slate-400'}`}>
                      {fmtAgo(l.created_at)}
                    </span>
                    <span className="min-w-0 flex-1">{l.message}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>

      {/* Recycle modal */}
      <RecycleButton videoId={v.id} onDone={setNote} />
    </div>
  );
}

function QcPanel({ qc, notes, onRecheck, busy }: { qc: QcReport | null; notes: string[]; onRecheck: () => void; busy?: boolean }) {
  if (!qc) {
    return (
      <Section title="Quality control">
        <p className="text-sm text-slate-400">No QC report stored for this video.</p>
        <button className="btn-ghost mt-2" onClick={onRecheck} disabled={busy}>
          {busy ? 'Checking…' : 'Run check now'}
        </button>
      </Section>
    );
  }
  const tone =
    qc.status === 'passed' ? 'text-emerald-500' : qc.status === 'failed' ? 'text-rose-500' : 'text-amber-500';
  return (
    <Section
      title={`Quality control — ${qc.status.replace('_', ' ')}`}
      right={
        <button className="btn-ghost !py-1 !text-xs" onClick={onRecheck} disabled={busy}>
          {busy ? 'Checking…' : 'Re-run'}
        </button>
      }
    >
      <div className="mb-3 flex items-center gap-3">
        <div className={`text-3xl font-black ${tone}`}>{qc.score}</div>
        <div className="text-xs text-slate-400">
          score / 100
          <br />
          {qc.unverifiedClaims.length} unverified claim(s)
        </div>
      </div>
      <div className="space-y-1.5">
        {qc.checks.map((c) => (
          <div key={c.id} className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
            <span
              className={`mt-0.5 text-sm ${c.status === 'pass' ? 'text-emerald-500' : c.status === 'warn' ? 'text-amber-500' : 'text-rose-500'}`}
            >
              {c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✕'}
            </span>
            <div>
              <div className="font-medium">{c.label}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{c.detail}</div>
            </div>
          </div>
        ))}
      </div>
      {notes.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="mb-1 font-bold">Review notes</div>
          <ul className="list-inside list-disc space-y-0.5">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function RecycleButton({ videoId, onDone }: { videoId: string; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [topics, setTopics] = useState<{ id: string; title: string; category: string }[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const res = await api<{ topics: { id: string; title: string; category: string }[] }>(`/videos/${videoId}/recycle`, {
        method: 'POST',
        body: {},
      });
      setTopics(res.topics);
    } catch (e) {
      onDone(e instanceof Error ? e.message : 'Recycle failed');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn-ghost" onClick={() => setOpen(true)}>
        ♻ Recycle into new topics
      </button>
      {open && (
        <Modal title="Recycle into original follow-ups" onClose={() => setOpen(false)}>
          {!topics ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Derive new original topic ideas from this video (angles: update, counterpoint, deeper dive…). Every derived
                topic goes through the same fact-check pipeline before publishing.
              </p>
              <button className="btn-primary" disabled={busy} onClick={run}>
                {busy ? 'Deriving…' : 'Derive topics'}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {topics.length === 0 ? (
                <p className="text-sm text-slate-400">No new topics derived.</p>
              ) : (
                topics.map((t) => (
                  <div key={t.id} className="rounded-lg border border-slate-200 p-2.5 text-sm dark:border-slate-800">
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-slate-400">{t.category}</div>
                  </div>
                ))
              )}
              <button className="btn-ghost w-full" onClick={() => { setOpen(false); setTopics(null); navigate('/topics'); }}>
                Open in Topics
              </button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
