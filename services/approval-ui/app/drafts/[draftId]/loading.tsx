// /drafts/[draftId] loading skeleton. Mirrors detail page:
// breadcrumb + h1 + metadata strip + body card + recent-activity card +
// table skeleton (recent metric snapshots).

import { AppShell } from "@/components/layout/AppShell";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const METRIC_ROW_COUNT = 5;

export default function Loading() {
  return (
    <AppShell title="draft">
      <div className="p-6 max-w-5xl mx-auto">
        <Skeleton className="h-4 w-36 mb-4" />

        <div className="mb-6">
          <Skeleton className="h-7 w-3/4 max-w-md mb-2" />
          <div className="flex flex-wrap items-center gap-2 text-sm text-text-tertiary font-mono tabular-nums">
            <Skeleton className="h-5 w-24" />
            <span>·</span>
            <Skeleton className="h-4 w-20" />
            <span>·</span>
            <Skeleton className="h-4 w-24 font-mono tabular-nums" />
            <span>·</span>
            <Skeleton className="h-4 w-20 font-mono tabular-nums" />
          </div>
        </div>

        {/* Body card — title + a paragraph of pulsing lines */}
        <Card size="full" tone="default" className="mb-6">
          <CardHeader>
            <CardLabel>body</CardLabel>
            <Skeleton className="h-3 w-24 font-mono tabular-nums" />
          </CardHeader>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-10/12" />
            <Skeleton className="h-4 w-9/12" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-7/12" />
          </div>
        </Card>

        {/* Recent activity / approval state card — same column width
            as the body card so it visually nests beneath. */}
        <Card size="full" tone="default" className="mb-6">
          <CardHeader>
            <CardLabel>recent activity</CardLabel>
            <Skeleton className="h-3 w-20 font-mono tabular-nums" />
          </CardHeader>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-4 w-12 shrink-0 font-mono tabular-nums" />
                <Skeleton className="h-5 w-20 shrink-0" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        </Card>

        {/* Recent metric snapshots table */}
        <Card size="full" tone="default" className="mb-8">
          <CardHeader>
            <CardLabel>recent metrics</CardLabel>
            <Skeleton className="h-3 w-24 font-mono tabular-nums" />
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle">
                  {[
                    "snapshot",
                    "platform",
                    "impressions",
                    "reach",
                    "clicks",
                    "engagement_p",
                  ].map((h) => (
                    <th
                      key={h}
                      className="py-2 px-3 text-xs uppercase tracking-wider font-medium text-text-secondary text-right first:text-left first:pr-4 first:pl-0 last:pl-3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {Array.from({ length: METRIC_ROW_COUNT }).map((_, ri) => (
                  <tr key={ri}>
                    <td className="py-2 pr-4">
                      <Skeleton className="h-4 w-32 font-mono tabular-nums" />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <Skeleton className="h-4 w-16 ml-auto" />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <Skeleton className="h-4 w-14 ml-auto font-mono tabular-nums" />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <Skeleton className="h-4 w-14 ml-auto font-mono tabular-nums" />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <Skeleton className="h-4 w-12 ml-auto font-mono tabular-nums" />
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <Skeleton className="h-4 w-10 ml-auto font-mono tabular-nums" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="mt-8 flex items-center gap-4 text-xs text-text-tertiary">
          <Skeleton className="h-3 w-32 font-mono tabular-nums" />
          <span>·</span>
          <Skeleton className="h-3 w-32" />
          <Skeleton className="ml-auto h-3 w-32" />
        </div>
      </div>
    </AppShell>
  );
}
