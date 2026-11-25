import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] font-semibold tracking-tight tabular-nums transition-colors duration-150",
  {
    variants: {
      variant: {
        default: "border-primary/25 bg-primary/10 text-primary",
        secondary: "border-border bg-secondary text-secondary-foreground",
        outline: "border-border bg-transparent text-foreground",
        success:
          "border-emerald-300/80 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-200",
        warning:
          "border-amber-300/80 bg-amber-50 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200",
        destructive:
          "border-red-300/80 bg-red-50 text-red-800 dark:border-red-800/70 dark:bg-red-950/60 dark:text-red-200"
      }
    },
    defaultVariants: {
      variant: "secondary"
    }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
