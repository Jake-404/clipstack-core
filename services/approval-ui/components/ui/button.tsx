// Doc 8 §8.1 — Button. Five variants, four sizes. Always rounded-md.
// Hard rule: no decorative animation; transition-colors only.
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors duration-fast ease-default focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-accent-500 text-text-inverted hover:bg-accent-600 active:bg-accent-700",
        secondary:
          "border border-border-default bg-bg-surface text-text-primary hover:bg-bg-elevated hover:border-border-strong",
        ghost:
          "text-text-primary hover:bg-bg-elevated",
        destructive:
          "bg-status-danger text-white hover:bg-status-danger/90",
        icon:
          "border border-border-default bg-bg-surface text-text-secondary hover:bg-bg-elevated hover:text-text-primary",
      },
      size: {
        xs: "h-6 px-2 text-xs",
        sm: "h-8 px-3 text-sm",
        md: "h-9 px-4 text-base",
        lg: "h-10 px-5 text-md",
        iconOnly: "h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
