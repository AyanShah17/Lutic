"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SpotlightItem {
  id: string;
  label: string;
  badge?: string | number;
  icon?: React.ReactNode;
}

/**
 * Vengeance UI — SpotlightNavbar (cursor-tracked subtle spotlight tab bar)
 */
export function SpotlightNavbar({
  items,
  activeId,
  onSelect,
  className
}: {
  items: SpotlightItem[];
  activeId: string;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const navRef = React.useRef<HTMLDivElement>(null);
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [spotX, setSpotX] = React.useState<number | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (items.length === 0) return;
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % items.length;
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + items.length) % items.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = items.length - 1;
    if (nextIdx !== null) {
      e.preventDefault();
      const target = items[nextIdx];
      if (target) {
        onSelect(target.id);
        tabRefs.current[nextIdx]?.focus();
      }
    }
  };

  return (
    <div
      ref={navRef}
      onMouseMove={(e) => {
        const rect = navRef.current?.getBoundingClientRect();
        if (rect) setSpotX(e.clientX - rect.left);
      }}
      onMouseLeave={() => setSpotX(null)}
      className={cn(
        "relative inline-flex max-w-full flex-nowrap sm:flex-wrap overflow-x-auto items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-[0_1px_2px_rgba(0,0,0,0.03)]",
        className
      )}
      role="tablist"
    >
      {spotX !== null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-28 -translate-x-1/2 bg-gradient-to-r from-transparent via-primary/10 to-transparent transition-opacity duration-150"
          style={{ left: spotX }}
        />
      )}
      {items.map((item, idx) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            ref={(el) => {
              tabRefs.current[idx] = el;
            }}
            type="button"
            role="tab"
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            onClick={() => onSelect(item.id)}
            className={cn(
              "relative z-10 inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.985] min-h-[34px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            )}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.badge !== undefined && (
              <span
                className={cn(
                  "rounded-sm px-1.5 py-0.5 text-[10px] font-mono tabular-nums leading-none",
                  active
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
