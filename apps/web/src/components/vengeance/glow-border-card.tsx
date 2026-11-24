import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Vengeance UI — GlowBorderCard (calibrated to restrained industrial palette)
 */
export function GlowBorderCard({
  children,
  className,
  glowColors = ["hsl(var(--primary))", "hsl(var(--border))", "hsl(var(--primary) / 0.45)"]
}: {
  children: React.ReactNode;
  className?: string;
  glowColors?: string[];
}) {
  const gradient = `conic-gradient(from 0deg, ${glowColors.join(", ")}, ${glowColors[0]})`;

  return (
    <div className={cn("relative rounded-lg p-[1px] overflow-hidden", className)}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-[100%] animate-lutic-spin-slow opacity-35 motion-reduce:animate-none"
        style={{ background: gradient }}
      />
      <div className="relative rounded-[calc(var(--radius)-1px)] bg-card text-card-foreground">
        {children}
      </div>
    </div>
  );
}
