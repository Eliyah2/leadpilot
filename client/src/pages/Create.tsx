import { useEffect, useState } from 'react';
import { api, type Niche } from '../lib/api';
import { navigate } from '../lib/util';
import { Section, Spinner, ErrorNote } from '../components/ui';

/* Must match the backend validation in server/routes/content.ts and server/lib/aspect.ts. */
const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'nl', label: 'Nederlands' },
  { id: 'de', label: 'Deutsch' },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
];
const ASPECTS = [
  { id: '9:16', label: 'Short 9:16' },
  { id: '16:9', label: 'Landscape 16:9' },
  { id: '1:1', label: 'Square 1:1' },
];
const DURATIONS = [15, 30, 60, 90];

type Scene = { idx: number; kind: string; voiceover: string; durationSec: number; textOnScreen: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');

export function CreateVideoPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [niches, setNiches] = useState<Niche[]>([]);
  const [idea, setIdea] = useState('');
  const [nicheId, setNicheId] = useState('');
  const [language, setLanguage] = useState('en');
  const [durationSec, setDurationSec] = useState(30);
  const [aspect, setAspect] = useState('9:16');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Niche[]>('/niches')
      .then((n) => {
        setNiches(n);
        setNicheId((cur) => cur || n[0]?.id || '');
      })
      .catch((e) => setError(errorText(e)));
  }, []);

  const createScript = async () => {
    setBusy('Writing script… this can take a moment');
    setError('');
    try {
      const res = await api<{ videoId: string }>('/videos/from-idea', {
        method: 'POST',
        body: { idea: idea.trim(), nicheId, language, durationSec, aspect },
      });
      const detail = await api<{ scenes: Scene[] }>(`/videos/${res.videoId}`);
      setVideoId(res.videoId);
      setScenes(detail.scenes);
      setStep(3);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const saveScript = async () => {
    if (!videoId) return;
    if (scenes.some((s) => !s.voiceover.trim())) {
      setError('Every scene needs voice-over text before you can save or render.');
      return false;
    }
    await api(`/videos/${videoId}/script`, {
      method: 'PUT',
      body: { voiceovers: scenes.map((s) => s.voiceover.trim()) },
    });
    return true;
  };

  const save = async () => {
    setBusy('Saving script…');
    setError('');
    try {
      await saveScript();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const renderVideo = async () => {
    if (!videoId) return;
    setBusy('Saving and queueing render…');
    setError('');
    try {
      if ((await saveScript()) === false) return;
      await api(`/videos/${videoId}/render`, { method: 'POST' });
      navigate(`/videos/${videoId}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const updateScene = (idx: number, voiceover: string) =>
    setScenes((cur) => cur.map((s) => (s.idx === idx ? { ...s, voiceover } : s)));

  const totalSec = scenes.reduce((sum, s) => sum + s.durationSec, 0);
  const canContinue = idea.trim().length >= 3 && Boolean(nicheId);

  return (
    <div className="space-y-4 animate-fade">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Create Video</h1>
        <span className="text-xs text-slate-400">
          Step {step} of 3 · {step === 1 ? 'Idea & genre' : step === 2 ? 'Settings' : 'Review script'}
        </span>
      </div>

      <ErrorNote message={error} />

      <Section title={step === 1 ? 'What is the video about?' : step === 2 ? 'Format' : 'Script (editable before rendering)'}>
        {step === 1 && (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="idea">Your idea</label>
              <textarea
                id="idea"
                className="input min-h-[90px]"
                maxLength={300}
                placeholder="e.g. A lighthouse keeper logs a light that appears every night at 3:12 AM"
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-400">{idea.length}/300 · at least 3 characters</p>
            </div>
            <div>
              <label className="label" htmlFor="genre">Genre</label>
              <select id="genre" className="input" value={nicheId} onChange={(e) => setNicheId(e.target.value)}>
                {niches.map((n) => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end">
              <button className="btn-primary" disabled={!canContinue} onClick={() => setStep(2)}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <span className="label">Duration</span>
              <div className="flex flex-wrap gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={durationSec === d}
                    className={durationSec === d ? 'btn-primary' : 'btn-ghost'}
                    onClick={() => setDurationSec(d)}
                  >
                    {d} s
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="lang">Language</label>
              <select id="lang" className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
            </div>
            <div>
              <span className="label">Aspect ratio</span>
              <div className="flex flex-wrap gap-2">
                {ASPECTS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={aspect === a.id}
                    className={aspect === a.id ? 'btn-primary' : 'btn-ghost'}
                    onClick={() => setAspect(a.id)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
            {busy ? (
              <Spinner label={busy} />
            ) : (
              <div className="flex justify-between gap-2">
                <button className="btn-ghost" onClick={() => setStep(1)}>Back</button>
                <button className="btn-primary" onClick={createScript}>Write script</button>
              </div>
            )}
          </div>
        )}

        {step === 3 && videoId && (
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              {scenes.length} scenes · about {Math.round(totalSec)} s · nothing is rendered until you press Render.
            </p>
            {scenes.map((s) => (
              <div key={s.idx} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <span>Scene {s.idx + 1} · {s.kind}</span>
                  <span>{Math.round(s.durationSec)} s</span>
                </div>
                {s.textOnScreen && <p className="mb-2 text-xs italic text-slate-500">On screen: {s.textOnScreen}</p>}
                <textarea
                  aria-label={`Voice-over for scene ${s.idx + 1}`}
                  className="input min-h-[70px]"
                  maxLength={600}
                  value={s.voiceover}
                  onChange={(e) => updateScene(s.idx, e.target.value)}
                />
              </div>
            ))}
            {busy ? (
              <Spinner label={busy} />
            ) : (
              <div className="flex flex-wrap justify-between gap-2">
                <button className="btn-ghost" onClick={save}>Save script</button>
                <button className="btn-primary" onClick={renderVideo}>Render MP4</button>
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
