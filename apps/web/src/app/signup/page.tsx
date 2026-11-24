"use client";

import React from "react";
import Link from "next/link";
import { Factory } from "lucide-react";
import { LuticAuthCard } from "@/components/auth-card";
import { useAppContext } from "@/components/providers";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignupPage() {
  const { clerkEnabled } = useAppContext();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12 space-y-6">
      <div className="flex items-center gap-3 border-b border-border pb-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Factory className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            Get Started with Lutic
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Launch AI automations, agentic dashboards, multi-agent systems, and plant operations on lutic.app.
          </p>
        </div>
      </div>

      {clerkEnabled ? (
        <LuticAuthCard mode="sign-up" />
      ) : (
        <Card className="mx-auto max-w-md">
          <CardHeader>
            <CardTitle>Workspace Invitations</CardTitle>
            <CardDescription>
              Local authentication mode is active. Sign in with credentials issued by your administrator or explore the interactive demo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/login" className={buttonVariants({ className: "w-full" })}>
              Go to Sign In
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
