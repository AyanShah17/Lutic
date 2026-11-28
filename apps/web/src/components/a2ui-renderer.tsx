"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowRight, Pin, PinOff, Send } from "lucide-react";
import type { A2UIComponent, A2UISpec } from "@lutic/core/a2ui";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

function isSafeInternalHref(href?: string): href is string {
  return Boolean(href && href.startsWith("/") && !href.startsWith("//"));
}

function triggerAssistantPrompt(prompt: string, serviceId?: string) {
  window.dispatchEvent(
    new CustomEvent("lutic:open-ai", {
      detail: {
        scope: serviceId ? "screen" : "global",
        serviceId: serviceId ?? "overview",
        prompt
      }
    })
  );
}

function renderKpiBlock(comp: Extract<A2UIComponent, { type: "kpi" }>) {
  return (
    <div key={comp.id} className="space-y-2">
      <div className="text-xs font-semibold text-foreground">{comp.title}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {comp.items.map((item) => (
          <div key={item.label} className="rounded-lg border border-border/70 bg-muted/20 p-3">
            <div className="text-[11px] text-muted-foreground">{item.label}</div>
            <div
              className={cn(
                "mt-1 text-lg font-semibold font-mono tabular-nums",
                item.tone === "danger" && "text-destructive",
                item.tone === "warning" && "text-amber-600 dark:text-amber-400",
                item.tone === "success" && "text-emerald-600 dark:text-emerald-400"
              )}
            >
              {item.value}
            </div>
            {item.delta && (
              <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{item.delta}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderChartBlock(comp: Extract<A2UIComponent, { type: "chart" }>) {
  const maxVal = Math.max(1, ...comp.series.map((s) => s.value));
  return (
    <div key={comp.id} className="space-y-2 rounded-lg border border-border/70 bg-muted/15 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">{comp.title}</span>
        {comp.unit && <span className="text-[10px] font-mono text-muted-foreground">{comp.unit}</span>}
      </div>
      <div className="space-y-1.5">
        {comp.series.map((pt) => {
          const pct = Math.max(4, Math.min(100, (pt.value / maxVal) * 100));
          return (
            <div key={pt.label} className="grid grid-cols-[88px_1fr_54px] items-center gap-2 text-[11px]">
              <span className="truncate text-muted-foreground">{pt.label}</span>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-right font-mono tabular-nums">
                {pt.value}
                {comp.unit ?? ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderTableBlock(comp: Extract<A2UIComponent, { type: "table" }>) {
  return (
    <div key={comp.id} className="space-y-2">
      <div className="text-xs font-semibold text-foreground">{comp.title}</div>
      <div className="rounded-lg border border-border/70 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {comp.columns.map((col) => (
                <TableHead key={col} className="text-[11px] h-8">
                  {col}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {comp.rows.map((row, idx) => (
              <TableRow key={idx}>
                {row.map((cell, cIdx) => (
                  <TableCell key={cIdx} className="text-xs py-2">
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function renderStatusListBlock(comp: Extract<A2UIComponent, { type: "status_list" }>) {
  return (
    <div key={comp.id} className="space-y-2">
      <div className="text-xs font-semibold text-foreground">{comp.title}</div>
      <div className="divide-y divide-border/60 rounded-lg border border-border/70">
        {comp.items.map((item, idx) => {
          const badgeVariant =
            item.status === "ok"
              ? "success"
              : item.status === "error"
                ? "destructive"
                : item.status === "warn"
                  ? "warning"
                  : "outline";
          return (
            <div key={idx} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
              <div className="min-w-0">
                {isSafeInternalHref(item.href) ? (
                  <Link href={item.href} className="font-medium hover:underline truncate block">
                    {item.label}
                  </Link>
                ) : (
                  <div className="font-medium truncate">{item.label}</div>
                )}
                {item.detail && (
                  <div className="text-[11px] text-muted-foreground truncate">{item.detail}</div>
                )}
              </div>
              <Badge variant={badgeVariant} className="text-[10px] uppercase shrink-0">
                {item.status}
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InteractiveA2UIForm({ comp }: { comp: Extract<A2UIComponent, { type: "form" }> }) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of comp.fields) {
      init[f.name] = f.defaultValue ?? (f.options?.[0] ?? "");
    }
    return init;
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let finalPrompt = comp.aiPromptTemplate;
    for (const f of comp.fields) {
      finalPrompt = finalPrompt.replaceAll(`{{${f.name}}}`, values[f.name] ?? "");
    }
    triggerAssistantPrompt(finalPrompt);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-border/70 bg-muted/15 p-3">
      <div className="text-xs font-semibold text-foreground">{comp.title}</div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {comp.fields.map((field) => (
          <div key={field.name} className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground block">
              {field.label}
            </label>
            {field.kind === "select" && field.options ? (
              <Select
                value={values[field.name] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                className="h-8 text-xs"
              >
                {field.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                value={values[field.name] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                placeholder={field.placeholder ?? ""}
                className="h-8 text-xs"
              />
            )}
          </div>
        ))}
      </div>
      <Button type="submit" size="sm">
        <Send className="h-3.5 w-3.5" />
        <span>{comp.submitLabel}</span>
      </Button>
    </form>
  );
}

export function A2UIRenderer({
  spec,
  pinned = false,
  onPin,
  onUnpin,
  compact = false
}: {
  spec: A2UISpec;
  pinned?: boolean;
  onPin?: (spec: A2UISpec) => void;
  onUnpin?: (specId: string) => void;
  compact?: boolean;
}) {
  return (
    <Card className={cn("rounded-2xl border-border/80 space-y-4", compact ? "p-3.5" : "p-5")}>
      <div className="flex items-start justify-between gap-2 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground truncate">{spec.title}</h3>
            <Badge variant="outline" className="text-[10px] font-mono">
              Custom View
            </Badge>
          </div>
          {spec.subtitle && (
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{spec.subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!pinned && onPin && (
            <Button size="sm" variant="outline" onClick={() => onPin(spec)}>
              <Pin className="h-3.5 w-3.5" />
              <span>Pin View</span>
            </Button>
          )}
          {onUnpin && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove ${spec.title}`}
              onClick={() => onUnpin(spec.id)}
            >
              <PinOff className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3.5">
        {spec.components.map((comp) => {
          switch (comp.type) {
            case "kpi":
              return renderKpiBlock(comp);
            case "chart":
              return renderChartBlock(comp);
            case "table":
              return renderTableBlock(comp);
            case "status_list":
              return renderStatusListBlock(comp);
            case "form":
              return <InteractiveA2UIForm key={comp.id} comp={comp} />;
            case "action_bar":
              return (
                <div key={comp.id} className="flex flex-wrap items-center gap-1.5 pt-1">
                  {comp.actions.map((act) =>
                    isSafeInternalHref(act.href) ? (
                      <Link
                        key={act.label}
                        href={act.href}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        <span>{act.label}</span>
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    ) : (
                      <Button
                        key={act.label}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => triggerAssistantPrompt(act.aiPrompt ?? act.label, act.serviceId)}
                      >
                        <span>{act.label}</span>
                      </Button>
                    )
                  )}
                </div>
              );
          }
        })}
      </div>
    </Card>
  );
}
