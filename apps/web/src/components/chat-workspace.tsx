"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  AlertTriangle,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  FileWarning,
  History,
  LayoutDashboard,
  Paperclip,
  Plus,
  Search,
  Send,
  Share2,
  ShieldAlert,
  Table as TableIcon,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Wrench,
  X
} from "lucide-react";
import { useAppContext } from "./providers";
import { MachineStatusBadge } from "./machine-status-badge";
import { AuthGate } from "./ui/auth-gate";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

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

interface ToolTrace {
  toolName: string;
  args: Record<string, unknown>;
  status: string;
  latencyMs: number;
  summary: string;
}

interface InlineChart {
  id: string;
  title: string;
  type: "bar" | "line";
  unit: string;
  data: Array<{ label: string; value: number }>;
}

interface PendingAction {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
  idempotencyKey: string;
  status?: string;
  result?: Record<string, unknown>;
}

interface UploadedAttachment {
  attachmentId: string;
  name: string;
  mimeType: string;
  kind: "document" | "image" | "text";
  size: number;
  extractedText?: string;
  previewUrl?: string;
}

interface ChatMessageItem {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: UploadedAttachment[];
  toolCalls?: ToolTrace[];
  citations?: Citation[];
  charts?: InlineChart[];
  dashboardDraft?: Record<string, unknown>;
  pendingAction?: PendingAction | null;
  safetyWarning?: string | null;
  supersededWarning?: string | null;
}

interface ConversationSummary {
  id: string;
  title: string;
  machineId?: string | null;
  shareToken?: string | null;
}

export interface MachineHeaderInfo {
  id: string;
  name: string;
  machineType: string;
  manufacturer: string;
  model: string;
  serialNo?: string;
  plantId: string;
  plantName?: string;
  plantTimezone?: string;
  status: string;
  updatedAt?: string | null;
  temperature?: number | null;
  vibration?: number | null;
  activeAlarms: Array<{ code: string; severity: string; message: string }>;
}

function formatMachineObservationTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  if (timeZone) {
    try {
      const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short"
      }).format(date);
      return `${formatted} (${timeZone})`;
    } catch {
      // Fallback to UTC timestamp if plant timezone is invalid.
    }
  }
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

const ROLE_SUGGESTIONS: Record<string, string[]> = {
  engineer: [
    "Line 3 filler is throwing E42 — what should I check and what parts do we have?",
    "Show me the SOP-001 Lockout/Tagout steps before servicing a servo drive.",
    "What is the Line 3 OEE and downtime this week?"
  ],
  analyst: [
    "Show downtime by machine on Line 3 this week plus OEE",
    "Compare OEE and scrap rate across lines over the last 30 days",
    "Which machines have the highest energy consumption this week?"
  ],
  manager: [
    "What is plant OEE by line over the last 7 days?",
    "Which active alarms are currently open across my plants?",
    "Show MTBF and MTTR by line over the last 30 days"
  ],
  admin: [
    "Line 3 filler is throwing E42 — explain cause, Rev 4.2 specs, and parts stock.",
    "Build a dashboard for Line 3 downtime and OEE this week",
    "Show parts below minimum stock across plants"
  ]
};

const PROD_ROLE_SUGGESTIONS: Record<string, string[]> = {
  engineer: [
    "Which active alarms are currently open across my assigned plants?",
    "List machines in my plant scope and their latest telemetry status.",
    "Check open work orders and spare parts inventory."
  ],
  analyst: [
    "Summarize machine downtime and OEE across my plants over the last 7 days.",
    "Compare recent telemetry trends across my assigned machines.",
    "List active alert rules and recent threshold triggers."
  ],
  manager: [
    "What is plant OEE across my assigned plants over the last 7 days?",
    "Which active alarms are currently open across my plants?",
    "Summarize open maintenance work orders and MTTR."
  ],
  admin: [
    "Summarize active alarms, machine status, and recent audit activity.",
    "Check parts below minimum stock across plants.",
    "Review active workflows, monitoring rules, and notification topics."
  ]
};

function InlineChartCard({ chart }: { chart: InlineChart }) {
  const [showTable, setShowTable] = useState(false);

  return (
    <div className="rounded-md border border-border bg-background p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold">
          {chart.title} <span className="text-muted-foreground">({chart.unit})</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowTable((v) => !v)}
          className="h-7 px-2 text-[11px]"
          aria-label={`Toggle data table for ${chart.title}`}
        >
          <TableIcon className="h-3 w-3" />
          <span>{showTable ? "Chart" : "Table"}</span>
        </Button>
      </div>

      {showTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Segment</th>
                <th className="py-1.5 font-medium">Value ({chart.unit})</th>
              </tr>
            </thead>
            <tbody>
              {chart.data.map((d, idx) => (
                <tr key={idx} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 pr-3">{d.label}</td>
                  <td className="py-1.5 font-mono tabular-nums">{d.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-52 w-full" role="img" aria-label={`${chart.title} chart`}>
          <ResponsiveContainer width="100%" height="100%">
            {chart.type === "line" ? (
              <LineChart data={chart.data}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.22} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            ) : (
              <BarChart data={chart.data}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.22} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function ChatWorkspace({
  machineHeader,
  initialConversationId
}: {
  machineHeader?: MachineHeaderInfo;
  initialConversationId?: string;
}) {
  const router = useRouter();
  const { user, t, demoEnabled } = useAppContext();

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [threadSearch, setThreadSearch] = useState("");
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [activeConvId, setActiveConvId] = useState<string | undefined>(
    initialConversationId
  );
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [snippetText, setSnippetText] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lastFailedPayload, setLastFailedPayload] = useState<{
    message: string;
    attachments: UploadedAttachment[];
  } | null>(null);
  const [openChecks, setOpenChecks] = useState<Record<string, boolean>>({});
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const [sourceModal, setSourceModal] = useState<{
    loading: boolean;
    document?: {
      title: string;
      revision: string;
      status: string;
      effectiveDate: string;
      source: string;
    };
    chunk?: {
      page: number;
      sectionPath: string;
      text: string;
      faultCodes: string[];
      partNumbers: string[];
    } | null;
    fallbackNotice?: string;
  } | null>(null);

  const [feedbackSent, setFeedbackSent] = useState<Record<string, string>>({});
  const [wrongCommentFor, setWrongCommentFor] = useState<string | null>(null);
  const [wrongComment, setWrongComment] = useState("");
  const [actionStates, setActionStates] = useState<
    Record<string, { status: string; detail?: string }>
  >({});

  const loadConversations = async () => {
    if (!user) return;
    const qs = machineHeader ? `?machineId=${encodeURIComponent(machineHeader.id)}` : "";
    try {
      const res = await fetch(`/api/conversations${qs}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { conversations: ConversationSummary[] };
        setConversations(data.conversations ?? []);
      } else {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setError(err.detail ?? "Failed to load conversations");
      }
    } catch {
      setError("Failed to load conversations");
    }
  };

  const loadConversationMessages = async (convId: string) => {
    try {
      const res = await fetch(`/api/conversations/${convId}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          conversation: ConversationSummary;
          messages: ChatMessageItem[];
        };
        setError(null);
        setActiveConvId(convId);
        setMessages(data.messages);
        setHistoryDrawerOpen(false);
        if (data.conversation.shareToken) {
          setShareUrl(`${window.location.origin}/share/${data.conversation.shareToken}`);
        } else {
          setShareUrl(null);
        }
      } else {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setError(err.detail ?? "Failed to load conversation messages");
      }
    } catch {
      setError("Failed to load conversation messages");
    }
  };

  useEffect(() => {
    loadConversations();
    if (initialConversationId) {
      loadConversationMessages(initialConversationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.userId, machineHeader?.id]);

  const filteredConversations = useMemo(() => {
    const q = threadSearch.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.machineId ?? "").toLowerCase().includes(q)
    );
  }, [conversations, threadSearch]);

  const machineThreads = filteredConversations.filter((c) => Boolean(c.machineId));
  const generalThreads = filteredConversations.filter((c) => !c.machineId);

  if (!user) {
    return (
      <AuthGate
        title="Authentication Required"
        description="Please sign in to access Lutic role-governed operations chat."
      />
    );
  }

  const sendMessage = async (
    textOverride?: string,
    attachmentsOverride?: UploadedAttachment[]
  ) => {
    const currentAttachments = attachmentsOverride ?? [...attachments];
    const msgText =
      (textOverride ?? input).trim() ||
      (currentAttachments.length > 0 ? "Please analyze the attached file(s)." : "");
    if (!msgText || sending) return;

    setError(null);
    setLastFailedPayload(null);
    setSending(true);
    setStreamingText("");
    if (textOverride === undefined) setInput("");

    const tempId = `temp-u-${Date.now()}`;
    const optimisticUserMsg: ChatMessageItem = {
      id: tempId,
      role: "user",
      content: msgText,
      attachments: currentAttachments
    };
    setMessages((prev) => [...prev, optimisticUserMsg]);
    if (!attachmentsOverride) setAttachments([]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConvId,
          machineId: machineHeader?.id,
          message: msgText,
          attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
          stream: true
        })
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail ?? `Chat request failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("Streaming reader unavailable");
      }

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
            type: "delta" | "done";
            text?: string;
            payload?: Record<string, unknown>;
          };
          if (json.type === "delta" && json.text) {
            setStreamingText((prev) => prev + json.text);
          } else if (json.type === "done" && json.payload) {
            finalPayload = json.payload;
          }
        }
      }

      if (finalPayload) {
        const convId = String(finalPayload.conversationId);
        setActiveConvId(convId);
        const assistantMsg: ChatMessageItem = {
          id: String(finalPayload.messageId),
          role: "assistant",
          content: String(finalPayload.answer),
          toolCalls: (finalPayload.toolCalls ?? []) as ToolTrace[],
          citations: (finalPayload.citations ?? []) as Citation[],
          charts: (finalPayload.charts ?? []) as InlineChart[],
          dashboardDraft: finalPayload.dashboardDraft as Record<string, unknown> | undefined,
          pendingAction: (finalPayload.pendingAction as PendingAction | undefined) ?? null,
          safetyWarning: (finalPayload.safetyWarning as string | undefined) ?? null,
          supersededWarning: (finalPayload.supersededWarning as string | undefined) ?? null
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingText("");
        await loadConversations();
      }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setLastFailedPayload({ message: msgText, attachments: currentAttachments });
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const openCitationViewer = async (c: Citation) => {
    setSourceModal({ loading: true });
    const fallbackModal = (fallbackNotice: string) => ({
      loading: false,
      fallbackNotice,
      document: {
        title: c.title,
        revision: c.revision,
        status: c.status,
        effectiveDate: "",
        source: ""
      },
      chunk: {
        page: c.page,
        sectionPath: c.sectionPath,
        text: c.excerpt,
        faultCodes: [],
        partNumbers: []
      }
    });
    try {
      const res = await fetch(
        `/api/documents/${encodeURIComponent(c.documentId)}/chunks/${encodeURIComponent(c.chunkId)}`
      );
      if (res.ok) {
        const data = await res.json();
        setSourceModal({ loading: false, ...data });
      } else {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setSourceModal(
          fallbackModal(err.detail ?? "Showing cited excerpt; full source passage unavailable.")
        );
      }
    } catch {
      setSourceModal(fallbackModal("Unable to fetch full passage; showing cited excerpt."));
    }
  };

  const submitFeedback = async (
    messageId: string,
    rating: "up" | "down",
    outcome?: "fixed_it" | "not_helpful" | "wrong",
    comment = ""
  ) => {
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, rating, outcome, comment })
      });
      if (res.ok) {
        setFeedbackSent((prev) => ({
          ...prev,
          [messageId]: outcome ?? rating
        }));
        setWrongCommentFor(null);
        setWrongComment("");
      } else {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setError(err.detail ?? "Failed to submit feedback");
      }
    } catch {
      setError("Failed to submit feedback");
    }
  };

  const handleTurnIntoDashboard = async (msg: ChatMessageItem) => {
    const spec =
      msg.dashboardDraft ??
      (msg.charts && msg.charts.length > 0
        ? {
            id: "draft-from-chat",
            title: `Analytics from Chat (${new Date().toLocaleDateString()})`,
            description: "Generated from Lutic chat answer",
            plantScope: user.plantIds,
            filters: { range: "7d" },
            widgets: msg.charts.map((c, idx) => ({
              id: `w-${idx + 1}`,
              type: c.type === "line" ? "line" : "bar",
              title: c.title,
              metric: c.id.includes("downtime")
                ? "downtime_minutes"
                : c.id.includes("scrap")
                  ? "scrap_rate"
                  : c.id.includes("energy")
                    ? "energy_kwh"
                    : "oee",
              groupBy: "line",
              range: "7d"
            })),
            layout: msg.charts.map((_, idx) => ({
              i: `w-${idx + 1}`,
              x: (idx % 2) * 6,
              y: Math.floor(idx / 2) * 5,
              w: 6,
              h: 5
            })),
            version: 1
          }
        : null);

    if (!spec) return;

    try {
      const res = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String((spec as { title?: string }).title ?? "Chat Dashboard"),
          spec
        })
      });

      if (res.ok) {
        const data = (await res.json()) as { dashboardId: string };
        router.push(`/dashboards/${data.dashboardId}`);
      } else {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setError(err.detail ?? "Unable to create dashboard");
      }
    } catch {
      setError("Unable to create dashboard");
    }
  };

  const handleConfirmAction = async (
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
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        result?: unknown;
        detail?: string;
      };
      if (res.ok && data.status) {
        setActionStates((prev) => ({
          ...prev,
          [act.id]: {
            status: data.status!,
            detail:
              data.status === "executed"
                ? JSON.stringify(data.result)
                : "Action cancelled."
          }
        }));
      } else {
        setActionStates((prev) => ({
          ...prev,
          [act.id]: { status: "error", detail: data.detail ?? "Action failed" }
        }));
      }
    } catch {
      setActionStates((prev) => ({
        ...prev,
        [act.id]: { status: "error", detail: "Action request failed" }
      }));
    }
  };

  const handleShareConversation = async () => {
    if (!activeConvId) return;
    try {
      const res = await fetch(`/api/conversations/${activeConvId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ createShareLink: true })
      });
      if (res.ok) {
        const data = (await res.json()) as { conversation: ConversationSummary };
        if (data.conversation.shareToken) {
          setShareUrl(`${window.location.origin}/share/${data.conversation.shareToken}`);
        }
      } else {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setError(err.detail ?? "Failed to share conversation");
      }
    } catch {
      setError("Failed to share conversation");
    }
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setError(err.detail ?? "Failed to delete conversation");
        return;
      }
      if (activeConvId === id) {
        setActiveConvId(undefined);
        setMessages([]);
        setShareUrl(null);
      }
      await loadConversations();
    } catch {
      setError("Failed to delete conversation");
    }
  };

  const suggestionSet = demoEnabled ? ROLE_SUGGESTIONS : PROD_ROLE_SUGGESTIONS;
  const suggestions = machineHeader
    ? [
        t("machine.explainAlarm"),
        t("machine.lastRepairs"),
        t("machine.partsForFault")
      ]
    : suggestionSet[user.role] ?? suggestionSet.engineer!;

  const canCreateDashboard = user.role === "analyst" || user.role === "admin";

  const renderHistoryList = () => (
    <div className="flex flex-col h-full p-3 gap-3">
      <Button
        onClick={() => {
          setActiveConvId(undefined);
          setMessages([]);
          setShareUrl(null);
          setHistoryDrawerOpen(false);
        }}
        className="w-full justify-center"
      >
        <Plus className="h-4 w-4" />
        <span>New Chat</span>
      </Button>

      <div className="relative">
        <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
        <Input
          value={threadSearch}
          onChange={(e) => setThreadSearch(e.target.value)}
          placeholder="Search threads..."
          aria-label="Search chat threads"
          className="pl-8 h-8"
        />
      </div>

      <div className="flex-1 overflow-y-auto space-y-4">
        {filteredConversations.length === 0 && (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            {conversations.length === 0 ? "No conversations yet." : "No matching threads."}
          </div>
        )}

        {machineThreads.length > 0 && (
          <div className="space-y-1">
            <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Machine Diagnostics ({machineThreads.length})
            </div>
            {machineThreads.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs ${
                  activeConvId === c.id
                    ? "bg-card border border-border font-semibold shadow-sm"
                    : "hover:bg-muted/60"
                }`}
              >
                <button
                  type="button"
                  onClick={() => loadConversationMessages(c.id)}
                  className="flex-1 truncate text-left"
                >
                  {c.title}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteConversation(c.id)}
                  className="opacity-50 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete conversation ${c.title}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {generalThreads.length > 0 && (
          <div className="space-y-1">
            <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              General Threads ({generalThreads.length})
            </div>
            {generalThreads.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs ${
                  activeConvId === c.id
                    ? "bg-card border border-border font-semibold shadow-sm"
                    : "hover:bg-muted/60"
                }`}
              >
                <button
                  type="button"
                  onClick={() => loadConversationMessages(c.id)}
                  className="flex-1 truncate text-left"
                >
                  {c.title}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteConversation(c.id)}
                  className="opacity-50 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete conversation ${c.title}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col md:flex-row min-h-[calc(100vh-56px)] md:h-[calc(100vh-56px)]">
      {/* Desktop Thread Sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border bg-muted/20">
        {renderHistoryList()}
      </aside>

      {/* Mobile Thread Drawer */}
      <Dialog
        open={historyDrawerOpen}
        onOpenChange={setHistoryDrawerOpen}
        variant="drawer-left"
        ariaLabel="Chat threads"
        className="md:hidden p-0"
      >
        {renderHistoryList()}
      </Dialog>

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col min-w-0 min-h-0">
        {/* Machine Context Header (for /m/[machineId]) */}
        {machineHeader && (
          <div className="border-b border-border bg-card px-4 py-2.5 sm:px-6 sm:py-3 space-y-2 shrink-0 max-h-[36vh] overflow-y-auto md:max-h-none md:overflow-visible min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-base sm:text-lg font-bold tracking-tight">
                    {machineHeader.name}
                  </h1>
                  <MachineStatusBadge status={machineHeader.status} />
                  {!machineHeader.updatedAt && (
                    <Badge variant="outline">No telemetry</Badge>
                  )}
                  {machineHeader.updatedAt &&
                    Date.now() - new Date(machineHeader.updatedAt).getTime() > 15 * 60 * 1000 && (
                      <Badge variant="warning">Stale telemetry</Badge>
                    )}
                  {machineHeader.activeAlarms.length > 0 && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      <span>{machineHeader.activeAlarms.length} Active Alarm</span>
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {machineHeader.manufacturer} {machineHeader.model}
                  {machineHeader.serialNo ? ` · S/N: ${machineHeader.serialNo}` : ""} · Type:{" "}
                  <code className="font-mono">{machineHeader.machineType}</code> · Plant:{" "}
                  <code className="font-mono">
                    {machineHeader.plantName
                      ? `${machineHeader.plantName} (${machineHeader.plantId})`
                      : machineHeader.plantId}
                  </code>
                  {machineHeader.updatedAt
                    ? ` · Last observation: ${formatMachineObservationTime(
                        machineHeader.updatedAt,
                        machineHeader.plantTimezone
                      )}`
                    : " · No telemetry observed yet"}
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-muted-foreground">
                <div>
                  Temp:{" "}
                  <span className="text-foreground font-semibold">
                    {machineHeader.temperature != null ? `${machineHeader.temperature}°C` : "—"}
                  </span>
                </div>
                <div>
                  Vib:{" "}
                  <span className="text-foreground font-semibold">
                    {machineHeader.vibration != null ? `${machineHeader.vibration} mm/s` : "—"}
                  </span>
                </div>
              </div>
            </div>

            {machineHeader.activeAlarms.length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 dark:bg-red-950/60 dark:border-red-800/70 dark:text-red-200">
                {machineHeader.activeAlarms.map((a, idx) => (
                  <div key={idx}>
                    <strong>{a.code}</strong> ({a.severity.toUpperCase()}): {a.message}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-nowrap overflow-x-auto sm:flex-wrap gap-2 pb-0.5">
              {suggestions.map((q) => (
                <Button
                  key={q}
                  variant="outline"
                  size="sm"
                  onClick={() => sendMessage(q)}
                  className="rounded-full shrink-0"
                >
                  {q}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Top Conversation Toolbar */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 sm:px-6 bg-card/60">
          <div className="flex items-center gap-2 min-w-0 text-xs text-muted-foreground">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistoryDrawerOpen(true)}
              className="md:hidden h-7 px-2"
            >
              <History className="h-3.5 w-3.5" />
              <span>Threads</span>
            </Button>
            <span className="truncate">
              Role: <strong className="uppercase text-foreground">{user.role}</strong> · Plants:{" "}
              {user.plantIds.join(", ")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {activeConvId && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleShareConversation}
                className="h-8"
              >
                <Share2 className="h-3.5 w-3.5" />
                <span>Share</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setActiveConvId(undefined);
                setMessages([]);
                setShareUrl(null);
              }}
              className="md:hidden h-8"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New</span>
            </Button>
          </div>
        </div>

        {shareUrl && (
          <div className="border-b border-border bg-muted/50 px-4 py-2 text-xs flex items-center justify-between gap-2">
            <span className="truncate">
              Tenant read-only link:{" "}
              <a href={shareUrl} className="underline font-mono text-primary">
                {shareUrl}
              </a>
            </span>
            <button
              type="button"
              onClick={() => setShareUrl(null)}
              aria-label="Dismiss share URL"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Messages Feed */}
        <div className="flex-1 min-h-[260px] md:min-h-0 overflow-y-auto px-4 py-5 sm:px-6 space-y-5">
          {messages.length === 0 && !sending && (
            <div className="mx-auto max-w-2xl py-6 space-y-5">
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {machineHeader ? "Machine Diagnostics" : "Operations Assistant"}
                </div>
                <h2 className="text-lg font-bold tracking-tight">
                  {machineHeader
                    ? `Scoped Diagnostics: ${machineHeader.name}`
                    : `Ask Lutic (${user.role})`}
                </h2>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Responses about torque specifications, lockout/tagout, parts, and telemetry cite verified plant manuals and execute tools under your RBAC scope.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Recommended Queries
                </div>
                <Card className="divide-y divide-border overflow-hidden">
                  {suggestions.map((promptText) => (
                    <button
                      key={promptText}
                      type="button"
                      onClick={() => sendMessage(promptText)}
                      className="w-full text-left px-4 py-3 text-xs sm:text-sm font-medium hover:bg-muted/50 transition-colors flex items-center justify-between gap-3"
                    >
                      <span>{promptText}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </button>
                  ))}
                </Card>
              </div>
            </div>
          )}

          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-full rounded-lg p-4 space-y-3 ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground sm:max-w-xl"
                      : "border border-border bg-card w-full shadow-sm"
                  }`}
                >
                  {m.role === "assistant" && m.safetyWarning && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-200"
                    >
                      <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{m.safetyWarning}</span>
                    </div>
                  )}

                  {m.role === "assistant" && m.supersededWarning && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-900 dark:bg-red-950/60 dark:border-red-800 dark:text-red-200"
                    >
                      <FileWarning className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{m.supersededWarning}</span>
                    </div>
                  )}

                  <div className="prose prose-sm dark:prose-invert max-w-none break-words text-sm leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  </div>

                  {m.attachments && m.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {m.attachments.map((att, idx) => (
                        <div
                          key={att.attachmentId ?? idx}
                          className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium ${
                            m.role === "user"
                              ? "bg-primary-foreground/15 text-primary-foreground"
                              : "bg-muted text-foreground"
                          }`}
                        >
                          {att.kind === "image" && att.previewUrl?.startsWith("data:image/") ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={att.previewUrl}
                              alt={att.name}
                              className="h-12 w-12 rounded object-cover border border-border/50"
                            />
                          ) : (
                            <Paperclip className="h-3 w-3" />
                          )}
                          <span>{att.name}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {m.role === "assistant" && m.charts && m.charts.length > 0 && (
                    <div className="grid gap-3 md:grid-cols-2">
                      {m.charts.map((c) => (
                        <InlineChartCard key={c.id} chart={c} />
                      ))}
                    </div>
                  )}

                  {m.role === "assistant" && m.pendingAction && (
                    <div className="rounded-md border border-primary/50 bg-primary/5 p-3 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-semibold">
                        <Wrench className="h-4 w-4 text-primary" />
                        <span>Confirmation Required: {m.pendingAction.toolName}</span>
                      </div>
                      <p className="text-xs">{m.pendingAction.summary}</p>
                      <pre className="rounded border border-border bg-muted/60 p-2 text-[11px] overflow-x-auto font-mono">
                        {JSON.stringify(m.pendingAction.args, null, 2)}
                      </pre>
                      {actionStates[m.pendingAction.id] ? (
                        <div className="text-xs font-semibold">
                          Status: {actionStates[m.pendingAction.id]!.status} —{" "}
                          {actionStates[m.pendingAction.id]!.detail}
                        </div>
                      ) : m.pendingAction.status && m.pendingAction.status !== "pending" ? (
                        <div className="text-xs font-semibold">
                          Status: {m.pendingAction.status}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleConfirmAction(m.pendingAction!, "confirm")}
                          >
                            Confirm &amp; Execute
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleConfirmAction(m.pendingAction!, "cancel")}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {m.role === "assistant" && m.citations && m.citations.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t("chat.sources")}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {m.citations.map((c) => (
                          <button
                            key={c.chunkId}
                            type="button"
                            onClick={() => openCitationViewer(c)}
                            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted min-h-[32px] ${
                              c.status === "superseded"
                                ? "border-red-400 text-red-700 dark:text-red-300"
                                : "border-border bg-background"
                            }`}
                          >
                            <BookOpen className="h-3 w-3 text-primary" />
                            <span className="truncate max-w-[210px]">
                              {c.title} ({c.revision}, p.{c.page})
                            </span>
                            <ExternalLink className="h-3 w-3 opacity-60" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0 && (
                    <div className="border-t border-border pt-2">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenChecks((prev) => ({ ...prev, [m.id]: !prev[m.id] }))
                        }
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground min-h-[28px]"
                      >
                        {openChecks[m.id] ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                        <span>
                          {t("chat.whatIChecked")} ({m.toolCalls.length} tool call
                          {m.toolCalls.length === 1 ? "" : "s"})
                        </span>
                      </button>

                      {openChecks[m.id] && (
                        <div className="mt-2 space-y-1.5 rounded-md border border-border bg-muted/40 p-2.5 text-xs">
                          {m.toolCalls.map((tc, idx) => (
                            <div
                              key={idx}
                              className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-1 last:border-0 last:pb-0"
                            >
                              <div>
                                <code className="font-semibold font-mono">{tc.toolName}</code>{" "}
                                <span className="text-muted-foreground">({tc.summary})</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant={tc.status === "denied" ? "destructive" : "success"}
                                  className="uppercase text-[10px]"
                                >
                                  {tc.status}
                                </Badge>
                                <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
                                  {tc.latencyMs}ms
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {m.role === "assistant" && !m.id.startsWith("temp-") && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => submitFeedback(m.id, "up")}
                          className={
                            feedbackSent[m.id] === "up"
                              ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                              : ""
                          }
                          aria-label="Thumbs up"
                        >
                          <ThumbsUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => submitFeedback(m.id, "down", "not_helpful")}
                          className={
                            feedbackSent[m.id] === "not_helpful"
                              ? "border-amber-500 bg-amber-50 text-amber-800"
                              : ""
                          }
                          aria-label="Thumbs down"
                        >
                          <ThumbsDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => submitFeedback(m.id, "up", "fixed_it")}
                          className={
                            feedbackSent[m.id] === "fixed_it"
                              ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                              : ""
                          }
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>This fixed it</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setWrongCommentFor((prev) => (prev === m.id ? null : m.id))
                          }
                          className={
                            feedbackSent[m.id] === "wrong"
                              ? "border-red-500 bg-red-50 text-red-800"
                              : ""
                          }
                        >
                          <span>Wrong answer</span>
                        </Button>
                      </div>

                      {canCreateDashboard &&
                        (m.dashboardDraft || (m.charts && m.charts.length > 0)) && (
                          <Button size="sm" onClick={() => handleTurnIntoDashboard(m)}>
                            <LayoutDashboard className="h-3.5 w-3.5" />
                            <span>
                              {m.dashboardDraft
                                ? "Open in Visual Builder"
                                : t("chat.turnIntoDashboard")}
                            </span>
                          </Button>
                        )}
                    </div>
                  )}

                  {wrongCommentFor === m.id && (
                    <div className="flex gap-2 pt-1">
                      <Input
                        aria-label="Explain what was wrong or missing"
                        placeholder="What was wrong or missing?"
                        value={wrongComment}
                        onChange={(e) => setWrongComment(e.target.value)}
                      />
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => submitFeedback(m.id, "down", "wrong", wrongComment)}
                      >
                        Submit
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {sending && (
              <Card className="p-4 space-y-2">
                <div className="text-xs font-semibold text-primary animate-pulse">
                  Checking plant connectors and technical manuals...
                </div>
                {streamingText && (
                  <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
                  </div>
                )}
              </Card>
            )}

            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 flex items-center justify-between gap-2">
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (lastFailedPayload) {
                      sendMessage(
                        lastFailedPayload.message,
                        lastFailedPayload.attachments
                      );
                    } else if (input.trim()) {
                      sendMessage();
                    } else {
                      setError(null);
                      void loadConversations();
                      const targetConvId = activeConvId ?? initialConversationId;
                      if (targetConvId) void loadConversationMessages(targetConvId);
                    }
                  }}
                  className="underline font-semibold"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
          className="border-t border-border bg-card px-4 py-3 sm:px-6"
        >
          <div className="mx-auto max-w-3xl space-y-2">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {attachments.map((att) => (
                  <span
                    key={att.attachmentId}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-xs"
                  >
                    {att.kind === "image" && att.previewUrl?.startsWith("data:image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={att.previewUrl}
                        alt={att.name}
                        className="h-6 w-6 rounded object-cover"
                      />
                    ) : att.kind === "image" ? (
                      <Camera className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 text-primary" />
                    )}
                    <span className="max-w-[160px] truncate">{att.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((prev) =>
                          prev.filter((a) => a.attachmentId !== att.attachmentId)
                        )
                      }
                      aria-label={`Remove attachment ${att.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {snippetOpen && (
              <div className="flex flex-col sm:flex-row gap-2 rounded-md border border-border bg-background p-2">
                <Textarea
                  aria-label="Diagnostic log or field note text"
                  rows={2}
                  value={snippetText}
                  onChange={(e) => setSnippetText(e.target.value)}
                  placeholder="Paste diagnostic log or field note text..."
                  className="flex-1 min-h-[56px]"
                />
                <Button
                  size="sm"
                  disabled={uploading || !snippetText.trim()}
                  onClick={async () => {
                    setUploading(true);
                    try {
                      const res = await fetch("/api/uploads", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: `note-${Date.now().toString().slice(-4)}.txt`,
                          text: snippetText.trim()
                        })
                      });
                      if (res.ok) {
                        const uploaded = (await res.json()) as UploadedAttachment;
                        setAttachments((prev) => [...prev, uploaded]);
                        setSnippetText("");
                        setSnippetOpen(false);
                      } else {
                        const err = (await res.json().catch(() => ({}))) as { detail?: string };
                        setError(err.detail ?? "Failed to attach text snippet");
                      }
                    } catch {
                      setError("Failed to attach text snippet");
                    } finally {
                      setUploading(false);
                    }
                  }}
                  className="self-end"
                >
                  Attach Text
                </Button>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t("chat.placeholder")}
                aria-label="Chat message input"
                className="flex-1 h-10 text-sm"
              />
              <Button
                type="submit"
                size="lg"
                aria-label={t("chat.send")}
                disabled={sending || (!input.trim() && attachments.length === 0)}
              >
                <Send className="h-4 w-4" />
                <span className="hidden sm:inline">{t("chat.send")}</span>
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium hover:bg-muted focus-within:ring-2 focus-within:ring-ring min-h-[30px]">
                <Paperclip className="h-3.5 w-3.5 text-primary" />
                <span>{uploading ? "Uploading..." : "Upload Document / Image"}</span>
                <input
                  type="file"
                  accept=".md,.markdown,.txt,.pdf,.docx,image/*"
                  className="sr-only"
                  disabled={uploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setUploading(true);
                    setError(null);
                    try {
                      const fd = new FormData();
                      fd.append("file", file);
                      const res = await fetch("/api/uploads", {
                        method: "POST",
                        body: fd
                      });
                      if (res.ok) {
                        const uploaded = (await res.json()) as UploadedAttachment;
                        setAttachments((prev) => [...prev, uploaded]);
                      } else {
                        const err = (await res.json().catch(() => ({}))) as { detail?: string };
                        setError(err.detail ?? "File upload failed");
                      }
                    } catch {
                      setError("File upload failed");
                    } finally {
                      setUploading(false);
                    }
                  }}
                />
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSnippetOpen((v) => !v)}
                className="h-[30px] text-[11px]"
              >
                <FileText className="h-3.5 w-3.5 text-primary" />
                <span>Attach Text</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  sendMessage(
                    "Check active workflows, monitoring alerts, and notification topics in the platform"
                  )
                }
                className="h-[30px] text-[11px]"
              >
                <span>Platform Status</span>
              </Button>
            </div>
          </div>
        </form>
      </div>

      {/* Source Citation Viewer Drawer */}
      <Dialog
        open={Boolean(sourceModal)}
        onOpenChange={(open) => !open && setSourceModal(null)}
        variant="drawer-right"
        ariaLabel="Document Source Viewer"
        className="p-5 space-y-4"
      >
        {sourceModal && (
          <>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-bold">
                  {sourceModal.document?.title ?? "Loading source..."}
                </h3>
                {sourceModal.document && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {sourceModal.document.revision} · Status:{" "}
                    <strong>{sourceModal.document.status.toUpperCase()}</strong> · Source:{" "}
                    {sourceModal.document.source}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setSourceModal(null)}
                aria-label="Close source viewer"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {sourceModal.document?.status === "superseded" && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs font-semibold text-red-900 dark:bg-red-950 dark:text-red-200">
                WARNING: This document revision is SUPERSEDED. Consult the current revision before performing maintenance.
              </div>
            )}

            {sourceModal.fallbackNotice && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-200">
                {sourceModal.fallbackNotice}
              </div>
            )}

            {sourceModal.loading ? (
              <div className="text-sm text-muted-foreground animate-pulse">
                Loading passage...
              </div>
            ) : (
              sourceModal.chunk && (
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-primary">
                    Page {sourceModal.chunk.page} · {sourceModal.chunk.sectionPath}
                  </div>
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-4 text-sm whitespace-pre-wrap leading-relaxed">
                    {sourceModal.chunk.text}
                  </div>
                  {(sourceModal.chunk.faultCodes.length > 0 ||
                    sourceModal.chunk.partNumbers.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {sourceModal.chunk.faultCodes.map((fc) => (
                        <Badge key={fc} variant="secondary" className="font-mono">
                          Fault: {fc}
                        </Badge>
                      ))}
                      {sourceModal.chunk.partNumbers.map((pn) => (
                        <Badge key={pn} variant="secondary" className="font-mono">
                          Part: {pn}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
          </>
        )}
      </Dialog>
    </div>
  );
}
