"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Play,
  Plus,
  Search,
  Trash2,
  X
} from "lucide-react";
import { useAppContext } from "./providers";
import { AuthGate } from "./ui/auth-gate";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { SpotlightNavbar } from "./vengeance/spotlight-navbar";

interface MachineTelemetry {
  id: string;
  name: string;
  plantId: string;
  status: string | null;
  temperature: number | null;
  vibration: number | null;
  pressure: number | null;
  updatedAt?: string | null;
}

interface ReadingBucket {
  bucketStart: string;
  tag: string;
  unit: string;
  avg: number;
}

interface AlertRuleRow {
  id: string;
  name: string;
  machineId: string | null;
  metricTag: string;
  operator: string;
  threshold: number;
  severity: string;
  state: string;
  enabled: boolean;
}

interface AlertEventRow {
  id: string;
  ruleId: string | null;
  machineId: string | null;
  status: string;
  severity: string;
  title: string;
  message: string;
  triggeredAt: string;
  acknowledgedBy?: string | null;
  resolvedBy?: string | null;
}

export function ruleStateBadgeVariant(state: string): "destructive" | "warning" | "success" {
  if (state === "ALARM") return "destructive";
  if (state === "INSUFFICIENT_DATA") return "warning";
  return "success";
}

export function MonitoringConsole() {
  const { user, demoEnabled } = useAppContext();
  const [machines, setMachines] = useState<MachineTelemetry[]>([]);
  const [selectedMachine, setSelectedMachine] = useState("");
  const [series, setSeries] = useState<ReadingBucket[]>([]);
  const [rules, setRules] = useState<AlertRuleRow[]>([]);
  const [alerts, setAlerts] = useState<AlertEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ticking, setTicking] = useState(false);

  const [ruleForm, setRuleForm] = useState({
    name: "",
    machineId: "",
    metric: "temperature",
    operator: "gt",
    threshold: "80",
    severity: "high"
  });

  const activeMachineRef = useRef("");
  activeMachineRef.current = selectedMachine;
  const loadReqRef = useRef(0);
  const seriesReqRef = useRef(0);
  const plantScopeKey = user?.plantIds?.join(",") ?? "";

  const canWriteRules = user?.role === "analyst" || user?.role === "admin";
  const canAck =
    user?.role === "engineer" ||
    user?.role === "manager" ||
    user?.role === "admin";

  const readErrorDetail = async (res: Response, fallback: string) => {
    try {
      const err = (await res.json()) as { detail?: string };
      return err.detail ?? fallback;
    } catch {
      return fallback;
    }
  };

  const fetchMachineSeries = async (machineId: string, expectedLoadId?: number) => {
    if (!machineId) {
      setSeries([]);
      return;
    }
    const reqId = ++seriesReqRef.current;
    try {
      const res = await fetch(
        `/api/monitoring/metrics?machineId=${encodeURIComponent(machineId)}`,
        { cache: "no-store" }
      );
      if (
        reqId !== seriesReqRef.current ||
        (expectedLoadId !== undefined && expectedLoadId !== loadReqRef.current)
      ) {
        return;
      }
      if (res.ok) {
        const data = (await res.json()) as {
          machines?: MachineTelemetry[];
          series?: ReadingBucket[];
        };
        setSeries(data.series ?? []);
        const updated = data.machines?.[0];
        if (updated) {
          setMachines((prev) =>
            prev.map((m) => (m.id === updated.id ? updated : m))
          );
        }
      } else {
        setNotice(
          await readErrorDetail(res, "Failed to load machine telemetry series")
        );
      }
    } catch {
      if (
        reqId === seriesReqRef.current &&
        (expectedLoadId === undefined || expectedLoadId === loadReqRef.current)
      ) {
        setNotice("Failed to load machine telemetry series");
      }
    }
  };

  const load = async (mId = activeMachineRef.current, showLoading = false) => {
    const loadId = ++loadReqRef.current;
    if (showLoading) {
      setLoading(true);
      setLoadError(null);
    }
    const seriesReqAtStart = seriesReqRef.current;
    try {
      const [mRes, rRes, aRes] = await Promise.all([
        fetch("/api/monitoring/metrics", { cache: "no-store" }),
        fetch("/api/monitoring/rules", { cache: "no-store" }),
        fetch("/api/monitoring/alerts", { cache: "no-store" })
      ]);
      if (loadId !== loadReqRef.current) return;

      if (mRes.ok) {
        const mData = (await mRes.json()) as {
          machineId?: string | null;
          machines: MachineTelemetry[];
          series: ReadingBucket[];
        };
        if (loadId !== loadReqRef.current) return;
        const machineList = mData.machines ?? [];
        setMachines(machineList);
        const preferredId = activeMachineRef.current || mId;
        const firstId = machineList[0]?.id ?? "";
        const targetId =
          preferredId && machineList.some((m) => m.id === preferredId)
            ? preferredId
            : firstId;

        if (targetId !== activeMachineRef.current) {
          activeMachineRef.current = targetId;
          setSelectedMachine(targetId);
        }
        setRuleForm((prev) => ({
          ...prev,
          machineId: machineList.some((m) => m.id === prev.machineId)
            ? prev.machineId
            : targetId
        }));

        if (!targetId) {
          if (seriesReqRef.current === seriesReqAtStart) {
            setSeries([]);
          }
        } else if ((mData.machineId ?? firstId) === targetId) {
          if (seriesReqRef.current === seriesReqAtStart) {
            setSeries(mData.series ?? []);
          }
        } else if (seriesReqRef.current === seriesReqAtStart) {
          await fetchMachineSeries(targetId, loadId);
        }
      }
      if (loadId !== loadReqRef.current) return;
      const loadErrors: string[] = [];
      if (!mRes.ok) {
        loadErrors.push(await readErrorDetail(mRes, "Failed to load telemetry metrics"));
      }
      if (rRes.ok) {
        const rData = (await rRes.json()) as { rules: AlertRuleRow[] };
        if (loadId === loadReqRef.current) setRules(rData.rules ?? []);
      } else {
        loadErrors.push(await readErrorDetail(rRes, "Failed to load alert rules"));
      }
      if (aRes.ok) {
        const aData = (await aRes.json()) as { alerts: AlertEventRow[] };
        if (loadId === loadReqRef.current) setAlerts(aData.alerts ?? []);
      } else {
        loadErrors.push(await readErrorDetail(aRes, "Failed to load alert incidents"));
      }
      if (loadErrors.length > 0 && loadId === loadReqRef.current) {
        setLoadError(loadErrors[0] ?? "Failed to load monitoring data");
      } else if (loadId === loadReqRef.current) {
        setLoadError(null);
      }
    } catch {
      if (loadId === loadReqRef.current) {
        setLoadError("Failed to load telemetry metrics");
      }
    } finally {
      if (loadId === loadReqRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadReqRef.current += 1;
    seriesReqRef.current += 1;
    setNotice(null);
    setLoadError(null);
    if (user) {
      void load(activeMachineRef.current, true);
    } else {
      activeMachineRef.current = "";
      setMachines([]);
      setSeries([]);
      setRules([]);
      setAlerts([]);
      setSelectedMachine("");
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.userId, user?.role, plantScopeKey]);

  const filteredAlerts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return alerts.filter((a) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.message.toLowerCase().includes(q) ||
        (a.machineId ?? "").toLowerCase().includes(q)
      );
    });
  }, [alerts, statusFilter, search]);

  const filteredRules = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.machineId ?? "").toLowerCase().includes(q) ||
        r.metricTag.toLowerCase().includes(q)
    );
  }, [rules, search]);

  if (!user) {
    return (
      <AuthGate
        title="Sign in to view Monitoring & Alerts"
        description="Live equipment telemetry, threshold alarm rules, and incident acknowledgement require authentication."
      />
    );
  }

  const handleTick = async () => {
    setTicking(true);
    setNotice(null);
    try {
      const res = await fetch("/api/monitoring/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId: selectedMachine || machines[0]?.id })
      });
      if (res.ok) {
        const data = (await res.json()) as {
          summary: {
            telemetryUpdated: number;
            rulesEvaluated: number;
            alertsTriggered: number;
          };
        };
        setNotice(
          `Runtime tick: ${data.summary.telemetryUpdated} machines updated, ${data.summary.rulesEvaluated} rules evaluated, ${data.summary.alertsTriggered} alert(s) triggered.`
        );
        await load(selectedMachine);
      } else {
        setNotice(await readErrorDetail(res, "Telemetry tick failed"));
      }
    } catch {
      setNotice("Telemetry tick failed");
    } finally {
      setTicking(false);
    }
  };

  const chartBuckets = new Map<
    string,
    { time: string; temperature?: number; vibration?: number }
  >();
  for (const b of series) {
    if (b.tag !== "temperature" && b.tag !== "vibration") continue;
    const key = b.bucketStart;
    const entry = chartBuckets.get(key) ?? { time: b.bucketStart.slice(11, 16) };
    if (b.tag === "temperature") entry.temperature = b.avg;
    else entry.vibration = b.avg;
    chartBuckets.set(key, entry);
  }
  const chartData = Array.from(chartBuckets.values()).slice(-20);

  const alarmCount = rules.filter((r) => r.state === "ALARM").length;
  const openEvents = alerts.filter((a) => a.status === "ALARM").length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Kojo Telemetry &amp; Alert Rules
          </div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <span>Monitoring &amp; Alerts</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time telemetry metrics, threshold alarm rules, automated triggers, and incident lifecycle management.
          </p>
        </div>

        <Button onClick={handleTick} disabled={ticking}>
          <Play className="h-3.5 w-3.5" />
          <span>
            {ticking
              ? (demoEnabled ? "Simulating..." : "Evaluating...")
              : (demoEnabled ? "Simulate Telemetry Tick" : "Evaluate Alert Rules")}
          </span>
        </Button>
      </div>

      {notice && (
        <div className="rounded-md border border-border bg-muted/60 px-3.5 py-2 text-xs font-medium flex items-center justify-between gap-2 min-w-0">
          <span className="min-w-0 break-words">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss monitoring notice"
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(activeMachineRef.current, true)}
            className="shrink-0"
          >
            Retry
          </Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="p-4 border-l-2 border-l-red-600">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Rules in Alarm
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-red-600 mt-1">
            {loading ? "—" : alarmCount}
          </div>
        </Card>
        <Card className="p-4 border-l-2 border-l-emerald-600">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Rules OK
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-600 mt-1">
            {loading ? "—" : rules.filter((r) => r.state === "OK").length}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Open Alert Events
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-1">
            {loading ? "—" : openEvents}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Monitored Machines
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-1">
            {loading ? "—" : machines.length}
          </div>
        </Card>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Machine Telemetry Series</h2>
            {(() => {
              const current = machines.find((m) => m.id === selectedMachine);
              if (!current) return null;
              if (!current.updatedAt) {
                return (
                  <p className="text-[11px] text-muted-foreground">
                    No telemetry received yet for {current.name}.
                  </p>
                );
              }
              const ageMs = Date.now() - new Date(current.updatedAt).getTime();
              return (
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  Last observation: {new Date(current.updatedAt).toISOString().slice(0, 19).replace("T", " ")} UTC
                  {ageMs > 15 * 60 * 1000 ? " (stale telemetry > 15m)" : ""}
                </p>
              );
            })()}
          </div>
          {machines.length > 0 && (
            <Select
              value={selectedMachine}
              onChange={(e) => {
                const nextId = e.target.value;
                activeMachineRef.current = nextId;
                setSelectedMachine(nextId);
                void fetchMachineSeries(nextId);
              }}
              aria-label="Select machine for monitoring chart"
              className="w-full sm:w-auto sm:max-w-md min-w-0"
            >
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.id}) — Temp {m.temperature != null ? `${m.temperature}°C` : "—"} / Vib {m.vibration != null ? `${m.vibration} mm/s` : "—"}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div className="h-56 w-full">
          {chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground border border-dashed border-border rounded-md px-4 text-center">
              {loading
                ? "Loading telemetry..."
                : machines.length === 0
                  ? (loadError ?? "No machines configured yet. Add assets in Admin Console -> Assets & QR and stream telemetry to POST /api/telemetry.")
                  : "No time-series readings available for this machine yet."}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.22} />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="temp" tick={{ fontSize: 11 }} unit="°C" />
                <YAxis
                  yAxisId="vib"
                  orientation="right"
                  tick={{ fontSize: 11 }}
                  unit=" mm/s"
                />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  yAxisId="temp"
                  type="monotone"
                  dataKey="temperature"
                  name="Temperature (°C)"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  connectNulls
                />
                <Line
                  yAxisId="vib"
                  type="monotone"
                  dataKey="vibration"
                  name="Vibration (mm/s)"
                  stroke="#0369a1"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <SpotlightNavbar
          activeId={statusFilter}
          onSelect={setStatusFilter}
          items={[
            { id: "all", label: "All Incidents", badge: alerts.length },
            { id: "ALARM", label: "Alarm", badge: alerts.filter((a) => a.status === "ALARM").length },
            {
              id: "ACKNOWLEDGED",
              label: "Acknowledged",
              badge: alerts.filter((a) => a.status === "ACKNOWLEDGED").length
            },
            {
              id: "RESOLVED",
              label: "Resolved",
              badge: alerts.filter((a) => a.status === "RESOLVED").length
            }
          ]}
        />

        <div className="relative w-full sm:w-auto">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter alerts & rules..."
            aria-label="Filter alerts and rules"
            className="pl-8 w-full sm:w-56"
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-2.5 text-sm font-semibold flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-primary" />
          <span>Alert Incidents ({filteredAlerts.length})</span>
        </div>
        {filteredAlerts.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            {loading
              ? "Loading incidents..."
              : alerts.length === 0
                ? (loadError ?? "No alert incidents recorded for this tenant yet.")
                : "No alert incidents match your current filter."}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Incident</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Triggered</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAlerts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-semibold">{a.title}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {a.machineId ?? "platform"} · {a.message}
                    </div>
                  </TableCell>
                  <TableCell className="uppercase font-semibold">{a.severity}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        a.status === "ALARM"
                          ? "destructive"
                          : a.status === "ACKNOWLEDGED"
                            ? "warning"
                            : "success"
                      }
                      className="uppercase text-[10px]"
                    >
                      {a.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {new Date(a.triggeredAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="space-x-1.5">
                    {canAck && a.status === "ALARM" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            const res = await fetch(`/api/monitoring/alerts/${a.id}/acknowledge`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({})
                            });
                            if (res.ok) {
                              setNotice(`Acknowledged ${a.title}`);
                              await load(selectedMachine);
                            } else {
                              setNotice(await readErrorDetail(res, "Acknowledge failed"));
                            }
                          } catch {
                            setNotice("Acknowledge failed");
                          }
                        }}
                      >
                        <Check className="h-3 w-3" />
                        <span>Acknowledge</span>
                      </Button>
                    )}
                    {(canAck || canWriteRules) && a.status !== "RESOLVED" && (
                      <Button
                        size="sm"
                        onClick={async () => {
                          try {
                            const res = await fetch(`/api/monitoring/alerts/${a.id}/resolve`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({})
                            });
                            if (res.ok) {
                              setNotice(`Resolved ${a.title}`);
                              await load(selectedMachine);
                            } else {
                              setNotice(await readErrorDetail(res, "Resolve failed"));
                            }
                          } catch {
                            setNotice("Resolve failed");
                          }
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        <span>Resolve</span>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {canWriteRules && (
          <Card className="p-4 h-fit min-w-0">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!ruleForm.name.trim()) return;
                try {
                  const res = await fetch("/api/monitoring/rules", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      name: ruleForm.name.trim(),
                      machineId: ruleForm.machineId || machines[0]?.id,
                      metric: ruleForm.metric,
                      operator: ruleForm.operator,
                      threshold: Number(ruleForm.threshold),
                      severity: ruleForm.severity,
                      enabled: true
                    })
                  });
                  if (res.ok) {
                    setRuleForm({ ...ruleForm, name: "" });
                    setNotice("Alert rule created");
                    await load(selectedMachine);
                  } else {
                    setNotice(await readErrorDetail(res, "Failed to create alert rule"));
                  }
                } catch {
                  setNotice("Failed to create alert rule");
                }
              }}
              className="space-y-3"
            >
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Plus className="h-4 w-4 text-primary" />
                <span>Create Alert Rule</span>
              </div>
              <Input
                required
                placeholder="Rule Name"
                aria-label="Alert rule name"
                value={ruleForm.name}
                onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
              />
              <Select
                aria-label="Rule machine"
                value={ruleForm.machineId}
                onChange={(e) => setRuleForm({ ...ruleForm, machineId: e.target.value })}
                disabled={machines.length === 0}
                className="w-full min-w-0"
              >
                {machines.length === 0 ? (
                  <option value="">No machines registered</option>
                ) : (
                  machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))
                )}
              </Select>
              <div className="grid grid-cols-3 gap-2">
                <Select
                  aria-label="Rule metric"
                  value={ruleForm.metric}
                  onChange={(e) => setRuleForm({ ...ruleForm, metric: e.target.value })}
                  className="w-full min-w-0"
                >
                  <option value="temperature">temperature</option>
                  <option value="vibration">vibration</option>
                  <option value="pressure">pressure</option>
                  <option value="currentSpeed">currentSpeed</option>
                </Select>
                <Select
                  aria-label="Rule operator"
                  value={ruleForm.operator}
                  onChange={(e) => setRuleForm({ ...ruleForm, operator: e.target.value })}
                  className="w-full min-w-0"
                >
                  <option value="gt">&gt;</option>
                  <option value="gte">&gt;=</option>
                  <option value="lt">&lt;</option>
                  <option value="lte">&lt;=</option>
                </Select>
                <Input
                  type="number"
                  step="0.1"
                  aria-label="Rule threshold"
                  value={ruleForm.threshold}
                  onChange={(e) => setRuleForm({ ...ruleForm, threshold: e.target.value })}
                  className="font-mono min-w-0"
                />
              </div>
              <Select
                aria-label="Rule severity"
                value={ruleForm.severity}
                onChange={(e) => setRuleForm({ ...ruleForm, severity: e.target.value })}
                className="w-full min-w-0"
              >
                <option value="critical">critical</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </Select>
              <Button type="submit" className="w-full" disabled={machines.length === 0}>
                Create Rule
              </Button>
            </form>
          </Card>
        )}

        <Card className={`${canWriteRules ? "lg:col-span-2" : "lg:col-span-3"} min-w-0 overflow-hidden`}>
          <div className="border-b border-border px-4 py-2.5 text-sm font-semibold">
            Alert Rules ({filteredRules.length})
          </div>
          {filteredRules.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              {loading
                ? "Loading rules..."
                : rules.length === 0
                  ? (loadError ?? "No alert rules configured for this tenant yet.")
                  : "No alert rules match your filter."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>State</TableHead>
                  {canWriteRules && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-semibold">{r.name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {r.machineId ?? "all"} · {r.severity}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {r.metricTag} {r.operator} {r.threshold}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={ruleStateBadgeVariant(r.state)}
                        className="uppercase text-[10px]"
                      >
                        {r.state}
                      </Badge>
                    </TableCell>
                    {canWriteRules && (
                      <TableCell className="space-x-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/monitoring/rules/${r.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ enabled: !r.enabled })
                              });
                              if (res.ok) await load(selectedMachine);
                              else setNotice(await readErrorDetail(res, "Failed to update rule"));
                            } catch {
                              setNotice("Failed to update rule");
                            }
                          }}
                        >
                          {r.enabled ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/monitoring/rules/${r.id}`, {
                                method: "DELETE"
                              });
                              if (res.ok) await load(selectedMachine);
                              else setNotice(await readErrorDetail(res, "Failed to delete rule"));
                            } catch {
                              setNotice("Failed to delete rule");
                            }
                          }}
                          className="h-8 w-8 text-destructive"
                          aria-label={`Delete rule ${r.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
