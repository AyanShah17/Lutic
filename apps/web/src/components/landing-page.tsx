"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Factory,
  Layers,
  LineChart,
  Moon,
  ShieldCheck,
  Sun,
  Wrench,
  XCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LuticPlantAnatomy } from "@/components/landing-anatomy";

interface ProblemItem {
  id: string;
  focus: "downtime" | "knowledge" | "systems" | "governance";
  title: string;
  before: string;
  after: string;
  impact: string;
}

const PROBLEMS: ProblemItem[] = [
  {
    id: "downtime",
    focus: "downtime",
    title: "Long Unplanned Stoppages",
    before: "Crews spend 45+ minutes cycling panels and calling around when an unexpected alarm halts production.",
    after: "Lutic pairs machine conditions with matching fault history in seconds so teams pinpoint the real cause fast.",
    impact: "Faster recovery back to normal line speed"
  },
  {
    id: "knowledge",
    focus: "knowledge",
    title: "Tribal Knowledge Walkouts",
    before: "Critical troubleshooting steps live in aging binders, scattered PDFs, and the heads of veteran specialists.",
    after: "Approved plant manuals and past repair resolutions become instant, cited guidance for every shift crew.",
    impact: "Consistent first-time fixes across all shifts"
  },
  {
    id: "systems",
    focus: "systems",
    title: "Disconnected Tools & Reports",
    before: "Supervisors jump between maintenance logs, spare inventory, alerts, and spreadsheets to piece together one answer.",
    after: "Floor alerts, maintenance work orders, spare parts, and site scorecards flow through one calm operating hub.",
    impact: "Less chasing updates, more time running the floor"
  },
  {
    id: "governance",
    focus: "governance",
    title: "Risk of Unverified Changes",
    before: "Verbal handoffs and manual copy-paste leave gaps in what changed on a line, who approved it, and why.",
    after: "Every work order or spare-part reservation waits for explicit human sign-off with a complete plant history record.",
    impact: "Safer floor changes with zero guesswork"
  }
];

interface OfferingItem {
  title: string;
  tag: string;
  description: string;
  points: string[];
  Icon: React.ComponentType<{ className?: string }>;
}

const OFFERINGS: OfferingItem[] = [
  {
    title: "Instant Floor Guidance",
    tag: "Operations Assistant",
    description:
      "Give shift crews clear, reliable troubleshooting steps grounded directly in your own plant procedures and repair history.",
    points: ["Cited binder and manual sections", "Past fault resolutions matched in seconds"],
    Icon: BookOpen
  },
  {
    title: "Live Plant Visibility",
    tag: "Line & Alert Monitoring",
    description:
      "See machine health, active alarms, and line bottlenecks across facilities without waiting for end-of-shift email recaps.",
    points: ["Real-time machine condition tracking", "Early warnings before minor drifts stop a line"],
    Icon: Factory
  },
  {
    title: "Approved Maintenance Dispatch",
    tag: "Work Orders & Parts",
    description:
      "Move cleanly from diagnosing an issue to opening a work order and holding the right spare parts—always with human review.",
    points: ["One-click supervisor approval", "Priority dispatch and shift alerts kept aligned"],
    Icon: Wrench
  },
  {
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
  role: string;
  headline: string;
  summary: string;
  wins: string[];
}

const TEAM_PROFILES: TeamProfile[] = [
  {
    id: "managers",
    role: "Plant & Shift Managers",
    headline: "Start every shift with calm clarity instead of firefighting.",
    summary:
      "Spot developing slowdowns early, verify that high-risk repairs receive supervisor sign-off, and hand off shifts using live plant status rather than handwritten notes.",
    wins: ["Shorter unplanned downtime windows", "Automatic shift-change handoff briefs", "Clear visibility across every line"]
  },
  {
    id: "maintenance",
    role: "Maintenance & Floor Crews",
    headline: "Bring veteran plant knowledge to every technician on day one.",
    summary:
      "Scan a machine badge or type a symptom to pull up the exact manual procedure, check compatible spare parts, and prepare a clean work order without walking back to a desk.",
    wins: ["No hunting through binders on night shifts", "Right spare parts held on the first trip", "Higher first-visit repair success"]
  },
  {
    id: "analysts",
    role: "Operations Analysts",
    headline: "Spend less time reconciling spreadsheets and more time improving lines.",
    summary:
      "Build live plant scorecards from governed operational definitions—comparing downtime, throughput, energy, and repair speed across sites from a single source of truth.",
    wins: ["Consistent KPIs across multiple facilities", "Instant comparisons across shifts and weeks", "Executive boards ready in minutes"]
  },
  {
    id: "leads",
    role: "Compliance & Ops Leads",
    headline: "Keep every facility strictly scoped and every floor action accounted for.",
    summary:
      "Ensure each operator only views and acts on their assigned plants, protect connected plant tools, and keep a complete review trail for quality and safety audits.",
    wins: ["Site-by-site team access boundaries", "Mandatory human sign-off on changes", "Clean activity records for every action"]
  }
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
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
              <Factory className="h-4 w-4" />
            </span>
            <span className="text-base font-bold tracking-tight">Lutic</span>
            <span className="hidden sm:inline-block rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              lutic.app
            </span>
          </Link>

          <nav aria-label="Landing sections" className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#how-it-works" className="hover:text-foreground transition-colors">
              How It Works
            </a>
            <a href="#problems" className="hover:text-foreground transition-colors">
              Problems We Solve
            </a>
            <a href="#offerings" className="hover:text-foreground transition-colors">
              What We Offer
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
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              {currentTheme === "dark" ? (
                <Moon className="h-4 w-4" />
              ) : (
                <Sun className="h-4 w-4" />
              )}
            </button>
            <Link href="/login" className={buttonVariants({ size: "sm" })}>
              <span>Sign in</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="mx-auto max-w-6xl px-4 pt-12 pb-10 sm:px-6 sm:pt-16 sm:pb-12">
        <div className="max-w-3xl space-y-5 animate-lutic-fade-up">
          <Badge variant="outline" className="gap-1.5 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Lutic Industrial Operations · lutic.app
          </Badge>

          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-foreground leading-[1.12]">
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
            <a
              href="#how-it-works"
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              <span>See How Lutic Works</span>
            </a>
          </div>

          <div className="grid grid-cols-1 gap-3 pt-4 sm:grid-cols-3 border-t border-border">
            <div className="flex items-center gap-2.5 text-sm">
              <Clock className="h-4 w-4 text-primary shrink-0" />
              <span className="text-muted-foreground">
                <strong className="font-semibold text-foreground">Minutes</strong> to verified root cause
              </span>
            </div>
            <div className="flex items-center gap-2.5 text-sm">
              <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
              <span className="text-muted-foreground">
                <strong className="font-semibold text-foreground">Human sign-off</strong> before floor changes
              </span>
            </div>
            <div className="flex items-center gap-2.5 text-sm">
              <Layers className="h-4 w-4 text-primary shrink-0" />
              <span className="text-muted-foreground">
                <strong className="font-semibold text-foreground">One source of truth</strong> across sites
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Anatomy Showcase */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
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

      {/* Problems We Solve */}
      <section id="problems" className="border-y border-border bg-muted/25 py-14 sm:py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-1.5 max-w-xl">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                Why Plants Lose Hours
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Operational Drags Lutic Eliminates
              </h2>
            </div>

            <div className="inline-flex flex-wrap gap-1.5">
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
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    activeProblem === tab.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {visibleProblems.map((item) => (
              <Card key={item.id} className="p-5 space-y-4 transition-all hover:border-primary/40">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold">{item.title}</h3>
                  <Badge variant="secondary" className="text-[11px]">
                    {item.impact}
                  </Badge>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1.5">
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <XCircle className="h-3.5 w-3.5 text-destructive" />
                      Before Lutic
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{item.before}</p>
                  </div>

                  <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 space-y-1.5">
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      With Lutic
                    </div>
                    <p className="text-xs leading-relaxed text-foreground">{item.after}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* What We Offer */}
      <section id="offerings" className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16 space-y-8">
        <div className="max-w-2xl space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">
            What We Offer
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            One Operating Platform From Line Crew to Plant Leadership
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Every team gets clear workflows built around real plant responsibilities—no steep training curve, and zero disruption to existing shop-floor controls.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {OFFERINGS.map((off) => {
            const Icon = off.Icon;
            return (
              <Card
                key={off.title}
                className="group p-5 space-y-3 transition-all hover:border-primary/50 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-105">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {off.tag}
                      </div>
                      <h3 className="text-base font-semibold text-foreground">{off.title}</h3>
                    </div>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{off.description}</p>
                <ul className="space-y-1.5 pt-1 border-t border-border">
                  {off.points.map((pt) => (
                    <li key={pt} className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Interactive Team Benefits */}
      <section id="teams" className="border-t border-border bg-muted/20 py-14 sm:py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-6">
          <div className="space-y-1.5 max-w-xl">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">
              Tailored By Role
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Built Around How Your Teams Actually Work
            </h2>
          </div>

          <div
            role="tablist"
            aria-label="Operational roles"
            className="flex flex-wrap gap-2"
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
                    "rounded-lg border px-3.5 py-2 text-xs sm:text-sm font-medium transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  )}
                >
                  {profile.role}
                </button>
              );
            })}
          </div>

          <Card className="p-6 grid gap-6 md:grid-cols-[1.2fr_1fr] items-center">
            <div className="space-y-2.5">
              <Badge variant="outline" className="text-[11px]">
                {activeTeam.role}
              </Badge>
              <h3 className="text-xl font-bold tracking-tight text-foreground">
                {activeTeam.headline}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {activeTeam.summary}
              </p>
            </div>
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Measurable Daily Impact
              </div>
              {activeTeam.wins.map((win) => (
                <div key={win} className="flex items-start gap-2 text-sm text-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>{win}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        <Card className="p-6 sm:p-10 flex flex-col gap-5 md:flex-row md:items-center md:justify-between border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card">
          <div className="space-y-2 max-w-xl">
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
        </Card>
      </section>

      <footer className="border-t border-border bg-muted/20 py-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <Factory className="h-3.5 w-3.5 text-primary" />
            <span>Lutic · lutic.app</span>
          </div>
          <div>Role-governed industrial operations platform for manufacturing teams.</div>
        </div>
      </footer>
    </div>
  );
}
