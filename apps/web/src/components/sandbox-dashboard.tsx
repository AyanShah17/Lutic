"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  Check,
  CheckCircle2,
  Cpu,
  GitBranch,
  Kanban,
  Layers,
  Pin,
  PinOff,
  Plug,
  Plus,
  QrCode,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import type { SessionUser } from "@lutic/core";
import {
  buildVirtualDefaultSandboxServices,
  type SandboxServiceId,
  type TenantSandboxServiceView
} from "@lutic/core/sandbox-services";
import { LuticLogo } from "@/components/lutic-logo";
import { useAppContext, type OverviewAgentSummaryView } from "@/components/providers";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { GlowBorderCard } from "@/components/vengeance/glow-border-card";
import { LineHoverLink } from "@/components/vengeance/line-hover-link";
import { cn } from "@/lib/utils";

const SERVICE_ICONS: Record<SandboxServiceId, React.ComponentType<{ className?: string }>> = {
  board: Kanban,
  machines: Cpu,
  monitoring: Activity,
  dashboards: BarChart3,
  workflows: GitBranch,
  connectors: Plug,
  notifications: Bell,
  queues: Layers
};

export interface WorkspaceSnapshot {
  totalMachines: number;
  runningMachines: number;
  faultMachines: number;
  openAlerts: number | null;
  enabledWorkflows: number | null;
  unreadNotifications: number | null;
  spotlightMachine: {
    id: string;
    name: string;
    plantId: string;
    code: string;
    message: string;
  } | null;
}

export function SandboxDashboard({
  user,
  snapshot,
  initialServices,
  initialOverviewAgent,
  primaryMachineHref,
  primaryMachineLabel
}: {
  user: SessionUser;
  snapshot: WorkspaceSnapshot | null;
  initialServices: TenantSandboxServiceView[];
  initialOverviewAgent: OverviewAgentSummaryView;
  primaryMachineHref: string;
  primaryMachineLabel: string;
}) {
  const {
    sandboxServices,
    overviewAgent,
    setSandboxServicesState
  } = useAppContext();

  const [services, setServices] = useState<TenantSandboxServiceView[]>(
    initialServices.length > 0 ? initialServices : buildVirtualDefaultSandboxServices()
  );
  const [overview, setOverview] = useState<OverviewAgentSummaryView>(initialOverviewAgent);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [expandedSkillsFor, setExpandedSkillsFor] = useState<string | null>(null);
  const [savingServiceId, setSavingServiceId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (sandboxServices.length > 0) {
      setServices(sandboxServices);
    }
    if (overviewAgent) {
      setOverview(overviewAgent);
    }
  }, [sandboxServices, overviewAgent]);

  const mutateService = async (payload: {
    serviceId: SandboxServiceId;
    enabled?: boolean;
    pinnedToDashboard?: boolean;
    enabledSkills?: string[];
  }, successMsg: string) => {
    setSavingServiceId(payload.serviceId);
    setNotice(null);
    try {
      const res = await fetch("/api/sandbox/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = (await res.json().catch(() => ({}))) as {
        services?: TenantSandboxServiceView[];
        overviewAgent?: OverviewAgentSummaryView;
        detail?: string;
      };
      if (!res.ok || !data.services) {
        setNotice(data.detail ?? "Unable to update sandbox service.");
        return;
      }
      setServices(data.services);
      if (data.overviewAgent) setOverview(data.overviewAgent);
      setSandboxServicesState(data.services, data.overviewAgent ?? null);
      setNotice(successMsg);
    } catch {
      setNotice("Failed to update sandbox service.");
    } finally {
      setSavingServiceId(null);
    }
  };

  const removeService = async (serviceId: SandboxServiceId, name: string) => {
    setSavingServiceId(serviceId);
    setNotice(null);
    try {
      const res = await fetch(`/api/sandbox/services?serviceId=${encodeURIComponent(serviceId)}`, {
        method: "DELETE"
      });
      const data = (await res.json().catch(() => ({}))) as {
        services?: TenantSandboxServiceView[];
        overviewAgent?: OverviewAgentSummaryView;
        detail?: string;
      };
      if (!res.ok || !data.services) {
        setNotice(data.detail ?? `Unable to remove ${name}.`);
        return;
      }
      setServices(data.services);
      if (data.overviewAgent) setOverview(data.overviewAgent);
      setSandboxServicesState(data.services, data.overviewAgent ?? null);
      if (expandedSkillsFor === serviceId) setExpandedSkillsFor(null);
      setNotice(`Removed ${name} from your sandbox.`);
    } catch {
      setNotice(`Failed to remove ${name}.`);
    } finally {
      setSavingServiceId(null);
    }
  };

  const toggleSkill = (svc: TenantSandboxServiceView, skillId: string) => {
    const current = new Set(svc.enabledSkills);
    if (current.has(skillId)) {
      current.delete(skillId);
    } else {
      current.add(skillId);
    }
    void mutateService(
      { serviceId: svc.id, enabledSkills: Array.from(current) },
      `Updated ${svc.agentName} skills.`
    );
  };

  const openAgent = (scope: "screen" | "global", serviceId: SandboxServiceId | "overview", label: string) => {
    window.dispatchEvent(
      new CustomEvent("lutic:open-ai", {
        detail: { scope, serviceId, entityName: label }
      })
    );
  };

  const enabledServices = services.filter((s) => s.enabled);
  const pinnedServices = enabledServices.filter((s) => s.pinnedToDashboard);
  const unpinnedEnabled = enabledServices.filter((s) => !s.pinnedToDashboard);

  return (
    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6 space-y-7">
      <section className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between border-b border-border/70 pb-6">
        <div className="space-y-1.5 max-w-2xl">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <LuticLogo className="h-4 w-4" />
            <span>{user.name} · Isolated Tenant Sandbox</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground">
            Lutic AI Workspace
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Configure services in your own sandbox dashboard, customize per-service agent skills, and orchestrate across active services with Overview Agent.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button size="default" onClick={() => setCatalogOpen(true)}>
            <Plus className="h-4 w-4" />
            <span>Add Service</span>
          </Button>
          <Button
            variant="outline"
            size="default"
            onClick={() => openAgent("global", "overview", "Overview Agent")}
          >
            <Sparkles className="h-4 w-4 text-primary" />
            <span>Overview Agent</span>
          </Button>
          {enabledServices.some((s) => s.id === "machines") && (
            <Link
              href={primaryMachineHref}
              className={buttonVariants({ variant: "outline", size: "default" })}
            >
              <QrCode className="h-4 w-4" />
              <span>{primaryMachineLabel}</span>
            </Link>
          )}
        </div>
      </section>

      {notice && (
        <div className="rounded-lg border border-border bg-muted/50 px-3.5 py-2 text-xs font-medium flex items-center justify-between gap-2">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss sandbox notice"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {snapshot && (
        <section
          aria-label="Operational Snapshot"
          className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border/70 rounded-2xl border border-border/80 bg-card overflow-hidden"
        >
          <div className="p-4">
            <div className="text-xs font-medium text-muted-foreground">Fleet Running</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums">
              {snapshot.runningMachines}
              <span className="text-xs font-normal text-muted-foreground">
                /{snapshot.totalMachines}
              </span>
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs font-medium text-muted-foreground">Active Faults</div>
            <div
              className={cn(
                "mt-1 text-xl font-semibold font-mono tabular-nums",
                snapshot.faultMachines > 0 ? "text-destructive" : "text-foreground"
              )}
            >
              {snapshot.faultMachines}
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs font-medium text-muted-foreground">Open Alerts</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums">
              {snapshot.openAlerts ?? "—"}
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs font-medium text-muted-foreground">Active Workflows</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums">
              {snapshot.enabledWorkflows ?? "—"}
            </div>
          </div>
        </section>
      )}

      {snapshot?.spotlightMachine && (
        <GlowBorderCard>
          <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">
                    {`Spotlight: ${snapshot.spotlightMachine.name}`}
                  </span>
                  <Badge variant="destructive" className="font-mono">
                    {snapshot.spotlightMachine.code}
                  </Badge>
                  <Badge variant="outline" className="font-mono">
                    {snapshot.spotlightMachine.plantId}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground max-w-2xl">
                  {snapshot.spotlightMachine.message}
                </p>
              </div>
            </div>

            <LineHoverLink href={primaryMachineHref} className="shrink-0 py-1 font-medium">
              {`Inspect ${snapshot.spotlightMachine.id}`}
              <ArrowRight className="h-3.5 w-3.5" />
            </LineHoverLink>
          </div>
        </GlowBorderCard>
      )}

      {/* Overview Agent (Cross-Service Aware) Card */}
      <Card className="p-5 rounded-2xl border-border/80 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
              <Bot className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold tracking-tight">Overview Agent</h2>
                <Badge variant="secondary" className="text-[10px]">
                  Cross-Service
                </Badge>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {enabledServices.length}/{services.length} services · {overview.activeSkills.length} active skills
                </span>
              </div>
              <p className="text-xs text-muted-foreground max-w-2xl">
                Aware of every service currently enabled in your sandbox. Each individual service agent runs strictly isolated to its own service skills.
              </p>
            </div>
          </div>

          <Button
            size="sm"
            onClick={() => openAgent("global", "overview", "Overview Agent")}
            className="shrink-0"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Ask Overview Agent</span>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/60">
          {enabledServices.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              No services installed yet. Click Add Service to populate your sandbox.
            </span>
          ) : (
            enabledServices.map((svc) => (
              <Badge key={svc.id} variant="outline" className="text-[11px] gap-1 font-normal">
                <CheckCircle2 className="h-3 w-3 text-primary" />
                <span>{svc.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  ({svc.enabledSkills.length})
                </span>
              </Badge>
            ))
          )}
        </div>
      </Card>

      {/* Customizable Sandbox Dashboard Service Cards */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">
              My Sandbox Dashboard ({pinnedServices.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Each pinned service runs its own isolated agent and customizable skill set.
            </p>
          </div>
          {unpinnedEnabled.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Unpinned:</span>
              {unpinnedEnabled.map((svc) => (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() =>
                    void mutateService(
                      { serviceId: svc.id, pinnedToDashboard: true },
                      `Pinned ${svc.name} to your Sandbox Dashboard.`
                    )
                  }
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium hover:border-primary/60"
                >
                  <Pin className="h-3 w-3" />
                  <span>Pin {svc.shortName}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {pinnedServices.length === 0 ? (
          <Card className="p-8 text-center space-y-3 rounded-2xl">
            <p className="text-xs text-muted-foreground">
              No services pinned to your dashboard yet. Add a service from the sandbox catalog to get started.
            </p>
            <Button size="sm" onClick={() => setCatalogOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              <span>Add First Service</span>
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {pinnedServices.map((svc) => {
              const Icon = SERVICE_ICONS[svc.id] ?? Layers;
              const isExpanded = expandedSkillsFor === svc.id;
              const isBusy = savingServiceId === svc.id;
              return (
                <Card key={svc.id} className="p-4 rounded-2xl space-y-3 flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <h3 className="text-sm font-semibold truncate">{svc.name}</h3>
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {svc.tag}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {svc.description}
                          </p>
                        </div>
                      </div>

                      <Link
                        href={svc.href}
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}
                      >
                        <span>Open</span>
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-muted/25 p-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                          <span>{svc.agentName}</span>
                          <Badge variant="outline" className="text-[10px] font-normal">
                            Isolated
                          </Badge>
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {svc.enabledSkills.length}/{svc.skills.length} skills
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {svc.skills.map((sk) => {
                          const active = svc.enabledSkills.includes(sk.id);
                          return (
                            <span
                              key={sk.id}
                              className={cn(
                                "rounded-md border px-2 py-0.5 text-[10px] font-medium",
                                active
                                  ? "border-primary/40 bg-primary/10 text-foreground"
                                  : "border-border/70 text-muted-foreground line-through opacity-60"
                              )}
                            >
                              {sk.name}
                            </span>
                          );
                        })}
                      </div>

                      {isExpanded && (
                        <div className="pt-2 mt-2 border-t border-border/60 space-y-2">
                          <div className="text-[11px] font-medium text-muted-foreground">
                            Allowed Skills for {svc.agentName} (strictly isolated to {svc.shortName}):
                          </div>
                          {svc.skills.map((sk) => {
                            const checked = svc.enabledSkills.includes(sk.id);
                            return (
                              <label
                                key={sk.id}
                                className="flex items-start gap-2 rounded-lg border border-border/70 bg-card p-2 cursor-pointer hover:border-primary/50"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={isBusy}
                                  onChange={() => toggleSkill(svc, sk.id)}
                                  className="mt-0.5 accent-primary"
                                />
                                <div className="min-w-0">
                                  <div className="text-xs font-medium text-foreground">
                                    {sk.name}
                                  </div>
                                  <div className="text-[11px] text-muted-foreground">
                                    {sk.description}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/60">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        size="sm"
                        onClick={() => openAgent("screen", svc.id, svc.name)}
                      >
                        <Bot className="h-3.5 w-3.5" />
                        <span>Ask Agent</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setExpandedSkillsFor(isExpanded ? null : svc.id)}
                      >
                        <Sliders className="h-3.5 w-3.5" />
                        <span>{isExpanded ? "Done" : "Skills"}</span>
                      </Button>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isBusy}
                        onClick={() =>
                          void mutateService(
                            { serviceId: svc.id, pinnedToDashboard: false },
                            `Unpinned ${svc.name} from dashboard (still active in sandbox).`
                          )
                        }
                        aria-label={`Unpin ${svc.name}`}
                      >
                        <PinOff className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => void removeService(svc.id, svc.name)}
                        aria-label={`Remove ${svc.name} from sandbox`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Add Service to Sandbox Dialog */}
      <Dialog
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        ariaLabel="Add Service to Sandbox"
        className="max-w-2xl p-5 space-y-4"
      >
        <div className="flex items-start justify-between gap-2 border-b border-border/70 pb-3">
          <div>
            <h2 className="text-base font-semibold">Sandbox Service Catalog</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add services to your isolated sandbox. Each service installs its own isolated agent and skill permissions.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCatalogOpen(false)}
            aria-label="Close service catalog"
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 max-h-[65vh] overflow-y-auto pr-1">
          {services.map((svc) => {
            const Icon = SERVICE_ICONS[svc.id] ?? Layers;
            const isBusy = savingServiceId === svc.id;
            return (
              <div
                key={svc.id}
                className={cn(
                  "rounded-xl border p-3.5 space-y-2.5 transition-colors",
                  svc.enabled ? "border-primary/50 bg-muted/20" : "border-border bg-card"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <Icon className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">{svc.name}</div>
                      <div className="text-[11px] font-mono text-muted-foreground truncate">
                        {svc.agentName} · {svc.skills.length} skills
                      </div>
                    </div>
                  </div>
                  <Badge variant={svc.enabled ? "success" : "outline"} className="text-[10px]">
                    {svc.enabled ? "Active" : "Available"}
                  </Badge>
                </div>

                <p className="text-[11px] text-muted-foreground line-clamp-2">
                  {svc.description}
                </p>

                <div className="flex flex-wrap gap-1">
                  {svc.skills.map((sk) => (
                    <span
                      key={sk.id}
                      className="rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {sk.name}
                    </span>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  {svc.enabled ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => void removeService(svc.id, svc.name)}
                      className="w-full"
                    >
                      <Check className="h-3.5 w-3.5 text-primary" />
                      <span>Remove from Sandbox</span>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={isBusy}
                      onClick={() =>
                        void mutateService(
                          {
                            serviceId: svc.id,
                            enabled: true,
                            pinnedToDashboard: true
                          },
                          `Added ${svc.name} and ${svc.agentName} to your sandbox.`
                        )
                      }
                      className="w-full"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add to Sandbox</span>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Dialog>
    </div>
  );
}
