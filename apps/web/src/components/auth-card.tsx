"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useClerk, useSignIn, useSignUp, useUser } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { ArrowRight, KeyRound, Lock, LogOut, MailCheck } from "lucide-react";
import { useAppContext } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AnimatedButton } from "@/components/vengeance/animated-button";

type OAuthStrategy = "oauth_google" | "oauth_microsoft";

function getConfiguredOAuthProviders(): Array<{ id: "google" | "microsoft"; label: string; strategy: OAuthStrategy }> {
  const raw = (process.env.NEXT_PUBLIC_CLERK_OAUTH_PROVIDERS ?? "google,microsoft")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const providers: Array<{ id: "google" | "microsoft"; label: string; strategy: OAuthStrategy }> = [];
  if (raw.includes("google")) {
    providers.push({ id: "google", label: "Continue with Google", strategy: "oauth_google" });
  }
  if (raw.includes("microsoft")) {
    providers.push({ id: "microsoft", label: "Continue with Microsoft", strategy: "oauth_microsoft" });
  }
  return providers;
}

function readClerkError(err: unknown): string {
  if (isClerkAPIResponseError(err)) {
    return err.errors[0]?.longMessage ?? err.errors[0]?.message ?? "Authentication failed.";
  }
  if (err instanceof Error) return err.message;
  return "Authentication failed. Please try again.";
}

export function LuticAuthCard({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const { user, refreshSession } = useAppContext();
  const { signOut } = useClerk();
  const { isLoaded: userLoaded, isSignedIn, user: clerkUser } = useUser();
  const { isLoaded: signInLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const { isLoaded: signUpLoaded, signUp, setActive: setSignUpActive } = useSignUp();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [step, setStep] = useState<"credentials" | "verify_email" | "forgot_request" | "forgot_verify">("credentials");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkingWorkspace, setCheckingWorkspace] = useState(false);

  const providers = getConfiguredOAuthProviders();

  useEffect(() => {
    if (!userLoaded || !isSignedIn) return;
    if (user) {
      router.replace("/");
      return;
    }
    let active = true;
    setCheckingWorkspace(true);
    void refreshSession()
      .then((resolved) => {
        if (active && resolved) {
          router.replace("/");
        }
      })
      .finally(() => {
        if (active) setCheckingWorkspace(false);
      });
    return () => {
      active = false;
    };
  }, [userLoaded, isSignedIn, user, refreshSession, router]);

  const finishSession = async (sessionId: string | null, modeUsed: "sign-in" | "sign-up") => {
    if (modeUsed === "sign-in" && setSignInActive) {
      await setSignInActive({ session: sessionId });
    } else if (modeUsed === "sign-up" && setSignUpActive) {
      await setSignUpActive({ session: sessionId });
    }
    const resolved = await refreshSession();
    if (resolved) {
      router.push("/");
      router.refresh();
    }
  };

  const handleOAuth = async (strategy: OAuthStrategy) => {
    setError(null);
    setBusy(true);
    try {
      if (mode === "sign-in") {
        if (!signInLoaded || !signIn) return;
        await signIn.authenticateWithRedirect({
          strategy,
          redirectUrl: "/sso-callback",
          redirectUrlComplete: "/"
        });
      } else {
        if (!signUpLoaded || !signUp) return;
        await signUp.authenticateWithRedirect({
          strategy,
          redirectUrl: "/sso-callback",
          redirectUrlComplete: "/"
        });
      }
    } catch (err) {
      setError(readClerkError(err));
      setBusy(false);
    }
  };

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signInLoaded || !signIn) return;
    setError(null);
    setBusy(true);
    try {
      const attempt = await signIn.create({ identifier: email.trim(), password });
      if (attempt.status === "complete") {
        await finishSession(attempt.createdSessionId, "sign-in");
      } else {
        setError("Additional verification is required to sign in.");
      }
    } catch (err) {
      setError(readClerkError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signUpLoaded || !signUp) return;
    setError(null);
    setBusy(true);
    try {
      const parts = fullName.trim().split(/\s+/).filter(Boolean);
      const firstName = parts[0] ?? undefined;
      const lastName = parts.length > 1 ? parts.slice(1).join(" ") : undefined;
      const attempt = await signUp.create({
        firstName,
        lastName,
        emailAddress: email.trim(),
        password
      });
      if (attempt.status === "complete") {
        await finishSession(attempt.createdSessionId, "sign-up");
      } else {
        await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
        setStep("verify_email");
        setNotice(`Enter the 6-digit verification code sent to ${email.trim()}.`);
      }
    } catch (err) {
      setError(readClerkError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signUpLoaded || !signUp) return;
    setError(null);
    setBusy(true);
    try {
      const attempt = await signUp.attemptEmailAddressVerification({ code: code.trim() });
      if (attempt.status === "complete") {
        await finishSession(attempt.createdSessionId, "sign-up");
      } else {
        setError("Verification incomplete. Please check your code.");
      }
    } catch (err) {
      setError(readClerkError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleForgotRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signInLoaded || !signIn) return;
    setError(null);
    setBusy(true);
    try {
      await signIn.create({ strategy: "reset_password_email_code", identifier: email.trim() });
      setStep("forgot_verify");
      setNotice(`Password reset code sent to ${email.trim()}.`);
    } catch (err) {
      setError(readClerkError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleForgotReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signInLoaded || !signIn) return;
    setError(null);
    setBusy(true);
    try {
      const attempt = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code: code.trim(),
        password: newPassword
      });
      if (attempt.status === "complete") {
        await finishSession(attempt.createdSessionId, "sign-in");
      } else {
        setError("Password reset requires additional verification.");
      }
    } catch (err) {
      setError(readClerkError(err));
    } finally {
      setBusy(false);
    }
  };

  if (userLoaded && isSignedIn && !user) {
    const activeEmail = clerkUser?.primaryEmailAddress?.emailAddress ?? email;
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            <span>{checkingWorkspace ? "Preparing Workspace" : "Access Pending"}</span>
          </CardTitle>
          <CardDescription>
            {checkingWorkspace
              ? "Verifying your Lutic workspace permissions..."
              : `This Enterprise Lutic workspace requires an administrator invitation for ${activeEmail || "your email"}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!checkingWorkspace && (
            <Button
              variant="outline"
              className="w-full"
              onClick={async () => {
                await signOut({ redirectUrl: "/login" });
              }}
            >
              <LogOut className="h-4 w-4" />
              <span>Sign out and use another account</span>
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-md rounded-xl">
      <CardHeader className="border-b border-border/60 pb-3.5">
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <span>
            {step === "verify_email"
              ? "Verify Your Email"
              : step === "forgot_request" || step === "forgot_verify"
                ? "Reset Password"
                : mode === "sign-up"
                  ? "Create Lutic Account"
                  : "Sign in to Lutic"}
          </span>
        </CardTitle>
        <CardDescription>
          {step === "verify_email"
            ? "Confirm your email address to launch your Lutic workspace."
            : mode === "sign-up"
              ? "Start with Google, Microsoft, or work email on Free / Individual, or join your invited Enterprise workspace."
              : "Authenticate with Google, Microsoft, or your Lutic account credentials."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
          >
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-medium text-foreground">
            {notice}
          </div>
        )}

        {step === "credentials" && providers.length > 0 && (
          <>
            <div className="grid gap-2">
              {providers.map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  variant="outline"
                  className="w-full h-10 justify-center font-medium"
                  disabled={busy}
                  onClick={() => void handleOAuth(p.strategy)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-border" />
              <span className="mx-3 text-[11px] uppercase tracking-wider text-muted-foreground">
                or email
              </span>
              <div className="flex-grow border-t border-border" />
            </div>
          </>
        )}

        {step === "verify_email" && (
          <form onSubmit={handleVerifyEmail} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="otp-code">Verification Code</Label>
              <Input
                id="otp-code"
                required
                inputMode="numeric"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="h-10 font-mono"
              />
            </div>
            <AnimatedButton type="submit" disabled={busy} className="w-full h-10">
              <MailCheck className="h-4 w-4" />
              <span>{busy ? "Verifying..." : "Verify & Continue"}</span>
            </AnimatedButton>
          </form>
        )}

        {step === "forgot_request" && (
          <form onSubmit={handleForgotRequest} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reset-email">Account Email</Label>
              <Input
                id="reset-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10"
              />
            </div>
            <AnimatedButton type="submit" disabled={busy} className="w-full h-10">
              <span>{busy ? "Sending..." : "Send Reset Code"}</span>
            </AnimatedButton>
            <Button
              type="button"
              variant="ghost"
              className="w-full text-xs"
              onClick={() => {
                setStep("credentials");
                setError(null);
              }}
            >
              Back to Sign In
            </Button>
          </form>
        )}

        {step === "forgot_verify" && (
          <form onSubmit={handleForgotReset} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reset-code">Reset Code</Label>
              <Input
                id="reset-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="h-10 font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reset-password">New Password</Label>
              <Input
                id="reset-password"
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-10"
              />
            </div>
            <AnimatedButton type="submit" disabled={busy} className="w-full h-10">
              <span>{busy ? "Updating..." : "Reset Password & Sign In"}</span>
            </AnimatedButton>
          </form>
        )}

        {step === "credentials" && mode === "sign-in" && (
          <form onSubmit={handleSignInSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="clerk-email">Work Email</Label>
              <Input
                id="clerk-email"
                type="email"
                autoComplete="email"
                disabled={busy}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="clerk-password">Password</Label>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                    setStep("forgot_request");
                  }}
                  className="text-[11px] text-primary hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <Input
                id="clerk-password"
                type="password"
                autoComplete="current-password"
                disabled={busy}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10"
              />
            </div>
            <AnimatedButton type="submit" disabled={busy} className="w-full h-10">
              <span>{busy ? "Signing in..." : "Sign in"}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </AnimatedButton>
          </form>
        )}

        {step === "credentials" && mode === "sign-up" && (
          <form onSubmit={handleSignUpSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="clerk-name">Full Name</Label>
              <Input
                id="clerk-name"
                required
                disabled={busy}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="clerk-signup-email">Work Email</Label>
              <Input
                id="clerk-signup-email"
                type="email"
                autoComplete="email"
                required
                disabled={busy}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="clerk-signup-password">Password</Label>
              <Input
                id="clerk-signup-password"
                type="password"
                autoComplete="new-password"
                required
                disabled={busy}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10"
              />
            </div>
            <div id="clerk-captcha" />
            <AnimatedButton type="submit" disabled={busy} className="w-full h-10">
              <span>{busy ? "Creating account..." : "Create Account"}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </AnimatedButton>
          </form>
        )}

        <div className="pt-2 border-t border-border text-center text-xs text-muted-foreground">
          {mode === "sign-in" ? (
            <>
              New to Lutic?{" "}
              <Link href="/signup" className="text-primary font-medium hover:underline">
                Create a free account
              </Link>
            </>
          ) : (
            <>
              Already have a workspace?{" "}
              <Link href="/login" className="text-primary font-medium hover:underline">
                Sign in
              </Link>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
