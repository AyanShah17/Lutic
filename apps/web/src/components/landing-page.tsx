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
      {/* Minimal Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
              <Factory className="h-3.5 w-3.5" />
            </span>
            <span className="text-sm font-semibold tracking-tight">Lutic</span>
            <span className="hidden sm:inline-block text-[11px] font-mono text-muted-foreground">
              lutic.app
            </span>
          </Link>

          <nav
            aria-label="Landing sections"
            className="hidden md:flex items-center gap-7 text-xs font-medium text-muted-foreground"
          >
            <a href="#how-it-works" className="hover:text-foreground transition-colors duration-150">
              Architecture
            </a>
            <a href="#problems" className="hover:text-foreground transition-colors duration-150">
              Impact
            </a>
            <a href="#offerings" className="hover:text-foreground transition-colors duration-150">
              Capabilities
            </a>
            <a href="#platform" className="hover:text-foreground transition-colors duration-150">
              Platform
            </a>
            <a href="#teams" className="hover:text-foreground transition-colors duration-150">
              Teams
            </a>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setTheme(currentTheme === "dark" ? "light" : "dark")}
              aria-label="Toggle color theme"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors duration-150"
            >
              {currentTheme === "dark" ? (
                <Moon className="h-3.5 w-3.5" />
              ) : (
                <Sun className="h-3.5 w-3.5" />
              )}
            </button>
            <Link href="/signup" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              <span>Start Free</span>
            </Link>
            <Link href="/login" className={buttonVariants({ size: "sm" })}>
              <span>Sign in</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Editorial Asymmetric Hero */}
      <section className="lutic-hero-glow">
        <div className="mx-auto max-w-6xl px-4 pt-14 pb-16 sm:px-6 sm:pt-20 sm:pb-20">
          <div className="grid gap-12 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-7 space-y-6 lutic-reveal">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/80 px-3 py-1 text-[11px] font-medium text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                <span>Industrial &amp; Enterprise AI · lutic.app</span>
              </div>

              <h1 className="text-4xl sm:text-[50px] font-semibold tracking-[-0.035em] text-foreground leading-[1.06]">
                Turn Every Plant Issue Into a Fast, Safe, Verified Fix.
              </h1>

              <p className="text-base sm:text-[17px] text-muted-foreground leading-relaxed max-w-xl">
                Lutic unifies plant manuals, live machine topology, maintenance workflows, and site scorecards in one calm workspace—resolving stoppages in minutes under human sign-off.
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
                  <span>See How It Works</span>
                </a>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 border-t border-border/70 pt-6">
                <div>
                  <div className="font-mono text-sm font-semibold text-foreground tabular-nums">
                    &lt; 5 min
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">Verified root cause triage</div>
                </div>
                <div>
                  <div className="font-mono text-sm font-semibold text-foreground tabular-nums">
                    100% Gated
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">Human sign-off before changes</div>
                </div>
                <div>
                  <div className="font-mono text-sm font-semibold text-foreground tabular-nums">
                    2,100+
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">OT/IT &amp; ERP connectors</div>
                </div>
              </div>
            </div>

            {/* Minimal Live Execution Readout */}
            <div className="lg:col-span-5 lutic-reveal-delay-2">
              <div className="rounded-2xl border border-border/80 bg-card overflow-hidden">
                <div className="flex items-center justify-between border-b border-border/70 px-5 py-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    Live Execution Trace
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                    <span>Verified</span>
                  </span>
                </div>
                <div className="divide-y divide-border/60">
                  {EXECUTION_TRACE.map((row) => (
                    <div
                      key={row.step}
                      className={cn(
                        "flex items-start justify-between gap-3 px-5 py-3.5 transition-colors duration-150",
                        row.active ? "bg-muted/35" : "hover:bg-muted/20"
                      )}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <span
                          className={cn(
                            "font-mono text-[11px] font-medium mt-0.5 tabular-nums",
                            row.active ? "text-primary" : "text-muted-foreground"
                          )}
                        >
                          {row.step}
                        </span>
                        <div className="min-w-0 space-y-0.5">
                          <div className="text-[11px] font-medium text-muted-foreground">
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
                <div className="flex items-center justify-between border-t border-border/70 bg-muted/20 px-5 py-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                    <span>Role-scoped · Plant-isolated</span>
                  </span>
                  <span className="font-medium text-foreground">Audit Sealed</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Anatomy Showcase */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="mb-6 max-w-xl space-y-1.5">
          <div className="text-xs font-medium text-primary">Architecture</div>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            How Lutic Keeps Lines Moving
          </h2>
          <p className="text-sm text-muted-foreground">
            Switch scenarios or select any station to trace how issues move from floor alert to verified fix.
          </p>
        </div>
        <LuticPlantAnatomy />
      </section>

      {/* Problems We Solve — Hairline Comparison Ledger */}
      <section id="problems" className="border-y border-border/60 bg-muted/15 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-1.5 max-w-xl">
              <div className="text-xs font-medium text-primary">Impact</div>
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                Operational Drags Lutic Eliminates
              </h2>
            </div>

            <div className="inline-flex flex-wrap gap-0.5 rounded-lg border border-border/75 bg-muted/40 p-1">
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
                    "rounded-md px-3 py-1 text-xs font-medium transition-[color,background-color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.985]",
                    activeProblem === tab.id
                      ? "bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-border/70"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border/80 bg-card divide-y divide-border/60 overflow-hidden">
            <div className="hidden md:grid md:grid-cols-[1fr_1.45fr_1.45fr] px-6 py-3 text-xs font-medium text-muted-foreground">
              <span>Area</span>
              <span>Before Lutic</span>
              <span>With Lutic</span>
            </div>
            {visibleProblems.map((item) => (
              <div
                key={item.id}
                className="grid gap-5 px-6 py-5 md:grid-cols-[1fr_1.45fr_1.45fr] md:items-start hover:bg-muted/20 transition-colors duration-150"
              >
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                  <div className="text-xs text-muted-foreground">{item.impact}</div>
                </div>

                <div className="space-y-1">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground md:hidden">
                    <XCircle className="h-3.5 w-3.5 text-destructive" />
                    <span>Before Lutic</span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{item.before}</p>
                </div>

                <div className="space-y-1 border-l border-primary/50 pl-4">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary md:hidden">
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

      {/* Core Capabilities — Minimal Hairline Matrix */}
      <section id="offerings" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 space-y-8">
        <div className="max-w-2xl space-y-1.5">
          <div className="text-xs font-medium text-primary">Capabilities</div>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            One Operating Platform From Line Crew to Leadership
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Clear workflows built around real plant responsibilities—without disrupting existing shop-floor controls.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-px bg-border/70 rounded-2xl border border-border/70 overflow-hidden">
          {OFFERINGS.map((off) => {
            const Icon = off.Icon;
            return (
              <div
                key={off.title}
                className="bg-card p-6 sm:p-7 space-y-4 hover:bg-muted/20 transition-colors duration-150"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">{off.tag}</div>
                    <h3 className="text-base font-semibold text-foreground">{off.title}</h3>
                  </div>
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/60 text-foreground shrink-0">
                    <Icon className="h-4 w-4" />
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{off.description}</p>
                <ul className="space-y-1.5 pt-2 border-t border-border/60">
                  {off.points.map((pt) => (
                    <li key={pt} className="flex items-center gap-2 text-xs text-foreground">
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

      {/* Lutic Product Suite — Quiet Bento */}
      <section id="platform" className="border-t border-border/60 bg-muted/10 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-8">
          <div className="max-w-2xl space-y-1.5">
            <div className="text-xs font-medium text-primary">Platform Suite</div>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              AI Systems Built to Run Real Work
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Governed AI automations, agentic dashboards, autonomous multi-agent systems, and connected execution boards tailored to your stack.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-7 rounded-2xl border border-border/80 bg-card p-6 sm:p-7 flex flex-col justify-between gap-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-primary">Flagship Platform</span>
                  <Factory className="h-4 w-4 text-muted-foreground" />
                </div>
                <h3 className="text-xl font-semibold tracking-tight text-foreground">
                  Lutic Industrial Operations
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Unify shop-floor alerts, OEM manuals, machine connection drawings, and Kanban/List execution boards across every plant under strict RBAC boundaries.
                </p>
              </div>
              <div className="flex flex-wrap gap-6 border-t border-border/60 pt-4 text-xs text-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>Plant floor to boardroom visibility</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>Floating AI copilot with Before / After diffs</span>
                </span>
              </div>
            </div>

            <div className="lg:col-span-5 rounded-2xl border border-border/80 bg-card p-6 sm:p-7 flex flex-col justify-between gap-4">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Cross-System Execution</span>
                  <Workflow className="h-4 w-4 text-muted-foreground" />
                </div>
                <h3 className="text-base font-semibold text-foreground">AI Automations</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Replace manual ticket handoffs with visual multi-step workflows across SAP, ServiceNow, AWS, and plant operations teams.
                </p>
              </div>
              <div className="space-y-1.5 border-t border-border/60 pt-3 text-xs text-foreground">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                  <span>Event-driven triggers &amp; human approvals</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 rounded-2xl border border-border/80 bg-card p-6 sm:p-7 flex flex-col justify-between gap-4">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Decision Intelligence</span>
                  <LineChart className="h-4 w-4 text-muted-foreground" />
                </div>
                <h3 className="text-base font-semibold text-foreground">Agentic Dashboards</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Live operational scorecards that surface anomalies automatically, explain shifts, and scope metrics cleanly per plant.
                </p>
              </div>
              <div className="flex flex-wrap gap-4 border-t border-border/60 pt-3 text-xs text-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                  <span>Zero spreadsheet reconciliation</span>
                </span>
              </div>
            </div>

            <div className="lg:col-span-6 rounded-2xl border border-border/80 bg-card p-6 sm:p-7 flex flex-col justify-between gap-4">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Governed Agent Swarms</span>
                  <Bot className="h-4 w-4 text-muted-foreground" />
                </div>
                <h3 className="text-base font-semibold text-foreground">
                  Autonomous Multi-Agent Systems
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Specialist agents collaborate across diagnostics, spare-parts checks, IT service desks, and planning with role permissions enforced.
                </p>
              </div>
              <div className="flex flex-wrap gap-4 border-t border-border/60 pt-3 text-xs text-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                  <span>Full reasoning trail &amp; audit log</span>
                </span>
              </div>
            </div>
          </div>

          {/* Quiet Typographic Ecosystem Line */}
          <div className="flex flex-col gap-2.5 border-y border-border/60 py-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground shrink-0">
              <Cpu className="h-3.5 w-3.5 text-primary" />
              <span>Ready Ecosystem</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/85 font-mono">
              {ECOSYSTEM_ITEMS.map((item, idx) => (
                <React.Fragment key={item}>
                  {idx > 0 && <span className="text-border" aria-hidden="true">·</span>}
                  <span>{item}</span>
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-border/80 bg-card p-5 flex items-start gap-3.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/60 text-foreground shrink-0">
                <Kanban className="h-4 w-4" />
              </span>
              <div className="space-y-1">
                <div className="text-sm font-semibold">Free &amp; Individual Workspaces</div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Sign up with Google, Microsoft, or email and launch your workspace with starter workflows and execution boards immediately.
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-border/80 bg-card p-5 flex items-start gap-3.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/60 text-foreground shrink-0">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div className="space-y-1">
                <div className="text-sm font-semibold">Enterprise Managed Deployments</div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Admin-invited access controls, strict facility boundaries, SAP &amp; AWS connectors, and governed multi-agent execution under your domain.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Role Dossier */}
      <section id="teams" className="border-t border-border/60 bg-background py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-8">
          <div className="space-y-1.5 max-w-xl">
            <div className="text-xs font-medium text-primary">For Teams</div>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Built Around How Your Teams Actually Work
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-[240px_1fr] items-start">
            <div
              role="tablist"
              aria-label="Operational roles"
              className="flex flex-col border-l border-border/80"
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
                      "-ml-px border-l-2 px-4 py-2.5 text-left text-xs sm:text-sm font-medium transition-[color,background-color,border-color] duration-150",
                      selected
                        ? "border-primary bg-muted/40 text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/20"
                    )}
                  >
                    {profile.role}
                  </button>
                );
              })}
            </div>

            <div className="rounded-2xl border border-border/80 bg-card p-6 sm:p-7 grid gap-6 lg:grid-cols-[1.25fr_1fr] items-center">
              <div className="space-y-2.5">
                <div className="text-xs font-medium text-primary">{activeTeam.role}</div>
                <h3 className="text-xl font-semibold tracking-tight text-foreground">
                  {activeTeam.headline}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {activeTeam.summary}
                </p>
              </div>
              <div className="space-y-2.5 rounded-xl bg-muted/30 p-4">
                <div className="text-[11px] font-medium text-muted-foreground">
                  Measurable Daily Impact
                </div>
                {activeTeam.wins.map((win) => (
                  <div key={win} className="flex items-start gap-2 text-xs text-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                    <span>{win}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Minimal Closing Banner */}
      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-20">
        <div className="rounded-2xl border border-border/80 bg-card p-7 sm:p-10 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1.5 max-w-xl">
            <div className="text-xs font-medium text-primary">Ready for every shift</div>
            <h2 className="text-2xl font-semibold tracking-tight">
              Bring Calm, Verified Speed to Every Shift.
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Sign in with your Lutic account to access your plants, topology connections, guided troubleshooting, and operational scorecards.
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

      <footer className="border-t border-border/60 py-7">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <Factory className="h-3.5 w-3.5 text-primary" />
            <span>Lutic · lutic.app</span>
          </div>
          <div>Autonomous AI systems, automations, agentic dashboards, and industrial operations.</div>
        </div>
      </footer>
    </div>
  );
}
