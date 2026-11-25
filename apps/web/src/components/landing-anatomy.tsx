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
  code: string;
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
    code: "01",
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
    code: "02",
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
    code: "03",
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
    code: "04",
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
    statusTag: string;
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
    statusTag: "NOMINAL // IN BAND",
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
    statusTag: "STALLED // MANUAL HUNT",
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
    statusTag: "VERIFIED // HUMAN SIGNED",
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
    <g>
      <polygon
        points={pts.left}
        fill={leftFill}
        stroke={stroke}
        strokeWidth={1}
        strokeLinejoin="round"
        className="transition-[fill,stroke] duration-300"
      />
      <polygon
        points={pts.right}
        fill={rightFill}
        stroke={stroke}
        strokeWidth={1}
        strokeLinejoin="round"
        className="transition-[fill,stroke] duration-300"
      />
      <polygon
        points={pts.top}
        fill={topFill}
        stroke={stroke}
        strokeWidth={1}
        strokeLinejoin="round"
        className="transition-[fill,stroke] duration-300"
      />
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
    <div className="rounded-xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05)] overflow-hidden">
      {/* Top Instrument Control Bar (Static Rail) */}
      <div className="flex flex-col gap-3 border-b border-border bg-muted/30 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              SYS-ANATOMY // ISA-95 L1-L4
            </span>
            <span className="text-border" aria-hidden="true">
              /
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Interactive Plant Anatomy
            </span>
            <Badge
              variant={isFaulted ? "warning" : isResolved ? "success" : "secondary"}
              className="font-mono text-[10px]"
            >
              {model.statusTag}
            </Badge>
          </div>
          <p className="text-sm font-medium text-foreground">{model.headline}</p>
        </div>

        <div
          role="group"
          aria-label="Operating scenario selector"
          className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-background p-1 shrink-0"
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
                  "rounded-md px-2.5 py-1.5 text-xs font-medium transition-[color,background-color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                )}
              >
                {SCENARIO_CONFIG[key].label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1.35fr_0.95fr]">
        {/* Left Schematic Viewport */}
        <div className="relative flex flex-col justify-between border-b border-border bg-background/60 lg:border-b-0 lg:border-r">
          <div className="relative lutic-grid-bg p-3 sm:p-5">
            {/* Corner Technical Readout Labels (Static) */}
            <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
              <span>TOPOLOGY // 4-STATION LOOP</span>
              <span>{model.flowActive ? "SIGNAL: ACTIVE" : "SIGNAL: INTERRUPTED"}</span>
            </div>

            <svg
              viewBox="0 0 760 426"
              role="img"
              aria-label="Interactive isometric Lutic operations workflow across shop floor, manuals, maintenance dispatch, and leadership metrics"
              className="w-full h-auto select-none"
            >
              {/* Orthographic Corner Reticle Ticks */}
              <g stroke="hsl(var(--border))" strokeWidth={1.25} fill="none">
                <path d="M 16 28 L 16 14 L 30 14" />
                <path d="M 730 14 L 744 14 L 744 28" />
                <path d="M 16 398 L 16 412 L 30 412" />
                <path d="M 730 412 L 744 412 L 744 398" />
              </g>

              {/* Architectural Datum Diamond */}
              <polygon
                points="380,44 710,209 380,374 50,209"
                fill="hsl(var(--card) / 0.85)"
                stroke="hsl(var(--border))"
                strokeWidth={1}
              />
              <polygon
                points="380,74 662,215 380,356 98,215"
                fill="none"
                stroke="hsl(var(--border))"
                strokeDasharray="4 6"
                strokeWidth={1}
              />

              {/* Dual-Layer Signal Conduits: Static Track + Animated Flow */}
              <g fill="none" strokeLinecap="round">
                {/* Base structural conduits (Stasis Rule) */}
                <g stroke="hsl(var(--border))" strokeWidth={3}>
                  <path d="M 226 278 L 330 226" />
                  <path d="M 246 154 L 338 200" />
                  <path d="M 422 200 L 516 154" />
                  <path d="M 428 228 L 520 274" />
                </g>

                {/* Active Telemetry Flow Overlay */}
                <g strokeWidth={2.25}>
                  <path
                    d="M 226 278 L 330 226"
                    stroke={model.flowActive ? accentStroke : "hsl(var(--muted-foreground) / 0.35)"}
                    strokeDasharray="6 6"
                    className={model.flowActive ? "animate-lutic-flow" : ""}
                  />
                  <path
                    d="M 246 154 L 338 200"
                    stroke={model.flowActive ? accentStroke : "hsl(var(--muted-foreground) / 0.35)"}
                    strokeDasharray="6 6"
                    className={model.flowActive ? "animate-lutic-flow" : ""}
                  />
                  <path
                    d="M 422 200 L 516 154"
                    stroke={model.flowActive ? accentStroke : "hsl(var(--muted-foreground) / 0.35)"}
                    strokeDasharray="6 6"
                    className={model.flowActive ? "animate-lutic-flow" : ""}
                  />
                  <path
                    d="M 428 228 L 520 274"
                    stroke={model.flowActive ? accentStroke : "hsl(var(--muted-foreground) / 0.35)"}
                    strokeDasharray="6 6"
                    className={model.flowActive ? "animate-lutic-flow" : ""}
                  />
                </g>
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
                    rx={86}
                    ry={41}
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
                    rx={78}
                    ry={39}
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
                <rect
                  x={152}
                  y={76}
                  width={92}
                  height={20}
                  rx={5}
                  fill="hsl(var(--card))"
                  stroke="hsl(var(--border))"
                />
                <text
                  x={198}
                  y={90}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[9.5px] font-mono font-medium"
                >
                  {isFaulted ? "MANUAL SEARCH" : "SOP INDEXED"}
                </text>
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
                    rx={78}
                    ry={39}
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
                <rect
                  x={512}
                  y={76}
                  width={102}
                  height={20}
                  rx={5}
                  fill={isResolved ? "#059669" : "hsl(var(--card))"}
                  stroke={isResolved ? "#059669" : "hsl(var(--border))"}
                />
                <text
                  x={563}
                  y={90}
                  textAnchor="middle"
                  className={cn(
                    "text-[9.5px] font-mono font-medium",
                    isResolved ? "fill-white" : "fill-muted-foreground"
                  )}
                >
                  {isResolved ? "HUMAN APPROVED" : isFaulted ? "RADIO WAIT" : "SIGN-OFF READY"}
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
                    rx={80}
                    ry={41}
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
          </div>

          {/* Anchored Hairline Metric Readout Strip */}
          <div className="grid grid-cols-2 divide-y sm:grid-cols-4 sm:divide-y-0 sm:divide-x divide-border border-t border-border bg-card">
            <div className="px-3.5 py-2.5">
              <div className="text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground">
                Resolution Time
              </div>
              <div className="mt-0.5 text-xs font-semibold font-mono text-foreground tabular-nums">
                {model.resolutionTime}
              </div>
            </div>
            <div className="px-3.5 py-2.5">
              <div className="text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground">
                First-Time Fix
              </div>
              <div className="mt-0.5 text-xs font-semibold font-mono text-foreground tabular-nums">
                {model.firstTimeFix}
              </div>
            </div>
            <div className="px-3.5 py-2.5">
              <div className="text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground">
                Shift Handoff
              </div>
              <div className="mt-0.5 text-xs font-semibold font-mono text-foreground tabular-nums">
                {model.handoffPrep}
              </div>
            </div>
            <div className="px-3.5 py-2.5">
              <div className="text-[10px] font-mono font-medium uppercase tracking-wider text-muted-foreground">
                Safety Control
              </div>
              <div className="mt-0.5 text-xs font-semibold font-mono text-foreground tabular-nums">
                {model.safetyGate}
              </div>
            </div>
          </div>
        </div>

        {/* Right Station Diagnostic Dossier */}
        <div className="flex flex-col justify-between p-4 sm:p-5 space-y-4 bg-card">
          <div className="space-y-4">
            <div>
              <div className="text-[10px] font-mono font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-2">
                Select Station Dossier
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
                        "flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs font-medium transition-[color,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "border-primary/60 bg-primary/10 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )}
                    >
                      <StIcon
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          active ? "text-primary" : "text-muted-foreground"
                        )}
                      />
                      <span className="truncate">{station.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold text-primary">
                    {activeSpec.code}
                  </span>
                  <div className="text-sm font-semibold text-foreground">{activeSpec.label}</div>
                </div>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {activeSpec.metricByScenario[scenario]}
                </Badge>
              </div>

              <div className="space-y-1">
                <div className="text-[10px] font-mono font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  01 // Legacy Floor Reality
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {activeSpec.friction}
                </p>
              </div>

              <div className="space-y-1 border-l-2 border-primary pl-3">
                <div className="text-[10px] font-mono font-semibold uppercase tracking-[0.08em] text-primary">
                  02 // Lutic Verified Pipeline
                </div>
                <p className="text-xs leading-relaxed text-foreground">
                  {activeSpec.solution}
                </p>
              </div>

              <div className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary mt-0.5" />
                <span className="text-xs font-medium text-foreground">{activeSpec.outcome}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              <span>Human sign-off enforced</span>
            </span>
            <span className="inline-flex items-center gap-1 font-mono font-medium text-foreground">
              <ClipboardCheck className="h-3.5 w-3.5 text-primary" />
              <span>Audit trail active</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
