"use client";

// Toast / notification primitive — Doc 8 §11.x ephemeral feedback layer.
//
// Lives one level up the tree (in app/layout.tsx via <ToastProvider>) so
// every page + every nested client component can fire a toast through
// useToast() without prop-drilling. The provider holds an array of
// active toasts in state; the viewport renders them bottom-right with
// a translate-x slide-in.
//
// Why hand-rolled (no react-toastify / radix toast): the surface area is
// small, the visual language is opinionated (Doc 8 status tones, no
// shadow, charcoal palette), and a third-party would either fight the
// tokens or balloon the bundle. The whole file is ~150 LOC of standard
// React + Tailwind — we own it.

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export type ToastKind = "success" | "info" | "warning" | "danger";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  // Per-toast lifetime; falls back to DEFAULT_DURATION_MS in the provider
  // so the kind→duration coupling can be revisited centrally later.
  durationMs?: number;
}

export interface ToastContextValue {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 4000;

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error(
      "useToast() must be used inside a <ToastProvider>. Mount it in app/layout.tsx.",
    );
  }
  return ctx;
}

interface ToastProviderProps {
  children: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  // Track timeouts per id so dismiss() (manual or auto) can cancel
  // pending firings — otherwise a fast user dismiss + a slow timeout
  // would call setState on an unmounted toast.
  const timeoutsRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const dismiss = React.useCallback((id: string) => {
    const t = timeoutsRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timeoutsRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const push = React.useCallback(
    (toast: Omit<Toast, "id">): string => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const next: Toast = { ...toast, id };
      setToasts((prev) => [...prev, next]);
      const duration = toast.durationMs ?? DEFAULT_DURATION_MS;
      if (duration > 0) {
        const timeoutId = setTimeout(() => {
          dismiss(id);
        }, duration);
        timeoutsRef.current.set(id, timeoutId);
      }
      return id;
    },
    [dismiss],
  );

  // Cleanup all pending timeouts on unmount — provider lives at the app
  // root so this is essentially "browser closed", but the hygienic
  // discipline keeps fast-refresh + future remounts safe.
  React.useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      for (const t of timeouts.values()) clearTimeout(t);
      timeouts.clear();
    };
  }, []);

  const value = React.useMemo<ToastContextValue>(
    () => ({ toasts, push, dismiss }),
    [toasts, push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// Tone styling — mirrors badge.tsx variants but with full opacity bg
// + thin tinted border for a denser, alarm-ish read at small size.
// Default tone falls back to bg-elevated (the "neutral notification"
// case, e.g. an info toast that doesn't justify a colored band).
const toastVariants = cva(
  "pointer-events-auto flex items-start gap-3 rounded-md border px-4 py-3 shadow-sm backdrop-blur-sm transition-all duration-200 ease-out min-w-[280px] max-w-[420px] data-[state=closed]:translate-x-full data-[state=closed]:opacity-0 data-[state=open]:translate-x-0 data-[state=open]:opacity-100",
  {
    variants: {
      kind: {
        success:
          "bg-bg-elevated border-status-success/40 text-text-primary",
        info: "bg-bg-elevated border-status-info/40 text-text-primary",
        warning:
          "bg-bg-elevated border-status-warning/40 text-text-primary",
        danger:
          "bg-bg-elevated border-status-danger/40 text-text-primary",
      },
    },
    defaultVariants: { kind: "info" },
  },
);

// Title-tone: only the title gets the status color; body copy stays in
// text-primary for legibility (Doc 8 hard rule — no colored body text).
const titleVariants = cva("text-sm font-semibold leading-tight", {
  variants: {
    kind: {
      success: "text-status-success",
      info: "text-status-info",
      warning: "text-status-warning",
      danger: "text-status-danger",
    },
  },
  defaultVariants: { kind: "info" },
});

interface ToastViewportProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  // Fixed bottom-right rail — single column, gap-2 between toasts. Pointer
  // events on container are off so it doesn't block clicks behind empty
  // strips; each toast itself re-enables pointer-events.
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

type ToastVariantProps = VariantProps<typeof toastVariants>;

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  // Two-frame mount → translate-x-full → translate-x-0 transition. We
  // start at "closed" then flip to "open" after the first paint so the
  // browser interpolates the property change instead of teleporting to
  // the open state.
  const [state, setState] = React.useState<"open" | "closed">("closed");

  React.useEffect(() => {
    const id = requestAnimationFrame(() => setState("open"));
    return () => cancelAnimationFrame(id);
  }, []);

  // Variant derived from toast.kind — narrowed to the union the cva
  // variant accepts so TS won't widen to string.
  const variantKind: ToastVariantProps["kind"] = toast.kind;

  return (
    <div
      data-state={state}
      role={toast.kind === "danger" ? "alert" : "status"}
      className={cn(toastVariants({ kind: variantKind }))}
    >
      <div className="flex-1 min-w-0">
        <div className={cn(titleVariants({ kind: variantKind }))}>
          {toast.title}
        </div>
        {toast.description ? (
          <div className="mt-1 text-xs text-text-secondary leading-relaxed">
            {toast.description}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 -mr-1 -mt-0.5 p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-base transition-colors duration-fast focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
      >
        {/* Inline X — keeps the toast component free of icon-pkg deps. */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
          <path
            d="M3 3 L11 11 M11 3 L3 11"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
