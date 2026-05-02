"use client";

// Command palette — stub. Cmd+K opens this; the body is a placeholder
// until the real fuzzy-search-over-routes-and-actions implementation
// lands. The point of shipping the stub now is so the keybind exists
// and the dialog accessibility patterns are baked in — adding the
// search index later is purely a body-of-the-modal change.
//
// Mirrors HelpDialog's accessibility scaffolding: backdrop click, Esc,
// focus restore, focus trap, aria-modal.

import * as React from "react";

import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current =
      (document.activeElement as HTMLElement | null) ?? null;
    requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab") {
        const root = dialogRef.current;
        if (!root) return;
        const focusables = root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    function onClipstackEscape() {
      onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("clipstack:escape", onClipstackEscape);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener(
        "clipstack:escape",
        onClipstackEscape,
      );
      previouslyFocusedRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-modal-open
      role="dialog"
      aria-modal="true"
      aria-labelledby="command-palette-title"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm pt-24"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={cn(
          "w-full max-w-xl mx-4 rounded-lg border border-border-default bg-bg-surface outline-none",
          "animate-in fade-in zoom-in-95 duration-200",
        )}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
          {/* Search-glyph as inline svg — same icon-pkg-free idiom as toast.tsx. */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden
            className="text-text-tertiary"
          >
            <circle cx="6" cy="6" r="4.25" stroke="currentColor" strokeWidth="1.25" />
            <path
              d="M9.5 9.5 L12.5 12.5"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
            />
          </svg>
          <h2
            id="command-palette-title"
            className="text-sm text-text-primary"
          >
            Command palette
          </h2>
          <span className="ml-auto text-xs text-text-tertiary font-mono tabular-nums">
            esc
          </span>
        </div>
        <div className="p-6 text-center">
          <div className="text-sm text-text-secondary mb-1">
            Coming next.
          </div>
          <div className="text-xs text-text-tertiary leading-relaxed max-w-sm mx-auto">
            Fuzzy search across drafts, agents, lessons, and actions
            lands in a follow-up slice. The keybind is wired so muscle
            memory builds today.
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-5 px-3 py-1.5 rounded border border-border-default text-xs text-text-secondary hover:bg-bg-elevated transition-colors duration-fast"
          >
            close
          </button>
        </div>
      </div>
    </div>
  );
}
