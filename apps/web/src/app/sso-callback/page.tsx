"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { Factory } from "lucide-react";
import { useAppContext } from "@/components/providers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SsoCallbackPage() {
  const router = useRouter();
  const { clerkEnabled } = useAppContext();

  useEffect(() => {
    if (!clerkEnabled) {
      router.replace("/login");
    }
  }, [clerkEnabled, router]);

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Factory className="h-4 w-4 text-primary" />
            <span>Signing you in to Lutic</span>
          </CardTitle>
          <CardDescription>
            Completing your secure sign-in and preparing your workspace...
          </CardDescription>
        </CardHeader>
        <CardContent>
          {clerkEnabled ? (
            <AuthenticateWithRedirectCallback
              signInForceRedirectUrl="/"
              signUpForceRedirectUrl="/"
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
