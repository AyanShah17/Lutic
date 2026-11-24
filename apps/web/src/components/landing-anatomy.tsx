"use client";

import React, { useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Factory,
  LineChart,
  ShieldCheck,
  Wrench
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export type AnatomyScenario = "steady" | "without" | "with";
export type StationId = "floor" | "knowledge" | "dispatch" | "scorecard";

interface StationSpec {
  id: StationId;
  label: string;
  shortLabel: string;
  metricByScenario: Record<AnatomyScenario, string>;
  friction: string;
  solution: string;
  outcome: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const STATIONS: StationSpec[] = [
  {
    id: "floor",
    label: "Shop Floor Line",
    shortLabel: "01 Floor Line",
    metricByScenario: {
      steady: "Normal Output · 96% Target",
      without: "Line Stalled · Waiting on Diagnosis",
      with: "Alert Pinpointed · Back Online"
    },
    friction:
      "When a line slows or trips, crews lose precious minutes trying to separate normal warm-up swings from real mechanical risk.",
    solution:
      "Lutic translates live equipment behavior and past stops into a plain status brief the moment an anomaly appears.",
    outcome: "Operators spot root causes immediately instead of guessing at panel lights.",
    Icon: Factory
  },
  {
    id: "knowledge",
    label: "Plant Manuals & History",
    shortLabel: "02 Manuals & History",
    metricByScenario: {
      steady: "Verified SOPs Indexed",
      without: "40+ Min Binder & Spreadsheet Hunt",
      with: "Exact Step Cited in 8 Seconds"
    },
    friction:
      "Hard-won repair steps sit buried inside thick binder manuals, shift handoff notebooks, or the memory of senior technicians.",
    solution:
      "Every crew gets direct, page-referenced guidance drawn from your plant's approved procedures and past repair wins.",
    outcome: "Newer operators solve unfamiliar faults with veteran precision on the first visit.",
    Icon: BookOpen
  },
  {
    id: "dispatch",
    label: "Maintenance & Parts",
    shortLabel: "03 Maintenance & Parts",
    metricByScenario: {
      steady: "Crew & Spares Standing By",
      without: "Verbal Radio Handoff Delays",
      with: "Approved Work Order & Part Reserved"
    },
    friction:
      "Even after finding a problem, teams stall walking back to desks to log maintenance tickets, check spare stock, and chase approvals.",
    solution:
      "Lutic prepares ready-to-approve work orders and spare-parts reservations so a supervisor signs off in one click.",
    outcome: "No unapproved floor changes, zero duplicate orders, and parts waiting at the line.",
    Icon: Wrench
  },
  {
    id: "scorecard",
    label: "Leadership Visibility",
    shortLabel: "04 Executive View",
    metricByScenario: {
      steady: "All Plants Aligned",
      without: "Blind Until End-of-Shift Report",
      with: "Live Shift & Multi-Site Rollup"
    },
    friction:
      "Plant leaders often hear about downtime hours later through stitched spreadsheets that hide which bottlenecks repeat across shifts.",
    solution:
      "Lutic rolls standardized uptime, downtime, and turnaround figures into live shift and leadership views across sites.",
    outcome: "Weekly reviews start from one trusted number rather than reconciling five slide decks.",
    Icon: LineChart
  }
];

const SCENARIO_CONFIG: Record<
  AnatomyScenario,
  {
    label: string;
    headline: string;
    summary: string;
    resolutionTime: string;
    firstTimeFix: string;
    handoffPrep: string;
    safetyGate: string;
    barHeights: [number, number, number];
    flowActive: boolean;
    tone: "primary" | "warning" | "success";
  }
> = {
  steady: {
    label: "Steady Production",
    headline: "Routine runs stay tracked without manual spreadsheets",
    summary:
      "Lines run inside normal operating bands while verified manuals, maintenance queues, and plant scorecards stay aligned.",
    resolutionTime: "< 4 min check",
    firstTimeFix: "94% first visit",
    handoffPrep: "Live brief",
    safetyGate: "Supervised",
    barHeights: [42, 48, 44],
    flowActive: true,
    tone: "primary"
  },
  without: {
    label: "Stoppage Without Lutic",
    headline: "One mid-shift fault stalls the line into disconnected guesswork",
    summary:
      "Teams split time hunting binders, radioing maintenance, and building end-of-shift explanations while output drops.",
    resolutionTime: "52 min stalled",
    firstTimeFix: "61% repeat fix",
    handoffPrep: "35 min manual",
    safetyGate: "Ad-hoc notes",
    barHeights: [16, 22, 18],
    flowActive: false,
    tone: "warning"
  },
  with: {
    label: "Resolved With Lutic",
    headline: "From floor alert to human-approved fix in under five minutes",
    summary:
      "Lutic pinpoints the matching SOP, drafts the maintenance & spare-part action for sign-off, and updates plant KPIs automatically.",
    resolutionTime: "4 min 20 sec",
    firstTimeFix: "96% verified",
    handoffPrep: "Instant brief",
    safetyGate: "100% signed off",
    barHeights: [56, 64, 58],
    flowActive: true,
    tone: "success"
  }
};

function isoPrismPoints(x: number, y: number, w: number, d: number, h: number) {
  const fb: [number, number] = [x, y];
  const rb: [number, number] = [x + w, y - w * 0.5];
  const lb: [number, number] = [x - d, y - d * 0.5];

  const ft: [number, number] = [x, y - h];
  const rt: [number, number] = [x + w, y - w * 0.5 - h];
  const bt: [number, number] = [x + w - d, y - (w + d) * 0.5 - h];
  const lt: [number, number] = [x - d, y - d * 0.5 - h];

  const fmt = (pts: Array<[number, number]>) =>
    pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ");

  return {
    top: fmt([ft, rt, bt, lt]),
    left: fmt([lb, fb, ft, lt]),
    right: fmt([fb, rb, rt, ft])
  };
}

function IsoPrism({
  x,
  y,
  w,
  d,
  h,
  topFill,
  leftFill,
  rightFill,
  stroke = "hsl(var(--border))"
}: {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  topFill: string;
  leftFill: string;
  rightFill: string;
  stroke?: string;
}) {
  const pts = isoPrismPoints(x, y, w, d, h);
  return (
    <g className="transition-all duration-500">
      <polygon points={pts.left} fill={leftFill} stroke={stroke} strokeWidth={1} strokeLinejoin="round" />
      <polygon points={pts.right} fill={rightFill} stroke={stroke} strokeWidth={1} strokeLinejoin="round" />
      <polygon points={pts.top} fill={topFill} stroke={stroke} strokeWidth={1} strokeLinejoin="round" />
    </g>
  );
}

export function LuticPlantAnatomy() {
  const [scenario, setScenario] = useState<AnatomyScenario>("with");
  const [selectedStation, setSelectedStation] = useState<StationId>("floor");

  const model = SCENARIO_CONFIG[scenario];
  const activeSpec = STATIONS.find((s) => s.id === selectedStation) ?? STATIONS[0]!;
  const isFaulted = scenario === "without";
  const isResolved = scenario === "with";

  const accentStroke = isFaulted
    ? "#d97706"
    : isResolved
      ? "#059669"
      : "hsl(var(--primary))";

  const coreTop = isFaulted
    ? "#fde68a"
    : isResolved
      ? "#6ee7b7"
      : "#fdba74";
  const coreLeft = isFaulted ? "#f59e0b" : isResolved ? "#10b981" : "#ea580c";
  const coreRight = isFaulted ? "#b45309" : isResolved ? "#047857" : "#c2410c";

  const stationHighlight = (id: StationId) => selectedStation === id;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Control Header tied directly to the anatomy state */}
      <div className="flex flex-col gap-3 border-b border-border bg-muted/30 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Interactive Plant Anatomy
            </span>
            <Badge
              variant={isFaulted ? "outline" : "secondary"}
              className={cn(
                "text-[10px]",
                isFaulted && "border-amber-500/50 text-amber-700 dark:text-amber-300",
                isResolved && "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
              )}
            >
              {model.label}
            </Badge>
          </div>
          <p className="text-sm font-medium text-foreground">{model.headline}</p>
        </div>

        <div
          role="group"
          aria-label="Operating scenario selector"
          className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-background p-1"
        >
          {(["steady", "without", "with"] as AnatomyScenario[]).map((key) => {
            const active = scenario === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => setScenario(key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {SCENARIO_CONFIG[key].label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1.35fr_0.95fr]">
        {/* Interactive Isometric Machine Figure */}
        <div className="relative border-b border-border bg-gradient-to-b from-background via-muted/20 to-muted/40 p-3 sm:p-4 lg:border-b-0 lg:border-r">
          <svg
            viewBox="0 0 760 440"
            role="img"
            aria-label="Interactive isometric Lutic operations workflow across shop floor, manuals, maintenance dispatch, and leadership metrics"
            className="w-full h-auto select-none"
          >
            {/* Subtle architectural base floor diamond */}
            <polygon
              points="380,46 710,211 380,376 50,211"
              fill="hsl(var(--muted) / 0.45)"
              stroke="hsl(var(--border))"
              strokeWidth={1}
            />
            <polygon
              points="380,76 665,218 380,360 95,218"
              fill="none"
              stroke="hsl(var(--border))"
              strokeDasharray="4 6"
              strokeWidth={1}
            />

            {/* Connecting Signal Rails between Stations and Central Lutic Core */}
            <g fill="none" strokeWidth={2.5} strokeLinecap="round">
              {/* Floor -> Core */}
              <path
                d="M 226 278 L 330 226"
                stroke={model.flowActive ? accentStroke : "hsl(var(--muted-foreground) / 0.35)"}
                strokeDasharray="6 6"
                className={model.flowActive ? "animate-lutic-flow" : ""}
              />
              {/* Manuals -> Core */}
              <path
                d="M 246 154 L 338 200"
                stroke={model.flowActive ? accentStroke : "hsl(var(--muted-foreground) / 0.35)"}
                strokeDasharray="6 6"
                className={model.flowActive ? "animate-lutic-flow" : ""}
              />
              {/* Core -> Maintenance Dispatch */}
              <path
                d="M 422 200 L 516 154"
                stroke={model.flowActive ? accentStroke : "hsl(var(--muted-foreground) / 0.35)"}
                strokeDasharray="6 6"
                className={model.flowActive ? "animate-lutic-flow" : ""}
              />
              {/* Core -> Leadership Scorecard */}
              <path
                d="M 428 228 L 520 274"
                stroke={model.flowActive ? accentStroke : "hsl(var(--muted-foreground) / 0.35)"}
                strokeDasharray="6 6"
                className={model.flowActive ? "animate-lutic-flow" : ""}
              />
            </g>

            {/* Central Station: Lutic Operations Core */}
            <g transform="translate(0, 0)">
              <IsoPrism
                x={380}
                y={252}
                w={62}
                d={62}
                h={16}
                topFill="hsl(var(--card))"
                leftFill="hsl(var(--muted))"
                rightFill="hsl(var(--secondary))"
              />
              <IsoPrism
                x={380}
                y={230}
                w={38}
                d={38}
                h={22}
                topFill={coreTop}
                leftFill={coreLeft}
                rightFill={coreRight}
                stroke={accentStroke}
              />
              <circle
                cx={380}
                cy={189}
                r={isFaulted ? 12 : 10}
                fill="none"
                stroke={accentStroke}
                strokeWidth={2}
                className="animate-lutic-pulse"
              />
              <text
                x={380}
                y={274}
                textAnchor="middle"
                className="fill-foreground text-[11px] font-semibold"
              >
                Lutic Operations Hub
              </text>
            </g>

            {/* Station 1: Shop Floor Line (Bottom-Left) */}
            <g
              role="button"
              tabIndex={0}
              aria-label="Inspect Shop Floor Line station"
              aria-pressed={stationHighlight("floor")}
              onClick={() => setSelectedStation("floor")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedStation("floor");
                }
              }}
              className="cursor-pointer focus:outline-none"
            >
              {stationHighlight("floor") && (
                <ellipse
                  cx={176}
                  cy={304}
                  rx={84}
                  ry={40}
                  fill="hsl(var(--primary) / 0.08)"
                  stroke="hsl(var(--primary))"
                  strokeWidth={1.5}
                />
              )}
              <IsoPrism
                x={168}
                y={334}
                w={94}
                d={40}
                h={14}
                topFill="hsl(var(--card))"
                leftFill="hsl(var(--muted))"
                rightFill="hsl(var(--secondary))"
              />
              {/* Conveyor track */}
              <line
                x1={142}
                y1={307}
                x2={232}
                y2={262}
                stroke="hsl(var(--muted-foreground) / 0.7)"
                strokeWidth={5}
                strokeDasharray="6 6"
                className={model.flowActive ? "animate-lutic-conveyor" : ""}
              />
              {/* Production crates moving or halted on line */}
              <IsoPrism
                x={isFaulted ? 156 : 168}
                y={isFaulted ? 304 : 298}
                w={16}
                d={16}
                h={14}
                topFill={isFaulted ? "#fca5a5" : "#fdba74"}
                leftFill={isFaulted ? "#ef4444" : "#f97316"}
                rightFill={isFaulted ? "#b91c1c" : "#c2410c"}
              />
              <IsoPrism
                x={isFaulted ? 188 : 204}
                y={isFaulted ? 288 : 280}
                w={16}
                d={16}
                h={14}
                topFill={isFaulted ? "#fde68a" : "#6ee7b7"}
                leftFill={isFaulted ? "#f59e0b" : "#10b981"}
                rightFill={isFaulted ? "#b45309" : "#047857"}
              />
              <text
                x={176}
                y={360}
                textAnchor="middle"
                className="fill-foreground text-[11px] font-semibold"
              >
                01 · Shop Floor Line
              </text>
            </g>

            {/* Station 2: Plant Manuals & History (Top-Left) */}
            <g
              role="button"
              tabIndex={0}
              aria-label="Inspect Plant Manuals and History station"
              aria-pressed={stationHighlight("knowledge")}
              onClick={() => setSelectedStation("knowledge")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedStation("knowledge");
                }
              }}
              className="cursor-pointer focus:outline-none"
            >
              {stationHighlight("knowledge") && (
                <ellipse
                  cx={198}
                  cy={142}
                  rx={76}
                  ry={38}
                  fill="hsl(var(--primary) / 0.08)"
                  stroke="hsl(var(--primary))"
                  strokeWidth={1.5}
                />
              )}
              <IsoPrism
                x={198}
                y={170}
                w={46}
                d={46}
                h={12}
                topFill="hsl(var(--card))"
                leftFill="hsl(var(--muted))"
                rightFill="hsl(var(--secondary))"
              />
              <IsoPrism
                x={186}
                y={154}
                w={18}
                d={28}
                h={32}
                topFill={isFaulted ? "hsl(var(--muted))" : "#fed7aa"}
                leftFill={isFaulted ? "hsl(var(--muted))" : "#fb923c"}
                rightFill={isFaulted ? "hsl(var(--secondary))" : "#ea580c"}
              />
              <IsoPrism
                x={212}
                y={144}
                w={18}
                d={28}
                h={40}
                topFill={isFaulted ? "hsl(var(--muted))" : "#fde68a"}
                leftFill={isFaulted ? "hsl(var(--muted))" : "#f59e0b"}
                rightFill={isFaulted ? "hsl(var(--secondary))" : "#d97706"}
              />
              <text
                x={198}
                y={194}
                textAnchor="middle"
                className="fill-foreground text-[11px] font-semibold"
              >
                02 · Plant Manuals &amp; History
              </text>
            </g>

            {/* Station 3: Maintenance & Parts (Top-Right) */}
            <g
              role="button"
              tabIndex={0}
              aria-label="Inspect Maintenance and Parts station"
              aria-pressed={stationHighlight("dispatch")}
              onClick={() => setSelectedStation("dispatch")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedStation("dispatch");
                }
              }}
              className="cursor-pointer focus:outline-none"
            >
              {stationHighlight("dispatch") && (
                <ellipse
                  cx={562}
                  cy={142}
                  rx={76}
                  ry={38}
                  fill="hsl(var(--primary) / 0.08)"
                  stroke="hsl(var(--primary))"
                  strokeWidth={1.5}
                />
              )}
              <IsoPrism
                x={562}
                y={170}
                w={52}
                d={46}
                h={12}
                topFill="hsl(var(--card))"
                leftFill="hsl(var(--muted))"
                rightFill="hsl(var(--secondary))"
              />
              <IsoPrism
                x={556}
                y={152}
                w={26}
                d={24}
                h={26}
                topFill={isResolved ? "#a7f3d0" : isFaulted ? "hsl(var(--muted))" : "#fed7aa"}
                leftFill={isResolved ? "#34d399" : isFaulted ? "hsl(var(--muted))" : "#fb923c"}
                rightFill={isResolved ? "#059669" : isFaulted ? "hsl(var(--secondary))" : "#ea580c"}
              />
              {/* Human sign-off gate pill inside SVG */}
              <rect
                x={515}
                y={84}
                width={96}
                height={20}
                rx={10}
                fill={isResolved ? "#059669" : "hsl(var(--card))"}
                stroke={isResolved ? "#059669" : "hsl(var(--border))"}
              />
              <text
                x={563}
                y={98}
                textAnchor="middle"
                className={cn(
                  "text-[10px] font-medium",
                  isResolved ? "fill-white" : "fill-muted-foreground"
                )}
              >
                {isResolved ? "Human Approved" : isFaulted ? "Manual Radio Wait" : "Sign-Off Ready"}
              </text>
              <text
                x={562}
                y={194}
                textAnchor="middle"
                className="fill-foreground text-[11px] font-semibold"
              >
                03 · Maintenance &amp; Parts
              </text>
            </g>

            {/* Station 4: Leadership Visibility (Bottom-Right) */}
            <g
              role="button"
              tabIndex={0}
              aria-label="Inspect Leadership Visibility station"
              aria-pressed={stationHighlight("scorecard")}
              onClick={() => setSelectedStation("scorecard")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedStation("scorecard");
                }
              }}
              className="cursor-pointer focus:outline-none"
            >
              {stationHighlight("scorecard") && (
                <ellipse
                  cx={568}
                  cy={298}
                  rx={78}
                  ry={40}
                  fill="hsl(var(--primary) / 0.08)"
                  stroke="hsl(var(--primary))"
                  strokeWidth={1.5}
                />
              )}
              <IsoPrism
                x={568}
                y={332}
                w={64}
                d={46}
                h={12}
                topFill="hsl(var(--card))"
                leftFill="hsl(var(--muted))"
                rightFill="hsl(var(--secondary))"
              />
              {/* 3 model-driven extruded KPI bars */}
              <IsoPrism
                x={548}
                y={316}
                w={12}
                d={12}
                h={model.barHeights[0]}
                topFill={isFaulted ? "#fca5a5" : "#fdba74"}
                leftFill={isFaulted ? "#ef4444" : "#f97316"}
                rightFill={isFaulted ? "#b91c1c" : "#c2410c"}
              />
              <IsoPrism
                x={570}
                y={306}
                w={12}
                d={12}
                h={model.barHeights[1]}
                topFill={isFaulted ? "#fde68a" : "#6ee7b7"}
                leftFill={isFaulted ? "#f59e0b" : "#10b981"}
                rightFill={isFaulted ? "#b45309" : "#047857"}
              />
              <IsoPrism
                x={592}
                y={296}
                w={12}
                d={12}
                h={model.barHeights[2]}
                topFill={isFaulted ? "hsl(var(--muted))" : "#93c5fd"}
                leftFill={isFaulted ? "hsl(var(--muted))" : "#3b82f6"}
                rightFill={isFaulted ? "hsl(var(--secondary))" : "#1d4ed8"}
              />
              <text
                x={568}
                y={358}
                textAnchor="middle"
                className="fill-foreground text-[11px] font-semibold"
              >
                04 · Leadership Visibility
              </text>
            </g>
          </svg>

          {/* Live Model-Driven Metric Strip */}
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-card px-2.5 py-2">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Resolution Time
              </div>
              <div className="mt-0.5 text-xs font-semibold text-foreground tabular-nums">
                {model.resolutionTime}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card px-2.5 py-2">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                First-Time Fix
              </div>
              <div className="mt-0.5 text-xs font-semibold text-foreground tabular-nums">
                {model.firstTimeFix}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card px-2.5 py-2">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Shift Handoff
              </div>
              <div className="mt-0.5 text-xs font-semibold text-foreground tabular-nums">
                {model.handoffPrep}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card px-2.5 py-2">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Safety Control
              </div>
              <div className="mt-0.5 text-xs font-semibold text-foreground tabular-nums">
                {model.safetyGate}
              </div>
            </div>
          </div>
        </div>

        {/* Station Inspector Panel */}
        <div className="flex flex-col justify-between p-4 sm:p-5 space-y-4">
          <div className="space-y-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Click a Station to Inspect
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {STATIONS.map((station) => {
                  const active = station.id === selectedStation;
                  const StIcon = station.Icon;
                  return (
                    <button
                      key={station.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedStation(station.id)}
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs font-medium transition-colors",
                        active
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <StIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="truncate">{station.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-foreground">{activeSpec.label}</div>
                <Badge variant="outline" className="text-[10px]">
                  {activeSpec.metricByScenario[scenario]}
                </Badge>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  What Goes Wrong Today
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {activeSpec.friction}
                </p>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                  How Lutic Solves It
                </div>
                <p className="text-xs leading-relaxed text-foreground">
                  {activeSpec.solution}
                </p>
              </div>

              <div className="flex items-start gap-2 rounded-md border border-border bg-background px-2.5 py-2">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary mt-0.5" />
                <span className="text-xs font-medium text-foreground">{activeSpec.outcome}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Every floor change waits for human sign-off
            </span>
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <ClipboardCheck className="h-3.5 w-3.5 text-primary" />
              Full audit record
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
