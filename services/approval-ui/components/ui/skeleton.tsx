// Doc 8 §10 — perceived-speed primitive. Pulsing rectangle that
// reserves layout space during server-component fetch latency. Used by
// every route-level loading.tsx so the layout-shift on data swap is
// minimal: the skeleton block sits in the same grid cell as the real
// content, with the same width + height tokens.
//
// Single rule: it animate-pulses bg-bg-elevated. Sizing is the caller's
// job — pass `className` with h-* / w-* / col-span-* / row-span-* /
// rounded-* and the skeleton inherits them via the same cn() merge
// pattern as Card and Button.
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SkeletonProps
  extends React.HTMLAttributes<HTMLDivElement> {}

const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        "rounded bg-bg-elevated animate-pulse",
        className,
      )}
      {...props}
    />
  ),
);
Skeleton.displayName = "Skeleton";

export { Skeleton };
