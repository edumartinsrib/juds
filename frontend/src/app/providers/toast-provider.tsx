import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/button";

type ToastTone = "success" | "error" | "info";

type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
};

type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<{ notify: (toast: ToastInput) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-3), { ...toast, id }]);
      const timer = window.setTimeout(() => dismiss(id), 5_000);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className={cn(
          "pointer-events-none fixed bottom-4 right-4 z-50 v-stack w-[min(24rem,calc(100vw-2rem))] gap-2",
        )}
        role="region"
        aria-live="polite"
        aria-label="Notificações"
      >
        {toasts.map((toast) => {
          const Icon =
            toast.tone === "success" ? CheckCircle2 : toast.tone === "error" ? TriangleAlert : Info;
          return (
            <div
              key={toast.id}
              className={cn("ui-toast pointer-events-auto", {
                "border-success/40": toast.tone === "success",
                "border-danger/40": toast.tone === "error",
              })}
              role={toast.tone === "error" ? "alert" : "status"}
            >
              <Icon
                className={cn("mt-0.5 shrink-0", {
                  "text-success": toast.tone === "success",
                  "text-danger": toast.tone === "error",
                  "text-brand": !toast.tone || toast.tone === "info",
                })}
                size={19}
                aria-hidden="true"
              />
              <div className={cn("v-stack min-w-0 grow gap-1")}>
                <strong className={cn("text-sm")}>{toast.title}</strong>
                {toast.description ? (
                  <span className={cn("text-sm leading-5 text-muted")}>{toast.description}</span>
                ) : null}
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Dispensar notificação"
                onClick={() => dismiss(toast.id)}
              >
                <X size={16} aria-hidden="true" />
              </Button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast deve ser usado dentro de ToastProvider");
  }
  return context;
}
