// /performance loading skeleton. Mirrors app/performance/page.tsx:
// breadcrumb + h1 + supporting copy + range-pill row + 4 KPI card
// skeletons (in the same md:grid-cols-4 the real page uses) + a
// per-platform table skeleton.

import { AppShell } from "@/components/layout/AppShell";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const TABLE_ROWS = 4;

interface KpiPlaceholderProps {
  label: string;
}

// Mirror MetricTile's structure: label up top, big mono value
// underneath, sparkline strip at the bottom.
function KpiPlaceholder({ label }: KpiPlaceholderProps) {
  return (
    <Card size="wide" tone="default" className="md:col-span-1">
      <div className="flex items-start justify-between gap-2 mb-3">
        <CardLabel>{label}</CardLabel>
      </div>
      <Skeleton className="h-8 w-24 mb-3 font-mono tabular-nums" />
      <Skeleton className="h-8 w-full" />
    </Card>
  );
}

export default function Loading() {
  return (
    <AppShell title="performance">
      <div className="p-6 max-w-6xl mx-auto">
        <Skeleton className="h-4 w-36 mb-4" />

        <div className="mb-6">
          <Skeleton className="h-7 w-40 mb-2" />
          <Skeleton className="h-4 w-full max-w-2xl" />
        </div>

        {/* Range pills — three placeholders in the same row position
            as the real RangePill components. */}
        <div className="flex items-center gap-2 mb-6">
          <span className="text-xs uppercase tracking-wider text-text-tertiary mr-1">
            range
          </span>
          <Skeleton className="h-5 w-10" />
          <Skeleton className="h-5 w-10" />
          <Skeleton className="h-5 w-10" />
        </div>

        {/* 4-up KPI grid — labels are the real strings since they're
            structural, not data-driven. The numeric value + sparkline
            are the parts that pulse. */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <KpiPlaceholder label="avg engagement percentile" />
          <KpiPlaceholder label="avg ctr" />
          <KpiPlaceholder label="total reach" />
          <KpiPlaceholder label="total impressions" />
        </div>

        {/* Per-platform breakdown table */}
        <Card size="full" tone="default" className="mb-8">
          <CardHeader>
            <CardLabel>per-platform breakdown</CardLabel>
            <Skeleton className="h-3 w-20 font-mono tabular-nums" />
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle">
                  {["platform", "drafts", "impressions", "clicks", "reach", "engagement_p"].map(
                    (h) => (
                      <th
                        key={h}
                        className="py-2 px-3 text-xs uppercase tracking-wider font-medium text-text-secondary text-right first:text-left first:pr-4 first:pl-0 last:pl-3"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {Array.from({ length: TABLE_ROWS }).map((_, ri) => (
                  <tr key={ri}>
                    <td className="py-2 pr-4">
                      <Skeleton className="h-4 w-20" />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <Skeleton className="h-4 w-12 ml-auto font-mono tabular-nums" />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <Skeleton className="h-4 w-16 ml-auto font-mono tabular-nums" />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <Skeleton className="h-4 w-12 ml-auto font-mono tabular-nums" />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <Skeleton className="h-4 w-16 ml-auto font-mono tabular-nums" />
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
          <Skeleton className="h-3 w-20 font-mono tabular-nums" />
          <span>·</span>
          <Skeleton className="h-3 w-40" />
          <Skeleton className="ml-auto h-3 w-32" />
        </div>
      </div>
    </AppShell>
  );
}
