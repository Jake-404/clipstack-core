// Doc 8 §9.1 — top bar. h-14, border-b border-subtle, holds breadcrumb + global actions.
//
// On mobile (<md) the bar carries a hamburger button as its leading control
// so the user can summon the sidebar drawer; the button is hidden on md+
// where the sidebar is always visible.
"use client";
import { Menu, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TopBarProps {
  title: string;
  // Mobile-only: AppShell threads its drawer toggle in. The hamburger
  // button calls this handler; on md+ the button is hidden so the prop
  // is unused.
  onMobileMenuOpen?: () => void;
}

export function TopBar({ title, onMobileMenuOpen }: TopBarProps) {
  return (
    <header className="flex h-14 items-center gap-3 border-b border-border-subtle bg-bg-base px-4 sm:px-6">
      {/* Hamburger — mobile only. Hidden on md+ via the responsive class. */}
      <button
        type="button"
        onClick={onMobileMenuOpen}
        aria-label="Open navigation menu"
        className="md:hidden p-1.5 -ml-1 rounded text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors duration-fast focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>

      <h1 className="text-md font-semibold text-text-primary truncate min-w-0">
        {title}
      </h1>
      <span className="hidden sm:inline ml-1 text-xs uppercase tracking-wider text-text-tertiary">
        live
      </span>

      <div className="ml-auto flex items-center gap-2">
        {/* ⌘K command palette trigger — Doc 7 §2.4 + Doc 8 §8.7.
            On the smallest viewports the label collapses to icon-only
            via responsive classes; the kbd hint stays md+ only. */}
        <Button
          variant="secondary"
          size="sm"
          className="gap-2 text-text-secondary"
          aria-label="Open search"
        >
          <Search className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Search</span>
          <kbd className="hidden md:inline-flex ml-2 h-5 items-center rounded-sm border border-border-default bg-bg-surface px-1 font-mono text-xs text-text-tertiary">
            ⌘K
          </kbd>
        </Button>

        {/* ⌘J CEO chat dock — Doc 7 §2.4 + Doc 8 §8.8. */}
        <Button
          variant="icon"
          size="iconOnly"
          title="CEO chat (⌘J)"
          aria-label="Open CEO chat"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </header>
  );
}
