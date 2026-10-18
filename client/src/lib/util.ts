/** Small helpers: formatting, hash router, polling. */

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

export function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtDuration(sec: number | null | undefined): string {
  if (!sec && sec !== 0) return '—';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtAgo(ts: number | null | undefined): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const suffix = diff >= 0 ? 'ago' : 'from now';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ${suffix}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ${suffix}`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ${suffix}`;
  return new Date(ts).toLocaleDateString();
}

export function fmtDate(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtPct(n: number): string {
  return `${Math.round(n * 100) / 100}%`.replace('.00%', '%');
}

/* ---------------- hash router ---------------- */

export function currentRoute(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h || '/dashboard';
}

export function navigate(path: string): void {
  window.location.hash = path;
}

export function parseRoute(route: string): { page: string; id: string | null } {
  const parts = route.split('/').filter(Boolean);
  return { page: parts[0] ?? 'dashboard', id: parts[1] ? decodeURIComponent(parts[1]) : null };
}

/** Subscribe to hash changes; returns the current route immediately. */
export function onRouteChange(cb: (route: string) => void): () => void {
  const handler = () => cb(currentRoute());
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}

/** Poll fn on an interval while mounted. */
export function poll<T>(fn: () => Promise<T>, ms: number, onError?: (e: unknown) => void): () => void {
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (!alive) return;
    try {
      await fn();
    } catch (e) {
      onError?.(e);
    }
    if (alive) timer = setTimeout(tick, ms);
  };
  void tick();
  return () => {
    alive = false;
    if (timer) clearTimeout(timer);
  };
}
