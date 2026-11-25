"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  ArrowRight,
  BookOpen,
  Bot,
  CheckCircle2,
  Cpu,
  Factory,
  Kanban,
  LineChart,
  Moon,
  ShieldCheck,
  Sun,
  Workflow,
  Wrench,
  XCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { LuticPlantAnatomy } from "@/components/landing-anatomy";

interface ProblemItem {
  id: string;
  code: string;
  focus: "downtime" | "knowledge" | "systems" | "governance";
  title: string;
  before: string;
  after: string;
  impact: string;
}

const PROBLEMS: ProblemItem[] = [
  {
    id: "downtime",
    code: "01",
    focus: "downtime",
    title: "Long Unplanned Stoppages",
    before:
      "Crews spend 45+ minutes cycling panels and calling around when an unexpected alarm halts production.",
    after:
      "Lutic pairs machine conditions with matching fault history in seconds so teams pinpoint the real cause fast.",
    impact: "Faster line recovery"
  },
  {
    id: "knowledge",
    code: "02",
    focus: "knowledge",
    title: "Tribal Knowledge Walkouts",
    before:
      "Critical troubleshooting steps live in aging binders, scattered PDFs, and the heads of veteran specialists.",
    after:
      "Approved plant manuals and past repair resolutions become instant, cited guidance for every shift crew.",
    impact: "Consistent first-time fixes"
  },
  {
    id: "systems",
    code: "03",
    focus: "systems",
    title: "Disconnected Tools & Reports",
    before:
      "Supervisors jump between maintenance logs, spare inventory, alerts, and spreadsheets to piece together one answer.",
    after:
      "Floor alerts, maintenance work orders, spare parts, and site scorecards flow through one calm operating hub.",
    impact: "Zero swivel-chair triage"
  },
  {
    id: "governance",
    code: "04",
    focus: "governance",
    title: "Risk of Unverified Changes",
    before:
      "Verbal handoffs and manual copy-paste leave gaps in what changed on a line, who approved it, and why.",
    after:
      "Every work order or spare-part reservation waits for explicit human sign-off with a complete plant history record.",
    impact: "Safer floor changes"
  }
];

interface OfferingItem {
  code: string;
  title: string;
  tag: string;
  description: string;
  points: string[];
  Icon: React.ComponentType<{ className?: string }>;
}

const OFFERINGS: OfferingItem[] = [
  {
    code: "01",
    title: "Instant Floor Guidance",
    tag: "Operations Assistant",
    description:
      "Give shift crews clear, reliable troubleshooting steps grounded directly in your own plant procedures and repair history.",
    points: ["Cited binder and manual sections", "Past fault resolutions matched in seconds"],
    Icon: BookOpen
  },
  {
    code: "02",
    title: "Live Plant Visibility",
    tag: "Line & Alert Monitoring",
    description:
      "See machine health, active alarms, and line bottlenecks across facilities without waiting for end-of-shift email recaps.",
    points: ["Real-time machine condition tracking", "Early warnings before minor drifts stop a line"],
    Icon: Factory
  },
  {
    code: "03",
    title: "Approved Maintenance Dispatch",
    tag: "Work Orders & Parts",
    description:
      "Move cleanly from diagnosing an issue to opening a work order and holding the right spare parts—always with human review.",
    points: ["One-click supervisor approval", "Priority dispatch and shift alerts kept aligned"],
    Icon: Wrench
  },
  {
    code: "04",
    title: "Executive & Multi-Site Scorecards",
    tag: "Plant Performance",
    description:
      "Standardized uptime, downtime, scrap, energy, and repair-turnaround scorecards ready for plant managers and leadership.",
    points: ["Comparable metrics across every plant", "Shareable live views with zero slide prep"],
    Icon: LineChart
  }
];

interface TeamProfile {
  id: string;
  code: string;
  role: string;
  headline: string;
  summary: string;
  wins: string[];
}

const TEAM_PROFILES: TeamProfile[] = [
  {
    id: "managers",
    code: "ROLE-01",
    role: "Plant & Shift Managers",
    headline: "Start every shift with calm clarity instead of firefighting.",
    summary:
      "Spot developing slowdowns early, verify that high-risk repairs receive supervisor sign-off, and hand off shifts using live plant status rather than handwritten notes.",
    wins: [
      "Shorter unplanned downtime windows",
      "Automatic shift-change handoff briefs",
      "Clear visibility across every line"
    ]
  },
  {
    id: "maintenance",
    code: "ROLE-02",
    role: "Maintenance & Floor Crews",
    headline: "Bring veteran plant knowledge to every technician on day one.",
    summary:
      "Scan a machine badge or type a symptom to pull up the exact manual procedure, check compatible spare parts, and prepare a clean work order without walking back to a desk.",
    wins: [
      "No hunting through binders on night shifts",
      "Right spare parts held on the first trip",
      "Higher first-visit repair success"
    ]
  },
  {
    id: "analysts",
    code: "ROLE-03",
    role: "Operations Analysts",
    headline: "Spend less time reconciling spreadsheets and more time improving lines.",
    summary:
      "Build live plant scorecards from governed operational definitions—comparing downtime, throughput, energy, and repair speed across sites from a single source of truth.",
    wins: [
      "Consistent KPIs across multiple facilities",
      "Instant comparisons across shifts and weeks",
      "Executive boards ready in minutes"
    ]
  },
  {
    id: "leads",
    code: "ROLE-04",
    role: "Compliance & Ops Leads",
    headline: "Keep every facility strictly scoped and every floor action accounted for.",
    summary:
      "Ensure each operator only views and acts on their assigned plants, protect connected plant tools, and keep a complete review trail for quality and safety audits.",
    wins: [
      "Site-by-site team access boundaries",
      "Mandatory human sign-off on changes",
      "Clean activity records for every action"
    ]
  }
];

const EXECUTION_TRACE = [
  {
    step: "01",
    stage: "TELEMETRY INGEST",
    detail: "Line 3 Rotary Filler · Code E42 · 7.4 mm/s peak",
    meta: "00:00.2s",
    active: false
  },
  {
    step: "02",
    stage: "HYBRID RAG CITATION",
    detail: "Manual Rev 4.2 Sec 6.3 + LOTO SOP-001 retrieved",
    meta: "00:01.8s",
    active: false
  },
  {
    step: "03",
    stage: "SAFETY VERIFIER GATE",
    detail: "Torque 42 Nm & lockout checks verified against SOP",
    meta: "00:03.1s",
    active: false
  },
  {
    step: "04",
    stage: "HUMAN-APPROVED DISPATCH",
    detail: "SAP PM work order + bearing seal reserved by shift lead",
    meta: "04m 20s",
    active: true
  }
];

const ECOSYSTEM_ITEMS = [
  "2,100+ Ready Connectors",
  "SAP S/4HANA PM · MM · PP · QM",
  "AWS IoT SiteWise · S3 · CloudWatch",
  "ServiceNow ITSM & Incidents",
  "MQTT Sparkplug B",
  "OPC-UA Servers",
  "Modbus TCP / RTU",
  "Linear & Jira-Style Boards"
];

export function LuticLandingPage({ demoMode }: { demoMode: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [activeProblem, setActiveProblem] = useState<string>("all");
  const [activeTeamId, setActiveTeamId] = useState<string>("managers");

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentTheme = mounted ? resolvedTheme ?? "light" : "light";
  const visibleProblems =
    activeProblem === "all"
      ? PROBLEMS
      : PROBLEMS.filter((p) => p.focus === activeProblem);
  const activeTeam =
    TEAM_PROFILES.find((t) => t.id === activeTeamId) ?? TEAM_PROFILES[0]!;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top Instrument Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-15 max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
              <Factory className="h-4 w-4" />
            </span>
            <span className="text-base font-bold tracking-tight">Lutic</span>
            <span className="hidden sm:inline-block rounded-sm border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
              lutic.app
            </span>
          </Link>

          <nav
            aria-label="Landing sections"
            className="hidden md:flex items-center gap-6 text-xs font-medium text-muted-foreground"
          >
            <a href="#how-it-works" className="hover:text-foreground transition-colors">
              Architecture
            </a>
            <a href="#problems" className="hover:text-foreground transition-colors">
              Impact
            </a>
            <a href="#offerings" className="hover:text-foreground transition-colors">
              Capabilities
            </a>
            <a href="#platform" className="hover:text-foreground transition-colors">
              Platform Suite
            </a>
            <a href="#teams" className="hover:text-foreground transition-colors">
              For Teams
            </a>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setTheme(currentTheme === "dark" ? "light" : "dark")}
              aria-label="Toggle color theme"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              {currentTheme === "dark" ? (
                <Moon className="h-3.5 w-3.5" />
              ) : (
                <Sun className="h-3.5 w-3.5" />
              )}
            </button>
            <Link href="/signup" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <span>Start Free</span>
            </Link>
            <Link href="/login" className={buttonVariants({ size: "sm" })}>
              <span>Sign in</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Asymmetric Split Hero */}
      <section className="mx-auto max-w-6xl px-4 pt-12 pb-12 sm:px-6 sm:pt-16 sm:pb-14">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-7 space-y-5 lutic-reveal">
            <div className="inline-flex items-center gap-2 rounded-sm border border-border bg-card px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
              <span>Industrial &amp; Enterprise AI OS · lutic.app</span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-bold tracking-[-0.025em] text-foreground leading-[1.08]">
              Turn Every Plant Issue Into a Fast, Safe, Verified Fix.
            </h1>

            <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-2xl">
              Lutic connects your plant manuals, live machine behavior, maintenance workflows, and site scorecards in one clear workspace—helping floor crews resolve stoppages in minutes while leadership sees what matters across every plant.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link href="/login" className={buttonVariants({ size: "lg" })}>
                <span>{demoMode ? "Explore Interactive Demo" : "Sign in"}</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/signup" className={buttonVariants({ variant: "outline", size: "lg" })}>
                <span>Get Started Free</span>
              </Link>
              <a
                href="#how-it-works"
                className={buttonVariants({ variant: "ghost", size: "lg" })}
              >
                <span>See How Lutic Works</span>
              </a>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border border-y border-border bg-card/60 rounded-lg overflow-hidden">
              <div className="px-4 py-3">
                <div className="font-mono text-sm font-bold text-foreground tabular-nums">
                  &lt; 5 min
                </div>
                <div className="text-xs text-muted-foreground">Verified root cause triage</div>
              </div>
              <div className="px-4 py-3">
                <div className="font-mono text-sm font-bold text-foreground tabular-nums">
                  100% Gated
                </div>
                <div className="text-xs text-muted-foreground">Human sign-off before changes</div>
              </div>
              <div className="px-4 py-3">
                <div className="font-mono text-sm font-bold text-foreground tabular-nums">
                  2,100+
                </div>
                <div className="text-xs text-muted-foreground">OT/IT &amp; ERP connectors</div>
              </div>
            </div>
          </div>

          {/* Live Execution Pipeline Readout */}
          <div className="lg:col-span-5 lutic-reveal-delay-2">
            <div className="rounded-xl border border-border bg-card shadow-[0_2px_8px_rgba(0,0,0,0.04)] overflow-hidden">
              <div className="flex items-center justify-between border-b border-border bg-muted/35 px-4 py-2.5">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  LIVE EXECUTION TRACE // PLANT-01
                </span>
                <Badge variant="success" className="font-mono text-[10px]">
                  VERIFIED
                </Badge>
              </div>
              <div className="divide-y divide-border">
                {EXECUTION_TRACE.map((row) => (
                  <div
                    key={row.step}
                    className={cn(
                      "flex items-start justify-between gap-3 px-4 py-3",
                      row.active && "bg-primary/5"
                    )}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span
                        className={cn(
                          "font-mono text-[11px] font-semibold mt-0.5 tabular-nums",
                          row.active ? "text-primary" : "text-muted-foreground"
                        )}
                      >
                        {row.step}
                      </span>
                      <div className="min-w-0 space-y-0.5">
                        <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {row.stage}
                        </div>
                        <div className="text-xs font-medium text-foreground leading-snug">
                          {row.detail}
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground tabular-nums shrink-0">
                      {row.meta}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-2.5 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  <span>Role-scoped · Plant-isolated</span>
                </span>
                <span className="font-mono text-foreground font-medium">Audit Sealed</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Anatomy Showcase */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-primary">
              01 // System Architecture
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
              How Lutic Keeps Lines Moving
            </h2>
            <p className="text-sm text-muted-foreground">
              Switch scenarios or click any station in the plant model to trace how issues move from alert to resolution.
            </p>
          </div>
        </div>
        <LuticPlantAnatomy />
      </section>

      {/* Problems We Solve — Hairline Comparison Ledger */}
      <section id="problems" className="border-y border-border bg-muted/20 py-14 sm:py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-1 max-w-xl">
              <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-primary">
                02 // Operational Drags
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Operational Drags Lutic Eliminates
              </h2>
            </div>

            <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
              {[
                { id: "all", label: "All Areas" },
                { id: "downtime", label: "Downtime" },
                { id: "knowledge", label: "Know-How" },
                { id: "systems", label: "Fragmented Tools" },
                { id: "governance", label: "Safety & Audit" }
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveProblem(tab.id)}
                  className={cn(
                    "rounded-md px-3 py-1 text-xs font-medium transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.985]",
                    activeProblem === tab.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
            <div className="hidden md:grid md:grid-cols-[1.1fr_1.45fr_1.45fr] bg-muted/35 px-5 py-2.5 text-[10.5px] font-mono font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <span>Operational Drag</span>
              <span>Before Lutic</span>
              <span>With Lutic</span>
            </div>
            {visibleProblems.map((item) => (
              <div
                key={item.id}
                className="grid gap-4 p-5 md:grid-cols-[1.1fr_1.45fr_1.45fr] md:items-start hover:bg-muted/20 transition-colors duration-150"
              >
                <div className="space-y-1.5">
                  <div className="font-mono text-[10.5px] font-semibold text-primary">
                    {item.code}
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                  <Badge variant="outline" className="text-[10px]">
                    {item.impact}
                  </Badge>
                </div>

                <div className="space-y-1">
                  <div className="inline-flex items-center gap-1.5 text-[10.5px] font-mono font-semibold uppercase tracking-wider text-muted-foreground">
                    <XCircle className="h-3.5 w-3.5 text-destructive" />
                    <span>Before Lutic</span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{item.before}</p>
                </div>

                <div className="space-y-1 border-l-2 border-primary/40 pl-3.5">
                  <div className="inline-flex items-center gap-1.5 text-[10.5px] font-mono font-semibold uppercase tracking-wider text-primary">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>With Lutic</span>
                  </div>
                  <p className="text-xs leading-relaxed text-foreground">{item.after}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What We Offer — 2x2 Architectural Hairline Matrix */}
      <section id="offerings" className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16 space-y-6">
        <div className="max-w-2xl space-y-1.5">
          <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-primary">
            03 // Core Capabilities
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            One Operating Platform From Line Crew to Plant Leadership
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Every team gets clear workflows built around real plant responsibilities—no steep training curve, and zero disruption to existing shop-floor controls.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-px bg-border rounded-xl border border-border overflow-hidden">
          {OFFERINGS.map((off) => {
            const Icon = off.Icon;
            return (
              <div
                key={off.title}
                className="bg-card p-6 space-y-4 hover:bg-muted/25 transition-colors duration-150"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-semibold text-primary">
                        {off.code}
                      </span>
                      <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                        {off.tag}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-foreground">{off.title}</h3>
                  </div>
                  <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/40 text-foreground shrink-0">
                    <Icon className="h-4 w-4" />
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{off.description}</p>
                <ul className="space-y-1.5 pt-2 border-t border-border">
                  {off.points.map((pt) => (
                    <li key={pt} className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* Lutic Multi-Product Suite & Ecosystem — Asymmetric Bento */}
      <section id="platform" className="border-t border-border bg-muted/15 py-14 sm:py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-6">
          <div className="max-w-2xl space-y-1.5">
            <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-primary">
              04 // Lutic Product Suite
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              AI Systems Built to Run Real Work Across Every Team
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Beyond industrial operations, Lutic delivers governed AI automations, agentic dashboards, autonomous multi-agent systems, and connected execution boards tailored to your stack.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            {/* Flagship Card — Asymmetric Span */}
            <div className="lg:col-span-7 rounded-xl border border-border bg-card p-6 flex flex-col justify-between gap-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="default" className="font-mono text-[10px]">
                    FLAGSHIP PLATFORM
                  </Badge>
                  <Factory className="h-4 w-4 text-primary" />
                </div>
                <h3 className="text-xl font-bold tracking-tight text-foreground">
                  Lutic Industrial Operations
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Unify shop-floor alerts, OEM manuals, PLC/sensor streams, and Kanban/List execution boards to turn stoppages into verified fixes fast—across every plant under strict RBAC boundaries.
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3 border-t border-border pt-4">
                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>Plant floor to boardroom visibility</span>
                </div>
                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>Built-in execution board &amp; native connectors</span>
                </div>
              </div>
            </div>

            {/* AI Automations */}
            <div className="lg:col-span-5 rounded-xl border border-border bg-card p-6 flex flex-col justify-between gap-4">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    Cross-System Execution
                  </span>
                  <Workflow className="h-4 w-4 text-muted-foreground" />
                </div>
                <h3 className="text-base font-semibold text-foreground">AI Automations</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Replace manual ticket handoffs and swivel-chair updates with visual multi-step workflows across SAP, ServiceNow, AWS, and operations teams.
                </p>
              </div>
              <div className="space-y-1.5 border-t border-border pt-3">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                  <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                  <span>Event-driven triggers &amp; approvals</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                  <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                  <span>Complete audit history on every run</span>
                </div>
              </div>
            </div>

            {/* Agentic Dashboards */}
            <div className="lg:col-span-6 rounded-xl border border-border bg-card p-6 flex flex-col justify-between gap-4">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    Decision Intelligence
                  </span>
                  <LineChart className="h-4 w-4 text-muted-foreground" />
                </div>
                <h3 className="text-base font-semibold text-foreground">Agentic Dashboards</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Live operational and executive scorecards that surface anomalies automatically, explain what shifted, and answer follow-up questions in plain language.
                </p>
              </div>
              <div className="flex flex-wrap gap-4 border-t border-border pt-3 text-[11px] font-medium text-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                  <span>Zero spreadsheet reconciliation</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                  <span>Scoped views per plant, site, or team</span>
                </span>
              </div>
            </div>

            {/* Autonomous Multi-Agent Systems */}
            <div className="lg:col-span-6 rounded-xl border border-border bg-card p-6 flex flex-col justify-between gap-4">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    Governed Agent Swarms
                  </span>
                  <Bot className="h-4 w-4 text-muted-foreground" />
                </div>
                <h3 className="text-base font-semibold text-foreground">
                  Autonomous Multi-Agent Systems
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Specialist agents collaborate across diagnostics, spare-parts checks, IT service desks, and planning while enforcing role permissions and human sign-off.
                </p>
              </div>
              <div className="flex flex-wrap gap-4 border-t border-border pt-3 text-[11px] font-medium text-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                  <span>Role-governed tool boundaries</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                  <span>Safe escalation with full reasoning trail</span>
                </span>
              </div>
            </div>
          </div>

          {/* Ecosystem Ledger */}
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
              <Cpu className="h-4 w-4 text-primary" />
              <span>Ready-Made Ecosystem</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ECOSYSTEM_ITEMS.map((item) => (
                <Badge key={item} variant="secondary" className="font-mono text-[10.5px] font-medium">
                  {item}
                </Badge>
              ))}
            </div>
          </div>

          {/* Deployment Tiers */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5 flex items-start gap-3.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/40 text-foreground shrink-0">
                <Kanban className="h-4 w-4" />
              </span>
              <div className="space-y-1">
                <div className="text-sm font-semibold">Free &amp; Individual Workspaces</div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Sign up with Google, Microsoft, or email and launch your own workspace with starter workflows, connectors, and execution board immediately.
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-5 flex items-start gap-3.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted/40 text-foreground shrink-0">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div className="space-y-1">
                <div className="text-sm font-semibold">Enterprise Managed Deployments</div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Admin-invited access controls, strict facility boundaries, SAP &amp; AWS connectors, and dedicated multi-agent governance under your domain.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Role Dossier */}
      <section id="teams" className="border-t border-border bg-background py-14 sm:py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-6">
          <div className="space-y-1 max-w-xl">
            <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-primary">
              05 // Role Workspaces
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Built Around How Your Teams Actually Work
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-[270px_1fr] items-start">
            <div
              role="tablist"
              aria-label="Operational roles"
              className="flex flex-col gap-1.5"
            >
              {TEAM_PROFILES.map((profile) => {
                const selected = profile.id === activeTeam.id;
                return (
                  <button
                    key={profile.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActiveTeamId(profile.id)}
                    className={cn(
                      "flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-left text-xs sm:text-sm font-medium transition-[color,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.985]",
                      selected
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    )}
                  >
                    <span>{profile.role}</span>
                  </button>
                );
              })}
            </div>

            <div className="rounded-xl border border-border bg-card p-6 grid gap-6 lg:grid-cols-[1.25fr_1fr] items-center">
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10.5px] font-semibold text-primary">
                    {activeTeam.code}
                  </span>
                  <Badge variant="outline" className="text-[11px]">
                    {activeTeam.role}
                  </Badge>
                </div>
                <h3 className="text-xl font-bold tracking-tight text-foreground">
                  {activeTeam.headline}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {activeTeam.summary}
                </p>
              </div>
              <div className="space-y-2.5 rounded-lg border border-border bg-muted/25 p-4">
                <div className="text-[10.5px] font-mono font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Measurable Daily Impact
                </div>
                {activeTeam.wins.map((win) => (
                  <div key={win} className="flex items-start gap-2 text-xs font-medium text-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                    <span>{win}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Closing Command Banner */}
      <section className="mx-auto max-w-6xl px-4 pb-14 sm:px-6 sm:pb-16">
        <div className="rounded-xl border border-border bg-card p-6 sm:p-9 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1.5 max-w-xl">
            <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-primary">
              READY FOR EVERY SHIFT
            </div>
            <h2 className="text-2xl font-bold tracking-tight">
              Bring Calm, Verified Speed to Every Shift.
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Sign in with your Lutic account to access your plants, live line status, guided troubleshooting, and operational scorecards.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <Link href="/login" className={buttonVariants({ size: "lg" })}>
              <span>{demoMode ? "Explore Interactive Demo" : "Sign in to Lutic"}</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border bg-muted/20 py-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <Factory className="h-3.5 w-3.5 text-primary" />
            <span className="font-mono">Lutic · lutic.app</span>
          </div>
          <div>Autonomous AI systems, automations, agentic dashboards, and industrial operations.</div>
        </div>
      </footer>
    </div>
  );
}
