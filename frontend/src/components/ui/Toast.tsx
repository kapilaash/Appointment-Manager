import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, X } from 'lucide-react';

type ToastTone = 'success' | 'info';
type Toast = { id: number; message: string; tone: ToastTone };
type ToastApi = { notify: (message: string, tone?: ToastTone) => void };

const ToastContext = createContext<ToastApi | null>(null);
const VISIBLE_MS = 5000;
const MAX_TOASTS = 3;

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(VISIBLE_MS);
  const startedAt = useRef(0);

  // Count down only while the toast is not hovered/focused, so people have time to read it.
  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, onDismiss, toast.id]);

  const Icon = toast.tone === 'success' ? CheckCircle2 : Info;
  return (
    <div
      className="toast-enter pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-slate-200 bg-surface p-3.5 text-sm text-slate-800 shadow-lifted"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon
        size={18}
        aria-hidden="true"
        className={toast.tone === 'success' ? 'mt-0.5 shrink-0 text-emerald-600' : 'mt-0.5 shrink-0 text-indigo-600'}
      />
      <p className="flex-1 leading-5">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="-m-1 grid h-8 min-h-0 w-8 min-w-0 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Small, accessible confirmations ("Request sent", "Approved") that do not interrupt work. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const notify = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, message, tone }].slice(-MAX_TOASTS));
  }, []);
  const api = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] mx-auto flex max-w-sm flex-col gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:mx-0 sm:w-96"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- the hook is the public API of ToastProvider.
export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
