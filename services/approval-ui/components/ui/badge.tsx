// Doc 8 §8.4 — Badges and pills. Status variants use 10% opacity backgrounds.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-bg-elevated text-text-secondary",
        accent:  "bg-accent-500/10 text-accent-500",
        success: "bg-status-success/10 text-status-success",
        warning: "bg-status-warning/10 text-status-warning",
        danger:  "bg-status-danger/10 text-status-danger",
        info:    "bg-status-info/10 text-status-info",
        outline: "border border-border-default text-text-secondary",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
