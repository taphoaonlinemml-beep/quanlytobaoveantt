import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type ToastVariant = 'success' | 'warning' | 'info' | 'error';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
}

interface ToastContextValue {
  showToast: (toast: Omit<ToastItem, 'id'>, durationMs?: number) => string;
  dismissToast: (id: string) => void;
  success: (title: string, description?: string, durationMs?: number) => string;
  warning: (title: string, description?: string, durationMs?: number) => string;
  info: (title: string, description?: string, durationMs?: number) => string;
  error: (title: string, description?: string, durationMs?: number) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const existingTimer = timersRef.current.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (toast: Omit<ToastItem, 'id'>, durationMs = 7000) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev.slice(-4), { ...toast, id }]);
      if (durationMs > 0) {
        const timer = setTimeout(() => {
          dismissToast(id);
        }, durationMs);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [dismissToast]
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const success = useCallback(
    (title: string, description?: string, durationMs?: number) =>
      showToast({ variant: 'success', title, description }, durationMs),
    [showToast]
  );

  const warning = useCallback(
    (title: string, description?: string, durationMs?: number) =>
      showToast({ variant: 'warning', title, description }, durationMs),
    [showToast]
  );

  const info = useCallback(
    (title: string, description?: string, durationMs?: number) =>
      showToast({ variant: 'info', title, description }, durationMs),
    [showToast]
  );

  const error = useCallback(
    (title: string, description?: string, durationMs?: number) =>
      showToast({ variant: 'error', title, description }, durationMs),
    [showToast]
  );

  return (
    <ToastContext.Provider
      value={{ showToast, dismissToast, success, warning, info, error }}
    >
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

const VARIANT_STYLES: Record<
  ToastVariant,
  { container: string; iconWrap: string; title: string; label: string }
> = {
  success: {
    container: 'border-emerald-200 bg-white text-slate-900',
    iconWrap: 'bg-emerald-50 text-emerald-700',
    title: 'text-emerald-950',
    label: 'Hoàn tất',
  },
  warning: {
    container: 'border-amber-200 bg-white text-slate-900',
    iconWrap: 'bg-amber-50 text-amber-700',
    title: 'text-amber-950',
    label: 'Cảnh báo',
  },
  info: {
    container: 'border-slate-200 bg-white text-slate-900',
    iconWrap: 'bg-slate-100 text-slate-700',
    title: 'text-slate-900',
    label: 'Thông báo',
  },
  error: {
    container: 'border-red-200 bg-white text-slate-900',
    iconWrap: 'bg-red-50 text-red-700',
    title: 'text-red-950',
    label: 'Lỗi',
  },
};

function ToastIcon({ variant }: { variant: ToastVariant }) {
  if (variant === 'success') return <CheckCircle2 className="h-4 w-4 shrink-0" />;
  if (variant === 'warning') return <AlertTriangle className="h-4 w-4 shrink-0" />;
  if (variant === 'error') return <XCircle className="h-4 w-4 shrink-0" />;
  return <Info className="h-4 w-4 shrink-0" />;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Thông báo hệ thống"
      className="no-print pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[calc(100%-2.5rem)] max-w-md flex-col gap-2.5"
    >
      {toasts.map((toast) => {
        const style = VARIANT_STYLES[toast.variant];
        return (
          <div
            key={toast.id}
            role={toast.variant === 'error' || toast.variant === 'warning' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border p-4 shadow-lg transition-all duration-200 ${style.container}`}
          >
            <div
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${style.iconWrap}`}
            >
              <ToastIcon variant={toast.variant} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className={`text-sm font-bold leading-snug ${style.title}`}>
                  {toast.title}
                </p>
              </div>
              {toast.description && (
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  {toast.description}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Đóng thông báo"
              className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
