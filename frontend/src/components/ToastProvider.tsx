import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { IconInfoCircle, IconX } from '@tabler/icons-react';

const DURATION_MS = 3000;
const ToastContext = createContext<((message: string) => void) | null>(null);

export function useToast() {
  const showToast = useContext(ToastContext);
  if (!showToast) throw new Error('ToastProvider is missing');
  return showToast;
}

export default function ToastProvider({ children }: { children: ReactNode }) {
  const nextId = useRef(0);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const showToast = useCallback((message: string) => {
    setToast({ id: ++nextId.current, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast(current => current?.id === toast.id ? null : current);
    }, DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {toast && (
        <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex justify-end sm:bottom-6 sm:right-6">
          <div key={toast.id} role="status" className="pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-xl border border-atlas-mist bg-white shadow-xl">
            <div className="flex items-start gap-3 p-4 pb-5">
              <IconInfoCircle size={22} stroke={1.8} aria-hidden="true" className="shrink-0 text-atlas-red" />
              <p className="min-w-0 flex-1 text-sm leading-5 text-atlas-ink">{toast.message}</p>
              <button type="button" onClick={() => setToast(null)} aria-label="Cerrar notificación" className="shrink-0 rounded p-0.5 text-atlas-muted hover:text-atlas-ink">
                <IconX size={18} stroke={1.8} aria-hidden="true" />
              </button>
            </div>
            <div className="absolute inset-x-0 bottom-0 h-1 bg-atlas-mist">
              <div className="toast-progress h-full bg-atlas-red" />
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
