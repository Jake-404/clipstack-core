// /experiments loading skeleton. Mirrors app/experiments/page.tsx
// list-style: breadcrumb + h1 + supporting copy + 8 row skeletons
// grouped by 2 fake platform sections (matches the real page's
// platform-grouped reduce → newest-first within group).

import { AppShell } from "@/components/layout/AppShell";
import { Skeleton } from "@/components/ui/skeleton";

const PLATFORM_GROUPS = 2;
const ROWS_PER_GROUP = 4;

export default function Loading() {
  return (
    <AppShell title="experiments">
      <div className="p-6 max-w-5xl mx-auto">
        <Skeleton className="h-4 w-36 mb-4" />

        <div className="mb-6">
          <Skeleton className="h-7 w-44 mb-2" />
          <Skeleton className="h-4 w-full max-w-2xl mb-1" />
          <Skeleton className="h-4 w-3/4 max-w-xl" />
        </div>

        <div className="space-y-6">
          {Array.from({ length: PLATFORM_GROUPS }).map((_, gi) => (
            <section key={gi}>
              <div className="flex items-baseline gap-2 mb-2 pb-1 border-b border-border-subtle">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-16 font-mono tabular-nums" />
              </div>
              <ul className="divide-y divide-border-subtle">
                {Array.from({ length: ROWS_PER_GROUP }).map((_, ri) => (
                  <li key={ri}>
                    <div className="flex items-baseline gap-3 py-3 -mx-2 px-2">
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        <Skeleton className="h-4 w-2/3 max-w-md" />
                        <Skeleton className="h-3 w-56 mt-1 font-mono tabular-nums" />
                      </div>
                      {/* leader posterior mean ×100 — fixed-width
                          tabular column on the right */}
                      <Skeleton className="h-4 w-12 shrink-0 font-mono tabular-nums" />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-8 flex items-center gap-4 text-xs text-text-tertiary">
          <Skeleton className="h-3 w-20 font-mono tabular-nums" />
          <span>·</span>
          <Skeleton className="h-3 w-48" />
          <Skeleton className="ml-auto h-3 w-32" />
        </div>
      </div>
    </AppShell>
  );
}
