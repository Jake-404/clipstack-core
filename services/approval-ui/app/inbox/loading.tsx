// /inbox loading skeleton — list-style. Mirrors app/inbox/page.tsx:
// breadcrumb + h1 + supporting copy + 6 row skeletons (AgentMark
// circle + title bar + age bar + percentile pill). The list reads as
// the eventual approval queue without committing to a specific draft
// count — 6 rows matches the typical "above the fold" density.

import { AppShell } from "@/components/layout/AppShell";
import { Skeleton } from "@/components/ui/skeleton";

const ROW_COUNT = 6;

export default function Loading() {
  return (
    <AppShell title="inbox">
      <div className="p-6 max-w-5xl mx-auto">
        {/* Breadcrumb back to mission control — fixed string + arrow,
            no skeleton needed since it doesn't depend on data. */}
        <Skeleton className="h-4 w-36 mb-4" />

        <div className="mb-6">
          <Skeleton className="h-7 w-32 mb-2" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>

        <section>
          {/* Channel section header */}
          <div className="flex items-baseline gap-2 mb-2 pb-1 border-b border-border-subtle">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-6 font-mono tabular-nums" />
          </div>
          <ul className="divide-y divide-border-subtle">
            {Array.from({ length: ROW_COUNT }).map((_, i) => (
              <li
                key={i}
                className="flex items-center gap-3 py-3 -mx-2 px-2"
              >
                {/* AgentMark placeholder — circular */}
                <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-3/4 max-w-md mb-1.5" />
                  <Skeleton className="h-3 w-48 font-mono tabular-nums" />
                </div>
                {/* percentile pill — mono tabular-nums width */}
                <Skeleton className="h-5 w-12 shrink-0 font-mono tabular-nums" />
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-8 flex items-center gap-4 text-xs text-text-tertiary">
          <Skeleton className="h-3 w-20 font-mono tabular-nums" />
          <span>·</span>
          <Skeleton className="h-3 w-32" />
          <Skeleton className="ml-auto h-3 w-32" />
        </div>
      </div>
    </AppShell>
  );
}
