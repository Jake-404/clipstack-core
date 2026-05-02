"use client";

// Global keyboard listener — mounts once at the layout level and
// dispatches every keypress against a small state machine: chord prefix
// (`g`), single-key actions (`j` / `k` / `Enter` / `a`), modifier
// combos (Cmd/Ctrl+K), and meta keys (`?`, Escape).
//
// The component is invisible. It manages two pieces of UI state — the
// help dialog and the command palette — but exposes them via local
// useState rather than a context, since no other component needs to
// open them.
//
// Shortcuts are inert when the active element is editable (input /
// textarea / contenteditable) or while a modal is open. Modal detection
// is via a `[data-modal-open]` attribute the dialog components stamp
// onto themselves — KeyboardShortcuts queries the DOM rather than
// holding modal state itself, so any future modal that follows the
// same convention auto-cooperates.

import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { CommandPalette } from "./CommandPalette";
import { HelpDialog } from "./HelpDialog";

// 500ms chord window — tuned to the spec. Long enough that a deliberate
// `g` + `h` registers even with a slow second press; short enough that
// a `g` typed in error doesn't merge with an unrelated keypress 3
// seconds later.
const CHORD_WINDOW_MS = 500;

// Prefixes participate in chords. Today only `g` (for "go to ___");
// keeping it as an array makes adding `c` (create), `s` (search), etc.
// later a one-line change.
const CHORD_PREFIXES = new Set(["g"]);

interface ChordRoute {
  key: string;
  path: string;
}

const CHORD_ROUTES: Record<string, ChordRoute[]> = {
  g: [
    { key: "h", path: "/" },
    { key: "i", path: "/inbox" },
    { key: "a", path: "/activity" },
    { key: "p", path: "/performance" },
    { key: "e", path: "/experiments" },
  ],
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

function isModalOpen(): boolean {
  // Any element with [data-modal-open] is a live modal; the keyboard
  // listener stays out of its way except for Escape, which it broadcasts
  // as a custom event so each modal can decide for itself whether to close.
  return document.querySelector("[data-modal-open]") !== null;
}

// Find all rows that opted into J/K nav. Two flavours of selector:
// the row itself (`[data-keyboard-row]`) and the list scope
// (`[data-keyboard-list]` is informational; we just iterate every
// matching row in document order regardless of which list they sit
// in, which works for both single-list pages like /inbox and any
// future page that decorates a different element).
function getKeyboardRows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-keyboard-row]"),
  );
}

// Which row is "currently focused" for J/K nav. We treat the active
// element as the cursor when it's a keyboard row; otherwise default to
// "before the first row" (next J → row 0).
function findFocusedRowIndex(rows: HTMLElement[]): number {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return -1;
  return rows.indexOf(active);
}

// idempotency lock — guards against the listener double-mounting in
// React Strict Mode dev. Module-scoped: cleared in cleanup so a real
// remount works correctly; "double mount in same render" is what we
// guard against.
let listenerMounted = false;

export function KeyboardShortcuts() {
  const router = useRouter();
  // pathname read inside the handler closure via ref so we don't have
  // to remount the listener on every navigation.
  const pathname = usePathname();
  const pathnameRef = React.useRef(pathname);
  React.useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const [helpOpen, setHelpOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  // Chord state: which prefix is armed + a timestamp so we can let it
  // expire. Stored in a ref so the keydown handler doesn't have to
  // re-bind every time a chord arms.
  const chordRef = React.useRef<{ prefix: string; armedAt: number } | null>(
    null,
  );

  React.useEffect(() => {
    if (listenerMounted) return;
    listenerMounted = true;

    function onKeyDown(e: KeyboardEvent) {
      // Modifier-aware Cmd+K / Ctrl+K — handle before anything else
      // because the editable-target check below would let "Cmd+K from
      // an input" through, which we want to keep.
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        // No alt or shift in the canonical combo — keep "Shift+Cmd+K"
        // free for a future "open palette in different scope" mode.
        if (e.altKey || e.shiftKey) return;
        e.preventDefault();
        setPaletteOpen(true);
        chordRef.current = null;
        return;
      }

      // Escape: broadcast and let modals handle close. We always fire
      // this — modal detection wouldn't help here since the whole
      // point is to dismiss whatever modal is up.
      if (e.key === "Escape") {
        document.dispatchEvent(new CustomEvent("clipstack:escape"));
        // Don't preventDefault — the system Esc behavior (e.g.
        // canceling input composition) should still work.
        chordRef.current = null;
        return;
      }

      // Bail on editable targets + open modals for everything below.
      if (isEditableTarget(e.target)) return;
      if (isModalOpen()) return;

      // `?` — Shift+/ on US layout. Fires from any non-editable surface.
      // Use e.key === "?" so it works regardless of how the OS maps
      // the modifier; some IMEs send a different code.
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
        chordRef.current = null;
        return;
      }

      // From here down, every shortcut requires "no modifiers" — Shift+J,
      // Cmd+J, Alt+J, Ctrl+J should all NOT fire J nav. (Shift is the
      // sneaky one — it produces "J" rather than "j" on the key value,
      // but the modifier flag is what we actually filter on.)
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
        chordRef.current = null;
        return;
      }

      const key = e.key;
      const now = Date.now();

      // Chord resolution: if a prefix is armed and within the window,
      // try to match the second key; clear chord regardless of result.
      const chord = chordRef.current;
      if (chord && now - chord.armedAt <= CHORD_WINDOW_MS) {
        const routes = CHORD_ROUTES[chord.prefix] ?? [];
        const match = routes.find((r) => r.key === key);
        chordRef.current = null;
        if (match) {
          e.preventDefault();
          router.push(match.path);
          return;
        }
        // No match — fall through to single-key handling so a missed
        // chord still respects single-key shortcuts (e.g. `g x` →
        // chord miss → `x` doesn't accidentally trigger anything).
      } else if (chord) {
        // Window expired; clear and treat this keypress fresh.
        chordRef.current = null;
      }

      // Arm a new chord prefix.
      if (CHORD_PREFIXES.has(key)) {
        chordRef.current = { prefix: key, armedAt: now };
        return;
      }

      // List nav — only on pages that have a [data-keyboard-list]
      // marker. Iterate rows in document order regardless of list
      // grouping (channels on /inbox split rows across <ul> blocks).
      const hasList = document.querySelector("[data-keyboard-list]") !== null;
      if (!hasList) return;

      if (key === "j" || key === "k" || key === "Enter" || key === "a") {
        const rows = getKeyboardRows();
        if (rows.length === 0) return;
        const focusedIdx = findFocusedRowIndex(rows);

        if (key === "j") {
          e.preventDefault();
          const next = focusedIdx < 0 ? 0 : Math.min(rows.length - 1, focusedIdx + 1);
          rows[next]?.focus();
          // Keep the focused row visible — block:nearest matches what
          // mail clients do: scroll only when needed, never jolt.
          rows[next]?.scrollIntoView({ block: "nearest" });
          return;
        }
        if (key === "k") {
          e.preventDefault();
          const prev = focusedIdx <= 0 ? 0 : focusedIdx - 1;
          rows[prev]?.focus();
          rows[prev]?.scrollIntoView({ block: "nearest" });
          return;
        }
        if (key === "Enter") {
          if (focusedIdx >= 0) {
            e.preventDefault();
            rows[focusedIdx]?.click();
          }
          return;
        }
        if (key === "a") {
          // `a` (without modifiers) navigates to the focused draft
          // with an `action=approve` query flag. The draft detail page
          // doesn't read this flag yet (its own slice); for now we
          // route to the draft page so muscle memory builds.
          if (focusedIdx >= 0) {
            const row = rows[focusedIdx];
            const href = row?.getAttribute("href");
            if (href) {
              e.preventDefault();
              const sep = href.includes("?") ? "&" : "?";
              router.push(`${href}${sep}action=approve`);
            }
          }
          return;
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      listenerMounted = false;
    };
  }, [router]);

  // Render only the controlled modals — the listener itself emits no
  // DOM. Both dialogs early-return null when closed so they're zero-cost
  // when not open.
  return (
    <>
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </>
  );
}
