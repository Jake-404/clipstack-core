"use client";

// Help dialog — surfaces the full keyboard shortcut catalog when the
// user presses `?`. Modal pattern: backdrop + centered card; closes on
// Escape, on backdrop click, on the X button. Focus is trapped while
// open and restored to the previously-focused element on close.
//
// All copy lives here so KeyboardShortcuts.tsx stays a pure listener.

import * as React from "react";

import { cn } from "@/lib/utils";

interface ShortcutEntry {
  keys: string[];
  label: string;
}

interface ShortcutSection {
  title: string;
  entries: ShortcutEntry[];
}

const SECTIONS: ShortcutSection[] = [
  {
    title: "Navigation",
    entries: [
      { keys: ["g", "h"], label: "Go to Mission Control" },
      { keys: ["g", "i"], label: "Go to inbox" },
      { keys: ["g", "a"], label: "Go to activity" },
      { keys: ["g", "p"], label: "Go to performance" },
      { keys: ["g", "e"], label: "Go to experiments" },
    ],
  },
  {
    title: "Inbox",
    entries: [
      { keys: ["j"], label: "Next row" },
      { keys: ["k"], label: "Previous row" },
      { keys: ["Enter"], label: "Open focused row" },
      { keys: ["a"], label: "Approve focused draft" },
    ],
  },
  {
    title: "General",
    entries: [
      { keys: ["⌘", "K"], label: "Open command palette" },
      { keys: ["?"], label: "Show this help" },
      { keys: ["Esc"], label: "Close dialogs" },
    ],
  },
];

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  // Track the element that opened the dialog so we can restore focus
  // when it closes — matches WAI-ARIA modal pattern.
  const previouslyFocusedRef = React.useRef<HTMLElement | null>(null);

  // Close-on-Escape + close-on-backdrop are the same callback so the
  // outer keyboard listener can ignore Escape entirely while a modal
  // is open (it dispatches `clipstack:escape` which we listen for).
  React.useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current =
      (document.activeElement as HTMLElement | null) ?? null;
    // Focus the dialog body so Esc / Tab work without a click.
    requestAnimationFrame(() => {
      dialogRef.current?.focus();
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      // Lightweight focus trap — Tab + Shift+Tab cycle within the
      // dialog. Full trap (querying every focusable child) is overkill
      // for a modal with one button; we just keep focus inside the
      // outer container.
      if (e.key === "Tab") {
        const root = dialogRef.current;
        if (!root) return;
        const focusables = root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
      // Restore focus on close so the user lands back where they were.
      previouslyFocusedRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      // data-modal-open is the breadcrumb KeyboardShortcuts checks to
      // suppress non-Escape shortcuts while a modal owns the screen.
      data-modal-open
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={cn(
          "w-full max-w-md mx-4 rounded-lg border border-border-default bg-bg-surface p-6 outline-none",
          // Subtle entrance — opacity + scale. Reduced-motion users get
          // the @media reduce override from globals.css.
          "animate-in fade-in zoom-in-95 duration-200",
        )}
      >
        <div className="flex items-baseline justify-between mb-4">
          <h2
            id="help-dialog-title"
            className="text-base font-semibold text-text-primary"
          >
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help"
            className="text-text-tertiary hover:text-text-primary text-xs transition-colors duration-fast"
          >
            esc
          </button>
        </div>

        <div className="space-y-5">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h3 className="text-xs uppercase tracking-wider text-text-secondary mb-2">
                {section.title}
              </h3>
              <ul className="space-y-1.5">
                {section.entries.map((entry) => (
                  <li
                    key={entry.label}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-text-primary">{entry.label}</span>
                    <span className="flex items-center gap-1">
                      {entry.keys.map((k, i) => (
                        <React.Fragment key={`${entry.label}-${i}`}>
                          {i > 0 ? (
                            <span className="text-text-tertiary text-xs">
                              then
                            </span>
                          ) : null}
                          <kbd className="font-mono text-xs px-1.5 py-0.5 rounded border border-border-default bg-bg-elevated text-text-secondary tabular-nums">
                            {k}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-5 pt-4 border-t border-border-subtle text-xs text-text-tertiary leading-relaxed">
          Shortcuts are inert while typing in inputs / textareas. Press{" "}
          <kbd className="font-mono px-1 py-0.5 rounded border border-border-default bg-bg-elevated">
            ?
          </kbd>{" "}
          anywhere to reopen this list.
        </div>
      </div>
    </div>
  );
}
