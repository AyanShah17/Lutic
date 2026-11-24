"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GitBranch, Play, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { useAppContext } from "@/components/providers";
import { AuthGate } from "@/components/ui/auth-gate";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SpotlightNavbar } from "@/components/vengeance/spotlight-navbar";

interface WorkflowListItem {
  id: string;
  name: string;
  description: string;
  triggerType: string;
  enabled: boolean;
  currentVersion: number;
  nodes?: unknown[];
  updatedAt: string;
}

export default function WorkflowsPage() {
  const router = useRouter();
  const { user } = useAppContext();
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [triggerFilter, setTriggerFilter] = useState("all");
  const [aiPrompt, setAiPrompt] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canWrite = user?.role === "analyst" || user?.role === "admin";
  const canExecute =
    user?.role === "engineer" ||
    user?.role === "analyst" ||
    user?.role === "admin";

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/workflows", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { workflows: WorkflowListItem[] };
        setWorkflows(data.workflows ?? []);
      } else {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setLoadError(err.detail ?? "Failed to load workflows");
      }
    } catch {
      setLoadError("Failed to load workflows");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) void load();
    else setLoading(false);
  }, [user]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return workflows.filter((wf) => {
      if (triggerFilter !== "all" && wf.triggerType !== triggerFilter) return false;
      if (!q) return true;
      return (
        wf.name.toLowerCase().includes(q) ||
        wf.description.toLowerCase().includes(q) ||
        wf.triggerType.toLowerCase().includes(q)
      );
    });
  }, [workflows, search, triggerFilter]);

  if (!user) {
    return (
      <AuthGate
        title="Sign in to view Workflows"
        description="Automated DAG orchestration and the Workflow Builder require an authenticated Kojo session."
      />
    );
  }

  const handleAiCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim() || !canWrite) return;
    setBusy(true);
    setNotice(null);
    try {
      const buildRes = await fetch("/api/workflows/ai-build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt.trim() })
      });
      if (!buildRes.ok) {
        const err = (await buildRes.json().catch(() => ({}))) as { detail?: string };
        setNotice(err.detail ?? "Draft builder failed");
        return;
      }
      const { workflow } = (await buildRes.json()) as {
        workflow: {
          name: string;
          description: string;
          triggerType: "manual" | "schedule" | "alert" | "connector";
          triggerConfig: Record<string, unknown>;
          nodes: unknown[];
          edges: unknown[];
        };
      };

      const saveRes = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workflow)
      });
      if (saveRes.ok) {
        const created = (await saveRes.json()) as { id: string };
        router.push(`/workflows/${created.id}`);
      } else {
        const err = (await saveRes.json().catch(() => ({}))) as { detail?: string };
        setNotice(err.detail ?? "Failed to save generated workflow draft");
      }
    } catch {
      setNotice("Workflow draft request failed");
    } finally {
      setBusy(false);
    }
  };

  const handleBlankCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !canWrite) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          triggerType: "manual",
          nodes: [
            { id: "n1", type: "trigger", label: "Manual Trigger", config: {}, position: { x: 80, y: 120 } },
            { id: "n2", type: "notify", label: "Send Alert", config: { topicId: "topic-plant-alerts" }, position: { x: 320, y: 120 } }
          ],
          edges: [{ id: "e1", source: "n1", target: "n2" }]
        })
      });
      if (res.ok) {
        const created = (await res.json()) as { id: string };
        router.push(`/workflows/${created.id}`);
      } else {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setNotice(err.detail ?? "Failed to create workflow");
      }
    } catch {
      setNotice("Failed to create workflow");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Orchestration
          </div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-primary" />
            <span>Workflows &amp; Builder</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Build visual node-and-edge operational workflows across alerts, MCP connectors, queues, and work orders.
          </p>
        </div>

        <div className="relative w-full sm:w-auto">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workflows..."
            aria-label="Search workflows"
            className="pl-8 w-full sm:w-56"
          />
        </div>
      </div>

      {notice && (
        <div className="rounded-md border border-border bg-muted/60 px-3.5 py-2 text-xs font-medium flex items-center justify-between gap-2 min-w-0">
          <span className="min-w-0 break-words">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss notice"
            className="shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {!loading && loadError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive flex items-center justify-between gap-3 min-w-0"
        >
          <span className="min-w-0 break-words">{loadError}</span>
          <Button variant="outline" size="sm" onClick={() => void load()} className="shrink-0">
            Retry
          </Button>
        </div>
      )}

      {canWrite && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2 p-4 space-y-2.5 min-w-0">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                <Sparkles className="h-4 w-4" />
                <span>Rule-Based Workflow Builder (Keyword Draft)</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Generates a draft graph from machine ID, metric (temperature, vibration, pressure, currentSpeed), and threshold keywords without calling a live LLM.
              </p>
            </div>
            <form onSubmit={handleAiCreate} className="flex flex-col sm:flex-row gap-2">
              <Input
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder='Describe a workflow, e.g. "When CNC mach-l1-cnc-01 temperature exceeds 80C, check alarms and notify"'
                aria-label="Workflow draft description"
                className="flex-1 min-w-0"
              />
              <Button type="submit" disabled={busy || !aiPrompt.trim()}>
                Generate Draft
              </Button>
            </form>
          </Card>

          <Card className="p-4 space-y-2.5 min-w-0">
            <div className="text-xs font-semibold">New Blank Workflow</div>
            <form onSubmit={handleBlankCreate} className="flex gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Workflow name"
                aria-label="New workflow name"
                className="flex-1 min-w-0"
              />
              <Button type="submit" variant="outline" disabled={busy || !newName.trim()}>
                <Plus className="h-3.5 w-3.5" />
                <span>Create</span>
              </Button>
            </form>
          </Card>
        </div>
      )}

      <SpotlightNavbar
        activeId={triggerFilter}
        onSelect={setTriggerFilter}
        items={[
          { id: "all", label: "All Triggers", badge: workflows.length },
          {
            id: "alert",
            label: "Alert",
            badge: workflows.filter((w) => w.triggerType === "alert").length
          },
          {
            id: "schedule",
            label: "Schedule",
            badge: workflows.filter((w) => w.triggerType === "schedule").length
          },
          {
            id: "manual",
            label: "Manual",
            badge: workflows.filter((w) => w.triggerType === "manual").length
          },
          {
            id: "connector",
            label: "Connector",
            badge: workflows.filter((w) => w.triggerType === "connector").length
          }
        ]}
      />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="h-44 rounded-lg border border-border bg-muted animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-xs text-muted-foreground">
          {workflows.length === 0
            ? (loadError ?? "No workflows created for this tenant yet.")
            : "No workflows match your active filter."}
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((wf) => (
            <Card key={wf.id} className="flex flex-col justify-between min-w-0">
              <CardHeader className="space-y-1.5">
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <CardTitle className="leading-snug min-w-0 break-words">
                    <Link
                      href={`/workflows/${wf.id}`}
                      className="hover:text-primary transition-colors"
                    >
                      {wf.name}
                    </Link>
                  </CardTitle>
                  <Badge variant="secondary" className="uppercase font-mono text-[10px] shrink-0">
                    v{wf.currentVersion} · {wf.triggerType}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {wf.description || "Automated workflow DAG"}
                </p>
                <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground tabular-nums">
                  <span>{wf.nodes?.length ?? 0} nodes</span>
                  <span>·</span>
                  <Badge variant={wf.enabled ? "success" : "outline"} className="text-[10px]">
                    {wf.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="flex items-center justify-between gap-2 pt-3 border-t border-border/60">
                <Link href={`/workflows/${wf.id}`} className={buttonVariants({ size: "sm" })}>
                  Open Canvas
                </Link>
                <div className="flex items-center gap-1.5">
                  {canExecute && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          const res = await fetch(`/api/workflows/${wf.id}/run`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({})
                          });
                          const d = (await res.json().catch(() => ({}))) as {
                            run?: { id: string; status: string };
                            detail?: string;
                          };
                          setNotice(
                            res.ok && d.run
                              ? `Triggered ${wf.name}: ${d.run.status}`
                              : d.detail ?? "Failed to trigger workflow"
                          );
                        } catch {
                          setNotice("Failed to trigger workflow");
                        }
                      }}
                    >
                      <Play className="h-3 w-3" />
                      <span>Run</span>
                    </Button>
                  )}
                  {canWrite && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={async () => {
                        try {
                          const res = await fetch(`/api/workflows/${wf.id}`, {
                            method: "DELETE"
                          });
                          if (res.ok) {
                            await load();
                          } else {
                            const err = (await res.json().catch(() => ({}))) as { detail?: string };
                            setNotice(err.detail ?? "Failed to delete workflow");
                          }
                        } catch {
                          setNotice("Failed to delete workflow");
                        }
                      }}
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      aria-label={`Delete ${wf.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
