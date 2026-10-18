import { useState } from 'react';
import { api, setCsrf, type User, ApiError } from '../lib/api';
import { ErrorNote } from '../components/ui';

export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = mode === 'login' ? { email, password } : { email, password, name };
      const res = await api<{ user: User; csrf: string | null }>(`/auth/${mode}`, { method: 'POST', body });
      setCsrf(res.csrf ?? null);
      onSignedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 p-4 dark:bg-[#0b1020]">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-accent-600 text-2xl font-black text-white">
            S
          </div>
          <h1 className="text-2xl font-bold">ShortForge</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Your automated, fact-checked YouTube Shorts content factory
          </p>
        </div>

        <form className="card space-y-4 p-6" onSubmit={submit}>
          <ErrorNote message={error} />
          {mode === 'register' && (
            <div>
              <label className="label" htmlFor="name">
                Display name
              </label>
              <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
            </div>
          )}
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
            />
          </div>
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Signing in…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
          <button
            type="button"
            className="w-full text-center text-xs text-accent-600 hover:underline dark:text-accent-400"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
            }}
          >
            {mode === 'login' ? 'No account yet? Register — the first account becomes the owner' : 'Have an account? Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          Everything runs locally. No data leaves your machine unless you connect YouTube.
        </p>
      </div>
    </div>
  );
}
