"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Vengeance UI — AnimatedButton (tactile sheen + active scale micro-interaction)
 */
export const AnimatedButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "outline";
  }
>(({ children, className, variant = "primary", type = "button", ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(
      "group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-md px-4 py-2 text-xs font-semibold transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 min-h-[38px]",
      variant === "primary"
        ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
        : "border border-border bg-card text-foreground hover:bg-muted",
      className
    )}
    {...props}
  >
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-500 group-hover:translate-x-full motion-reduce:hidden"
    />
    <span className="relative inline-flex items-center gap-1.5">{children}</span>
  </button>
));
AnimatedButton.displayName = "AnimatedButton";
