"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Factory, KeyRound, ShieldCheck } from "lucide-react";
import { useAppContext } from "@/components/providers";
import { LuticAuthCard } from "@/components/auth-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AnimatedButton } from "@/components/vengeance/animated-button";

const PERSONA_GROUPS = [
  {
    group: "Plant Floor & Maintenance",
    accounts: [
      {
        email: "engineer@acme.demo",
        role: "engineer",
        plant: "Detroit",
        desc: "Manuals, alarms, work orders, parts. Read-only dashboards."
      },
      {
        email: "austin.engineer@acme.demo",
        role: "engineer",
        plant: "Austin",
        desc: "Scoped strictly to Austin plant assets and telemetry."
      }
    ]
  },
  {
    group: "Analytics & Leadership",
    accounts: [
      {
        email: "analyst@acme.demo",
        role: "analyst",
        plant: "Detroit & Austin",
        desc: "OEE/downtime metrics, visual dashboards, workflow builder."
      },
      {
        email: "manager@acme.demo",
        role: "manager",
        plant: "Detroit & Austin",
        desc: "Multi-plant dashboards, alert triage, and topic publishing."
      }
    ]
  },
  {
    group: "Platform Governance",
    accounts: [
      {
        email: "admin@acme.demo",
        role: "admin",
        plant: "All Plants",
        desc: "Users, RBAC matrix, system connectors, knowledge revisions, license."
      }
    ]
  }
];

export default function LoginPage() {
  const router = useRouter();
  const { refreshSession, demoEnabled, clerkEnabled } = useAppContext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const disabled = !hydrated || loading;

  useEffect(() => {
    setHydrated(true);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setError(err.detail ?? "Sign in failed");
        return;
      }
      await refreshSession();
      router.push("/chat");
      router.refresh();
    } catch {
      setError("Unable to connect. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemo = async (demoEmail: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/demo-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: demoEmail })
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        setError(err.detail ?? "Demo switch failed");
        return;
      }
      await refreshSession();
      router.push("/chat");
      router.refresh();
    } catch {
      setError("Unable to connect. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12 space-y-6">
      <div className="flex items-center gap-3 border-b border-border pb-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Factory className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            Sign in to Lutic
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Role-governed industrial operations AI across manuals, telemetry, workflows, and dashboards.
          </p>
        </div>
      </div>

      <div className={demoEnabled ? "grid gap-6 lg:grid-cols-12 items-start" : "mx-auto max-w-md"}>
        {clerkEnabled ? (
          <div className={demoEnabled ? "lg:col-span-5" : ""}>
            <LuticAuthCard mode="sign-in" />
          </div>
        ) : (
        <Card className={demoEnabled ? "lg:col-span-5" : ""}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              <span>Credentials Sign-In</span>
            </CardTitle>
            <CardDescription>
              Authenticate with tenant email and password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
                >
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email">Work Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  disabled={disabled}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-10"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  disabled={disabled}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-10"
                />
                {demoEnabled && <p className="text-[11px] text-muted-foreground">
                  Dev demo password: <code className="font-mono">lutic-demo-password</code>
                </p>}
              </div>

              <AnimatedButton
                type="submit"
                disabled={disabled}
                className="w-full h-10"
              >
                <span>{loading ? "Signing in..." : "Sign in"}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </AnimatedButton>
            </form>
          </CardContent>
        </Card>
        )}

        {demoEnabled && <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span>Demo Personas by Role &amp; Scope</span>
            </CardTitle>
            <CardDescription>
              Switch directly into any role to verify server-side RBAC, plant isolation, and connector permissions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {PERSONA_GROUPS.map((section) => (
              <div key={section.group} className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.group}
                </div>
                <div className="divide-y divide-border rounded-md border border-border overflow-hidden">
                  {section.accounts.map((u) => (
                    <button
                      key={u.email}
                      type="button"
                      disabled={disabled}
                      onClick={() => handleQuickDemo(u.email)}
                      className="w-full text-left px-3.5 py-2.5 bg-background hover:bg-muted/60 transition-colors flex items-center justify-between gap-3 disabled:opacity-50"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="text-xs font-semibold text-foreground truncate">
                          {u.email}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {u.desc}
                        </div>
                      </div>
                      <Badge variant="secondary" className="shrink-0 uppercase text-[10px]">
                        {u.role} · {u.plant}
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>}
      </div>
    </div>
  );
}
