"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound } from "lucide-react";
import { useAppContext } from "@/components/providers";
import { LuticAuthCard } from "@/components/auth-card";
import { LuticLogo } from "@/components/lutic-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AnimatedButton } from "@/components/vengeance/animated-button";

export default function LoginPage() {
  const router = useRouter();
  const { refreshSession, clerkEnabled } = useAppContext();
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border pb-5">
        <div className="flex items-center gap-3">
          <LuticLogo className="h-9 w-9" />
          <div>
            <h1 className="text-2xl font-medium tracking-tight">
              Sign in to Lutic
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Sign in to continue in your persistent Lutic AI workspace.
            </p>
          </div>
        </div>
        <Link
          href="/signup"
          className="text-xs font-medium text-primary hover:underline shrink-0"
        >
          New to Lutic? Start free
        </Link>
      </div>

      <div className="mx-auto max-w-md">
        {clerkEnabled ? (
          <LuticAuthCard mode="sign-in" />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-medium">
                <KeyRound className="h-4 w-4 text-primary" />
                <span>Sign in with Email</span>
              </CardTitle>
              <CardDescription>
                Access your saved AI workflows, boards, dashboards, and connectors.
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
                </div>

                <AnimatedButton
                  type="submit"
                  disabled={disabled}
                  className="w-full h-10"
                >
                  <span>{loading ? "Signing in..." : "Sign in"}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </AnimatedButton>

                <div className="pt-2 border-t border-border text-center text-xs text-muted-foreground">
                  New to Lutic?{" "}
                  <Link href="/signup" className="text-primary font-medium hover:underline">
                    Create a free workspace
                  </Link>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
