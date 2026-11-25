"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  GitCompare,
  Globe,
  History,
  Layers,
  Paperclip,
  Send,
  ShieldAlert,
  Sparkles,
  Wrench,
  X
} from "lucide-react";
import type { AiChangeProposal, ChangeDiffRow } from "@/app/api/ai/changes/route";
import { useAppContext } from "@/components/providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface Citation {
  chunkId: string;
  documentId: string;
  title: string;
  revision: string;
  status: "current" | "superseded";
  page: number;
  sectionPath: string;
  excerpt: string;
}

interface PendingAction {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
  idempotencyKey: string;
  status?: string;
}

interface SavedChangeItem {
  id: string;
  savedAt: string;
  savedBy: string;
  scope: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  summary: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  diffRows: ChangeDiffRow[];
}

interface FeedEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  safetyWarning?: string | null;
  pendingAction?: PendingAction | null;
  proposal?: AiChangeProposal;
  savedRecord?: SavedChangeItem;
}

interface ScreenContextMeta {
  label: string;
  entityId?: string;
  screenPresets: Array<{ label: string; prompt: string }>;
}

function getScreenContext(pathname: string): ScreenContextMeta {
  if (pathname.startsWith("/machines")) {
    return {
      label: "Machines Topology",
      screenPresets: [
        {
          label: "Add Line 3 air tie",
          prompt: "Connect mach-l3-comp-01 -> mach-l3-pack-01 pneumatic utility 6.0 bar erector air"
        },
        {
          label: "Raise machine criticality",
          prompt: "Update criticality for mach-l3-pack-02 to A"
        }
      ]
    };
  }
  if (pathname.startsWith("/m/")) {
    const id = decodeURIComponent(pathname.slice(3).split("/")[0] ?? "");
    return {
      label: `Machine ${id}`,
      entityId: id,
      screenPresets: [
        {
          label: "Raise criticality to A",
          prompt: `Update criticality for ${id} to A`
        },
        {
          label: "Create board triage task",
          prompt: `Inspect and verify repair spares for ${id}`
        }
      ]
    };
  }
  if (pathname.startsWith("/dashboards/")) {
    const id = decodeURIComponent(pathname.slice(12).split("/")[0] ?? "");
    return {
      label: "Dashboard Builder",
      entityId: id,
      screenPresets: [
        {
          label: "Add Energy (kWh) chart",
          prompt: "Add an energy_kwh breakdown widget to this dashboard"
        },
        {
          label: "Expand range to 30d",
          prompt: "Update dashboard window to 30d"
        }
      ]
    };
  }
  if (pathname.startsWith("/dashboards")) {
    return {
      label: "Dashboards",
      screenPresets: [
        {
          label: "Add Scrap widget",
          prompt: "Add a scrap_rate widget to the primary dashboard"
        },
        {
          label: "Switch to 30d window",
          prompt: "Update dashboard window to 30d"
        }
      ]
    };
  }
  if (pathname.startsWith("/workflows/")) {
    const id = decodeURIComponent(pathname.slice(11).split("/")[0] ?? "");
    return {
      label: "Workflow Canvas",
      entityId: id,
      screenPresets: [
        {
          label: "Toggle enabled state",
          prompt: "Toggle workflow enabled status"
        }
      ]
    };
  }
  if (pathname.startsWith("/workflows")) {
    return {
      label: "Workflows",
      screenPresets: [
        {
          label: "Draft vibration alert workflow",
          prompt: "Create workflow: when vibration exceeds 7 mm/s check parts and notify supervisors"
        }
      ]
    };
  }
  if (pathname.startsWith("/monitoring")) {
    return {
      label: "Monitoring & Alerts",
      screenPresets: [
        {
          label: "Tighten alarm threshold",
          prompt: "Set alert threshold to 75"
        }
      ]
    };
  }
  if (pathname.startsWith("/board")) {
    return {
      label: "Execution Board",
      screenPresets: [
        {
          label: "Move LUT-101 to Done",
          prompt: "Mark LUT-101 as done"
        },
        {
          label: "Create urgent fault issue",
          prompt: "Urgent: Schedule bearing seal inspection on Line 3 Filler #1"
        }
      ]
    };
  }
  return {
    label: "Command Overview",
    screenPresets: [
      {
        label: "Create shift handoff task",
        prompt: "High priority: Verify Detroit Line 3 E42 spares before B-shift"
      },
      {
        label: "Update machine link",
        prompt: "Connect mach-l1-comp-01 -> mach-l1-press-02 pneumatic 6.2 bar tie"
      }
    ]
  };
}

const GLOBAL_PRESETS: Array<{ label: string; prompt: string }> = [
  {
    label: "Global Board Task",
    prompt: "Create global operations action: Audit lockout tags across all plants"
  },
  {
    label: "Global 30d KPI Window",
    prompt: "Update dashboard window to 30d globally"
  },
  {
    label: "Cross-Line Connection",
    prompt: "Connect mach-l1-comp-01 -> mach-l3-pack-01 pneumatic utility ring header"
  }
];

export function FloatingAiAssistant() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, demoEnabled } = useAppContext();

  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"screen" | "global">("screen");
  const [drawerTab, setDrawerTab] = useState<"copilot" | "history">("copilot");
  const [selectedEntityId, setSelectedEntityId] = useState<string | undefined>(undefined);
  const [selectedEntityLabel, setSelectedEntityLabel] = useState<string | undefined>(undefined);

  const [prompt, setPrompt] = useState("");
  const [convId, setConvId] = useState<string | undefined>(undefined);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [busyMode, setBusyMode] = useState<"idle" | "ask" | "propose" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [savedHistory, setSavedHistory] = useState<SavedChangeItem[]>([]);
  const [actionStates, setActionStates] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadedFileNote, setUploadedFileNote] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const screenCtx = useMemo(() => getScreenContext(pathname), [pathname]);
  const effectiveEntityId = selectedEntityId ?? screenCtx.entityId;

  const loadSavedHistory = async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/ai/changes", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { changes?: SavedChangeItem[] };
        setSavedHistory(data.changes ?? []);
      }
    } catch {
      // Ignore transient load failure
    }
  };

  useEffect(() => {
    setSelectedEntityId(undefined);
    setSelectedEntityLabel(undefined);
  }, [pathname]);

  useEffect(() => {
    if (open && user) {
      void loadSavedHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpenEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<{
        scope?: "screen" | "global";
        entityId?: string;
        entityName?: string;
        prompt?: string;
      }>).detail;
      if (detail?.scope) setScope(detail.scope);
      if (detail?.entityId) setSelectedEntityId(detail.entityId);
      if (detail?.entityName) setSelectedEntityLabel(detail.entityName);
      if (detail?.prompt) setPrompt(detail.prompt);
      setDrawerTab("copilot");
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("lutic:open-ai", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("lutic:open-ai", onOpenEvent);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [feed.length, streamingText]);

  if (!user) return null;

  const handleAskAi = async (customPrompt?: string) => {
    const msg = (customPrompt ?? prompt).trim();
    if (!msg || busyMode !== "idle") return;

    setError(null);
    setBusyMode("ask");
    setStreamingText("");
    if (!customPrompt) setPrompt("");

    const userMsgId = `u-${Date.now()}`;
    const scopedPrefix =
      scope === "global"
        ? "[Scope: Global workspace across plants] "
        : `[Scope: Current screen ${pathname}${effectiveEntityId ? ` (${effectiveEntityId})` : ""}] `;

    setFeed((prev) => [...prev, { id: userMsgId, role: "user", content: msg }]);

    try {
      const machineIdForChat =
        pathname.startsWith("/m/") || pathname.startsWith("/machines")
          ? effectiveEntityId
          : undefined;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: convId,
          machineId: machineIdForChat,
          message: `${scopedPrefix}${msg}${uploadedFileNote ? `\n\nContext upload:\n${uploadedFileNote}` : ""}`,
          stream: true
        })
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail ?? `AI request failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Streaming reader unavailable");
      const decoder = new TextDecoder();
      let buffer = "";
      let finalPayload: Record<string, unknown> | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const ev of events) {
          if (!ev.startsWith("data: ")) continue;
          const json = JSON.parse(ev.slice(6)) as {
            type: "delta" | "done" | "error";
            text?: string;
            detail?: string;
            payload?: Record<string, unknown>;
          };
          if (json.type === "delta" && json.text) {
            setStreamingText((prev) => prev + json.text);
          } else if (json.type === "done" && json.payload) {
            finalPayload = json.payload;
          } else if (json.type === "error") {
            throw new Error(json.detail ?? "Chat stream failed");
          }
        }
      }

      if (finalPayload) {
        setConvId(String(finalPayload.conversationId));
        setFeed((prev) => [
          ...prev,
          {
            id: String(finalPayload!.messageId),
            role: "assistant",
            content: String(finalPayload!.answer),
            citations: (finalPayload!.citations ?? []) as Citation[],
            safetyWarning: (finalPayload!.safetyWarning as string | undefined) ?? null,
            pendingAction: (finalPayload!.pendingAction as PendingAction | undefined) ?? null
          }
        ]);
      }
      setStreamingText("");
      setUploadedFileNote(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to query Lutic AI");
    } finally {
      setBusyMode("idle");
    }
  };

  const handleProposeChange = async (customPrompt?: string) => {
    const text = (customPrompt ?? prompt).trim();
    if (!text || busyMode !== "idle") return;

    setError(null);
    setBusyMode("propose");
    if (!customPrompt) setPrompt("");

    setFeed((prev) => [
      ...prev,
      {
        id: `u-chg-${Date.now()}`,
        role: "user",
        content: `Propose ${scope === "global" ? "Global" : screenCtx.label} change: ${text}`
      }
    ]);

    try {
      const res = await fetch("/api/ai/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "propose",
          prompt: text,
          scope,
          pathname,
          selectedEntityId: effectiveEntityId
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        proposal?: AiChangeProposal;
        detail?: string;
      };
      if (!res.ok || !data.proposal) {
        throw new Error(data.detail ?? "Could not build change proposal");
      }
      setFeed((prev) => [
        ...prev,
        {
          id: `a-chg-${Date.now()}`,
          role: "assistant",
          content: data.proposal!.summary,
          proposal: data.proposal!
        }
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Change proposal failed");
    } finally {
      setBusyMode("idle");
    }
  };

  const handleSaveProposal = async (entryId: string, proposal: AiChangeProposal) => {
    setError(null);
    setBusyMode("saving");
    try {
      const res = await fetch("/api/ai/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "save", proposal })
      });
      const data = (await res.json().catch(() => ({}))) as {
        saved?: SavedChangeItem;
        detail?: string;
      };
      if (!res.ok || !data.saved) {
        throw new Error(data.detail ?? "Unable to save change");
      }

      setFeed((prev) =>
        prev.map((item) =>
          item.id === entryId ? { ...item, savedRecord: data.saved! } : item
        )
      );
      setSavedHistory((prev) => [data.saved!, ...prev]);
      router.refresh();
      window.dispatchEvent(new CustomEvent("lutic:ai-change-saved", { detail: data.saved }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusyMode("idle");
    }
  };

  const handleConfirmPendingAction = async (
    act: PendingAction,
    decision: "confirm" | "cancel"
  ) => {
    try {
      const res = await fetch("/api/actions/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionId: act.id,
          idempotencyKey: act.idempotencyKey,
          decision
        })
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string; detail?: string };
      setActionStates((prev) => ({
        ...prev,
        [act.id]: res.ok ? `Status: ${data.status}` : data.detail ?? "Action failed"
      }));
      if (res.ok && decision === "confirm") {
        router.refresh();
        window.dispatchEvent(new CustomEvent("lutic:ai-change-saved"));
      }
    } catch {
      setActionStates((prev) => ({ ...prev, [act.id]: "Action request failed" }));
    }
  };

  const presets = scope === "global" ? GLOBAL_PRESETS : screenCtx.screenPresets;

  return (
    <>
      {/* Persistent Floating Action Button across every screen */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open Lutic AI Assistant"
        className={cn(
          "no-print fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-lg transition-[transform,background-color,box-shadow] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-primary/90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open && "ring-2 ring-ring"
        )}
      >
        <Bot className="h-4 w-4" />
        <span>Lutic AI</span>
        <span className="hidden sm:inline rounded-full bg-primary-foreground/20 px-2 py-0.5 font-mono text-[10px] leading-none">
          {screenCtx.label}
        </span>
      </button>

      {/* Slide-Over Copilot & Before/After Change Drawer */}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        variant="drawer-right"
        ariaLabel="Lutic Floating AI Assistant"
        className="max-w-xl p-0 flex flex-col"
      >
        {/* Header & Scope Controls */}
        <div className="border-b border-border bg-card px-4 py-3.5 space-y-3 shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-bold tracking-tight">Lutic Floating AI Copilot</h2>
                <Badge variant="outline" className="font-mono text-[10px]">
                  Cmd+J
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Ask diagnostics, propose edits, inspect Before vs. After diffs, and save changes to{" "}
                <code className="font-mono text-foreground">
                  {scope === "global" ? "Global Workspace" : pathname}
                </code>
                {selectedEntityLabel ? ` (${selectedEntityLabel})` : ""}.
              </p>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setOpen(false)}
              aria-label="Close Lutic AI Assistant"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              role="group"
              aria-label="AI change scope"
              className="inline-flex rounded-md border border-border bg-muted/50 p-0.5"
            >
              <button
                type="button"
                aria-pressed={scope === "screen"}
                onClick={() => setScope("screen")}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                  scope === "screen"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Layers className="h-3 w-3 text-primary" />
                <span>Current Screen</span>
              </button>
              <button
                type="button"
                aria-pressed={scope === "global"}
                onClick={() => setScope("global")}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                  scope === "global"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Globe className="h-3 w-3 text-primary" />
                <span>Global Changes</span>
              </button>
            </div>

            <TabsList>
              <TabsTrigger
                active={drawerTab === "copilot"}
                onClick={() => setDrawerTab("copilot")}
              >
                <Sparkles className="h-3 w-3" />
                <span>Ask &amp; Edit</span>
              </TabsTrigger>
              <TabsTrigger
                active={drawerTab === "history"}
                onClick={() => {
                  setDrawerTab("history");
                  void loadSavedHistory();
                }}
              >
                <History className="h-3 w-3" />
                <span>Saved ({savedHistory.length})</span>
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        {drawerTab === "history" ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {savedHistory.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                No AI changes saved yet. Propose a screen or global change and click Save Change to record its Before / After snapshot.
              </div>
            ) : (
              savedHistory.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-border bg-card p-3.5 space-y-2.5 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-foreground">{item.summary}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {item.targetType} · {item.targetLabel} · {item.savedAt.slice(0, 19).replace("T", " ")} UTC
                      </div>
                    </div>
                    <Badge variant={item.scope === "global" ? "default" : "secondary"} className="text-[10px] uppercase">
                      {item.scope}
                    </Badge>
                  </div>

                  <div className="space-y-1.5 rounded-md border border-border bg-muted/25 p-2.5">
                    {item.diffRows.map((d, idx) => (
                      <div key={idx} className="grid grid-cols-[110px_1fr] gap-2 text-[11px] items-start">
                        <span className="font-mono font-semibold text-muted-foreground truncate">
                          {d.field}
                        </span>
                        <div className="space-y-0.5">
                          <div className="text-muted-foreground line-through">
                            Before: {d.before}
                          </div>
                          <div className="font-medium text-emerald-700 dark:text-emerald-300">
                            After: {d.after}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <>
            {/* Conversation & Diff Feed */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3.5">
              {feed.length === 0 && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border bg-muted/25 p-3.5 text-xs space-y-1">
                    <div className="font-semibold text-foreground">
                      Ready on {screenCtx.label} ({scope} scope)
                    </div>
                    <p className="text-muted-foreground leading-relaxed">
                      Use <strong>Ask AI</strong> for SOP-grounded diagnostics and live telemetry checks, or <strong>Propose Change</strong> to preview a Before / After diff and save updates cleanly.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Quick {scope === "global" ? "Global" : screenCtx.label} Actions
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {presets.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => void handleProposeChange(preset.prompt)}
                          className="rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:border-primary/50 hover:bg-muted/50 transition-colors"
                        >
                          {preset.label}
                        </button>
                      ))}
                      {demoEnabled && (
                        <button
                          type="button"
                          onClick={() =>
                            void handleAskAi(
                              "Summarize active faults and SOP requirements on this plant scope"
                            )
                          }
                          className="rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                        >
                          Ask: Active fault summary
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {feed.map((item) => (
                <div
                  key={item.id}
                  className={cn("flex", item.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[95%] rounded-lg p-3 space-y-2.5 text-xs",
                      item.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "w-full border border-border bg-card"
                    )}
                  >
                    {item.safetyWarning && (
                      <div
                        role="alert"
                        className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] font-medium text-amber-950 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
                      >
                        <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>{item.safetyWarning}</span>
                      </div>
                    )}

                    <div className="prose prose-xs dark:prose-invert max-w-none break-words leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
                    </div>

                    {/* Before / After Proposal Card */}
                    {item.proposal && (
                      <div className="rounded-md border border-border bg-muted/25 p-3 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">
                            <GitCompare className="h-3.5 w-3.5" />
                            <span>Before vs. After ({item.proposal.scope})</span>
                          </span>
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {item.proposal.targetType}
                          </Badge>
                        </div>

                        <div className="space-y-1.5 border-y border-border/70 py-2">
                          {item.proposal.diffRows.map((d, idx) => (
                            <div key={idx} className="grid grid-cols-1 gap-1 text-[11px]">
                              <span className="font-mono font-semibold text-muted-foreground">
                                {d.field}
                              </span>
                              <div className="grid gap-1 sm:grid-cols-2">
                                <div className="rounded border border-border bg-background px-2 py-1 text-muted-foreground">
                                  <span className="font-mono text-[9.5px] uppercase block">Before</span>
                                  <span>{d.before}</span>
                                </div>
                                <div className="rounded border border-emerald-400/60 bg-emerald-500/10 px-2 py-1 text-foreground">
                                  <span className="font-mono text-[9.5px] uppercase text-emerald-700 dark:text-emerald-300 block">
                                    After
                                  </span>
                                  <span className="font-medium">{d.after}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {item.savedRecord ? (
                          <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                            <span className="inline-flex items-center gap-1">
                              <Check className="h-3.5 w-3.5" />
                              <span>Saved ({item.savedRecord.savedAt.slice(11, 19)} UTC)</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => setDrawerTab("history")}
                              className="underline text-primary"
                            >
                              View Saved History
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            {!item.proposal.canSave ? (
                              <span className="text-[11px] text-destructive">
                                Requires permission: {item.proposal.permissionRequired}
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                disabled={busyMode === "saving"}
                                onClick={() => void handleSaveProposal(item.id, item.proposal!)}
                              >
                                <Check className="h-3.5 w-3.5" />
                                <span>{busyMode === "saving" ? "Saving..." : "Save Change"}</span>
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Pending Human-Gated Tool Action from Ask AI */}
                    {item.pendingAction && (
                      <div className="rounded-md border border-primary/40 bg-primary/5 p-2.5 space-y-2">
                        <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                          <Wrench className="h-3.5 w-3.5 text-primary" />
                          <span>Confirm Action: {item.pendingAction.toolName}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{item.pendingAction.summary}</p>
                        {actionStates[item.pendingAction.id] ? (
                          <div className="text-[11px] font-semibold">
                            {actionStates[item.pendingAction.id]}
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() =>
                                void handleConfirmPendingAction(item.pendingAction!, "confirm")
                              }
                            >
                              Confirm &amp; Save
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                void handleConfirmPendingAction(item.pendingAction!, "cancel")
                              }
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {item.citations && item.citations.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1 border-t border-border/60">
                        {item.citations.map((c) => (
                          <Badge key={c.chunkId} variant="outline" className="text-[10px] gap-1">
                            <BookOpen className="h-3 w-3 text-primary" />
                            <span>
                              {c.title} ({c.revision}, p.{c.page})
                            </span>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {busyMode === "ask" && (
                <div className="rounded-lg border border-border bg-card p-3 text-xs space-y-1.5">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-primary animate-pulse">
                    Checking manuals, telemetry &amp; topology...
                  </div>
                  {streamingText && (
                    <div className="prose prose-xs dark:prose-invert max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  {error}
                </div>
              )}
            </div>

            {/* Bottom Prompt + Ask / Propose Change Composer */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleAskAi();
              }}
              className="border-t border-border bg-card p-3.5 space-y-2 shrink-0"
            >
              {uploadedFileNote && (
                <div className="flex items-center justify-between rounded bg-muted px-2.5 py-1 text-[11px]">
                  <span>Attached context ready ({uploadedFileNote.length} chars)</span>
                  <button type="button" onClick={() => setUploadedFileNote(null)}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              <Input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  scope === "global"
                    ? "Ask globally or describe a cross-plant change..."
                    : `Ask or change something on ${screenCtx.label}...`
                }
                aria-label="Floating AI prompt"
                className="h-9"
              />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium hover:bg-muted">
                  <Paperclip className="h-3 w-3 text-primary" />
                  <span>{uploading ? "Reading..." : "Attach File/PDF"}</span>
                  <input
                    type="file"
                    accept=".md,.markdown,.txt,.pdf,.docx"
                    className="sr-only"
                    disabled={uploading}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f) return;
                      setUploading(true);
                      try {
                        const fd = new FormData();
                        fd.append("file", f);
                        const res = await fetch("/api/uploads", { method: "POST", body: fd });
                        if (res.ok) {
                          const data = (await res.json()) as { name?: string; extractedText?: string };
                          setUploadedFileNote(
                            `File ${data.name ?? f.name}: ${(data.extractedText ?? "").slice(0, 1500)}`
                          );
                        }
                      } finally {
                        setUploading(false);
                      }
                    }}
                  />
                </label>

                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busyMode !== "idle" || !prompt.trim()}
                    onClick={() => void handleProposeChange()}
                  >
                    <GitCompare className="h-3.5 w-3.5 text-primary" />
                    <span>Propose Change</span>
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={busyMode !== "idle" || !prompt.trim()}
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>Ask AI</span>
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </form>
          </>
        )}
      </Dialog>
    </>
  );
}
