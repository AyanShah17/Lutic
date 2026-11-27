"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  Cpu,
  Kanban,
  KeyRound,
  Moon,
  Network,
  Plug,
  ShieldCheck,
  Sparkles,
  Sun,
  Workflow
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { LuticPlantAnatomy } from "@/components/landing-anatomy";
import { LuticLogo } from "@/components/lutic-logo";

interface ServiceCard {
  id: string;
  title: string;
  tag: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const PAAS_SERVICES: ServiceCard[] = [
  {
    id: "ai-dashboard",
    title: "AI Dashboard",
    tag: "Semantic Analytics",
    description:
      "Ask in plain English and get governed KPI boards with 5-version history, client undo/redo, and tenant-isolated metrics.",
    Icon: BarChart3
  },
  {
    id: "ai-board",
    title: "AI Board",
    tag: "Kanban + List",
    description:
      "Linear and Jira-style execution board where autonomous agents and teams track incidents, tasks, and escalations end-to-end.",
    Icon: Kanban
  },
  {
    id: "ai-gateway",
    title: "AI Gateway",
    tag: "Model Router",
    description:
      "Unified multi-model inference routing with per-tenant budgets, token latency telemetry, and role-governed tool calls.",
    Icon: Cpu
  },
  {
    id: "agents",
    title: "Autonomous Agents",
    tag: "Swarms + Copilot",
    description:
      "Specialist multi-agent orchestrator plus a screen-aware Floating AI Copilot on every page for live operational changes.",
    Icon: Bot
  },
  {
    id: "connectors",
    title: "Connectors Hub",
    tag: "2,100+ Integrations",
    description:
      "Connect SAP, AWS, ServiceNow, Slack, Linear, GitHub, MQTT, OPC-UA, Modbus, and OpenAPI tools through audited interfaces.",
    Icon: Plug
  },
  {
    id: "iam-for-agents",
    title: "IAM for Agents",
    tag: "RBAC + RLS",
    description:
      "Six-step policy checks, core toolkits, AES-256-GCM credentials, row-level tenant isolation, and exportable audit trails.",
    Icon: KeyRound
  },
  {
    id: "ai-canvas",
    title: "AI Canvas",
    tag: "Visual DAG Builder",
    description:
      "n8n-style node-and-edge workflow automation builder paired with a color-coded document-grounded machine topology canvas.",
    Icon: Workflow
  },
  {
    id: "agent-hitl",
    title: "Agent HITL",
    tag: "Safety Verifier",
    description:
      "Mandatory Human-in-the-Loop confirmation gates and Before / After diffs before any agent writes to production systems.",
    Icon: ShieldCheck
  },
  {
    id: "custom-studio",
    title: "Custom AI Solutions",
    tag: "Lutic Studio",
    description:
      "Bespoke AI engineering, production consulting, workflow design, and 24/7 ongoing monitoring tailored to your stack.",
    Icon: Sparkles
  }
];

const MARQUEE_ITEMS = [
  "AI PaaS Workspaces",
  "AI Dashboard",
  "AI Board",
  "AI Gateway",
  "Autonomous Agents",
  "Connectors Hub",
  "IAM for Agents",
  "AI Canvas",
  "Agent HITL",
  "Custom AI Solutions",
  "Production Consulting",
  "24/7 AI Support"
];

const LOOP_TRACE = [
  {
    step: "01",
    verb: "Observe",
    stage: "OBSERVE · SIGNAL",
    detail: "Reads live webhooks, telemetry anomalies, and connected tickets",
    meta: "00:00.2s",
    active: false
  },
  {
    step: "02",
    verb: "Decide",
    stage: "DECIDE · POLICY",
    detail: "Hybrid RAG cites your SOPs and evaluates IAM role & scope boundaries",
    meta: "00:01.8s",
    active: false
  },
  {
    step: "03",
    verb: "Act",
    stage: "ACT · CONNECTORS",
    detail: "Plans tool execution across SAP, ServiceNow, Slack, and AI Canvas",
    meta: "00:03.1s",
    active: false
  },
  {
    step: "04",
    verb: "Verify",
    stage: "VERIFY · AGENT HITL",
    detail: "Before / After diff approved by human lead · Audit sealed",
    meta: "Verified",
    active: true
  }
];

const STUDIO_PROCESS = [
  {
    num: "1",
    title: "Sign Up or Discover",
    body: "Launch an isolated AI PaaS tenant on lutic.app in seconds, or scope your custom automation use case with our studio engineers."
  },
  {
    num: "2",
    title: "Wire AI Canvas & Tools",
    body: "Connect ERP, SaaS, cloud, and industrial data sources inside Connectors Hub and orchestrate them visually on AI Canvas."
  },
  {
    num: "3",
    title: "Gate with IAM & HITL",
    body: "Bind every agent toolkit to explicit RBAC roles, row-level tenant isolation, and human-approved Before / After execution diffs."
  },
  {
    num: "4",
    title: "Persist & Scale 24/7",
    body: "Every workflow, board item, dashboard, and agent change persists across sessions with full monitoring, alerts, and queues."
  }
];

interface TeamProfile {
  id: string;
  role: string;
  headline: string;
  summary: string;
  wins: string[];
}

const TEAM_PROFILES: TeamProfile[] = [
  {
    id: "founders",
    role: "AI Product & Platform Teams",
    headline: "Launch multi-tenant AI workflows without rebuilding plumbing.",
    summary:
      "Every signup receives a private tenant pre-wired with AI Gateway, Connectors Hub, Agent HITL, and persistent boards, canvases, and dashboards.",
    wins: [
      "Instant isolated workspace per signup",
      "Full session persistence across logins and restarts",
      "Unified AI Canvas and Autonomous Agent orchestration"
    ]
  },
  {
    id: "analysts",
    role: "Operations Analysts",
    headline: "Spend less time reconciling spreadsheets and more time improving systems.",
    summary:
      "Build live operational scorecards from governed definitions—comparing uptime, throughput, energy, and resolution speed across sites and agents.",
    wins: [
      "Consistent governed KPIs without raw SQL drift",
      "Natural-language dashboard drafts with 5-version undo",
      "Role- and plant-scoped executive boards in minutes"
    ]
  },
  {
    id: "engineers",
    role: "Automation & Plant Engineers",
    headline: "Turn tribal manuals and scattered alarms into verified action.",
    summary:
      "Trace color-coded system topology from your own PDFs, ask the Floating AI Copilot for live diffs, and route work orders cleanly.",
    wins: [
      "Cited RAG answers from your approved documents",
      "AI Canvas triggers wired directly to dispatch queues",
      "Mandatory Agent HITL sign-off before live changes"
    ]
  },
  {
    id: "security",
    role: "Security & Governance Leads",
    headline: "Keep every tenant isolated and every agent action accounted for.",
    summary:
      "Enforce six-step tool authorization, AES-256-GCM connector vaults, row-level isolation, and exportable audit logs on every request.",
    wins: [
      "Strict cross-tenant & workspace isolation",
      "IAM policies bound per role and toolkit",
      "Immutable audit history for compliance review"
    ]
  }
];

const ECOSYSTEM_ITEMS = [
  "2,100+ Ready Connectors",
  "SAP S/4HANA PM · MM · PP · QM",
  "AWS IoT SiteWise · S3 · CloudWatch",
  "ServiceNow · Jira · Linear · Slack",
  "MQTT · OPC-UA · Modbus TCP",
  "PostgreSQL RLS · AES-256-GCM"
];

export function LuticLandingPage({ demoMode }: { demoMode: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [activeTeamId, setActiveTeamId] = useState<string>("founders");
  const [rotIndex, setRotIndex] = useState(0);

  const rotatingPhrases = [
    "AI PaaS workspaces",
    "autonomous agents",
    "agentic automations",
    "custom AI solutions"
  ];

  useEffect(() => {
    setMounted(true);
    const id = setInterval(() => {
      setRotIndex((i) => (i + 1) % rotatingPhrases.length);
    }, 2600);
    return () => clearInterval(id);
  }, [rotatingPhrases.length]);

  const currentTheme = mounted ? resolvedTheme ?? "light" : "light";
  const activeTeam = TEAM_PROFILES.find((t) => t.id === activeTeamId) ?? TEAM_PROFILES[0]!;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Lutic-UI Floating Pill Header */}
      <div className="sticky top-0 z-40 px-3 pt-3 sm:px-6">
        <header className="mx-auto flex max-w-5xl items-center justify-between gap-2 rounded-full border border-border bg-card/85 px-3 py-2 backdrop-blur-md shadow-[0_6px_24px_rgba(16,16,18,0.06)]">
          <Link href="/" className="flex items-center gap-2.5 pl-1.5 min-w-0">
            <LuticLogo className="h-7 w-7" />
            <span className="text-base font-semibold tracking-tight text-foreground">Lutic</span>
            <span className="hidden sm:inline-block text-[11px] font-mono text-muted-foreground">
              lutic.app
            </span>
          </Link>

          <nav
            aria-label="Landing sections"
            className="hidden md:flex items-center gap-1 text-xs font-medium text-muted-foreground"
          >
            {[
              ["#services", "Services"],
              ["#how-it-works", "Architecture"],
              ["#studio", "Studio"],
              ["#teams", "Teams"]
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="rounded-full px-3 py-1.5 hover:bg-muted hover:text-foreground transition-colors duration-150"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setTheme(currentTheme === "dark" ? "light" : "dark")}
              aria-label="Toggle color theme"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-150"
            >
              {currentTheme === "dark" ? (
                <Moon className="h-3.5 w-3.5" />
              ) : (
                <Sun className="h-3.5 w-3.5" />
              )}
            </button>
            <Link href="/signup" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              <span>Create Workspace</span>
            </Link>
            <Link href="/login" className={buttonVariants({ size: "sm" })}>
              <span>Sign in</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </header>
      </div>

      {/* Lutic-UI Editorial Hero */}
      <section className="lutic-hero-glow">
        <div className="mx-auto max-w-6xl px-4 pt-12 pb-16 sm:px-6 sm:pt-16 sm:pb-20">
          <div className="grid gap-12 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-7 space-y-6 lutic-reveal">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1 text-[11px] font-medium text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                <span>AI PaaS · Independent AI Studio · lutic.app</span>
              </div>

              <h1 className="text-4xl sm:text-[56px] font-medium tracking-[-0.035em] text-foreground leading-[1.04]">
                Lutic builds AI systems that work.
              </h1>

              <p className="font-serif text-2xl sm:text-3xl text-muted-foreground leading-snug">
                We build{" "}
                <em className="italic text-primary not-italic">
                  {rotatingPhrases[rotIndex]}
                </em>
              </p>

              <p className="text-base sm:text-[17px] text-muted-foreground leading-relaxed max-w-xl">
                Launch your own persistent multi-tenant AI PaaS workspace in seconds—or partner with Lutic Studio to ship custom AI solutions, autonomous agents, AI Canvas workflows, and governed enterprise integrations.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link href="/signup" className={buttonVariants({ size: "lg" })}>
                  <span>Start Your Free Tenant</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/login" className={buttonVariants({ variant: "outline", size: "lg" })}>
                  <span>{demoMode ? "Explore Interactive Demo" : "Sign in"}</span>
                </Link>
                <a
                  href="#services"
                  className={buttonVariants({ variant: "ghost", size: "lg" })}
                >
                  <span>Explore Services</span>
                </a>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 border-t-2 border-foreground pt-5">
                <div>
                  <div className="text-2xl font-medium tracking-tight tabular-nums">12+</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Core AI PaaS services</div>
                </div>
                <div>
                  <div className="text-2xl font-medium tracking-tight tabular-nums">100%</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Session &amp; tenant persistence</div>
                </div>
                <div>
                  <div className="text-2xl font-medium tracking-tight tabular-nums">2,100+</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Connectors ready</div>
                </div>
                <div>
                  <div className="text-2xl font-medium tracking-tight tabular-nums">24/7</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Monitoring &amp; custom support</div>
                </div>
              </div>
            </div>

            {/* Right Column: Lutic Mascot + Live Closed-Loop Card */}
            <div className="lg:col-span-5 space-y-5 lutic-reveal-delay-2">
              <div className="relative flex flex-col items-center justify-center rounded-3xl border border-border bg-card p-6 sm:p-8 overflow-hidden">
                <div className="relative flex items-center justify-center py-4">
                  <LuticLogo className="h-44 w-44 sm:h-52 sm:w-52 lutic-mascot-glow" />
                  <div className="absolute -top-1 -right-3 rounded-xl border border-border bg-card px-3 py-1.5 text-xs shadow-sm flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                    <span className="font-medium text-foreground">Agent resolved 38 tasks</span>
                  </div>
                  <div className="absolute -bottom-1 -left-3 rounded-xl border border-border bg-card px-3 py-1.5 text-xs shadow-sm flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                    <span className="font-medium text-foreground">HITL gate · Diff approved</span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-[#101012] text-[#f4f4f2] overflow-hidden">
                <div className="flex items-center justify-between border-b border-[#26262b] px-5 py-3">
                  <span className="text-xs font-medium text-[#9a9aa3]">
                    Closed-Loop Agent Execution
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#52d27c]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#52d27c]" aria-hidden="true" />
                    <span>Tenant Isolated</span>
                  </span>
                </div>
                <div className="divide-y divide-[#26262b]">
                  {LOOP_TRACE.map((row) => (
                    <div
                      key={row.step}
                      className={cn(
                        "flex items-start justify-between gap-3 px-5 py-3",
                        row.active ? "bg-[#ee5414]/15" : ""
                      )}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <span
                          className={cn(
                            "font-mono text-[11px] font-medium mt-0.5 tabular-nums",
                            row.active ? "text-[#ee5414]" : "text-[#9a9aa3]"
                          )}
                        >
                          {row.step}
                        </span>
                        <div className="min-w-0 space-y-0.5">
                          <div className="text-[11px] font-medium text-[#9a9aa3]">
                            {row.stage}
                          </div>
                          <div className="text-xs font-medium text-white leading-snug">
                            {row.detail}
                          </div>
                        </div>
                      </div>
                      <span className="font-mono text-[11px] text-[#9a9aa3] tabular-nums shrink-0">
                        {row.meta}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Lutic-UI Capabilities Marquee */}
      <div className="border-y border-border bg-card py-4 overflow-hidden">
        <div className="flex w-max gap-10 whitespace-nowrap animate-lutic-marquee text-base sm:text-lg text-muted-foreground">
          {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, idx) => (
            <span key={`${item}-${idx}`} className="inline-flex items-center gap-3">
              <span>{item}</span>
              <span className="text-primary font-semibold" aria-hidden="true">
                /
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Nine AI PaaS & Custom Studio Services Grid (.gp Lutic-UI cards) */}
      <section id="services" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 space-y-10">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2 max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
              THE LUTIC AI PAAS &amp; STUDIO
            </span>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-[-0.03em]">
              Every AI service, persistent in your own tenant.
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
              Sign up once to provision your isolated workspace with every core service ready—or engage Lutic for custom AI solutions and production consulting.
            </p>
          </div>
          <Link href="/signup" className={buttonVariants({ size: "default" })}>
            <span>Provision Tenant</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PAAS_SERVICES.map((svc) => {
            const Icon = svc.Icon;
            return (
              <Link
                key={svc.id}
                href="/signup"
                className="group relative flex min-h-[220px] flex-col justify-between gap-4 rounded-[26px] border border-border bg-card p-6 transition-[transform,background-color,color,border-color] duration-200 hover:-translate-y-1 hover:border-foreground hover:bg-foreground hover:text-background"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-foreground transition-[transform,background-color,color] duration-200 group-hover:-rotate-6 group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="rounded-full border border-border px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground group-hover:border-background/25 group-hover:text-background/80">
                    {svc.tag}
                  </span>
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-xl font-medium tracking-[-0.025em]">{svc.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground group-hover:text-background/80">
                    {svc.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Quiet Typographic Ecosystem Line */}
        <div className="flex flex-col gap-2.5 border-y border-border py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground shrink-0">
            <Network className="h-3.5 w-3.5 text-primary" />
            <span>Ready Ecosystem</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/85 font-mono">
            {ECOSYSTEM_ITEMS.map((item, idx) => (
              <React.Fragment key={item}>
                {idx > 0 && (
                  <span className="text-border" aria-hidden="true">
                    ·
                  </span>
                )}
                <span>{item}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>

      {/* Interactive Architecture Showcase */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="mb-6 max-w-xl space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
            Architecture
          </div>
          <h2 className="text-2xl sm:text-3xl font-medium tracking-tight">
            From Signal to Human-Verified Action
          </h2>
          <p className="text-sm text-muted-foreground">
            Trace how Lutic links system telemetry, hybrid RAG manuals, safety verification gates, and ERP dispatch.
          </p>
        </div>
        <LuticPlantAnatomy />
      </section>

      {/* How a Lutic Project Runs (.proc Lutic-UI 4-column bar) */}
      <section id="studio" className="border-y border-border bg-muted/40 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-8">
          <div className="max-w-xl space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
              Process
            </div>
            <h2 className="text-2xl sm:text-3xl font-medium tracking-tight">
              How a Lutic workspace and project runs.
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 border-t-2 border-foreground pt-6">
            {STUDIO_PROCESS.map((step) => (
              <div key={step.num} className="space-y-2">
                <div className="font-mono text-xs font-semibold text-primary">0{step.num}</div>
                <h3 className="text-lg font-medium tracking-tight text-foreground">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Interactive Team Dossier */}
      <section id="teams" className="bg-background py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-8">
          <div className="space-y-1.5 max-w-xl">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">
              For Teams
            </div>
            <h2 className="text-2xl sm:text-3xl font-medium tracking-tight">
              Built Around How Your Teams Actually Work
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-[260px_1fr] items-start">
            <div
              role="tablist"
              aria-label="Operational roles"
              className="flex flex-col gap-1"
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
                      "rounded-2xl px-4 py-3 text-left text-xs sm:text-sm font-medium transition-[color,background-color] duration-150",
                      selected
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {profile.role}
                  </button>
                );
              })}
            </div>

            <div className="rounded-3xl border border-border bg-card p-6 sm:p-8 grid gap-6 lg:grid-cols-[1.25fr_1fr] items-center">
              <div className="space-y-2.5">
                <div className="text-xs font-medium text-primary">{activeTeam.role}</div>
                <h3 className="text-xl font-medium tracking-tight text-foreground">
                  {activeTeam.headline}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {activeTeam.summary}
                </p>
              </div>
              <div className="space-y-2.5 rounded-2xl bg-muted/60 p-4">
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

      {/* Lutic-UI Dark Rounded Studio CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-20">
        <div className="rounded-[32px] bg-[#101012] p-8 sm:p-12 text-white flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2 max-w-xl">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#ee5414]">
              <Activity className="h-3.5 w-3.5" />
              <span>AI PaaS · Persistent Workspaces</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-[-0.03em]">
              Launch your tenant, or tell us what to automate first.
            </h2>
            <p className="text-sm text-[#a9a9b2] leading-relaxed">
              Sign up to get an isolated tenant with AI Canvas, AI Board, AI Dashboard, Connectors Hub, IAM, and Agent HITL—with every workflow and change persisted across sessions.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#ee5414] px-5 py-3 text-sm font-medium text-white transition-transform duration-150 hover:-translate-y-0.5 hover:bg-[#ee5414]/90"
            >
              <span>Create Free Tenant</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/25 px-5 py-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-white/10"
            >
              <span>{demoMode ? "Explore Interactive Demo" : "Sign in"}</span>
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2.5 font-medium text-foreground">
            <LuticLogo className="h-6 w-6" />
            <span>Lutic · lutic.app</span>
          </div>
          <div>
            AI PaaS and independent AI studio for custom solutions, autonomous agents, and production automation.
          </div>
        </div>
      </footer>
    </div>
  );
}
