"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  Kanban,
  KeyRound,
  Plug,
  ShieldCheck,
  Workflow
} from "lucide-react";
import { LuticAuthCard } from "@/components/auth-card";
import { LuticLogo } from "@/components/lutic-logo";
import { useAppContext } from "@/components/providers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AnimatedButton } from "@/components/vengeance/animated-button";

const PROVISIONED_CAPABILITIES = [
  {
    title: "Dedicated Isolated Tenant",
    detail: "Private PostgreSQL RLS tenant & persistent workspace saved across every login session.",
    Icon: ShieldCheck
  },
  {
    title: "AI Canvas & Autonomous Agents",
    detail: "Visual workflow DAG builder, Floating AI Copilot, and Agent HITL Before/After verification.",
    Icon: Workflow
  },
  {
    title: "AI Dashboard & AI Board",
    detail: "Governed semantic KPI scorecards plus Kanban/List boards pre-loaded to customize.",
    Icon: BarChart3
  },
  {
    title: "2,100+ Connectors & IAM",
    detail: "Encrypted credential vault, core agent toolkits, and role-scoped permissions ready day one.",
    Icon: Plug
  }
];

export default function SignupPage() {
  const router = useRouter();
  const { clerkEnabled, refreshSession } = useAppContext();
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const disabled = !hydrated || loading;

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, workspaceName, email, password })
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setError(err.detail ?? "Unable to create workspace");
        return;
      }
      await refreshSession();
      router.push("/");
      router.refresh();
    } catch {
      setError("Unable to connect. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div className="flex items-center gap-3">
          <LuticLogo className="h-9 w-9" />
          <div>
            <h1 className="text-2xl sm:text-3xl font-medium tracking-tight">
              Launch Your Lutic AI PaaS Tenant
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Sign up to provision a dedicated, persistent AI workspace across AI Canvas, AI Board, Connectors, and Agents.
            </p>
          </div>
        </div>
        <Link
          href="/login"
          className="text-xs font-medium text-muted-foreground hover:text-primary transition-colors shrink-0"
        >
          Already have a workspace? Sign in
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-12 items-start">
        <div className="lg:col-span-6">
          {clerkEnabled ? (
            <LuticAuthCard mode="sign-up" />
          ) : (
            <Card>
              <CardHeader className="border-b border-border/60 pb-4">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                  <KeyRound className="h-4 w-4 text-primary" />
                  <span>Create Your Tenant Workspace</span>
                </CardTitle>
                <CardDescription>
                  Your workspace, workflows, boards, connectors, and AI configurations persist across every session.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-5">
                <form onSubmit={handleSignup} className="space-y-4">
                  {error && (
                    <div
                      role="alert"
                      className="rounded-xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs font-medium text-destructive"
                    >
                      {error}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="signup-name">Full Name</Label>
                    <Input
                      id="signup-name"
                      type="text"
                      autoComplete="name"
                      placeholder="Alex Rivera"
                      disabled={disabled}
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="signup-workspace">Workspace / Company Name (optional)</Label>
                    <Input
                      id="signup-workspace"
                      type="text"
                      autoComplete="organization"
                      placeholder="Acme Automation Studio"
                      disabled={disabled}
                      value={workspaceName}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="signup-email">Work Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      autoComplete="email"
                      placeholder="alex@company.com"
                      disabled={disabled}
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="signup-password">Password (min 8 characters)</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      autoComplete="new-password"
                      disabled={disabled}
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-10"
                    />
                  </div>

                  <AnimatedButton type="submit" disabled={disabled} className="w-full h-10">
                    <span>{loading ? "Provisioning workspace..." : "Create Workspace"}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </AnimatedButton>

                  <div className="pt-2 border-t border-border text-center text-xs text-muted-foreground">
                    Already provisioned?{" "}
                    <Link href="/login" className="text-primary font-medium hover:underline">
                      Sign in to continue
                    </Link>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="lg:col-span-6 space-y-4">
          <div className="rounded-3xl border border-border bg-card p-6 space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-primary">
              <Bot className="h-3.5 w-3.5" />
              <span>Included In Every Tenant</span>
            </div>
            <h2 className="text-xl font-medium tracking-tight">
              Full-stack AI PaaS, persisted end-to-end.
            </h2>
            <div className="grid gap-3">
              {PROVISIONED_CAPABILITIES.map((cap) => {
                const Icon = cap.Icon;
                return (
                  <div
                    key={cap.title}
                    className="flex items-start gap-3 rounded-2xl border border-border/80 bg-muted/35 p-3.5"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="space-y-0.5">
                      <div className="text-xs font-semibold text-foreground">{cap.title}</div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{cap.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border/70 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                <span>AI Board + Starter Workflows</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Kanban className="h-3.5 w-3.5 text-primary" />
                <span>Custom AI &amp; Automation Ready</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
