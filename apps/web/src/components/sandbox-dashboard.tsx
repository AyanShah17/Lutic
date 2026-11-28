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
  LayoutGrid,
  Pin,
  PinOff,
  Plug,
  Plus,
  QrCode,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import type { SessionUser } from "@lutic/core";
import { recommendServicesForGoal, type A2UISpec } from "@lutic/core/a2ui";
import { getPlanLimits, type PlanLimits, type PlanTier } from "@lutic/core/plan-limits";
import {
  buildVirtualDefaultSandboxServices,
  type SandboxServiceId,
  type TenantSandboxServiceView
} from "@lutic/core/sandbox-services";
import { A2UIRenderer } from "@/components/a2ui-renderer";
import { LuticLogo } from "@/components/lutic-logo";
import { useAppContext, type WorkspaceProfileView } from "@/components/providers";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

const GOAL_PRESETS = [
  {
    label: "KPI & Dashboards",
    goal: "Track KPIs, OEE dashboards, and workflow automations with alerts"
  },
  {
    label: "Task & Incident Triage",
    goal: "Triage operational tasks on AI Board, connect tools, and automate alerts"
  },
  {
    label: "Machine Fleet & Alerts",
    goal: "Monitor machines, alarms, and build automated pipelines"
  }
];

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

const DEFAULT_PROFILE: WorkspaceProfileView = {
  onboardingCompleted: true,
  goal: "",
  teamSize: "",
  primaryUseCase: "",
  pinnedA2UI: []
};

export function SandboxDashboard({
  user,
  snapshot,
  initialServices,
  initialProfile = DEFAULT_PROFILE,
  initialPlan = "free",
  initialLimits,
  initialConnectorCount = 0,
  primaryMachineHref,
  primaryMachineLabel
}: {
  user: SessionUser;
  snapshot: WorkspaceSnapshot | null;
  initialServices: TenantSandboxServiceView[];
  initialProfile?: WorkspaceProfileView;
  initialPlan?: PlanTier;
  initialLimits?: PlanLimits;
  initialConnectorCount?: number;
  primaryMachineHref: string;
  primaryMachineLabel: string;
}) {
  const {
    sandboxServices = [],
    workspaceProfile,
    planTier = initialPlan,
    planLimits,
    setSandboxServicesState
  } = useAppContext();

  const [services, setServices] = useState<TenantSandboxServiceView[]>(
    initialServices.length > 0 ? initialServices : buildVirtualDefaultSandboxServices()
  );
  const [profile, setProfile] = useState<WorkspaceProfileView>(initialProfile);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [savingServiceId, setSavingServiceId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Walkthrough state (for 0-service first-run workspaces)
  const [goalInput, setGoalInput] = useState("");
  const [teamSize, setTeamSize] = useState("Solo");
  const [selectedIds, setSelectedIds] = useState<SandboxServiceId[]>(() =>
    recommendServicesForGoal("", (initialLimits ?? getPlanLimits(initialPlan)).maxServices)
  );
  const [launching, setLaunching] = useState(false);

  // Prompt-built A2UI composer state
  const [a2uiPrompt, setA2uiPrompt] = useState("");
  const [buildingA2ui, setBuildingA2ui] = useState(false);

  const limits = planLimits ?? initialLimits ?? getPlanLimits(planTier);

  useEffect(() => {
    if (sandboxServices.length > 0) {
      setServices(sandboxServices);
    }
  }, [sandboxServices]);

  useEffect(() => {
    if (workspaceProfile) {
      setProfile(workspaceProfile);
    }
  }, [workspaceProfile]);

  useEffect(() => {
    const onA2uiUpdated = (ev: Event) => {
      const pinnedA2UI = (ev as CustomEvent<{ pinnedA2UI?: A2UISpec[] }>).detail?.pinnedA2UI;
      if (Array.isArray(pinnedA2UI)) {
        setProfile((prev) => ({ ...prev, pinnedA2UI }));
      }
    };
    window.addEventListener("lutic:a2ui-updated", onA2uiUpdated);
    return () => window.removeEventListener("lutic:a2ui-updated", onA2uiUpdated);
  }, []);

  const mutateService = async (
    payload: {
      serviceId: SandboxServiceId;
      enabled?: boolean;
      pinnedToDashboard?: boolean;
    },
    successMsg: string
  ) => {
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
        overviewAgent?: Parameters<typeof setSandboxServicesState>[1];
        workspaceProfile?: WorkspaceProfileView;
        detail?: string;
      };
      if (!res.ok || !data.services) {
        setNotice(data.detail ?? "Unable to update workspace service.");
        return;
      }
      setServices(data.services);
      if (data.workspaceProfile) setProfile(data.workspaceProfile);
      setSandboxServicesState(data.services, data.overviewAgent ?? null, data.workspaceProfile ?? null);
      setNotice(successMsg);
    } catch {
      setNotice("Failed to update workspace service.");
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
        overviewAgent?: Parameters<typeof setSandboxServicesState>[1];
        workspaceProfile?: WorkspaceProfileView;
        detail?: string;
      };
      if (!res.ok || !data.services) {
        setNotice(data.detail ?? `Unable to remove ${name}.`);
        return;
      }
      setServices(data.services);
      if (data.workspaceProfile) setProfile(data.workspaceProfile);
      setSandboxServicesState(data.services, data.overviewAgent ?? null, data.workspaceProfile ?? null);
      setNotice(`Removed ${name} from your workspace.`);
    } catch {
      setNotice(`Failed to remove ${name}.`);
    } finally {
      setSavingServiceId(null);
    }
  };

  const handleLaunchWalkthrough = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedIds.length === 0 || launching) return;
    setLaunching(true);
    setNotice(null);
    try {
      const res = await fetch("/api/sandbox/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete_onboarding",
          goal: goalInput.trim() || "Custom operational workspace",
          teamSize,
          serviceIds: selectedIds
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        services?: TenantSandboxServiceView[];
        overviewAgent?: Parameters<typeof setSandboxServicesState>[1];
        workspaceProfile?: WorkspaceProfileView;
        detail?: string;
      };
      if (!res.ok || !data.services) {
        setNotice(data.detail ?? "Unable to launch workspace.");
        return;
      }
      setServices(data.services);
      if (data.workspaceProfile) setProfile(data.workspaceProfile);
      setSandboxServicesState(data.services, data.overviewAgent ?? null, data.workspaceProfile ?? null);
      setNotice("Workspace configured and launched.");
    } catch {
      setNotice("Failed to launch workspace.");
    } finally {
      setLaunching(false);
    }
  };

  const handleBuildCustomA2ui = async (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = a2uiPrompt.trim();
    if (!prompt || buildingA2ui) return;
    setBuildingA2ui(true);
    setNotice(null);
    try {
      const res = await fetch("/api/ai/a2ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", prompt, pin: true })
      });
      const data = (await res.json().catch(() => ({}))) as {
        spec?: A2UISpec;
        pinnedA2UI?: A2UISpec[];
        detail?: string;
      };
      if (!res.ok || !data.pinnedA2UI) {
        setNotice(data.detail ?? "Unable to generate custom view.");
        return;
      }
      setProfile((prev) => ({ ...prev, pinnedA2UI: data.pinnedA2UI! }));
      setA2uiPrompt("");
      setNotice(`Added "${data.spec?.title ?? "Custom View"}" to your dashboard.`);
    } catch {
      setNotice("Failed to generate custom view.");
    } finally {
      setBuildingA2ui(false);
    }
  };

  const handleUnpinA2ui = async (specId: string) => {
    try {
      const res = await fetch("/api/ai/a2ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unpin", specId })
      });
      const data = (await res.json().catch(() => ({}))) as { pinnedA2UI?: A2UISpec[] };
      if (res.ok && data.pinnedA2UI) {
        setProfile((prev) => ({ ...prev, pinnedA2UI: data.pinnedA2UI! }));
      }
    } catch {
      setNotice("Failed to remove custom view.");
    }
  };

  const openAgent = (
    scope: "screen" | "global",
    serviceId: SandboxServiceId | "overview",
    label: string
  ) => {
    window.dispatchEvent(
      new CustomEvent("lutic:open-ai", {
        detail: { scope, serviceId, entityName: label }
      })
    );
  };

  const enabledServices = services.filter((s) => s.enabled);
  const pinnedServices = enabledServices.filter((s) => s.pinnedToDashboard);
  const unpinnedEnabled = enabledServices.filter((s) => !s.pinnedToDashboard);
  const atServiceCap = enabledServices.length >= limits.maxServices;
  const showWalkthrough = enabledServices.length === 0 && !profile.onboardingCompleted;

  if (showWalkthrough) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 pb-24 sm:px-6 space-y-6">
        <div className="space-y-2 border-b border-border/70 pb-5">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <LuticLogo className="h-4 w-4" />
            <span>{user.name} · Welcome to Lutic</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground">
            Set up your workspace
          </h1>
          <p className="text-sm text-muted-foreground">
            Tell us what you want to automate first, pick up to {limits.maxServices} starter services, and launch your personalized dashboard.
          </p>
        </div>

        {notice && (
          <div className="rounded-lg border border-border bg-muted/50 px-3.5 py-2 text-xs font-medium flex items-center justify-between gap-2">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <form onSubmit={(e) => void handleLaunchWalkthrough(e)} className="space-y-6">
          <Card className="p-5 rounded-2xl space-y-4">
            <div className="space-y-1">
              <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Step 1 · Your Goal
              </div>
              <h2 className="text-sm font-semibold">What are you building or monitoring first?</h2>
            </div>

            <Input
              value={goalInput}
              onChange={(e) => {
                const val = e.target.value;
                setGoalInput(val);
                if (val.trim().length >= 4) {
                  setSelectedIds(recommendServicesForGoal(val, limits.maxServices));
                }
              }}
              placeholder="e.g., Track line OEE dashboards, triage faults on board, and automate alerts"
              aria-label="Workspace goal"
            />

            <div className="flex flex-wrap items-center gap-1.5">
              {GOAL_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setGoalInput(preset.goal);
                    setSelectedIds(recommendServicesForGoal(preset.goal, limits.maxServices));
                  }}
                  className="rounded-full border border-border bg-muted/30 px-2.5 py-1 text-[11px] font-medium hover:border-primary/60"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-muted-foreground">Team size:</span>
              {["Solo", "2-10", "11+"].map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setTeamSize(sz)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    teamSize === sz
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:bg-muted"
                  )}
                >
                  {sz}
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-5 rounded-2xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Step 2 · Choose Services ({selectedIds.length}/{limits.maxServices} on {planTier} plan)
                </div>
                <h2 className="text-sm font-semibold">
                  Select up to {limits.maxServices} services ({limits.maxAgents} AI assistants included)
                </h2>
              </div>
              <Badge variant="outline" className="font-mono text-[11px]">
                {selectedIds.length}/{limits.maxServices} selected
              </Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {services.map((svc) => {
                const Icon = SERVICE_ICONS[svc.id] ?? Layers;
                const checked = selectedIds.includes(svc.id);
                const disabledChoice = !checked && selectedIds.length >= limits.maxServices;
                return (
                  <button
                    key={svc.id}
                    type="button"
                    disabled={disabledChoice}
                    onClick={() => {
                      setSelectedIds((prev) =>
                        prev.includes(svc.id)
                          ? prev.filter((id) => id !== svc.id)
                          : prev.length < limits.maxServices
                            ? [...prev, svc.id]
                            : prev
                      );
                    }}
                    className={cn(
                      "text-left rounded-xl border p-3.5 transition-colors space-y-1.5",
                      checked
                        ? "border-primary bg-primary/5"
                        : disabledChoice
                          ? "border-border/50 bg-muted/20 opacity-55 cursor-not-allowed"
                          : "border-border bg-card hover:border-primary/40"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className="h-4 w-4 text-primary shrink-0" />
                        <span className="text-xs font-semibold truncate">{svc.name}</span>
                      </div>
                      <Badge variant={checked ? "success" : "outline"} className="text-[10px]">
                        {checked ? "Selected" : disabledChoice ? "Plan Limit" : "Select"}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2">{svc.description}</p>
                  </button>
                );
              })}
            </div>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              Free tier includes {limits.maxServices} services, {limits.maxAgents} AI assistants, and {limits.maxConnectors} external connectors.
            </span>
            <Button type="submit" disabled={selectedIds.length === 0 || launching}>
              <Sparkles className="h-4 w-4" />
              <span>{launching ? "Launching Workspace..." : "Launch Workspace"}</span>
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6 space-y-7">
      <section className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between border-b border-border/70 pb-6">
        <div className="space-y-1.5 max-w-2xl">
          <div className="inline-flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
            <LuticLogo className="h-4 w-4" />
            <span>{user.name} · Workspace</span>
            <span className="font-mono text-[11px] rounded-full border border-border px-2 py-0.5">
              {enabledServices.length}/{limits.maxServices} services · {initialConnectorCount}/{limits.maxConnectors} connectors ({planTier})
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground">
            Lutic AI Workspace
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {profile.goal
              ? `Goal: ${profile.goal}`
              : "Add services to your workspace and manage them directly from your dashboard."}
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
            aria-label="Dismiss workspace notice"
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

      {/* Prompt-Built Custom Views (A2UI) */}
      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Custom Prompt Views</h2>
            <p className="text-xs text-muted-foreground">
              Describe any KPI card, status table, or interactive intake form to generate it on your dashboard.
            </p>
          </div>
        </div>

        <form onSubmit={(e) => void handleBuildCustomA2ui(e)} className="flex flex-wrap items-center gap-2">
          <Input
            value={a2uiPrompt}
            onChange={(e) => setA2uiPrompt(e.target.value)}
            placeholder="Describe a view (e.g., Show OEE chart & active tasks, or create an intake form)..."
            aria-label="Build custom UI from prompt"
            className="flex-1 min-w-[240px]"
          />
          <Button type="submit" size="default" disabled={!a2uiPrompt.trim() || buildingA2ui}>
            <LayoutGrid className="h-4 w-4" />
            <span>{buildingA2ui ? "Building View..." : "Generate View"}</span>
          </Button>
        </form>

        {profile.pinnedA2UI.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {profile.pinnedA2UI.map((spec) => (
              <A2UIRenderer
                key={spec.id}
                spec={spec}
                pinned
                onUnpin={(id) => void handleUnpinA2ui(id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Overview Agent Card */}
      <Card className="p-5 rounded-2xl border-border/80 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
              <Bot className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold tracking-tight">Overview Agent</h2>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {enabledServices.length}/{limits.maxServices} services active
                </span>
              </div>
              <p className="text-xs text-muted-foreground max-w-2xl">
                Ask questions or run actions across all services active in your workspace.
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

        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/60">
          {enabledServices.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              No services added yet. Click Add Service to get started.
            </span>
          ) : (
            enabledServices.map((svc) => (
              <Badge key={svc.id} variant="outline" className="text-[11px] gap-1 font-normal">
                <CheckCircle2 className="h-3 w-3 text-primary" />
                <span>{svc.name}</span>
              </Badge>
            ))
          )}
        </div>
      </Card>

      {/* Customizable Workspace Dashboard Cards */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">
              My Dashboard ({pinnedServices.length})
            </h2>
            <p className="text-xs text-muted-foreground">
              Open any service or ask its dedicated assistant.
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
                      `Pinned ${svc.name} to your dashboard.`
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
              No services pinned to your dashboard yet. Add a service to get started.
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
              const isBusy = savingServiceId === svc.id;
              return (
                <Card key={svc.id} className="p-4 rounded-2xl space-y-4 flex flex-col justify-between">
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

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/60">
                    <Button
                      size="sm"
                      onClick={() => openAgent("screen", svc.id, svc.name)}
                    >
                      <Bot className="h-3.5 w-3.5" />
                      <span>Ask {svc.shortName}</span>
                    </Button>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isBusy}
                        onClick={() =>
                          void mutateService(
                            { serviceId: svc.id, pinnedToDashboard: false },
                            `Unpinned ${svc.name} from dashboard.`
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
                        aria-label={`Remove ${svc.name} from workspace`}
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

      {/* Add Service Dialog */}
      <Dialog
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        ariaLabel="Add Service"
        className="max-w-2xl p-5 space-y-4"
      >
        <div className="flex items-start justify-between gap-2 border-b border-border/70 pb-3">
          <div>
            <h2 className="text-base font-semibold">Services Catalog</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {enabledServices.length}/{limits.maxServices} active services on your {planTier} plan. Remove one to swap in another.
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
                  "rounded-xl border p-3.5 space-y-3 transition-colors flex flex-col justify-between",
                  svc.enabled ? "border-primary/50 bg-muted/20" : "border-border bg-card"
                )}
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className="h-4 w-4 text-primary shrink-0" />
                      <div className="text-xs font-semibold truncate">{svc.name}</div>
                    </div>
                    <Badge variant={svc.enabled ? "success" : "outline"} className="text-[10px]">
                      {svc.enabled ? "Active" : "Available"}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-2">
                    {svc.description}
                  </p>
                </div>

                <div>
                  {svc.enabled ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => void removeService(svc.id, svc.name)}
                      className="w-full"
                    >
                      <Check className="h-3.5 w-3.5 text-primary" />
                      <span>Remove from Workspace</span>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={isBusy || atServiceCap}
                      onClick={() =>
                        void mutateService(
                          {
                            serviceId: svc.id,
                            enabled: true,
                            pinnedToDashboard: true
                          },
                          `Added ${svc.name} to your workspace.`
                        )
                      }
                      className="w-full"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>
                        {atServiceCap
                          ? `Plan limit (${enabledServices.length}/${limits.maxServices})`
                          : "Add to Workspace"}
                      </span>
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
