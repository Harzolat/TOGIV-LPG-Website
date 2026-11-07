import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Toast — minimal context-based notifications. Auto-dismiss with pause on
 * hover/focus; viewport is an aria-live region for screen readers.
 */
export type ToastTone = "info" | "success" | "warning" | "error";

export interface ToastInput {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
  tone: ToastTone;
}

interface ToastApi {
  toast: (t: ToastInput) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const toast = useCallback(
    (t: ToastInput) => {
      const id = nextId.current++;
      const item: ToastItem = { ...t, id, tone: t.tone ?? "info" };
      setItems((prev) => [...prev.slice(-4), item]); // max 5 visible
      const duration = t.durationMs ?? (t.tone === "error" ? 7000 : 4500);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
    },
    [dismiss],
  );

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="t-toast-viewport" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`t-toast t-toast--${i.tone}`}>
            <span>{i.message}</span>
            <button
              type="button"
              className="t-icon-btn"
              aria-label="Dismiss notification"
              onClick={() => dismiss(i.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
