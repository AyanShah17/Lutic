import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-tight tabular-nums transition-colors duration-150",
  {
    variants: {
      variant: {
        default: "border-primary/20 bg-primary/10 text-primary",
        secondary: "border-border/80 bg-secondary/80 text-secondary-foreground",
        outline: "border-border/80 bg-transparent text-muted-foreground",
        success:
          "border-emerald-300/60 bg-emerald-50/80 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/50 dark:text-emerald-300",
        warning:
          "border-amber-300/60 bg-amber-50/80 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-300",
        destructive:
          "border-red-300/60 bg-red-50/80 text-red-800 dark:border-red-800/60 dark:bg-red-950/50 dark:text-red-300"
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
