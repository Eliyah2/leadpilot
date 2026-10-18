import { useEffect, type ReactNode } from 'react';

/** Status badge colours for video/QC/job states. */
export function StatusBadge({ status }: { status: string | null | undefined }) {
  const map: Record<string, string> = {
    draft: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
    review: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
    approved: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
    scheduled: 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
    published: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
    analyzing: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300',
    passed: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
    needs_review: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
    failed: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
    done: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
    rendering: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
    pending: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
    running: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
    queued: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
    queued2: '',
    canceled: 'bg-slate-500/15 text-slate-500',
    active: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
    paused: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
    ended: 'bg-slate-500/15 text-slate-500',
    available: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
    used: 'bg-slate-500/15 text-slate-500',
    retired: 'bg-rose-500/15 text-rose-500',
  };
  const label = (status ?? 'unknown').replace(/_/g, ' ');
  return <span className={`badge ${map[status ?? ''] ?? 'bg-slate-500/15 text-slate-500'}`}>{label}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
      {label}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card grid place-items-center gap-2 p-10 text-center">
      <div className="text-3xl opacity-40">◇</div>
      <div className="font-semibold">{title}</div>
      {hint && <div className="max-w-md text-sm text-slate-500 dark:text-slate-400">{hint}</div>}
      {action}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
      {message}
    </div>
  );
}

/** Simple inline toast stack (top-right). */
export type Toast = { id: number; kind: 'ok' | 'err'; text: string };

export function ToastStack({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed right-4 top-16 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`animate-fade rounded-lg border px-3 py-2 text-sm shadow-lg ${
            t.kind === 'ok'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200'
              : 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/70 dark:text-rose-200'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={`card relative z-10 max-h-[85vh] w-full overflow-y-auto p-5 ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">{title}</h3>
          <button className="btn-ghost !px-2" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Section wrapper with heading. */
export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-4 md:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Stat tile for the dashboard. */
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
