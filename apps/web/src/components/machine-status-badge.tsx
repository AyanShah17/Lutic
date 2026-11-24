"use client";

import React from "react";
import { AlertTriangle, CheckCircle2, PauseCircle, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

export type MachineState = "running" | "idle" | "fault" | "offline";

const STATUS_META: Record<
  MachineState,
  { label: string; className: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  running: {
    label: "Running",
    className:
      "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800/70",
    Icon: CheckCircle2
  },
  idle: {
    label: "Idle",
    className:
      "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800/70",
    Icon: PauseCircle
  },
  fault: {
    label: "Fault",
    className:
      "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-200 dark:border-red-800/70",
    Icon: AlertTriangle
  },
  offline: {
    label: "Offline",
    className:
      "bg-muted text-muted-foreground border-border",
    Icon: WifiOff
  }
};

export function MachineStatusBadge({
  status,
  size = "md"
}: {
  status: string;
  size?: "sm" | "md";
}) {
  const key: MachineState =
    status === "running" || status === "idle" || status === "fault" || status === "offline"
      ? status
      : "offline";
  const meta = STATUS_META[key];
  const Icon = meta.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border font-semibold tracking-tight",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-0.5 text-xs",
        meta.className
      )}
      aria-label={`Machine status: ${meta.label}`}
    >
      <Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}
