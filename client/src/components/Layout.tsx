import { useEffect, useState, type ReactNode } from 'react';
import type { User } from '../lib/api';
import { api } from '../lib/api';
import { navigate } from '../lib/util';

type NavItem = { page: string; label: string; icon: string };

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Produce',
    items: [
      { page: 'dashboard', label: 'Dashboard', icon: '◈' },
      { page: 'create', label: 'Create Video', icon: '+' },
      { page: 'factory', label: 'Content Factory', icon: '⚙' },
      { page: 'videos', label: 'Videos', icon: '▶' },
    ],
  },
  {
    section: 'Research',
    items: [
      { page: 'trends', label: 'Trend Finder', icon: '↗' },
      { page: 'topics', label: 'Topics & Hooks', icon: '✦' },
    ],
  },
  {
    section: 'Publish',
    items: [
      { page: 'calendar', label: 'Calendar', icon: '▦' },
      { page: 'youtube', label: 'YouTube', icon: '◉' },
      { page: 'analytics', label: 'Analytics', icon: '◫' },
    ],
  },
  {
    section: 'Improve',
    items: [
      { page: 'experiments', label: 'Experiments', icon: '⚗' },
      { page: 'settings', label: 'Settings', icon: '☰' },
    ],
  },
];

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('sf-theme', next ? 'dark' : 'light');
    } catch {
      /* private mode */
    }
  };
  return (
    <button className="btn-ghost !px-2" onClick={toggle} title="Toggle theme" aria-label="Toggle theme">
      {dark ? '☀' : '☾'}
    </button>
  );
}

function HealthDot() {
  const [state, setState] = useState<'ok' | 'down'>('ok');
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        await api('/health');
        if (alive) setState('ok');
      } catch {
        if (alive) setState('down');
      }
    };
    const t = setInterval(check, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"
      title={state === 'ok' ? 'API online' : 'API unreachable'}
    >
      <span className={`h-2 w-2 rounded-full ${state === 'ok' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
      {state === 'ok' ? 'Online' : 'Offline'}
    </span>
  );
}

export function Layout({
  user,
  route,
  onLogout,
  children,
}: {
  user: User;
  route: string;
  onLogout: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setOpen(false), [route]);

  const go = (page: string) => navigate(`/${page}`);

  const nav = (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <div className="flex items-center gap-2 px-2 pt-1">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-600 font-black text-white">S</span>
        <div>
          <div className="text-sm font-bold leading-tight">ShortForge</div>
          <div className="text-[10px] uppercase tracking-widest text-slate-400">Shorts factory</div>
        </div>
      </div>

      {NAV.map((group) => (
        <div key={group.section}>
          <div className="mb-1 px-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
            {group.section}
          </div>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = route === item.page;
              return (
                <li key={item.page}>
                  <button
                    onClick={() => go(item.page)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${
                      active
                        ? 'bg-accent-600/15 font-semibold text-accent-600 dark:text-accent-300'
                        : 'text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="w-4 text-center opacity-70">{item.icon}</span>
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className="mt-auto space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
        <div className="px-2 text-xs text-slate-500 dark:text-slate-400">
          <div className="truncate font-medium text-slate-700 dark:text-slate-200">{user.name}</div>
          <div className="truncate">{user.email}</div>
        </div>
        <button className="btn-ghost w-full !justify-start" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0d1329] lg:block">
        {nav}
      </aside>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0d1329]">
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/80 px-4 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-[#0b1020]/80">
          <button className="btn-ghost !px-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            ☰
          </button>
          <HealthDot />
          <div className="ml-auto flex items-center gap-2">
            <button className="btn-primary" onClick={() => navigate('/factory')}>
              + Generate
            </button>
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
        <footer className="border-t border-slate-200 px-4 py-3 text-center text-xs text-slate-400 dark:border-slate-800">
          ShortForge — original, sourced Shorts generated locally. No fake engagement, ever.
        </footer>
      </div>
    </div>
  );
}
