"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Copy, Plus, Search, Sparkles, X } from "lucide-react";
import { useAppContext } from "@/components/providers";
import { AuthGate } from "@/components/ui/auth-gate";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SpotlightNavbar } from "@/components/vengeance/spotlight-navbar";

interface DashboardRow {
  id: string;
  title: string;
  description: string;
  currentVersion: number;
  isTemplate: boolean;
  plantScope: string[];
}

export default function DashboardsListPage() {
  const router = useRouter();
  const { user } = useAppContext();
  const [aiPrompt, setAiPrompt] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboards", user?.userId],
    enabled: Boolean(user),
    queryFn: async () => {
      const res = await fetch("/api/dashboards");
      if (!res.ok) throw new Error("Failed to load dashboards");
      return (await res.json()) as { dashboards: DashboardRow[] };
    }
  });

  const all = useMemo(() => data?.dashboards ?? [], [data?.dashboards]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((d) => {
      if (category === "custom" && d.isTemplate) return false;
      if (category === "templates" && !d.isTemplate) return false;
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q)
      );
    });
  }, [all, category, search]);

  const templates = filtered.filter((d) => d.isTemplate);
  const custom = filtered.filter((d) => !d.isTemplate);

  if (!user) {
    return (
      <AuthGate
        title="Sign in to view Dashboards"
        description="Operational KPI boards and semantic analytics are governed by your plant scope and role permissions."
      />
    );
  }

  const canWrite = user.role === "analyst" || user.role === "admin";

  const handleCloneTemplate = async (tpl: DashboardRow) => {
    setCreating(true);
    setNotice(null);
    try {
      const res = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${tpl.title.split("—")[0]!.trim()} (Copy)`,
          fromTemplateId: tpl.id
        })
      });
      if (res.ok) {
        const d = (await res.json()) as { dashboardId: string };
        router.push(`/dashboards/${d.dashboardId}`);
      } else {
        const err = (await res.json()) as { detail?: string };
        setNotice(err.detail ?? "Failed to clone template");
      }
    } finally {
      setCreating(false);
    }
  };

  const handleGenerateFromPrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;
    setCreating(true);
    setNotice(null);
    try {
      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `Create a dashboard: ${aiPrompt}` })
      });
      if (!chatRes.ok) {
        const err = (await chatRes.json()) as { detail?: string };
        setNotice(err.detail ?? "AI dashboard generation failed");
        return;
      }
      const chatData = (await chatRes.json()) as {
        dashboardDraft?: Record<string, unknown>;
      };
      if (!chatData.dashboardDraft) {
        setNotice("Prompt did not produce a dashboard specification. Try naming a metric like OEE, downtime, or scrap rate.");
        return;
      }
      const saveRes = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(chatData.dashboardDraft.title ?? "AI Dashboard"),
          spec: chatData.dashboardDraft
        })
      });
      if (saveRes.ok) {
        const d = (await saveRes.json()) as { dashboardId: string };
        router.push(`/dashboards/${d.dashboardId}`);
      } else {
        const err = (await saveRes.json()) as { detail?: string };
        setNotice(err.detail ?? "Unable to save generated dashboard");
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-border/70 pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <span>Operational Dashboards</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {canWrite
              ? "Build declarative dashboards from natural language or templates under plant scope and RBAC."
              : "Read-only dashboard viewer. Widgets outside your role or plant scope show a locked placeholder."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search dashboards..."
              aria-label="Search dashboards"
              className="pl-8 w-52"
            />
          </div>
          {canWrite && (
            <Button
              disabled={creating}
              onClick={async () => {
                setCreating(true);
                setNotice(null);
                try {
                  const res = await fetch("/api/dashboards", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title: "New Plant Operations Dashboard" })
                  });
                  if (res.ok) {
                    const d = (await res.json()) as { dashboardId: string };
                    router.push(`/dashboards/${d.dashboardId}`);
                  } else {
                    const err = (await res.json()) as { detail?: string };
                    setNotice(err.detail ?? "Failed to create dashboard");
                  }
                } finally {
                  setCreating(false);
                }
              }}
            >
              <Plus className="h-4 w-4" />
              <span>Blank Dashboard</span>
            </Button>
          )}
        </div>
      </div>

      {(notice || error) && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2 text-xs font-medium text-destructive flex items-center justify-between gap-2"
        >
          <span>{notice ?? "Failed to load dashboards."}</span>
          {notice && (
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss notice"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {canWrite && (
        <Card className="p-3.5">
          <form
            onSubmit={handleGenerateFromPrompt}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold text-primary shrink-0 px-1">
              <Sparkles className="h-4 w-4" />
              <span>AI Builder</span>
            </div>
            <Input
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder='Describe a dashboard (e.g. "Show downtime by machine on Line 3 this week plus OEE")'
              aria-label="Describe a dashboard to generate"
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={creating || !aiPrompt.trim()}
            >
              {creating ? "Generating..." : "Generate Dashboard"}
            </Button>
          </form>
        </Card>
      )}

      <SpotlightNavbar
        activeId={category}
        onSelect={setCategory}
        items={[
          { id: "all", label: "All Dashboards", badge: all.length },
          { id: "custom", label: "Saved & Shared", badge: all.filter((d) => !d.isTemplate).length },
          { id: "templates", label: "Starter Templates", badge: all.filter((d) => d.isTemplate).length }
        ]}
      />

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 rounded-lg border border-border bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && (category === "all" || category === "custom") && (
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b border-border/70 pb-1.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Saved &amp; Shared Dashboards
            </h2>
            <span className="text-xs text-muted-foreground tabular-nums">{custom.length}</span>
          </div>
          {custom.length === 0 ? (
            category === "custom" ? (
              <Card className="p-6 text-xs text-muted-foreground">
                No saved or shared dashboards match your current filter. Clone a starter template or create one with AI Builder.
              </Card>
            ) : null
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {custom.map((d) => (
                <Link key={d.id} href={`/dashboards/${d.id}`}>
                  <Card className="h-full hover:border-primary/60 transition-colors">
                    <CardHeader>
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="truncate">{d.title}</CardTitle>
                        <Badge variant="secondary" className="font-mono">
                          v{d.currentVersion}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {d.description || "Custom semantic dashboard"}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {!isLoading && (category === "all" || category === "templates") && (
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b border-border/70 pb-1.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Starter Templates
            </h2>
            <span className="text-xs text-muted-foreground tabular-nums">{templates.length}</span>
          </div>
          {templates.length === 0 ? (
            <Card className="p-6 text-xs text-muted-foreground">
              No templates match your current filter or role scope.
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((tpl) => (
                <Card key={tpl.id} className="flex flex-col justify-between">
                  <CardHeader className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/dashboards/${tpl.id}`}
                        className="font-semibold text-sm hover:text-primary transition-colors"
                      >
                        {tpl.title}
                      </Link>
                      <Badge variant="default">Template</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{tpl.description}</p>
                  </CardHeader>
                  <CardContent className="flex items-center gap-2 pt-2 border-t border-border/60">
                    <Link
                      href={`/dashboards/${tpl.id}`}
                      className={buttonVariants({ variant: "outline", size: "sm", className: "flex-1" })}
                    >
                      Open Viewer
                    </Link>
                    {canWrite && (
                      <Button
                        size="sm"
                        disabled={creating}
                        onClick={() => handleCloneTemplate(tpl)}
                      >
                        <Copy className="h-3 w-3" />
                        <span>Use</span>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
