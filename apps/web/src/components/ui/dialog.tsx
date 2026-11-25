"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onOpenChange,
  ariaLabel,
  variant = "modal",
  children,
  className
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ariaLabel?: string;
  variant?: "modal" | "drawer-left" | "drawer-right";
  children: React.ReactNode;
  className?: string;
}) {
  const mouseDownBackdropRef = React.useRef(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const onOpenChangeRef = React.useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  React.useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    const prevFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const getFocusables = () =>
      panel && typeof panel.querySelectorAll === "function"
        ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        : [];

    if (panel) {
      const alreadyInside =
        typeof panel.contains === "function" && panel.contains(document.activeElement);
      if (!alreadyInside) {
        (getFocusables()[0] ?? panel).focus?.();
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChangeRef.current(false);
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = getFocusables();
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus?.();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      const inside = typeof panel.contains === "function" && panel.contains(active);
      if (e.shiftKey) {
        if (active === first || active === panel || !inside) {
          e.preventDefault();
          last.focus?.();
        }
      } else if (active === last || !inside) {
        e.preventDefault();
        first.focus?.();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      if (prevFocused && prevFocused.isConnected !== false) {
        prevFocused.focus?.();
      }
    };
  }, [open]);

  if (!open) return null;

  const containerClass =
    variant === "drawer-left"
      ? "fixed inset-0 z-50 flex justify-start bg-black/50 backdrop-blur-[2px]"
      : variant === "drawer-right"
        ? "fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-[2px]"
        : "fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[3px] p-4";

  const panelClass =
    variant === "drawer-left"
      ? "h-full w-72 max-w-[85vw] border-r border-border bg-card text-card-foreground shadow-2xl overflow-y-auto animate-lutic-drawer-left"
      : variant === "drawer-right"
        ? "h-full w-full max-w-lg border-l border-border bg-card text-card-foreground shadow-2xl overflow-y-auto animate-lutic-drawer-right"
        : "w-full max-w-lg rounded-xl border border-border bg-card text-card-foreground shadow-2xl animate-lutic-modal";

  return (
    <div
      className={containerClass}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onMouseDown={(e) => {
        mouseDownBackdropRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (mouseDownBackdropRef.current && e.target === e.currentTarget) {
          onOpenChange(false);
        }
        mouseDownBackdropRef.current = false;
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(panelClass, "focus:outline-none", className)}
        onMouseDown={() => {
          mouseDownBackdropRef.current = false;
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
