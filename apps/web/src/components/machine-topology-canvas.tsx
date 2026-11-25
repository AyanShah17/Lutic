"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BookOpen,
  Bot,
  ExternalLink,
  FileUp,
  Filter,
  Maximize2,
  Minus,
  Plus,
  QrCode,
  RotateCcw,
  Tag,
  X
} from "lucide-react";
import {
  CONNECTION_CATEGORIES,
  MACHINE_CATEGORIES,
  getConnectionCategoryMeta,
  getMachineCategoryMeta,
  type ConnectionCategoryId,
  type MachineCategoryId,
  type MachineTopologyGraph,
  type TopologyDocumentRef,
  type TopologyEdge,
  type TopologyNode
} from "@/lib/machine-topology";
import { cn } from "@/lib/utils";
import { MachineStatusBadge } from "@/components/machine-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface CanvasMachineTelemetry {
  id: string;
  temperature: number | null;
  vibration: number | null;
  pressure?: number | null;
  activeAlarms: Array<{ code: string; severity: string }>;
}

const NODE_W = 204;
const NODE_H = 88;

export function MachineTopologyCanvas({
  topology,
  machinesById,
  visibleMachineIds,
  canUploadDrawing,
  hasActiveSearchOrFilter = false,
  onTopologyUpdated
}: {
  topology: MachineTopologyGraph;
  machinesById: Map<string, CanvasMachineTelemetry>;
  visibleMachineIds: Set<string>;
  canUploadDrawing: boolean;
  hasActiveSearchOrFilter?: boolean;
  onTopologyUpdated: () => void;
}) {
  const [nodePositions, setNodePositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const dragMovedRef = useRef(false);

  const [zoom, setZoom] = useState(1);
  const [selectedZoneId, setSelectedZoneId] = useState<string>("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showAllLabels, setShowAllLabels] = useState(false);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<MachineCategoryId | "all">("all");
  const [activeConnTypes, setActiveConnTypes] = useState<Set<ConnectionCategoryId>>(
    () => new Set(Object.keys(CONNECTION_CATEGORIES) as ConnectionCategoryId[])
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Drawing/PDF Upload Modal
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadRevision, setUploadRevision] = useState("Rev 1.0");
  const [uploadText, setUploadText] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  // Cited PDF / Document Passage Modal
  const [docModal, setDocModal] = useState<{
    loading: boolean;
    ref: TopologyDocumentRef;
    document?: {
      title: string;
      revision: string;
      status: string;
      source: string;
    };
    chunk?: {
      page: number;
      sectionPath: string;
      text: string;
    } | null;
    notice?: string;
  } | null>(null);

  // Sync default positions & focus line when topology changes
  useEffect(() => {
    setNodePositions((prev) => {
      const next: Record<string, { x: number; y: number }> = {};
      for (const n of topology.nodes) {
        next[n.id] = prev[n.id] ?? n.position;
      }
      return next;
    });
    if (!selectedZoneId && topology.zones.length > 0) {
      const faultedNode = topology.nodes.find((n) => n.status === "fault");
      const defaultZone =
        (faultedNode?.lineId
          ? topology.zones.find((z) => z.lineId === faultedNode.lineId)
          : undefined) ?? topology.zones[0]!;
      setSelectedZoneId(defaultZone.id);
    }
    if (!selectedNodeId && !selectedEdgeId && topology.nodes.length > 0) {
      const faulted = topology.nodes.find((n) => n.status === "fault");
      setSelectedNodeId((faulted ?? topology.nodes[0]!).id);
    }
  }, [topology.nodes, topology.zones, selectedZoneId, selectedNodeId, selectedEdgeId]);

  const effectiveZoneId = useMemo(() => {
    if (hasActiveSearchOrFilter) return "all";
    if (selectedZoneId === "all") return "all";
    if (topology.zones.some((z) => z.id === selectedZoneId)) return selectedZoneId;
    return topology.zones[0]?.id ?? "all";
  }, [hasActiveSearchOrFilter, selectedZoneId, topology.zones]);

  const focusedZone = useMemo(
    () => (effectiveZoneId === "all" ? null : topology.zones.find((z) => z.id === effectiveZoneId) ?? null),
    [effectiveZoneId, topology.zones]
  );

  const zoneOffset = useMemo(
    () =>
      focusedZone
        ? { dx: focusedZone.x - 24, dy: focusedZone.y - 20 }
        : { dx: 0, dy: 0 },
    [focusedZone]
  );

  const visibleNodes = useMemo(() => {
    return topology.nodes.filter((n) => {
      if (!visibleMachineIds.has(n.id)) return false;
      if (focusedZone && (n.lineId || `${n.plantId}::unassigned`) !== focusedZone.lineId) {
        return false;
      }
      if (selectedCategory !== "all" && n.category !== selectedCategory) return false;
      return true;
    });
  }, [topology.nodes, visibleMachineIds, focusedZone, selectedCategory]);

  const visibleNodeSet = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  const visibleEdges = useMemo(() => {
    return topology.edges.filter(
      (e) =>
        activeConnTypes.has(e.category) &&
        visibleNodeSet.has(e.sourceId) &&
        visibleNodeSet.has(e.targetId)
    );
  }, [topology.edges, activeConnTypes, visibleNodeSet]);

  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<MachineCategoryId, number>> = {};
    for (const n of topology.nodes) {
      if (!visibleMachineIds.has(n.id)) continue;
      if (focusedZone && (n.lineId || `${n.plantId}::unassigned`) !== focusedZone.lineId) continue;
      counts[n.category] = (counts[n.category] ?? 0) + 1;
    }
    return counts;
  }, [topology.nodes, visibleMachineIds, focusedZone]);

  const connectionCounts = useMemo(() => {
    const counts: Partial<Record<ConnectionCategoryId, number>> = {};
    for (const e of topology.edges) {
      if (!visibleNodeSet.has(e.sourceId) || !visibleNodeSet.has(e.targetId)) continue;
      counts[e.category] = (counts[e.category] ?? 0) + 1;
    }
    return counts;
  }, [topology.edges, visibleNodeSet]);

  const visibleZones = useMemo(() => {
    const activeLines = new Set(
      visibleNodes.map((n) => n.lineId || `${n.plantId}::unassigned`)
    );
    return topology.zones
      .filter((z) => activeLines.has(z.lineId))
      .map((z) => ({
        ...z,
        x: z.x - zoneOffset.dx,
        y: z.y - zoneOffset.dy
      }));
  }, [topology.zones, visibleNodes, zoneOffset]);

  const faultLines = useMemo(() => {
    const set = new Set<string>();
    for (const n of topology.nodes) {
      if (n.status === "fault" && n.lineId) set.add(n.lineId);
    }
    return set;
  }, [topology.nodes]);

  const canvasDimensions = useMemo(() => {
    if (focusedZone) {
      return {
        width: Math.max(820, focusedZone.width + 48),
        height: Math.max(460, focusedZone.height + 40)
      };
    }
    return {
      width: topology.canvasWidth,
      height: topology.canvasHeight
    };
  }, [focusedZone, topology.canvasWidth, topology.canvasHeight]);

  const selectedNode: TopologyNode | null = useMemo(
    () => topology.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [topology.nodes, selectedNodeId]
  );

  const selectedEdge: TopologyEdge | null = useMemo(
    () => topology.edges.find((e) => e.id === selectedEdgeId) ?? null,
    [topology.edges, selectedEdgeId]
  );

  const selectedNodeEdges = useMemo(() => {
    if (!selectedNode) return { inbound: [] as TopologyEdge[], outbound: [] as TopologyEdge[] };
    return {
      inbound: topology.edges.filter((e) => e.targetId === selectedNode.id),
      outbound: topology.edges.filter((e) => e.sourceId === selectedNode.id)
    };
  }, [topology.edges, selectedNode]);

  const nodeMap = useMemo(
    () => new Map(topology.nodes.map((n) => [n.id, n])),
    [topology.nodes]
  );

  const toggleConnType = (id: ConnectionCategoryId) => {
    setActiveConnTypes((prev) => {
      const next = new Set(prev);
      if (next.has(id) && next.size > 1) next.delete(id);
      else if (next.has(id) && next.size === 1) {
        return new Set(Object.keys(CONNECTION_CATEGORIES) as ConnectionCategoryId[]);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const resetLayout = () => {
    const next: Record<string, { x: number; y: number }> = {};
    for (const n of topology.nodes) next[n.id] = n.position;
    setNodePositions(next);
    setZoom(1);
  };

  const openDocumentCitation = async (ref: TopologyDocumentRef) => {
    if (!ref.documentId || !ref.chunkId || ref.documentId === "ai-saved-topology") {
      setDocModal({
        loading: false,
        ref,
        document: {
          title: ref.title,
          revision: ref.revision,
          status: "current",
          source: ref.source
        },
        chunk: {
          page: ref.page,
          sectionPath: ref.sectionPath,
          text: ref.excerpt
        }
      });
      return;
    }

    setDocModal({ loading: true, ref });
    try {
      const res = await fetch(
        `/api/documents/${encodeURIComponent(ref.documentId)}/chunks/${encodeURIComponent(ref.chunkId)}`
      );
      if (res.ok) {
        const data = await res.json();
        setDocModal({ loading: false, ref, ...data });
      } else {
        setDocModal({
          loading: false,
          ref,
          document: {
            title: ref.title,
            revision: ref.revision,
            status: "current",
            source: ref.source
          },
          chunk: {
            page: ref.page,
            sectionPath: ref.sectionPath,
            text: ref.excerpt
          },
          notice: "Showing extracted drawing citation."
        });
      }
    } catch {
      setDocModal({
        loading: false,
        ref,
        document: {
          title: ref.title,
          revision: ref.revision,
          status: "current",
          source: ref.source
        },
        chunk: {
          page: ref.page,
          sectionPath: ref.sectionPath,
          text: ref.excerpt
        },
        notice: "Unable to load full document section; showing extracted excerpt."
      });
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError(null);
    setUploadNotice(null);
    setUploading(true);
    try {
      let res: Response;
      if (uploadFile) {
        const fd = new FormData();
        fd.append("file", uploadFile);
        if (uploadTitle.trim()) fd.append("title", uploadTitle.trim());
        fd.append("revision", uploadRevision.trim() || "Rev 1.0");
        res = await fetch("/api/machines", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/machines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: uploadTitle.trim() || "Custom Plant Drawing",
            revision: uploadRevision.trim() || "Rev 1.0",
            source: "custom-topology-drawing.md",
            rawContent: uploadText.trim()
          })
        });
      }
      const data = (await res.json().catch(() => ({}))) as {
        detail?: string;
        chunkCount?: number;
      };
      if (!res.ok) {
        setUploadError(data.detail ?? "Failed to ingest topology document.");
        return;
      }
      setUploadNotice(
        `Drawing indexed (${data.chunkCount ?? 1} chunks). Refreshing machine connections...`
      );
      setUploadTitle("");
      setUploadText("");
      setUploadFile(null);
      setUploadOpen(false);
      onTopologyUpdated();
    } catch {
      setUploadError("Network error uploading topology document.");
    } finally {
      setUploading(false);
    }
  };

  const hasCustomFilter =
    selectedCategory !== "all" ||
    activeConnTypes.size < Object.keys(CONNECTION_CATEGORIES).length;

  return (
    <div className="space-y-3">
      {/* Compact Line Switcher & Controls Bar */}
      <div className="rounded-xl border border-border/80 bg-card p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Line Switcher */}
          <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Production line focus">
            {topology.zones.map((z) => {
              const active = effectiveZoneId === z.id;
              const hasFault = faultLines.has(z.lineId);
              return (
                <button
                  key={z.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setSelectedZoneId(z.id);
                    const firstInLine = topology.nodes.find((n) => n.lineId === z.lineId);
                    if (firstInLine) {
                      setSelectedNodeId(firstInLine.id);
                      setSelectedEdgeId(null);
                    }
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150",
                    active
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  )}
                >
                  {hasFault && (
                    <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">{z.lineName.split("—")[0]?.trim()}</span>
                </button>
              );
            })}
            <button
              type="button"
              role="tab"
              aria-selected={effectiveZoneId === "all"}
              onClick={() => setSelectedZoneId("all")}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150",
                effectiveZoneId === "all"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              )}
            >
              All Lines
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant={filtersOpen || hasCustomFilter ? "secondary" : "outline"}
              size="sm"
              onClick={() => setFiltersOpen((v) => !v)}
              className="h-7 px-2.5 text-[11px]"
            >
              <Filter className="h-3 w-3" />
              <span>Filters{hasCustomFilter ? " *" : ""}</span>
            </Button>
            <Button
              variant={showAllLabels ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowAllLabels((v) => !v)}
              className="h-7 px-2.5 text-[11px]"
            >
              <Tag className="h-3 w-3" />
              <span>{showAllLabels ? "All Labels" : "Focus Labels"}</span>
            </Button>
            <div className="inline-flex items-center rounded-md border border-border/80 bg-background">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.7, Number((z - 0.1).toFixed(2))))}
                aria-label="Zoom out topology canvas"
                className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="px-1.5 font-mono text-[11px] tabular-nums text-foreground">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(1.3, Number((z + 0.1).toFixed(2))))}
                aria-label="Zoom in topology canvas"
                className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <Button variant="ghost" size="sm" onClick={resetLayout} className="h-7 px-2 text-[11px]">
              <RotateCcw className="h-3 w-3" />
              <span>Reset</span>
            </Button>
            {canUploadDrawing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setUploadError(null);
                  setUploadOpen(true);
                }}
                className="h-7 px-2.5 text-[11px]"
              >
                <FileUp className="h-3.5 w-3.5 text-primary" />
                <span>Upload Drawing / PDF</span>
              </Button>
            )}
          </div>
        </div>

        {/* Collapsible Group & Connection Filters */}
        {filtersOpen && (
          <div className="space-y-2 border-t border-border/60 pt-2.5">
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[11px] font-medium text-muted-foreground mr-1">Groups:</span>
              <button
                type="button"
                onClick={() => setSelectedCategory("all")}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                  selectedCategory === "all"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                All
              </button>
              {(Object.values(MACHINE_CATEGORIES) as Array<typeof MACHINE_CATEGORIES[MachineCategoryId]>).map(
                (cat) => {
                  const count = categoryCounts[cat.id] ?? 0;
                  if (count === 0) return null;
                  const active = selectedCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategory(active ? "all" : cat.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
                        active
                          ? "border-foreground/50 bg-muted text-foreground"
                          : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span>{cat.label}</span>
                      <span className="font-mono text-[10px] opacity-70 tabular-nums">{count}</span>
                    </button>
                  );
                }
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[11px] font-medium text-muted-foreground mr-1">Connections:</span>
              {(Object.values(CONNECTION_CATEGORIES) as Array<typeof CONNECTION_CATEGORIES[ConnectionCategoryId]>).map(
                (conn) => {
                  const enabled = activeConnTypes.has(conn.id);
                  const count = connectionCounts[conn.id] ?? 0;
                  return (
                    <button
                      key={conn.id}
                      type="button"
                      aria-pressed={enabled}
                      onClick={() => toggleConnType(conn.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium transition-opacity",
                        enabled
                          ? "bg-muted/50 text-foreground hover:bg-muted"
                          : "text-muted-foreground opacity-45 hover:opacity-75"
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="w-3 h-0 border-t-2 shrink-0"
                        style={{
                          borderColor: conn.color,
                          borderTopStyle: conn.dashed ? "dashed" : "solid"
                        }}
                      />
                      <span>{conn.label}</span>
                      <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                        {count}
                      </span>
                    </button>
                  );
                }
              )}
            </div>
          </div>
        )}

        {/* Whisper-quiet 1-line color legend & count */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {(Object.values(CONNECTION_CATEGORIES) as Array<typeof CONNECTION_CATEGORIES[ConnectionCategoryId]>).map(
              (conn) => (
                <span
                  key={conn.id}
                  className={cn(
                    "inline-flex items-center gap-1.5",
                    !activeConnTypes.has(conn.id) && "opacity-40"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="w-3 h-0 border-t-2 shrink-0"
                    style={{
                      borderColor: conn.color,
                      borderTopStyle: conn.dashed ? "dashed" : "solid"
                    }}
                  />
                  <span>{conn.label}</span>
                </span>
              )
            )}
          </div>
          <span className="font-mono tabular-nums">
            {visibleNodes.length} machines · {visibleEdges.length} links · {topology.documentsIndexed} drawings
          </span>
        </div>
      </div>

      {uploadNotice && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200 flex items-center justify-between gap-2">
          <span>{uploadNotice}</span>
          <button type="button" onClick={() => setUploadNotice(null)} aria-label="Dismiss notice">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Split Layout: Interactive Topology Canvas + Grounded Inspector */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Interactive Canvas */}
        <div
          className="relative h-[580px] w-full overflow-auto rounded-xl border border-border/80 bg-background lutic-grid-bg"
          onMouseMove={(e) => {
            if (!draggingId) return;
            dragMovedRef.current = true;
            const rect = e.currentTarget.getBoundingClientRect();
            const rawX = (e.clientX - rect.left + e.currentTarget.scrollLeft) / zoom - dragOffsetRef.current.dx;
            const rawY = (e.clientY - rect.top + e.currentTarget.scrollTop) / zoom - dragOffsetRef.current.dy;
            const x = Math.max(16, Math.round(rawX + zoneOffset.dx));
            const y = Math.max(16, Math.round(rawY + zoneOffset.dy));
            setNodePositions((prev) => ({ ...prev, [draggingId]: { x, y } }));
          }}
          onMouseUp={() => {
            setDraggingId(null);
          }}
          onMouseLeave={() => {
            setDraggingId(null);
          }}
        >
          <div
            className="relative origin-top-left"
            style={{
              width: Math.round(canvasDimensions.width * zoom),
              height: Math.round(canvasDimensions.height * zoom)
            }}
          >
            <div
              className="relative origin-top-left"
              style={{
                width: canvasDimensions.width,
                height: canvasDimensions.height,
                transform: `scale(${zoom})`
              }}
            >
              {/* Production Line Swimlane Group Frames */}
              {visibleZones.map((zone) => (
                <div
                  key={zone.id}
                  style={{
                    left: zone.x,
                    top: zone.y,
                    width: zone.width,
                    height: zone.height,
                    borderColor: `${zone.color}40`
                  }}
                  className="absolute rounded-2xl border border-dashed bg-card/35 pointer-events-none"
                >
                  <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/50">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: zone.color }}
                      />
                      <span className="text-xs font-semibold text-foreground truncate">
                        {zone.lineName}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground uppercase">
                        {zone.plantId}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                      {zone.machineCount} machines
                    </span>
                  </div>
                </div>
              ))}

              {/* Color-Coded SVG Connection Curves with Open-Channel Routing */}
              <svg
                width={canvasDimensions.width}
                height={canvasDimensions.height}
                className="absolute inset-0 pointer-events-none"
              >
                <defs>
                  {(Object.values(CONNECTION_CATEGORIES) as Array<typeof CONNECTION_CATEGORIES[ConnectionCategoryId]>).map(
                    (meta) => (
                      <marker
                        key={meta.id}
                        id={`topo-arrow-${meta.id}`}
                        markerWidth="7"
                        markerHeight="7"
                        refX="6"
                        refY="3.5"
                        orient="auto"
                      >
                        <path d="M0,0 L7,3.5 L0,7 Z" fill={meta.color} />
                      </marker>
                    )
                  )}
                </defs>

                {visibleEdges.map((edge, idx) => {
                  const rawS = nodePositions[edge.sourceId] ?? nodeMap.get(edge.sourceId)?.position;
                  const rawT = nodePositions[edge.targetId] ?? nodeMap.get(edge.targetId)?.position;
                  if (!rawS || !rawT) return null;

                  const sPos = { x: rawS.x - zoneOffset.dx, y: rawS.y - zoneOffset.dy };
                  const tPos = { x: rawT.x - zoneOffset.dx, y: rawT.y - zoneOffset.dy };

                  const sameCol = Math.abs(tPos.x - sPos.x) < 40;
                  const reverse = !sameCol && tPos.x < sPos.x;
                  const fanY = ((idx % 3) - 1) * 10;

                  let d: string;
                  if (sameCol) {
                    const sx = sPos.x + NODE_W;
                    const sy = sPos.y + NODE_H / 2 + fanY;
                    const tx = tPos.x + NODE_W;
                    const ty = tPos.y + NODE_H / 2 - fanY;
                    const arcX = sx + 48 + (idx % 3) * 12;
                    d = `M ${sx} ${sy} C ${arcX} ${sy}, ${arcX} ${ty}, ${tx} ${ty}`;
                  } else if (reverse) {
                    const sx = sPos.x;
                    const sy = sPos.y + NODE_H / 2 + fanY;
                    const tx = tPos.x + NODE_W;
                    const ty = tPos.y + NODE_H / 2 - fanY;
                    const ctrl = Math.max(54, Math.abs(sx - tx) * 0.42);
                    d = `M ${sx} ${sy} C ${sx - ctrl} ${sy + 28}, ${tx + ctrl} ${ty + 28}, ${tx} ${ty}`;
                  } else {
                    const sx = sPos.x + NODE_W;
                    const sy = sPos.y + NODE_H / 2 + fanY;
                    const tx = tPos.x;
                    const ty = tPos.y + NODE_H / 2;
                    const ctrl = Math.max(56, (tx - sx) * 0.48);
                    d = `M ${sx} ${sy} C ${sx + ctrl} ${sy}, ${tx - ctrl} ${ty}, ${tx} ${ty}`;
                  }

                  const meta = getConnectionCategoryMeta(edge.category);
                  const isEdgeSelected = selectedEdgeId === edge.id || hoveredEdgeId === edge.id;
                  const touchesSelectedNode =
                    selectedNodeId === edge.sourceId || selectedNodeId === edge.targetId;
                  const hasFocus = Boolean(selectedEdgeId || selectedNodeId || hoveredEdgeId);

                  return (
                    <g key={edge.id}>
                      <path
                        d={d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={14}
                        className="pointer-events-auto cursor-pointer"
                        onMouseEnter={() => setHoveredEdgeId(edge.id)}
                        onMouseLeave={() => setHoveredEdgeId((prev) => (prev === edge.id ? null : prev))}
                        onClick={() => {
                          setSelectedEdgeId(edge.id);
                          setSelectedNodeId(null);
                        }}
                      />
                      <path
                        d={d}
                        fill="none"
                        stroke={edge.categoryColor}
                        strokeWidth={isEdgeSelected ? 2.6 : touchesSelectedNode ? 2.1 : 1.5}
                        strokeOpacity={
                          hasFocus
                            ? isEdgeSelected || touchesSelectedNode
                              ? 0.95
                              : 0.16
                            : 0.65
                        }
                        strokeDasharray={meta.dashed ? "5 4" : undefined}
                        markerEnd={`url(#topo-arrow-${edge.category})`}
                      />
                    </g>
                  );
                })}
              </svg>

              {/* Channel-Centered Midpoint Connection Labels (Shown on Focus/Hover or "All Labels") */}
              {visibleEdges.map((edge, idx) => {
                const rawS = nodePositions[edge.sourceId] ?? nodeMap.get(edge.sourceId)?.position;
                const rawT = nodePositions[edge.targetId] ?? nodeMap.get(edge.targetId)?.position;
                if (!rawS || !rawT) return null;

                const isSelected = selectedEdgeId === edge.id || hoveredEdgeId === edge.id;
                const highlighted =
                  isSelected ||
                  selectedNodeId === edge.sourceId ||
                  selectedNodeId === edge.targetId;

                if (!showAllLabels && !highlighted) {
                  return null;
                }

                const sPos = { x: rawS.x - zoneOffset.dx, y: rawS.y - zoneOffset.dy };
                const tPos = { x: rawT.x - zoneOffset.dx, y: rawT.y - zoneOffset.dy };
                const sameCol = Math.abs(tPos.x - sPos.x) < 40;
                const reverse = !sameCol && tPos.x < sPos.x;

                let mx: number;
                let my: number;
                if (sameCol) {
                  mx = sPos.x + NODE_W + 46 + (idx % 3) * 10;
                  my = (sPos.y + tPos.y + NODE_H) / 2;
                } else if (reverse) {
                  mx = (sPos.x + tPos.x + NODE_W) / 2;
                  my = (sPos.y + tPos.y + NODE_H) / 2 + 18 + ((idx % 2) * 14);
                } else {
                  const sx = sPos.x + NODE_W;
                  const tx = tPos.x;
                  mx = (sx + tx) / 2;
                  my = (sPos.y + tPos.y + NODE_H) / 2 + ((idx % 3) - 1) * 14;
                }

                return (
                  <button
                    key={`lbl-${edge.id}`}
                    type="button"
                    onMouseEnter={() => setHoveredEdgeId(edge.id)}
                    onMouseLeave={() => setHoveredEdgeId((prev) => (prev === edge.id ? null : prev))}
                    onClick={() => {
                      setSelectedEdgeId(edge.id);
                      setSelectedNodeId(null);
                    }}
                    style={{
                      left: mx,
                      top: my,
                      transform: "translate(-50%, -50%)",
                      borderColor: edge.categoryColor
                    }}
                    className={cn(
                      "absolute rounded-full border bg-background/95 px-2 py-0.5 font-mono text-[9.5px] font-medium transition-transform duration-150 hover:scale-105 whitespace-nowrap",
                      highlighted ? "z-30 ring-1 ring-ring text-foreground" : "z-20 text-foreground/85"
                    )}
                    title={`${edge.categoryLabel}: ${edge.label}`}
                  >
                    {edge.label}
                  </button>
                );
              })}

              {/* Minimal Categorized Machine Nodes */}
              {visibleNodes.map((node) => {
                const rawPos = nodePositions[node.id] ?? node.position;
                const pos = { x: rawPos.x - zoneOffset.dx, y: rawPos.y - zoneOffset.dy };
                const live = machinesById.get(node.id);
                const active = selectedNodeId === node.id;
                const activeAlarms = live?.activeAlarms ?? [];

                return (
                  <div
                    key={node.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Inspect machine ${node.name} (${node.categoryLabel})`}
                    aria-pressed={active}
                    onMouseDown={(e) => {
                      dragMovedRef.current = false;
                      const canvas = e.currentTarget.parentElement?.parentElement?.parentElement;
                      const rect = canvas?.getBoundingClientRect();
                      if (rect && canvas) {
                        const mouseCanvasX = (e.clientX - rect.left + canvas.scrollLeft) / zoom;
                        const mouseCanvasY = (e.clientY - rect.top + canvas.scrollTop) / zoom;
                        dragOffsetRef.current = {
                          dx: mouseCanvasX - pos.x,
                          dy: mouseCanvasY - pos.y
                        };
                      }
                      setDraggingId(node.id);
                    }}
                    onClick={() => {
                      if (!dragMovedRef.current) {
                        setSelectedNodeId(node.id);
                        setSelectedEdgeId(null);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedNodeId(node.id);
                        setSelectedEdgeId(null);
                      }
                    }}
                    style={{
                      left: pos.x,
                      top: pos.y,
                      width: NODE_W,
                      height: NODE_H
                    }}
                    className={cn(
                      "absolute z-20 flex flex-col justify-between rounded-xl border bg-card/95 px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] select-none cursor-grab active:cursor-grabbing overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-primary ring-2 ring-primary/20 shadow-md"
                        : "border-border/80 hover:border-foreground/30"
                    )}
                  >
                    {/* Top Category Accent Line */}
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 top-0 h-[2px]"
                      style={{ backgroundColor: node.categoryColor }}
                    />

                    <div className="flex items-center justify-between gap-1.5">
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: node.categoryColor }}
                        />
                        <span>{getMachineCategoryMeta(node.machineType).shortLabel}</span>
                      </span>
                      <MachineStatusBadge status={node.status} size="sm" />
                    </div>

                    <div className="text-xs font-semibold text-foreground truncate">
                      {node.name}
                    </div>

                    <div className="flex items-center justify-between gap-1 text-[10px] font-mono tabular-nums text-muted-foreground">
                      <span className="truncate">
                        {live?.vibration != null ? `${live.vibration}mm/s` : "—"} ·{" "}
                        {live?.temperature != null ? `${live.temperature}C` : "—"}
                      </span>
                      {activeAlarms.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-destructive/15 px-1 py-0.5 text-[9.5px] font-semibold text-destructive shrink-0">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {activeAlarms[0]!.code}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Drawing & Topology Inspector */}
        <aside className="min-w-0 space-y-3">
          {selectedEdge ? (
            <Card className="p-4 space-y-4">
              <div className="space-y-1.5 border-b border-border pb-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge className={cn("font-mono text-[10px]", getConnectionCategoryMeta(selectedEdge.category).badgeClass)}>
                    {selectedEdge.categoryLabel}
                  </Badge>
                  {selectedEdge.crossLine && (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      Cross-Line
                    </Badge>
                  )}
                </div>
                <h2 className="text-sm font-bold text-foreground">{selectedEdge.label}</h2>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {selectedEdge.spec}
                </p>
              </div>

              <div className="space-y-2 text-xs">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Connected Equipment
                </div>
                <div className="grid gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedNodeId(selectedEdge.sourceId);
                      setSelectedEdgeId(null);
                    }}
                    className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-left hover:bg-muted/60"
                  >
                    <span className="font-medium truncate">
                      From: {nodeMap.get(selectedEdge.sourceId)?.name ?? selectedEdge.sourceId}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">Inspect</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedNodeId(selectedEdge.targetId);
                      setSelectedEdgeId(null);
                    }}
                    className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-left hover:bg-muted/60"
                  >
                    <span className="font-medium truncate">
                      To: {nodeMap.get(selectedEdge.targetId)?.name ?? selectedEdge.targetId}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">Inspect</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2 border-t border-border pt-3">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Drawing &amp; PDF Sources ({selectedEdge.citations.length})
                </div>
                {selectedEdge.citations.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    Grounded from active topology configuration.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedEdge.citations.map((cit, idx) => (
                      <button
                        key={`${cit.documentId}-${idx}`}
                        type="button"
                        onClick={() => openDocumentCitation(cit)}
                        className="w-full text-left rounded-md border border-border bg-background p-2.5 space-y-1 hover:border-primary/50 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground truncate">
                            <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="truncate">{cit.title}</span>
                          </span>
                          <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground truncate">
                          {cit.source} · {cit.revision} · p.{cit.page}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          ) : selectedNode ? (
            <Card className="p-4 space-y-4">
              <div className="space-y-2 border-b border-border pb-3">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase",
                      getMachineCategoryMeta(selectedNode.machineType).badgeClass
                    )}
                  >
                    {selectedNode.categoryLabel}
                  </span>
                  <MachineStatusBadge status={selectedNode.status} size="sm" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground">{selectedNode.name}</h2>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {selectedNode.manufacturer} {selectedNode.model} · {selectedNode.id}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link
                    href={`/m/${selectedNode.id}`}
                    className={buttonVariants({ size: "sm", variant: "outline" })}
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    <span>Open QR Workspace</span>
                  </Link>
                  <Button
                    size="sm"
                    onClick={() => {
                      window.dispatchEvent(
                        new CustomEvent("lutic:open-ai", {
                          detail: {
                            scope: "screen",
                            entityId: selectedNode.id,
                            entityName: selectedNode.name,
                            prompt: `Review connections and manuals for ${selectedNode.id}`
                          }
                        })
                      );
                    }}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    <span>Ask / Edit AI</span>
                  </Button>
                </div>
              </div>

              {/* Upstream & Downstream Links */}
              <div className="space-y-2">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Machine Connections ({selectedNodeEdges.inbound.length + selectedNodeEdges.outbound.length})
                </div>
                {selectedNodeEdges.inbound.length === 0 &&
                selectedNodeEdges.outbound.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                    No connections mapped for this asset yet. Upload a drawing PDF or use Lutic AI to add a connection.
                  </div>
                ) : (
                  <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                    {selectedNodeEdges.inbound.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => {
                          setSelectedEdgeId(e.id);
                          setSelectedNodeId(null);
                        }}
                        className="w-full text-left rounded-md border border-border bg-muted/25 px-2.5 py-2 hover:border-primary/50 space-y-0.5"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            INBOUND &lt;-
                          </span>
                          <span
                            className="rounded-sm px-1.5 py-0.5 font-mono text-[9.5px] font-semibold"
                            style={{
                              backgroundColor: `${e.categoryColor}18`,
                              color: e.categoryColor
                            }}
                          >
                            {e.label}
                          </span>
                        </div>
                        <div className="text-xs font-medium truncate">
                          {nodeMap.get(e.sourceId)?.name ?? e.sourceId}
                        </div>
                      </button>
                    ))}
                    {selectedNodeEdges.outbound.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => {
                          setSelectedEdgeId(e.id);
                          setSelectedNodeId(null);
                        }}
                        className="w-full text-left rounded-md border border-border bg-muted/25 px-2.5 py-2 hover:border-primary/50 space-y-0.5"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            OUTBOUND -&gt;
                          </span>
                          <span
                            className="rounded-sm px-1.5 py-0.5 font-mono text-[9.5px] font-semibold"
                            style={{
                              backgroundColor: `${e.categoryColor}18`,
                              color: e.categoryColor
                            }}
                          >
                            {e.label}
                          </span>
                        </div>
                        <div className="text-xs font-medium truncate">
                          {nodeMap.get(e.targetId)?.name ?? e.targetId}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Manuals & Drawing PDFs */}
              <div className="space-y-2 border-t border-border pt-3">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Knowledge &amp; Drawings ({selectedNode.documents.length})
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                  {selectedNode.documents.map((doc) => (
                    <button
                      key={doc.documentId}
                      type="button"
                      onClick={() => openDocumentCitation(doc)}
                      className="w-full text-left rounded-md border border-border bg-background px-2.5 py-2 hover:border-primary/50 space-y-0.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold truncate">{doc.title}</span>
                        <Badge variant="outline" className="font-mono text-[9.5px] shrink-0">
                          {doc.revision}
                        </Badge>
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground truncate">
                        {doc.source}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-5 text-xs text-muted-foreground space-y-2">
              <Maximize2 className="h-4 w-4 text-primary" />
              <div className="font-semibold text-foreground">Select a Machine or Connection</div>
              <p>
                Click any machine card or colored connection label on the canvas to inspect its process spec, drawing PDF citations, and live status.
              </p>
            </Card>
          )}
        </aside>
      </div>

      {/* Upload Drawing / PDF Modal */}
      <Dialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        ariaLabel="Upload topology drawing or PDF"
        className="max-w-lg p-5 space-y-4"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold">Upload Plant Drawing / Connection PDF</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Upload a PDF, Markdown, or text schematic describing machine interconnects. Lutic extracts and plots new connections on the canvas.
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setUploadOpen(false)}
            aria-label="Close drawing upload dialog"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleUploadSubmit} className="space-y-3">
          {uploadError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {uploadError}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="topo-doc-title">Drawing / Document Title</Label>
              <Input
                id="topo-doc-title"
                placeholder="e.g. DWG-DET-310 Line 3 Update"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="topo-doc-rev">Revision</Label>
              <Input
                id="topo-doc-rev"
                value={uploadRevision}
                onChange={(e) => setUploadRevision(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="topo-doc-file">PDF / Markdown / Text File</Label>
            <Input
              id="topo-doc-file"
              type="file"
              accept=".pdf,.md,.markdown,.txt"
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {!uploadFile && (
            <div className="space-y-1">
              <Label htmlFor="topo-doc-text">Or Paste Connection Spec</Label>
              <Textarea
                id="topo-doc-text"
                rows={4}
                placeholder="[CONN: mach-l3-comp-01 -> mach-l3-pack-01 | pneumatic_utility | 6.0 bar Erector Air | Feeds carton erector]"
                value={uploadText}
                onChange={(e) => setUploadText(e.target.value)}
                className="font-mono text-[11px]"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={uploading || (!uploadFile && uploadText.trim().length < 10)}
            >
              {uploading ? "Indexing Drawing..." : "Ingest & Update Canvas"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Cited Document Viewer Modal */}
      <Dialog
        open={Boolean(docModal)}
        onOpenChange={(open) => !open && setDocModal(null)}
        variant="drawer-right"
        ariaLabel="Topology Document Citation Viewer"
        className="p-5 space-y-4"
      >
        {docModal && (
          <>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-bold">
                  {docModal.document?.title ?? docModal.ref.title}
                </h3>
                <p className="font-mono text-[11px] text-muted-foreground mt-0.5">
                  {docModal.document?.source ?? docModal.ref.source} ·{" "}
                  {docModal.document?.revision ?? docModal.ref.revision}
                </p>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setDocModal(null)}
                aria-label="Close document citation"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {docModal.notice && (
              <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
                {docModal.notice}
              </div>
            )}
            {docModal.loading ? (
              <div className="text-xs text-muted-foreground animate-pulse">
                Loading drawing passage...
              </div>
            ) : (
              docModal.chunk && (
                <div className="space-y-2">
                  <div className="font-mono text-[11px] font-semibold text-primary">
                    Page {docModal.chunk.page} · {docModal.chunk.sectionPath}
                  </div>
                  <div className="rounded-md border border-border bg-muted/20 p-3.5 text-xs whitespace-pre-wrap leading-relaxed font-mono">
                    {docModal.chunk.text}
                  </div>
                </div>
              )
            )}
          </>
        )}
      </Dialog>
    </div>
  );
}
