"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Vengeance UI — AnimatedButton (tactile sheen + spring press micro-interaction)
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
      "group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full px-5 py-2 text-xs font-medium transition-[color,background-color,border-color,transform,box-shadow] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 min-h-[38px] motion-reduce:transition-none motion-reduce:active:scale-100",
      variant === "primary"
        ? "bg-foreground text-background shadow-[0_1px_2px_rgba(16,16,18,0.1)] hover:bg-primary hover:text-primary-foreground"
        : "border border-border bg-card text-foreground hover:border-primary/50 hover:bg-accent",
      className
    )}
    {...props}
  >
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-full motion-reduce:hidden"
    />
    <span className="relative inline-flex items-center gap-1.5">{children}</span>
  </button>
));
AnimatedButton.displayName = "AnimatedButton";
