"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Cpu, QrCode, RefreshCw, Search } from "lucide-react";
import { useAppContext } from "@/components/providers";
import { MachineStatusBadge } from "@/components/machine-status-badge";
import { AuthGate } from "@/components/ui/auth-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SpotlightNavbar } from "@/components/vengeance/spotlight-navbar";

interface MachineItem {
  id: string;
  name: string;
  plantId: string;
  machineType: string;
  manufacturer: string;
  model: string;
  criticality: string;
  status: string | null;
  temperature: number | null;
  vibration: number | null;
  updatedAt?: string | null;
  activeAlarms: Array<{ code: string; severity: string }>;
}

const STATUS_RANK: Record<string, number> = {
  fault: 0,
  idle: 1,
  running: 2,
  offline: 3
};

export default function MachinesPage() {
  const { user } = useAppContext();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [plantFilter, setPlantFilter] = useState("all");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["machines", user?.userId],
    enabled: Boolean(user),
    queryFn: async () => {
      const res = await fetch("/api/machines");
      if (!res.ok) throw new Error("Failed to load machines");
      return (await res.json()) as {
        machines: MachineItem[];
        plants: Array<{ id: string; name: string; timezone?: string }>;
      };
    }
  });

  const machines = useMemo(() => data?.machines ?? [], [data?.machines]);

  const statusCounts = useMemo(() => {
    const counts = { all: machines.length, fault: 0, running: 0, idle: 0, offline: 0 };
    for (const m of machines) {
      const key = m.status ?? "offline";
      if (key in counts) {
        counts[key as keyof typeof counts] += 1;
      }
    }
    return counts;
  }, [machines]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return machines
      .filter((m) => {
        if (statusFilter !== "all" && (m.status ?? "offline") !== statusFilter) return false;
        if (plantFilter !== "all" && m.plantId !== plantFilter) return false;
        if (!q) return true;
        return (
          m.name.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.machineType.toLowerCase().includes(q) ||
          m.manufacturer.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const ra = STATUS_RANK[a.status ?? "offline"] ?? 4;
        const rb = STATUS_RANK[b.status ?? "offline"] ?? 4;
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name);
      });
  }, [machines, statusFilter, plantFilter, search]);

  const groupedByPlant = useMemo(() => {
    const map = new Map<string, MachineItem[]>();
    for (const m of filtered) {
      const list = map.get(m.plantId) ?? [];
      list.push(m);
      map.set(m.plantId, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  if (!user) {
    return (
      <AuthGate
        title="Sign in to view machines"
        description="Plant equipment telemetry and QR diagnostic workspaces are scoped by role and plant permissions."
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-border pb-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Shop-Floor Assets
          </div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            <span>Machine Fleet &amp; QR Diagnostics</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Scoped to your authorized plants: {user.plantIds.join(", ")}. Faulted assets are surfaced first.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search machine, ID, or type..."
              aria-label="Search machines"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 w-56"
            />
          </div>
          <Select
            value={plantFilter}
            onChange={(e) => setPlantFilter(e.target.value)}
            aria-label="Filter by plant"
          >
            <option value="all">All Plants</option>
            {(data?.plants ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <SpotlightNavbar
        activeId={statusFilter}
        onSelect={setStatusFilter}
        items={[
          { id: "all", label: "All", badge: statusCounts.all },
          { id: "fault", label: "Fault", badge: statusCounts.fault },
          { id: "running", label: "Running", badge: statusCounts.running },
          { id: "idle", label: "Idle", badge: statusCounts.idle },
          { id: "offline", label: "Offline", badge: statusCounts.offline }
        ]}
      />

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-32 rounded-lg border border-border bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-xs text-destructive flex items-center justify-between gap-3"
        >
          <span>Failed to load machines for your authorized plants.</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Retry</span>
          </Button>
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <Card className="p-8 text-center text-xs text-muted-foreground space-y-1">
          <div className="font-semibold text-foreground">
            {machines.length === 0
              ? "No machines configured yet."
              : "No machines match the active filter criteria."}
          </div>
          {machines.length === 0 && (
            <p>
              Create a production line and machine in Admin Console -&gt; Assets &amp; QR, then submit readings via POST /api/telemetry.
            </p>
          )}
        </Card>
      )}

      <div className="space-y-6">
        {groupedByPlant.map(([plantId, items]) => {
          const plantMeta = data?.plants?.find((p) => p.id === plantId);
          const plantName = plantMeta?.name ?? plantId;
          const faults = items.filter((i) => i.status === "fault").length;
          return (
            <section key={plantId} className="space-y-2.5">
              <div className="flex items-center justify-between border-b border-border/70 pb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {plantName}
                  </span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {plantId}
                  </Badge>
                  {plantMeta?.timezone && (
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {plantMeta.timezone}
                    </span>
                  )}
                  {faults > 0 && (
                    <Badge variant="destructive" className="text-[10px] tabular-nums">
                      {faults} fault{faults === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {items.length} asset{items.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((m) => {
                  const updatedMs = m.updatedAt ? new Date(m.updatedAt).getTime() : 0;
                  const isStale = Boolean(updatedMs && Date.now() - updatedMs > 15 * 60 * 1000);
                  return (
                  <Link
                    key={m.id}
                    href={`/m/${m.id}`}
                    className="group rounded-lg border border-border bg-card p-4 hover:border-primary/60 transition-colors space-y-2.5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
                          {m.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {m.manufacturer} {m.model} · <code className="font-mono">{m.machineType}</code>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <MachineStatusBadge status={m.status ?? "offline"} size="sm" />
                        {!m.updatedAt ? (
                          <Badge variant="outline" className="text-[10px]">No telemetry</Badge>
                        ) : isStale ? (
                          <Badge variant="warning" className="text-[10px]">Stale</Badge>
                        ) : null}
                      </div>
                    </div>

                    {m.activeAlarms.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {m.activeAlarms.map((a, idx) => (
                          <Badge key={idx} variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            <span>Alarm {a.code}</span>
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/60 tabular-nums font-mono">
                      <div>
                        <div>
                          Vib {m.vibration != null ? `${m.vibration} mm/s` : "—"} ·{" "}
                          {m.temperature != null ? `${m.temperature}°C` : "—"}
                        </div>
                        <div className="text-[10px] mt-0.5">
                          {m.updatedAt
                            ? `Updated ${new Date(m.updatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC`
                            : "Awaiting telemetry"}
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 font-sans font-semibold text-primary">
                        <QrCode className="h-3.5 w-3.5" />
                        <span>Open</span>
                      </span>
                    </div>
                  </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
