// /activity loading skeleton — timeline. Mirrors app/activity/page.tsx:
// breadcrumb + h1 + supporting copy + 3 date-group sections, each with
// 4 row skeletons (HH:MM mono · actor-kind badge · actor name · kind
// badge · details).

import { AppShell } from "@/components/layout/AppShell";
import { Skeleton } from "@/components/ui/skeleton";

const DATE_GROUP_COUNT = 3;
const ROWS_PER_GROUP = 4;

export default function Loading() {
  return (
    <AppShell title="activity">
      <div className="p-6 max-w-5xl mx-auto">
        <Skeleton className="h-4 w-36 mb-4" />

        <div className="mb-6">
          <Skeleton className="h-7 w-28 mb-2" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>

        <div className="space-y-6">
          {Array.from({ length: DATE_GROUP_COUNT }).map((_, gi) => (
            <section key={gi}>
              <div className="flex items-baseline gap-2 mb-2 pb-1 border-b border-border-subtle">
                {/* date key (YYYY-MM-DD) — mono tabular-nums */}
                <Skeleton className="h-3 w-24 font-mono tabular-nums" />
                <Skeleton className="h-3 w-16 font-mono tabular-nums" />
              </div>
              <ul className="divide-y divide-border-subtle">
                {Array.from({ length: ROWS_PER_GROUP }).map((_, ri) => (
                  <li
                    key={ri}
                    className="flex items-start gap-3 py-3"
                  >
                    {/* HH:MM — fixed width, tabular */}
                    <Skeleton className="h-4 w-12 shrink-0 mt-0.5 font-mono tabular-nums" />
                    {/* actor kind badge */}
                    <Skeleton className="h-5 w-14 shrink-0" />
                    {/* actor display name */}
                    <Skeleton className="h-4 w-32 shrink-0" />
                    {/* event kind badge */}
                    <Skeleton className="h-5 w-32 shrink-0" />
                    {/* details */}
                    <Skeleton className="h-3 flex-1 min-w-0 mt-1 font-mono" />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-8 flex items-center gap-4 text-xs text-text-tertiary">
          <Skeleton className="h-3 w-32 font-mono tabular-nums" />
          <span>·</span>
          <Skeleton className="h-3 w-20" />
          <Skeleton className="ml-auto h-3 w-32" />
        </div>
      </div>
    </AppShell>
  );
}
