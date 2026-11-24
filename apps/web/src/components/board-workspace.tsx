"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { can } from "@lutic/core/rbac";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Circle,
  Clock,
  Kanban,
  LayoutList,
  Link2,
  Plus,
  Search,
  Trash2,
  User
} from "lucide-react";
import { useAppContext } from "@/components/providers";
import { AuthGate } from "@/components/ui/auth-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type BoardStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";
export type BoardPriority = "urgent" | "high" | "medium" | "low";
export type BoardCategory = "operations" | "automation" | "incident" | "connector" | "agent";

export interface BoardIssueItem {
  id: string;
  tenantId: string;
  plantId: string | null;
  identifier: string;
  title: string;
  description: string;
  status: BoardStatus;
  priority: BoardPriority;
  category: BoardCategory;
  assigneeName: string;
  labels: string[];
  sourceRef: string;
  dueDate: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface PlantOption {
  id: string;
  name: string;
  code: string;
}

const COLUMNS: Array<{
  id: Exclude<BoardStatus, "canceled">;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "backlog", label: "Backlog", Icon: Circle },
  { id: "todo", label: "Todo", Icon: Circle },
  { id: "in_progress", label: "In Progress", Icon: Clock },
  { id: "in_review", label: "In Review", Icon: AlertCircle },
  { id: "done", label: "Done", Icon: CheckCircle2 }
];

const PRIORITY_BADGE: Record<BoardPriority, { label: string; variant: "destructive" | "warning" | "secondary" | "outline" }> = {
  urgent: { label: "Urgent", variant: "destructive" },
  high: { label: "High", variant: "warning" },
  medium: { label: "Medium", variant: "secondary" },
  low: { label: "Low", variant: "outline" }
};

const CATEGORY_LABEL: Record<BoardCategory, string> = {
  operations: "Operations",
  automation: "AI Automation",
  incident: "Incident",
  connector: "Connector",
  agent: "Multi-Agent"
};

const EMPTY_FORM = {
  title: "",
  description: "",
  status: "todo" as BoardStatus,
  priority: "medium" as BoardPriority,
  category: "operations" as BoardCategory,
  plantId: "",
  assigneeName: "",
  labelsText: "",
  sourceRef: "",
  dueDate: ""
};

export function BoardWorkspace() {
  const { user } = useAppContext();
  const [issues, setIssues] = useState<BoardIssueItem[]>([]);
  const [plants, setPlants] = useState<PlantOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BoardIssueItem | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const canWrite = can(user, "workorder:write");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setLoadError(err.detail ?? "Failed to load board issues");
        return;
      }
      const data = (await res.json()) as {
        issues: BoardIssueItem[];
        plants: PlantOption[];
      };
      setIssues(data.issues ?? []);
      setPlants(data.plants ?? []);
    } catch {
      setLoadError("Unable to reach the board service.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
    else setLoading(false);
  }, [user, load]);

  const plantNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of plants) map.set(p.id, p.name);
    return map;
  }, [plants]);

  const filteredIssues = useMemo(() => {
    const q = search.trim().toLowerCase();
    return issues.filter((issue) => {
      if (priorityFilter !== "all" && issue.priority !== priorityFilter) return false;
      if (categoryFilter !== "all" && issue.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        issue.identifier.toLowerCase().includes(q) ||
        issue.title.toLowerCase().includes(q) ||
        issue.assigneeName.toLowerCase().includes(q) ||
        issue.sourceRef.toLowerCase().includes(q) ||
        issue.labels.some((l) => l.toLowerCase().includes(q))
      );
    });
  }, [issues, priorityFilter, categoryFilter, search]);

  const openCreate = (status: BoardStatus = "todo") => {
    setEditing(null);
    setFormError(null);
    setForm({
      ...EMPTY_FORM,
      status,
      plantId: plants[0]?.id ?? "",
      assigneeName: user?.name ?? ""
    });
    setDialogOpen(true);
  };

  const openEdit = (issue: BoardIssueItem) => {
    setEditing(issue);
    setFormError(null);
    setForm({
      title: issue.title,
      description: issue.description,
      status: issue.status,
      priority: issue.priority,
      category: issue.category,
      plantId: issue.plantId ?? "",
      assigneeName: issue.assigneeName,
      labelsText: issue.labels.join(", "),
      sourceRef: issue.sourceRef,
      dueDate: issue.dueDate
    });
    setDialogOpen(true);
  };

  const moveIssueStatus = async (issueId: string, nextStatus: BoardStatus) => {
    if (!canWrite) return;
    setIssues((prev) =>
      prev.map((item) => (item.id === issueId ? { ...item, status: nextStatus } : item))
    );
    const res = await fetch(`/api/board/${issueId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus })
    });
    if (res.ok) {
      const data = (await res.json()) as { issue: BoardIssueItem };
      setIssues((prev) => prev.map((item) => (item.id === issueId ? data.issue : item)));
    } else {
      void load();
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    setFormError(null);
    setSaving(true);
    try {
      const labels = form.labelsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const payload = {
        title: form.title,
        description: form.description,
        status: form.status,
        priority: form.priority,
        category: form.category,
        plantId: form.plantId || null,
        assigneeName: form.assigneeName,
        labels,
        sourceRef: form.sourceRef,
        dueDate: form.dueDate
      };

      const res = await fetch(editing ? `/api/board/${editing.id}` : "/api/board", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setFormError(err.detail ?? "Could not save board item");
        return;
      }
      const data = (await res.json()) as { issue: BoardIssueItem };
      setIssues((prev) =>
        editing
          ? prev.map((item) => (item.id === editing.id ? data.issue : item))
          : [data.issue, ...prev]
      );
      setDialogOpen(false);
    } catch {
      setFormError("Network error saving board item.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing || !canWrite) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/board/${editing.id}`, { method: "DELETE" });
      if (res.ok) {
        setIssues((prev) => prev.filter((item) => item.id !== editing.id));
        setDialogOpen(false);
      } else {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setFormError(err.detail ?? "Failed to delete issue");
      }
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <AuthGate
        title="Operations & AI Execution Board"
        description="Sign in to track plant incidents, SAP/ServiceNow escalations, AI automations, and multi-agent workstreams."
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-border pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Kanban className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold tracking-tight">Operations &amp; Execution Board</h1>
            <Badge variant="secondary" className="text-[10px]">
              {filteredIssues.length} items
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Unified Linear and Jira-style workspace connecting plant alarms, SAP orders, ServiceNow incidents, and AI agent workflows.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => setView("kanban")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                view === "kanban"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Kanban className="h-3.5 w-3.5" />
              <span>Board</span>
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                view === "list"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LayoutList className="h-3.5 w-3.5" />
              <span>List</span>
            </button>
          </div>

          {canWrite && (
            <Button size="sm" onClick={() => openCreate("todo")}>
              <Plus className="h-3.5 w-3.5" />
              <span>New Issue</span>
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ID, title, assignee, SAP/ServiceNow ref..."
            aria-label="Search board issues"
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            aria-label="Filter priority"
            className="w-36"
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
          <Select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter stream"
            className="w-40"
          >
            <option value="all">All Workstreams</option>
            <option value="operations">Operations</option>
            <option value="incident">Incident</option>
            <option value="automation">AI Automation</option>
            <option value="connector">Connector</option>
            <option value="agent">Multi-Agent</option>
          </Select>
        </div>
      </div>

      {loadError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3.5 py-2 text-xs text-destructive"
        >
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {COLUMNS.map((col) => (
            <Card key={col.id} className="p-3 h-48 animate-pulse bg-muted/30" />
          ))}
        </div>
      ) : view === "kanban" ? (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5 items-start">
          {COLUMNS.map((col) => {
            const columnItems = filteredIssues.filter((item) => item.status === col.id);
            const ColIcon = col.Icon;
            return (
              <div
                key={col.id}
                onDragOver={(e) => {
                  if (canWrite) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const droppedId = e.dataTransfer.getData("text/plain") || draggingId;
                  setDraggingId(null);
                  if (droppedId) void moveIssueStatus(droppedId, col.id);
                }}
                className="rounded-lg border border-border bg-muted/25 p-2.5 space-y-2.5 min-h-[260px]"
              >
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <ColIcon className="h-3.5 w-3.5 text-primary" />
                    <span>{col.label}</span>
                    <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0">
                      {columnItems.length}
                    </Badge>
                  </div>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => openCreate(col.id)}
                      aria-label={`Add issue to ${col.label}`}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {columnItems.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border/80 px-2.5 py-6 text-center text-[11px] text-muted-foreground">
                      No items in {col.label}
                    </div>
                  ) : (
                    columnItems.map((issue) => {
                      const prio = PRIORITY_BADGE[issue.priority];
                      return (
                        <Card
                          key={issue.id}
                          draggable={canWrite}
                          onDragStart={(e) => {
                            setDraggingId(issue.id);
                            e.dataTransfer.setData("text/plain", issue.id);
                          }}
                          onDragEnd={() => setDraggingId(null)}
                          onClick={() => openEdit(issue)}
                          className={cn(
                            "p-3 space-y-2 cursor-pointer transition-colors hover:border-primary/50",
                            draggingId === issue.id && "opacity-60"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                              {issue.identifier}
                            </span>
                            <Badge variant={prio.variant} className="text-[10px]">
                              {prio.label}
                            </Badge>
                          </div>

                          <div className="text-xs font-semibold leading-snug line-clamp-2">
                            {issue.title}
                          </div>

                          <div className="flex flex-wrap gap-1">
                            <Badge variant="secondary" className="text-[10px]">
                              {CATEGORY_LABEL[issue.category]}
                            </Badge>
                            {issue.sourceRef && (
                              <Badge variant="outline" className="text-[10px] font-mono gap-1">
                                <Link2 className="h-2.5 w-2.5" />
                                {issue.sourceRef}
                              </Badge>
                            )}
                          </div>

                          <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground border-t border-border/60">
                            <span className="inline-flex items-center gap-1 truncate">
                              <User className="h-3 w-3 shrink-0" />
                              <span className="truncate">{issue.assigneeName || "Unassigned"}</span>
                            </span>
                            {issue.dueDate && (
                              <span className="inline-flex items-center gap-1 font-mono text-[10px] shrink-0">
                                <Calendar className="h-3 w-3" />
                                {issue.dueDate}
                              </span>
                            )}
                          </div>
                        </Card>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {filteredIssues.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              No matching board items.
            </div>
          ) : (
            filteredIssues.map((issue) => {
              const prio = PRIORITY_BADGE[issue.priority];
              return (
                <div
                  key={issue.id}
                  onClick={() => openEdit(issue)}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40 cursor-pointer"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground font-semibold">
                        {issue.identifier}
                      </span>
                      <span className="text-sm font-medium truncate">{issue.title}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Badge variant="secondary" className="text-[10px]">
                        {CATEGORY_LABEL[issue.category]}
                      </Badge>
                      {issue.sourceRef && (
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {issue.sourceRef}
                        </Badge>
                      )}
                      {issue.plantId && (
                        <span>{plantNameById.get(issue.plantId) ?? issue.plantId}</span>
                      )}
                      <span>{issue.assigneeName || "Unassigned"}</span>
                    </div>
                  </div>
                  <div
                    className="flex items-center gap-2 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Badge variant={prio.variant} className="text-[10px]">
                      {prio.label}
                    </Badge>
                    <Select
                      value={issue.status}
                      disabled={!canWrite}
                      aria-label={`Change status for ${issue.identifier}`}
                      onChange={(e) => void moveIssueStatus(issue.id, e.target.value as BoardStatus)}
                      className="w-36 h-8 text-xs"
                    >
                      {COLUMNS.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                      <option value="canceled">Canceled</option>
                    </Select>
                  </div>
                </div>
              );
            })
          )}
        </Card>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        ariaLabel={editing ? `Edit ${editing.identifier}` : "Create board issue"}
        className="max-w-xl"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h2 className="text-base font-semibold">
              {editing ? `${editing.identifier} — Update Issue` : "New Board Issue"}
            </h2>
            {editing && canWrite && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={saving}
                onClick={() => void handleDelete()}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete</span>
              </Button>
            )}
          </div>

          {formError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {formError}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="board-title">Title</Label>
            <Input
              id="board-title"
              required
              disabled={!canWrite}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Inspect filler valve drift / automate SAP dispatch"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="board-desc">Description</Label>
            <Textarea
              id="board-desc"
              rows={3}
              disabled={!canWrite}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Acceptance criteria, root cause context, or connector reference..."
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="board-status">Status</Label>
              <Select
                id="board-status"
                disabled={!canWrite}
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as BoardStatus })}
              >
                {COLUMNS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
                <option value="canceled">Canceled</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="board-priority">Priority</Label>
              <Select
                id="board-priority"
                disabled={!canWrite}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as BoardPriority })}
              >
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="board-category">Workstream</Label>
              <Select
                id="board-category"
                disabled={!canWrite}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as BoardCategory })}
              >
                <option value="operations">Operations</option>
                <option value="incident">Incident</option>
                <option value="automation">AI Automation</option>
                <option value="connector">Connector</option>
                <option value="agent">Multi-Agent</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="board-assignee">Assignee</Label>
              <Input
                id="board-assignee"
                disabled={!canWrite}
                value={form.assigneeName}
                onChange={(e) => setForm({ ...form, assigneeName: e.target.value })}
                placeholder="Marcus Rivera"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="board-source">System Reference (SAP / ServiceNow / Tag)</Label>
              <Input
                id="board-source"
                disabled={!canWrite}
                value={form.sourceRef}
                onChange={(e) => setForm({ ...form, sourceRef: e.target.value })}
                placeholder="SAP PM #4000812 / INC004192"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="board-plant">Plant Scope</Label>
              <Select
                id="board-plant"
                disabled={!canWrite}
                value={form.plantId}
                onChange={(e) => setForm({ ...form, plantId: e.target.value })}
              >
                <option value="">All Workspace Plants</option>
                {plants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="board-due">Target Date</Label>
              <Input
                id="board-due"
                disabled={!canWrite}
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                placeholder="2026-11-30"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="board-labels">Labels (comma separated)</Label>
              <Input
                id="board-labels"
                disabled={!canWrite}
                value={form.labelsText}
                onChange={(e) => setForm({ ...form, labelsText: e.target.value })}
                placeholder="sap-pm, opc-ua"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            {canWrite && (
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : editing ? "Save Changes" : "Create Issue"}
              </Button>
            )}
          </div>
        </form>
      </Dialog>
    </div>
  );
}
