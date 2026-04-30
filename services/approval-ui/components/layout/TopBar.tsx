// Doc 8 §9.1 — top bar. h-14, border-b border-subtle, holds breadcrumb + global actions.
"use client";
import { Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TopBar({ title }: { title: string }) {
  return (
    <header className="flex h-14 items-center gap-4 border-b border-border-subtle bg-bg-base px-6">
      <h1 className="text-md font-semibold text-text-primary truncate">{title}</h1>
      <span className="ml-2 text-xs uppercase tracking-wider text-text-tertiary">
        live
      </span>

      <div className="ml-auto flex items-center gap-2">
        {/* ⌘K command palette trigger — Doc 7 §2.4 + Doc 8 §8.7. */}
        <Button variant="secondary" size="sm" className="gap-2 text-text-secondary">
          <Search className="h-4 w-4" />
          <span>Search</span>
          <kbd className="ml-2 inline-flex h-5 items-center rounded-sm border border-border-default bg-bg-surface px-1 font-mono text-xs text-text-tertiary">
            ⌘K
          </kbd>
        </Button>

        {/* ⌘J CEO chat dock — Doc 7 §2.4 + Doc 8 §8.8. */}
        <Button variant="icon" size="iconOnly" title="CEO chat (⌘J)">
          <Sparkles className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
