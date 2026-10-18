import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { fmtAgo, fmtNum, navigate, poll } from '../lib/util';
import { Section, Spinner, ErrorNote, StatusBadge } from '../components/ui';

type Status = {
  configured: boolean;
  connected: boolean;
  channelTitle: string | null;
  channelId: string | null;
  subs: number | null;
  redirectUri: string;
  quotaHint: string;
  recentUploads: { id: string; title: string; views: number; published_at: number; local_id: string }[];
  autoPublish: boolean;
};

type Settings = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  privacy: 'public' | 'unlisted' | 'private';
  category: string;
  madeForKids: boolean;
  autoPublish: boolean;
  tags: string[];
};

export function YouTubePage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, all] = await Promise.all([
        api<Status>('/youtube/status'),
        api<{ settings: Record<string, unknown> }>('/settings'),
      ]);
      setStatus(s);
      const st = all.settings;
      setSettings({
        clientId: String(st['youtube.clientId'] ?? ''),
        clientSecret: String(st['youtube.clientSecret'] ?? ''),
        redirectUri: String(st['youtube.redirectUri'] ?? s.redirectUri ?? ''),
        privacy: (st['youtube.privacy'] as Settings['privacy']) ?? 'private',
        category: String(st['youtube.category'] ?? '28'),
        madeForKids: Boolean(st['youtube.made_for_kids']),
        autoPublish: Boolean(st['youtube.auto_publish']),
        tags: Array.isArray(st['youtube.tags']) ? (st['youtube.tags'] as string[]) : [],
      });
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => poll(load, 10000), [load]);

  const save = async () => {
    if (!settings) return;
    setBusy(true);
    setError('');
    try {
      await api('/youtube/settings', { method: 'POST', body: settings });
      setNote('Settings saved');
      setTimeout(() => setNote(''), 3000);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ url: string }>('/youtube/auth-url', { method: 'POST', body: {} });
      window.open(res.url, '_blank', 'noopener');
      setNote('Complete the Google consent screen in the new tab, then return here.');
      setTimeout(() => void load(), 6000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not build the authorization URL');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm('Disconnect this channel? Uploads stop until you reconnect.')) return;
    setBusy(true);
    try {
      await api('/youtube/disconnect', { method: 'POST', body: {} });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Disconnect failed');
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    try {
      await api('/youtube/sync', { method: 'POST', body: {} });
      setNote('Stats sync queued — results appear in Analytics shortly.');
      setTimeout(() => setNote(''), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  };

  if (!status || !settings) return <Spinner label="Loading YouTube settings…" />;

  return (
    <div className="space-y-4 animate-fade">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">YouTube</h1>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={syncNow} disabled={busy || !status.connected}>
            ↻ Sync stats
          </button>
          {status.connected ? (
            <button className="btn-danger" onClick={disconnect} disabled={busy}>
              Disconnect
            </button>
          ) : (
            <button className="btn-primary" onClick={connect} disabled={busy || !status.configured}>
              {busy ? 'Opening…' : 'Connect channel'}
            </button>
          )}
        </div>
      </div>

      <ErrorNote message={error} />
      {note && (
        <div className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
          {note}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Connection">
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <StatusBadge status={status.connected ? 'connected' : status.configured ? 'configured' : 'not configured'} />
              {status.connected && (
                <span className="font-medium">
                  {status.channelTitle} {status.subs != null && <span className="text-slate-400">· {fmtNum(status.subs)} subs</span>}
                </span>
              )}
            </div>

            {!status.connected && (
              <ol className="list-inside list-decimal space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
                <li>
                  No YouTube channel yet? Sign in or create a Google account at{' '}
                  <a className="text-accent-500 hover:underline" href="https://accounts.google.com/signup" target="_blank" rel="noreferrer">
                    Google sign-up
                  </a>, then open{' '}
                  <a className="text-accent-500 hover:underline" href="https://www.youtube.com" target="_blank" rel="noreferrer">
                    YouTube
                  </a>{' '}
                  and create your channel. ShortForge cannot create accounts for you.
                </li>
                <li>
                  Create an OAuth client in <strong>Google Cloud Console</strong> (free): enable the YouTube Data API v3,
                  create an OAuth 2.0 Client ID of type “Web application”.
                </li>
                <li>
                  Add this redirect URI: <code className="mono rounded bg-slate-100 px-1 dark:bg-slate-800">{status.redirectUri}</code>
                </li>
                <li>Paste the client ID + secret below, save, then press “Connect channel”.</li>
              </ol>
            )}

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/50">
              <strong>Free quota:</strong> {status.quotaHint}
            </div>

            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={settings.autoPublish}
                onChange={(e) => setSettings({ ...settings, autoPublish: e.target.checked })}
              />
              Auto-publish scheduled videos (no manual click needed)
            </label>
          </div>
        </Section>

        <Section title="OAuth credentials & defaults">
          {!status.connected && (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              ShortForge never stores credentials in plain files — the client secret is kept in your local settings DB and
              never leaves this machine. Nothing is paid: OAuth and uploads use YouTube’s free daily quota.
            </div>
          )}
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="cid">OAuth Client ID</label>
              <input
                id="cid"
                className="input mono"
                value={settings.clientId}
                onChange={(e) => setSettings({ ...settings, clientId: e.target.value })}
                placeholder="xxxx.apps.googleusercontent.com"
              />
            </div>
            <div>
              <label className="label" htmlFor="csec">OAuth Client Secret</label>
              <input
                id="csec"
                className="input mono"
                type="password"
                value={settings.clientSecret}
                onChange={(e) => setSettings({ ...settings, clientSecret: e.target.value })}
                placeholder="GOCSPX-…"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="priv">Default privacy</label>
                <select
                  id="priv"
                  className="input"
                  value={settings.privacy}
                  onChange={(e) => setSettings({ ...settings, privacy: e.target.value as Settings['privacy'] })}
                >
                  <option value="public">public</option>
                  <option value="unlisted">unlisted</option>
                  <option value="private">private</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="cat">Category ID</label>
                <input
                  id="cat"
                  className="input"
                  value={settings.category}
                  onChange={(e) => setSettings({ ...settings, category: e.target.value })}
                />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.madeForKids}
                onChange={(e) => setSettings({ ...settings, madeForKids: e.target.checked })}
              />
              Made for kids (target audience setting)
            </label>
            <button className="btn-primary w-full" onClick={save} disabled={busy}>
              Save settings
            </button>
          </div>
        </Section>
      </div>

      <Section title="Recent uploads">
        {status.recentUploads.length === 0 ? (
          <p className="text-sm text-slate-400">No uploads yet. Approve a video and press “Upload to YouTube”.</p>
        ) : (
          <div className="space-y-2">
            {status.recentUploads.map((u) => (
              <div key={u.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                <a
                  className="min-w-0 flex-1 truncate hover:text-accent-500"
                  href={`https://www.youtube.com/watch?v=${u.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {u.title}
                </a>
                <span className="text-xs text-slate-400">{fmtNum(u.views)} views</span>
                <span className="text-xs text-slate-400">{fmtAgo(u.published_at)}</span>
                <button className="btn-ghost !py-0.5 !text-xs" onClick={() => navigate(`/videos/${u.local_id}`)}>
                  Open
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Rules ShortForge follows">
        <ul className="list-inside list-disc space-y-1 text-xs text-slate-500 dark:text-slate-400">
          <li>Official YouTube Data API v3 only — no scraping, no unofficial clients.</li>
          <li>Uploads are resumable and quota-aware (1 600 units of the free 10 000/day per upload).</li>
          <li>No fake views, subscribers, likes or comments — stats are read, never written.</li>
          <li>All content is original and fact-checked; nothing is copied from other creators.</li>
        </ul>
      </Section>
    </div>
  );
}
