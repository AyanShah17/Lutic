"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
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
  Lock,
  Pin,
  PinOff,
  Plug,
  Plus,
  QrCode,
  RotateCcw,
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

const SERVICE_GROUPS: Array<{
  id: "operations" | "automation" | "messaging";
  title: string;
  subtitle: string;
}> = [
  {
    id: "operations",
    title: "Core Operations",
    subtitle: "Incident boards, fleet asset state, and live threshold monitoring."
  },
  {
    id: "automation",
    title: "Automation & Data",
    subtitle: "Semantic KPI dashboards, workflow pipelines, and SaaS/OT connectors."
  },
  {
    id: "messaging",
    title: "Messaging & Delivery",
    subtitle: "Pub/sub alert routing and durable background queues."
  }
];

const STARTER_TEMPLATES = [
  {
    id: "analytics-automation",
    label: "KPIs & Automation",
    summary: "Metrics dashboards, scheduled workflows, and task tracking.",
    goal: "Track OEE dashboards, triage board tasks, and automate workflows"
  },
  {
    id: "ops-triage",
    label: "Incident & Board Ops",
    summary: "Escalation board, live alerts, and third-party tool sync.",
    goal: "Triage operational tasks on AI Board, connect tools, and automate alerts"
  },
  {
    id: "fleet-telemetry",
    label: "Fleet & Monitoring",
    summary: "Equipment status, alarm thresholds, and remediation pipelines.",
    goal: "Monitor machines, alarms, and build automated pipelines"
  },
  {
    id: "custom",
    label: "Start Clean",
    summary: "Describe your own focus and pick services manually.",
    goal: ""
  }
];

const A2UI_QUICK_CHIPS = [
  { label: "OEE & Shift Chart", prompt: "Show OEE chart & active shift KPIs" },
  { label: "Triage Intake Form", prompt: "Create a triage intake form and open tasks table" },
  { label: "Pipeline Status", prompt: "Show automation workflow pipeline health" },
  { label: "Connector Health", prompt: "Show connected apps and sync status" }
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

function QuotaProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mt-2">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          pct >= 100 ? "bg-amber-500" : "bg-primary"
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

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

  // Progressive 3-step SaaS walkthrough state
  const [walkthroughStep, setWalkthroughStep] = useState<1 | 2 | 3>(1);
  const [selectedTemplateId, setSelectedTemplateId] = useState("analytics-automation");
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

  const handleLaunchWalkthrough = async (e?: React.FormEvent) => {
    e?.preventDefault();
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

  const handleBuildCustomA2ui = async (overridePrompt?: string) => {
    const prompt = (overridePrompt ?? a2uiPrompt).trim();
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
      if (!overridePrompt) setA2uiPrompt("");
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

  const handleReopenWalkthrough = async () => {
    setCatalogOpen(false);
    try {
      const res = await fetch("/api/sandbox/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_onboarding" })
      });
      const data = (await res.json().catch(() => ({}))) as {
        services?: TenantSandboxServiceView[];
        overviewAgent?: Parameters<typeof setSandboxServicesState>[1];
        workspaceProfile?: WorkspaceProfileView;
      };
      if (res.ok && data.workspaceProfile) {
        setWalkthroughStep(1);
        setProfile(data.workspaceProfile);
        setSandboxServicesState(data.services ?? services, data.overviewAgent ?? null, data.workspaceProfile);
      }
    } catch {
      setNotice("Could not reset setup guide.");
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
  const selectedServicesPreview = services.filter((s) => selectedIds.includes(s.id));

  if (showWalkthrough) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 pb-24 sm:px-6 space-y-6">
        <div className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <LuticLogo className="h-4 w-4" />
              <span>{user.name} · Workspace Setup</span>
              <Badge variant="outline" className="font-mono text-[10px] capitalize">
                {planTier} Plan
              </Badge>
            </div>
            <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-foreground">
              Set up your workspace
            </h1>
            <p className="text-sm text-muted-foreground max-w-xl">
              Configure your goal and enable the cloud services you need. We automatically wire each enabled service, assistant, and starter view.
            </p>
          </div>

          <nav aria-label="Setup steps" className="flex items-center gap-1.5 text-xs">
            {[
              { id: 1 as const, label: "1. Define" },
              { id: 2 as const, label: "2. Services" },
              { id: 3 as const, label: "3. Launch" }
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setWalkthroughStep(s.id)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 font-medium transition-colors",
                  walkthroughStep === s.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : walkthroughStep > s.id
                      ? "border-primary/40 bg-primary/5 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </div>

        {notice && (
          <div className="rounded-lg border border-border bg-muted/50 px-3.5 py-2 text-xs font-medium flex items-center justify-between gap-2">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
          {/* Left Interactive Setup Step */}
          <div className="space-y-5">
            {walkthroughStep === 1 && (
              <Card className="p-5 sm:p-6 rounded-2xl space-y-5">
                <div className="space-y-1">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-primary">
                    Step 1 of 3 · Define Workspace
                  </div>
                  <h2 className="text-base font-semibold">Pick a starter profile or describe your goal</h2>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-2">
                  {STARTER_TEMPLATES.map((tpl) => {
                    const active = selectedTemplateId === tpl.id;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => {
                          setSelectedTemplateId(tpl.id);
                          setGoalInput(tpl.goal);
                          if (tpl.goal) {
                            setSelectedIds(recommendServicesForGoal(tpl.goal, limits.maxServices));
                          }
                        }}
                        className={cn(
                          "text-left rounded-xl border p-3.5 transition-colors space-y-1",
                          active
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card hover:border-primary/40"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-foreground">{tpl.label}</span>
                          {active && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
                        </div>
                        <p className="text-[11px] text-muted-foreground">{tpl.summary}</p>
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-foreground block">
                    What are you automating or monitoring first?
                  </label>
                  <Input
                    value={goalInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setGoalInput(val);
                      if (val.trim().length >= 4) {
                        setSelectedIds(recommendServicesForGoal(val, limits.maxServices));
                      }
                    }}
                    placeholder="e.g., Track OEE dashboards, triage board tasks, and automate workflows"
                    aria-label="Workspace goal"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
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

                  <Button type="button" onClick={() => setWalkthroughStep(2)}>
                    <span>Continue to Services</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            )}

            {walkthroughStep === 2 && (
              <Card className="p-5 sm:p-6 rounded-2xl space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-1">
                    <div className="text-[11px] font-mono uppercase tracking-wider text-primary">
                      Step 2 of 3 · Enable Services
                    </div>
                    <h2 className="text-base font-semibold">
                      Choose up to {limits.maxServices} services ({selectedIds.length}/{limits.maxServices} selected)
                    </h2>
                  </div>
                  <Badge variant="outline" className="font-mono text-[11px]">
                    {selectedIds.length}/{limits.maxServices} selected
                  </Badge>
                </div>

                <div className="space-y-4">
                  {SERVICE_GROUPS.map((group) => {
                    const groupServices = services.filter((s) => s.group === group.id);
                    if (groupServices.length === 0) return null;
                    return (
                      <div key={group.id} className="space-y-2">
                        <div>
                          <h3 className="text-xs font-semibold text-foreground">{group.title}</h3>
                          <p className="text-[11px] text-muted-foreground">{group.subtitle}</p>
                        </div>
                        <div className="grid gap-2.5 sm:grid-cols-2">
                          {groupServices.map((svc) => {
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
                                  <Badge variant={checked ? "success" : "outline"} className="text-[10px] shrink-0">
                                    {checked ? "Selected" : disabledChoice ? "Plan Limit" : "Enable"}
                                  </Badge>
                                </div>
                                <p className="text-[11px] text-muted-foreground line-clamp-2">
                                  {svc.description}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/60">
                  <Button type="button" variant="outline" onClick={() => setWalkthroughStep(1)}>
                    <ArrowLeft className="h-4 w-4" />
                    <span>Back</span>
                  </Button>
                  <Button
                    type="button"
                    disabled={selectedIds.length === 0}
                    onClick={() => setWalkthroughStep(3)}
                  >
                    <span>Review &amp; Launch</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            )}

            {walkthroughStep === 3 && (
              <Card className="p-5 sm:p-6 rounded-2xl space-y-5">
                <div className="space-y-1">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-primary">
                    Step 3 of 3 · Provision Workspace
                  </div>
                  <h2 className="text-base font-semibold">Review configuration and launch</h2>
                  <p className="text-xs text-muted-foreground">
                    Your workspace is provisioned cleanly with dedicated data isolation, rate protection, and a starter view tailored to your goal.
                  </p>
                </div>

                <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
                    <span className="text-muted-foreground">Workspace Goal</span>
                    <span className="font-medium text-right max-w-xs truncate">
                      {goalInput.trim() || "Custom operational workspace"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
                    <span className="text-muted-foreground">Team Size</span>
                    <span className="font-mono">{teamSize}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Enabled Services</span>
                    <span className="font-mono">
                      {selectedIds.length}/{limits.maxServices} active
                    </span>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  {selectedServicesPreview.map((svc) => {
                    const Icon = SERVICE_ICONS[svc.id] ?? Layers;
                    return (
                      <div key={svc.id} className="rounded-xl border border-border bg-card p-3 space-y-1">
                        <div className="flex items-center gap-1.5 text-xs font-semibold">
                          <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="truncate">{svc.name}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">{svc.tag}</div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/60">
                  <Button type="button" variant="outline" onClick={() => setWalkthroughStep(2)}>
                    <ArrowLeft className="h-4 w-4" />
                    <span>Edit Services</span>
                  </Button>
                  <Button
                    type="button"
                    disabled={selectedIds.length === 0 || launching}
                    onClick={() => void handleLaunchWalkthrough()}
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>{launching ? "Provisioning Workspace..." : "Launch Workspace"}</span>
                  </Button>
                </div>
              </Card>
            )}
          </div>

          {/* Right Sticky Blueprint Preview Panel (Supabase / Cloudflare Style) */}
          <Card className="p-5 rounded-2xl border-border/80 space-y-4 lg:sticky lg:top-20">
            <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-3">
              <div>
                <div className="text-xs font-semibold text-foreground">Workspace Blueprint</div>
                <div className="text-[11px] text-muted-foreground capitalize">{planTier} Plan</div>
              </div>
              <Badge variant="outline" className="font-mono text-[10px]">
                {selectedIds.length}/{limits.maxServices} Services
              </Badge>
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Service allocation</span>
                <span className="font-mono tabular-nums">
                  {selectedIds.length} / {limits.maxServices}
                </span>
              </div>
              <QuotaProgressBar value={selectedIds.length} max={limits.maxServices} />
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-muted-foreground">Active Modules</div>
              {selectedServicesPreview.length === 0 ? (
                <div className="text-xs text-muted-foreground py-2">No services selected yet.</div>
              ) : (
                <div className="space-y-1.5">
                  {selectedServicesPreview.map((svc) => (
                    <div
                      key={svc.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs"
                    >
                      <span className="font-medium truncate">{svc.name}</span>
                      <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/15 p-3 space-y-1.5 text-[11px]">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Lock className="h-3 w-3 text-primary" />
                <span>Included Quotas</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>AI Assistants</span>
                <span className="font-mono">Up to {limits.maxAgents}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>External Connectors</span>
                <span className="font-mono">Up to {limits.maxConnectors}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>API / AI Rate Cap</span>
                <span className="font-mono">
                  {limits.apiRequestsPerDay}/d · {limits.aiRequestsPerDay}/d
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-7 pb-24 sm:px-6 space-y-7">
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

      {/* Plan Quotas & Resource Usage Strip */}
      <section aria-label="Workspace Plan Quotas" className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4 rounded-2xl border-border/80">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Workspace Services</span>
            <Badge variant="outline" className="font-mono text-[10px] capitalize">
              {planTier}
            </Badge>
          </div>
          <div className="mt-1 text-lg font-semibold font-mono tabular-nums">
            {enabledServices.length}
            <span className="text-xs font-normal text-muted-foreground">
              /{limits.maxServices}
            </span>
          </div>
          <QuotaProgressBar value={enabledServices.length} max={limits.maxServices} />
        </Card>

        <Card className="p-4 rounded-2xl border-border/80">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>AI Assistants</span>
            <span className="text-[11px] font-mono">
              {limits.aiRequestsPerMinute}/min · {limits.aiRequestsPerDay}/day
            </span>
          </div>
          <div className="mt-1 text-lg font-semibold font-mono tabular-nums">
            {Math.min(enabledServices.length, limits.maxAgents)}
            <span className="text-xs font-normal text-muted-foreground">
              /{limits.maxAgents}
            </span>
          </div>
          <QuotaProgressBar
            value={Math.min(enabledServices.length, limits.maxAgents)}
            max={limits.maxAgents}
          />
        </Card>

        <Card className="p-4 rounded-2xl border-border/80">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Connected Integrations</span>
            <Link href="/connectors" className="text-[11px] font-medium text-primary hover:underline">
              Manage
            </Link>
          </div>
          <div className="mt-1 text-lg font-semibold font-mono tabular-nums">
            {initialConnectorCount}
            <span className="text-xs font-normal text-muted-foreground">
              /{limits.maxConnectors}
            </span>
          </div>
          <QuotaProgressBar value={initialConnectorCount} max={limits.maxConnectors} />
        </Card>
      </section>

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
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Custom Prompt Views</h2>
          <p className="text-xs text-muted-foreground">
            Describe any KPI card, status table, or interactive intake form to generate it on your dashboard.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleBuildCustomA2ui();
          }}
          className="flex flex-wrap items-center gap-2"
        >
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

        <div className="flex flex-wrap items-center gap-1.5">
          {A2UI_QUICK_CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              disabled={buildingA2ui}
              onClick={() => void handleBuildCustomA2ui(chip.prompt)}
              className="rounded-full border border-border bg-muted/30 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
            >
              + {chip.label}
            </button>
          ))}
        </div>

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
          <div className="flex items-center gap-1">
            {planTier !== "enterprise" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleReopenWalkthrough()}
                className="text-xs text-muted-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Setup Guide</span>
              </Button>
            )}
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
