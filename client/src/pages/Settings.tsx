import { useCallback, useEffect, useState } from 'react';
import { api, type User, type Niche } from '../lib/api';
import { fmtBytes, poll } from '../lib/util';
import { Section, Spinner, ErrorNote, StatusBadge } from '../components/ui';

type VoiceInfo = {
  provider: string;
  voices: { id: string; name: string; culture: string; language: string; recommended: boolean }[];
  languagesAvailable: string[];
  missingLanguages: string[];
  warning: string | null;
  settings: { voice: string; rate: number; pitch: number; volume: number; musicEnabled: boolean; musicVolume: number };
};

type CostSummary = {
  summary: {
    days: number;
    byKind: Record<string, { units: number; cost: number; events: number; providers: string[] }>;
    storageBytes: number;
    totalCostUsd: number;
    paidProviderEvents: number;
    capabilities: {
      id: string;
      name: string;
      free: string;
      freeActive: boolean;
      paid: string;
      paidRate: string;
      paidActive: boolean;
      note: string;
    }[];
  };
  freeTierNotes: string[];
};

export function SettingsPage({ user }: { user: User }) {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [niches, setNiches] = useState<Niche[]>([]);
  const [voice, setVoice] = useState<VoiceInfo | null>(null);
  const [costs, setCosts] = useState<CostSummary | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, n, v, c] = await Promise.all([
        api<{ settings: Record<string, unknown> }>('/settings'),
        api<Niche[]>('/niches'),
        api<VoiceInfo>('/voices'),
        api<CostSummary>('/costs'),
      ]);
      setSettings(s.settings);
      setNiches(n);
      setVoice(v);
      setCosts(c);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => poll(load, 30000), [load]);

  const saveSettings = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      await api('/settings', { method: 'PUT', body: patch });
      setSettings({ ...settings, ...patch });
      setNote('Settings saved');
      setTimeout(() => setNote(''), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const saveVoice = async (patch: Partial<VoiceInfo['settings']>) => {
    setBusy(true);
    try {
      await api('/voice/settings', { method: 'POST', body: patch });
      setVoice(voice ? { ...voice, settings: { ...voice.settings, ...patch } } : voice);
      setNote('Voice settings saved');
      setTimeout(() => setNote(''), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Voice save failed');
    } finally {
      setBusy(false);
    }
  };

  const saveSubtitles = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api('/subtitles/settings', { method: 'POST', body: patch });
      setNote('Subtitle settings saved');
      setTimeout(() => setNote(''), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Subtitle save failed');
    } finally {
      setBusy(false);
    }
  };

  const previewVoice = async () => {
    if (!voice) return;
    try {
      const res = await api<{ url: string }>('/voice/preview', {
        method: 'POST',
        body: { voice: voice.settings.voice, rate: voice.settings.rate, text: 'This is how your ShortForge narration will sound.' },
      });
      const audio = new Audio(res.url);
      void audio.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    }
  };

  if (!settings || !voice || !costs) return <Spinner label="Loading settings…" />;

  const str = (k: string, d = '') => String(settings[k] ?? d);
  const num = (k: string, d = 0) => Number(settings[k] ?? d);
  const bool = (k: string, d = false) => Boolean(settings[k] ?? d);

  return (
    <div className="space-y-4 animate-fade">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Settings</h1>
        <div className="flex gap-2">
          <span className="badge bg-slate-500/10 text-slate-500">{user.role}</span>
          <button className="btn-primary" onClick={() => saveSettings({})} disabled={busy}>
            Save all
          </button>
        </div>
      </div>

      <ErrorNote message={error} />
      {note && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
          {note}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Generation">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="s_lang">Default language</label>
                <input id="s_lang" className="input" value={str('generation.default_language', 'en')} onChange={(e) => setSettings({ ...settings, 'generation.default_language': e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="s_dur">Target duration (s)</label>
                <input id="s_dur" className="input" type="number" min={15} max={90} value={num('generation.duration_target_sec', 40)} onChange={(e) => setSettings({ ...settings, 'generation.duration_target_sec': Number(e.target.value) })} />
              </div>
              <div>
                <label className="label" htmlFor="s_hooks">Hooks per topic</label>
                <input id="s_hooks" className="input" type="number" min={3} max={12} value={num('generation.hooks_per_topic', 7)} onChange={(e) => setSettings({ ...settings, 'generation.hooks_per_topic': Number(e.target.value) })} />
              </div>
              <div>
                <label className="label" htmlFor="s_min">Min words</label>
                <input id="s_min" className="input" type="number" min={30} max={100} value={num('generation.script_min_words', 55)} onChange={(e) => setSettings({ ...settings, 'generation.script_min_words': Number(e.target.value) })} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="s_tone">Tone</label>
              <input id="s_tone" className="input" value={str('generation.tone', 'engaging')} onChange={(e) => setSettings({ ...settings, 'generation.tone': e.target.value })} />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={bool('generation.auto_render', true)} onChange={(e) => setSettings({ ...settings, 'generation.auto_render': e.target.checked })} />
              Auto-render MP4 after generation
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={bool('generation.auto_cover', true)} onChange={(e) => setSettings({ ...settings, 'generation.auto_cover': e.target.checked })} />
              Auto-generate cover image
            </label>
            <button className="btn-primary" disabled={busy} onClick={() => saveSettings({})}>
              Save generation settings
            </button>
          </div>
        </Section>

        <Section title="Autopilot (24/7)">
          <div className="space-y-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={bool('content.autopilot', true)} onChange={(e) => setSettings({ ...settings, 'content.autopilot': e.target.checked })} />
              Keep generating, approving and scheduling automatically
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="s_vpd">Videos per day</label>
                <input id="s_vpd" className="input" type="number" min={0} max={12} value={num('content.videos_per_day', 3)} onChange={(e) => setSettings({ ...settings, 'content.videos_per_day': Number(e.target.value) })} />
              </div>
              <div>
                <label className="label" htmlFor="s_trh">Trend refresh (hours)</label>
                <input id="s_trh" className="input" type="number" min={1} max={168} value={num('trends.auto_refresh_hours', 6)} onChange={(e) => setSettings({ ...settings, 'trends.auto_refresh_hours': Number(e.target.value) })} />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={bool('content.auto_approve_passed', true)} onChange={(e) => setSettings({ ...settings, 'content.auto_approve_passed': e.target.checked })} />
              Auto-approve videos that passed QC (needs-review still waits for you)
            </label>
            <p className="text-xs text-slate-400">
              0 videos per day pauses generation only — publishing keeps running. Each prime slot gets one upload,
              never a stack.
            </p>
            <button className="btn-primary" disabled={busy} onClick={() => saveSettings({})}>
              Save autopilot settings
            </button>
          </div>
        </Section>

        <Section
          title="Voice (TTS)"
          right={<button className="btn-ghost !py-1 !text-xs" onClick={previewVoice}>▶ Preview</button>}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <StatusBadge status={voice.provider === 'none' ? 'failed' : 'passed'} />
              <span className="mono text-xs">{voice.provider}</span>
              <span className="text-xs text-slate-400">free & local</span>
            </div>
            {voice.warning && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                {voice.warning}
              </div>
            )}
            <div>
              <label className="label" htmlFor="v_voice">Voice</label>
              <select id="v_voice" className="input" value={voice.settings.voice} onChange={(e) => setVoice({ ...voice, settings: { ...voice.settings, voice: e.target.value } })}>
                <option value="">Auto (match language)</option>
                {voice.voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.culture}){v.recommended ? ' ★' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label" htmlFor="v_rate">Rate {voice.settings.rate.toFixed(2)}</label>
                <input id="v_rate" className="w-full" type="range" min={0.5} max={2} step={0.01} value={voice.settings.rate} onChange={(e) => setVoice({ ...voice, settings: { ...voice.settings, rate: Number(e.target.value) } })} />
              </div>
              <div>
                <label className="label" htmlFor="v_pitch">Pitch {voice.settings.pitch.toFixed(2)}</label>
                <input id="v_pitch" className="w-full" type="range" min={0.5} max={2} step={0.01} value={voice.settings.pitch} onChange={(e) => setVoice({ ...voice, settings: { ...voice.settings, pitch: Number(e.target.value) } })} />
              </div>
              <div>
                <label className="label" htmlFor="v_vol">Volume {voice.settings.volume.toFixed(2)}</label>
                <input id="v_vol" className="w-full" type="range" min={0} max={2} step={0.05} value={voice.settings.volume} onChange={(e) => setVoice({ ...voice, settings: { ...voice.settings, volume: Number(e.target.value) } })} />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={voice.settings.musicEnabled} onChange={(e) => setVoice({ ...voice, settings: { ...voice.settings, musicEnabled: e.target.checked } })} />
              Ambient background music (procedural, royalty-free)
            </label>
            <div>
              <label className="label" htmlFor="v_mv">Music volume {voice.settings.musicVolume.toFixed(2)}</label>
              <input id="v_mv" className="w-full" type="range" min={0} max={0.3} step={0.01} value={voice.settings.musicVolume} onChange={(e) => setVoice({ ...voice, settings: { ...voice.settings, musicVolume: Number(e.target.value) } })} />
            </div>
            <button className="btn-primary" disabled={busy} onClick={() => saveVoice(voice.settings)}>
              Save voice settings
            </button>
            {voice.missingLanguages.length > 0 && (
              <p className="text-xs text-slate-400">
                Missing local voices: {voice.missingLanguages.join(', ')} — narration falls back to the closest available
                voice (free, offline).
              </p>
            )}
          </div>
        </Section>

        <Section title="Subtitles">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="st_size">Font size ({num('subtitles.size', 104)})</label>
                <input id="st_size" className="w-full" type="range" min={40} max={180} value={num('subtitles.size', 104)} onChange={(e) => setSettings({ ...settings, 'subtitles.size': Number(e.target.value) })} />
              </div>
              <div>
                <label className="label" htmlFor="st_pos">Position {num('subtitles.position', 80) / 100}</label>
                <input id="st_pos" className="w-full" type="range" min={30} max={95} value={Math.round(num('subtitles.position', 0.8) * 100)} onChange={(e) => setSettings({ ...settings, 'subtitles.position': Number(e.target.value) / 100 })} />
              </div>
              <div>
                <label className="label" htmlFor="st_words">Words per cue ({num('subtitles.max_words', 4)})</label>
                <input id="st_words" className="w-full" type="range" min={2} max={8} value={num('subtitles.max_words', 4)} onChange={(e) => setSettings({ ...settings, 'subtitles.max_words': Number(e.target.value) })} />
              </div>
              <div>
                <label className="label" htmlFor="st_style">Style</label>
                <select id="st_style" className="input" value={str('subtitles.style', 'word_highlight')} onChange={(e) => setSettings({ ...settings, 'subtitles.style': e.target.value })}>
                  <option value="word_highlight">word highlight</option>
                  <option value="phrase">phrase</option>
                  <option value="none">none</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="st_c1">Text colour</label>
                <input id="st_c1" className="input !px-1" type="color" value={str('subtitles.primary_color', '#ffffff')} onChange={(e) => setSettings({ ...settings, 'subtitles.primary_color': e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="st_c2">Highlight colour</label>
                <input id="st_c2" className="input !px-1" type="color" value={str('subtitles.highlight_color', '#ffd60a')} onChange={(e) => setSettings({ ...settings, 'subtitles.highlight_color': e.target.value })} />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={bool('subtitles.bold', true)} onChange={(e) => setSettings({ ...settings, 'subtitles.bold': e.target.checked })} />
              Bold
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={bool('subtitles.all_caps', true)} onChange={(e) => setSettings({ ...settings, 'subtitles.all_caps': e.target.checked })} />
              ALL CAPS
            </label>
            <button className="btn-primary" disabled={busy} onClick={() => saveSubtitles({})}>
              Save subtitle settings
            </button>
          </div>
        </Section>

        <Section title="Niches">
          <div className="space-y-2">
            {niches.map((n) => (
              <div key={n.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: n.color }} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{n.name}</div>
                  <div className="truncate text-xs text-slate-400">{n.description}</div>
                </div>
                <span className="badge bg-slate-500/10 text-slate-500">{n.language}</span>
                {n.isBuiltin && <span className="badge bg-slate-500/10 text-slate-400">builtin</span>}
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Free vs optional paid">
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg bg-emerald-500/10 p-3 text-sm">
            <div className="font-bold text-emerald-600 dark:text-emerald-400">Total spent (30d)</div>
            <div className="text-2xl font-black">${costs.summary.totalCostUsd.toFixed(2)}</div>
            <div className="text-xs text-slate-400">storage {fmtBytes(costs.summary.storageBytes)}</div>
          </div>
          <div className="rounded-lg bg-slate-500/10 p-3 text-sm">
            <div className="font-bold">Paid events</div>
            <div className="text-2xl font-black">{costs.summary.paidProviderEvents}</div>
            <div className="text-xs text-slate-400">none of them billed</div>
          </div>
          <div className="rounded-lg bg-sky-500/10 p-3 text-sm">
            <div className="font-bold text-sky-600 dark:text-sky-400">Usage window</div>
            <div className="text-2xl font-black">{costs.summary.days}d</div>
            <div className="text-xs text-slate-400">local render + TTS</div>
          </div>
        </div>

        <div className="space-y-2">
          {costs.summary.capabilities.map((c) => (
            <div key={c.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{c.name}</span>
                <span className={`badge ${c.freeActive ? 'bg-emerald-500/15 text-emerald-500' : 'bg-slate-500/15 text-slate-400'}`}>
                  free: {c.freeActive ? 'active' : 'available'}
                </span>
                <span className={`badge ${c.paidActive ? 'bg-amber-500/15 text-amber-500' : 'bg-slate-500/15 text-slate-400'}`}>
                  paid: {c.paidActive ? 'active' : 'never used'}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Free tier: {c.free}
                <br />
                Optional paid: {c.paid} {c.paidRate && <span>· {c.paidRate}</span>}
                <br />
                {c.note}
              </div>
            </div>
          ))}
        </div>

        <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-slate-400">
          {costs.freeTierNotes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
