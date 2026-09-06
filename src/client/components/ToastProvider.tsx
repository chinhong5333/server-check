import { AlertCircle, CheckCircle2, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode
} from "react";

type ToastTone = "success" | "error";

interface ToastInput {
  tone: ToastTone;
  message: string;
}

interface ToastMessage extends ToastInput {
  id: number;
}

interface ToastContextValue {
  showToast: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const nextIdRef = useRef(1);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [paused, setPaused] = useState(false);

  const showToast = useCallback((input: ToastInput) => {
    setPaused(false);
    setToast({ ...input, id: nextIdRef.current++ });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast || paused) return;
    const timeout = window.setTimeout(dismissToast, 5000);
    return () => window.clearTimeout(timeout);
  }, [dismissToast, paused, toast]);

  const value = useMemo(() => ({ showToast }), [showToast]);
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="region" aria-label="Notifications">
        {toast ? (
          <div
            key={toast.id}
            className={`toast toast--${toast.tone}`}
            role={toast.tone === "error" ? "alert" : "status"}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocusCapture={() => setPaused(true)}
            onBlurCapture={handleBlur}
          >
            {toast.tone === "success" ? (
              <CheckCircle2 className="toast__status-icon" aria-hidden="true" />
            ) : (
              <AlertCircle className="toast__status-icon" aria-hidden="true" />
            )}
            <p>{toast.message}</p>
            <button
              className="icon-button toast__close"
              type="button"
              aria-label="Dismiss Notification"
              onClick={dismissToast}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used within ToastProvider.");
  return value;
}
