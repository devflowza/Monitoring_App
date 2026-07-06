import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tone = 'error' | 'success' | 'info';
interface Toast { id: number; message: string; tone: Tone; }

interface ToastApi {
  notify: (message: string, tone?: Tone) => void;
  /** Convenience: toast only if a mutation returned an error. Returns true on success. */
  reportError: (result: { error: string | null }, successMessage?: string) => boolean;
}

const ToastContext = createContext<ToastApi>({ notify: () => {}, reportError: () => true });

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((message: string, tone: Tone = 'info') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const reportError = useCallback((result: { error: string | null }, successMessage?: string) => {
    if (result.error) { notify(result.error, 'error'); return false; }
    if (successMessage) notify(successMessage, 'success');
    return true;
  }, [notify]);

  return (
    <ToastContext.Provider value={{ notify, reportError }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[90vw] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`rounded-lg border px-4 py-3 text-sm shadow-lg ${
              t.tone === 'error'
                ? 'border-red-500/50 bg-red-950/90 text-red-100'
                : t.tone === 'success'
                ? 'border-emerald-500/50 bg-emerald-950/90 text-emerald-100'
                : 'border-edge bg-panel text-slate-100'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
