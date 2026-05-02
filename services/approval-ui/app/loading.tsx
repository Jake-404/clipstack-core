// Mission Control loading skeleton. Doc 8 §10 perceived-speed work.
//
// Mirrors app/page.tsx pixel-for-pixel: AppShell wrapper (sidebar +
// topbar render normally), then the same 12-col bento grid populated
// with 9 placeholder cards in the same size variants the real tiles
// occupy. Each card has a label-shaped block + a content-shaped block
// pulsing on bg-bg-elevated.
//
// Rendered instantly while the route segment fetches — not async.

import { AppShell } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface TilePlaceholderProps {
  size: "medium" | "large" | "wide" | "hero";
  contentHeight?: string;
}

function TilePlaceholder({ size, contentHeight = "h-16" }: TilePlaceholderProps) {
  return (
    <Card size={size} tone="default">
      <div className="flex items-start justify-between gap-2 mb-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-4 w-12" />
      </div>
      <Skeleton className={`w-full ${contentHeight}`} />
    </Card>
  );
}

export default function Loading() {
  return (
    <AppShell title="Mission Control">
      <div className="p-6">
        {/* 12-col bento grid — same shape as page.tsx so the skeleton
            collapses into the real tiles with zero layout shift. */}
        <div className="grid grid-cols-12 gap-4 auto-rows-[minmax(120px,auto)]">
          {/* HeroKpiTile — hero size */}
          <TilePlaceholder size="hero" contentHeight="h-32" />

          {/* ApprovalQueueTile — large */}
          <TilePlaceholder size="large" contentHeight="h-32" />

          {/* AgentActivityTile — large */}
          <TilePlaceholder size="large" contentHeight="h-32" />

          {/* CTR · last 7d — medium MetricTile */}
          <TilePlaceholder size="medium" contentHeight="h-12 font-mono tabular-nums" />

          {/* Reach · last 7d — medium MetricTile */}
          <TilePlaceholder size="medium" contentHeight="h-12 font-mono tabular-nums" />

          {/* Crisis monitor — medium */}
          <TilePlaceholder size="medium" contentHeight="h-12" />

          {/* AnomaliesTile — medium */}
          <TilePlaceholder size="medium" contentHeight="h-12" />

          {/* BusHealthTile — medium */}
          <TilePlaceholder size="medium" contentHeight="h-12" />

          {/* AI spend · this month — medium MetricTile */}
          <TilePlaceholder size="medium" contentHeight="h-12 font-mono tabular-nums" />
        </div>

        {/* Footer rail — match the static line on the real page so the
            page-bottom stays at the same y-coordinate during swap. */}
        <div className="mt-8 flex items-center gap-4 text-xs text-text-tertiary">
          <Skeleton className="h-3 w-24 font-mono tabular-nums" />
          <span>·</span>
          <Skeleton className="h-3 w-48" />
          <Skeleton className="ml-auto h-3 w-64" />
        </div>
      </div>
    </AppShell>
  );
}
