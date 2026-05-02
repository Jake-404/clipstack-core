// /experiments/[banditId] loading skeleton. Mirrors detail page:
// breadcrumb + h1 + metadata badges + 4 arm-card skeletons in a
// 2-col grid (lg:grid-cols-2 — same layout the real arms render in).

import { AppShell } from "@/components/layout/AppShell";
import { Card, CardHeader, CardLabel } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const ARM_COUNT = 4;

function ArmPlaceholder() {
  return (
    <Card size="medium" tone="default" className="flex flex-col">
      <CardHeader>
        <div className="flex flex-col gap-0.5 min-w-0">
          <CardLabel>
            <Skeleton className="h-3 w-20 inline-block" />
          </CardLabel>
          <Skeleton className="h-3 w-24 mt-1 font-mono tabular-nums" />
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Skeleton className="h-5 w-14" />
        </div>
      </CardHeader>

      {/* Body excerpt — 4 lines clamp on the real page */}
      <div className="space-y-1.5 mb-4">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-10/12" />
        <Skeleton className="h-3 w-8/12" />
      </div>

      {/* Posterior mean — 2xl mono number + small label */}
      <div className="flex items-baseline gap-2 mb-3">
        <Skeleton className="h-7 w-14 font-mono tabular-nums" />
        <Skeleton className="h-3 w-32" />
      </div>

      {/* α / β / alloc / rewards grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs mt-auto pt-3 border-t border-border-subtle">
        {["α", "β", "alloc", "rewards"].map((label) => (
          <div
            key={label}
            className="flex justify-between font-mono tabular-nums"
          >
            <span className="text-text-tertiary">{label}</span>
            <Skeleton className="h-3 w-10 font-mono tabular-nums" />
          </div>
        ))}
        <div className="flex justify-between font-mono tabular-nums col-span-2">
          <span className="text-text-tertiary">avg reward (when received)</span>
          <Skeleton className="h-3 w-10 font-mono tabular-nums" />
        </div>
      </div>
    </Card>
  );
}

export default function Loading() {
  return (
    <AppShell title="experiment">
      <div className="p-6 max-w-5xl mx-auto">
        <Skeleton className="h-4 w-36 mb-4" />

        <div className="mb-6">
          <Skeleton className="h-7 w-2/3 max-w-md mb-2" />
          <div className="flex flex-wrap items-center gap-2 text-sm text-text-tertiary font-mono tabular-nums">
            <Skeleton className="h-5 w-20" />
            <span>·</span>
            <Skeleton className="h-4 w-28 font-mono tabular-nums" />
            <span>·</span>
            <Skeleton className="h-4 w-32 font-mono tabular-nums" />
            <span>·</span>
            <Skeleton className="h-4 w-28 font-mono tabular-nums" />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: ARM_COUNT }).map((_, i) => (
            <ArmPlaceholder key={i} />
          ))}
        </div>

        <div className="mt-8 flex items-center gap-4 text-xs text-text-tertiary">
          <Skeleton className="h-3 w-32 font-mono tabular-nums" />
          <span>·</span>
          <Skeleton className="h-3 w-48" />
          <Skeleton className="ml-auto h-3 w-32" />
        </div>
      </div>
    </AppShell>
  );
}
