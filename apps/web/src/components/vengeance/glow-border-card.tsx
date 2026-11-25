import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Vengeance UI — GlowBorderCard (calibrated hairline border with restrained perimeter signal)
 */
export function GlowBorderCard({
  children,
  className,
  glowColors = ["hsl(var(--primary) / 0.7)", "hsl(var(--border))", "hsl(var(--primary) / 0.3)"]
}: {
  children: React.ReactNode;
  className?: string;
  glowColors?: string[];
}) {
  const gradient = `conic-gradient(from 0deg, ${glowColors.join(", ")}, ${glowColors[0]})`;

  return (
    <div className={cn("relative rounded-xl p-[1px] overflow-hidden", className)}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-[100%] animate-lutic-spin-slow opacity-35 motion-reduce:animate-none"
        style={{ background: gradient }}
      />
      <div className="relative rounded-[calc(var(--radius-xl)-3px)] bg-card text-card-foreground">
        {children}
      </div>
    </div>
  );
}
