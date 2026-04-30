// Doc 8 §8.3 — Card / Tile. bg-surface + border, never shadow.
// Bento grid size variants per Doc 8 §9.2.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const cardVariants = cva(
  "bg-bg-surface border border-border rounded-lg p-4 transition-colors duration-fast ease-default",
  {
    variants: {
      tone: {
        default:    "hover:border-border-strong",
        accent:     "border-accent-500/40 hover:border-accent-500/60",
        success:    "border-status-success/40",
        warning:    "border-status-warning/40",
        danger:     "border-status-danger/40",
        info:       "border-status-info/40",
        // Working state — Doc 8 §10.3 tile pulse
        working:    "border-accent-500/40 animate-tile-pulse",
      },
      size: {
        small:   "col-span-12 md:col-span-2",
        medium:  "col-span-12 md:col-span-3",
        large:   "col-span-12 md:col-span-4 row-span-2",
        wide:    "col-span-12 md:col-span-6",
        hero:    "col-span-12 md:col-span-6 row-span-2",
        full:    "col-span-12",
      },
    },
    defaultVariants: { tone: "default", size: "medium" },
  }
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, tone, size, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ tone, size }), className)} {...props} />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-start justify-between gap-2 mb-3", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

// Doc 8 §11.2 — section labels uppercase tracked
const CardLabel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("text-xs uppercase tracking-wider font-medium text-text-secondary", className)}
      {...props}
    />
  )
);
CardLabel.displayName = "CardLabel";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

export { Card, CardHeader, CardLabel, CardContent, cardVariants };
