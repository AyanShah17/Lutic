"use client";

import React, { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { useAppContext } from "./providers";
import { AuthGate } from "./ui/auth-gate";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface LicenseSnapshot {
  enforced: boolean;
  status: string;
  active: boolean;
  plan: string;
  expiresAt: string | null;
  keyHint: string;
  serverUrl: string;
  instanceId: string;
  lastVerifiedAt: string | null;
  activatedAt: string | null;
  reason: string;
}

export function ActivateLicensePanel() {
  const { user } = useAppContext();
  const [snapshot, setSnapshot] = useState<LicenseSnapshot | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const loadStatus = async (verify = false) => {
    const res = await fetch(verify ? "/api/license?verify=true" : "/api/license", {
      cache: "no-store"
    });
    if (res.ok) {
      const data = (await res.json()) as LicenseSnapshot;
      setSnapshot(data);
      if (!serverUrl && data.serverUrl) {
        setServerUrl(data.serverUrl);
      }
    }
  };

  useEffect(() => {
    loadStatus(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseKey.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: licenseKey.trim(),
          ...(serverUrl.trim() ? { serverUrl: serverUrl.trim() } : {})
        })
      });
      const data = (await res.json()) as {
        valid?: boolean;
        detail?: string;
        license?: LicenseSnapshot;
      };
      if (res.ok && data.license) {
        setSnapshot(data.license);
        setLicenseKey("");
        setMsg({ kind: "ok", text: "License activated successfully." });
      } else {
        setMsg({
          kind: "err",
          text: data.detail ?? "License activation failed."
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDeactivate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/license", { method: "DELETE" });
      if (res.ok) {
        await loadStatus(false);
        setMsg({ kind: "ok", text: "License deactivated." });
      } else {
        const d = (await res.json()) as { detail?: string };
        setMsg({ kind: "err", text: d.detail ?? "Failed to deactivate license." });
      }
    } finally {
      setBusy(false);
    }
  };

  const isAdmin = user?.role === "admin";

  if (!user) {
    return (
      <AuthGate
        title="Sign in to view License Activation"
        description="Instance licensing and online verification are restricted to authenticated tenant governance sessions."
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <KeyRound className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold">Lutic License Status</h2>
              <p className="text-xs text-muted-foreground">
                Online license verification against your configured license server.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={snapshot?.active ? "success" : "warning"}
              className="uppercase"
            >
              {snapshot?.active ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5" />
              )}
              <span>{snapshot?.status ?? "loading"}</span>
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadStatus(true)}
              disabled={busy}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Re-verify</span>
            </Button>
          </div>
        </div>

        {snapshot && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            <div className="rounded-md border border-border bg-background p-3">
              <div className="text-[11px] text-muted-foreground">Plan &amp; Enforcement</div>
              <div className="font-semibold mt-0.5">
                {snapshot.plan || "Unassigned"} ·{" "}
                {snapshot.enforced ? "Enforced" : "Dev Bypass"}
              </div>
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <div className="text-[11px] text-muted-foreground">Key Hint</div>
              <div className="font-mono font-semibold mt-0.5 tabular-nums">
                {snapshot.keyHint || "None"}
              </div>
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <div className="text-[11px] text-muted-foreground">Instance ID</div>
              <div className="font-mono font-semibold mt-0.5 truncate">
                {snapshot.instanceId}
              </div>
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <div className="text-[11px] text-muted-foreground">Expires</div>
              <div className="font-mono font-semibold mt-0.5 tabular-nums">
                {snapshot.expiresAt
                  ? new Date(snapshot.expiresAt).toLocaleDateString()
                  : "—"}
              </div>
            </div>
          </div>
        )}

        {snapshot?.reason && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-200">
            {snapshot.reason}
          </div>
        )}
      </Card>

      {msg && (
        <div
          className={`rounded-md border px-3 py-2 text-xs font-semibold ${
            msg.kind === "ok"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              : "border-red-300 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200"
          }`}
        >
          {msg.text}
        </div>
      )}

      {isAdmin ? (
        <Card className="p-5">
          <form onSubmit={handleActivate} className="space-y-4">
            <h3 className="text-sm font-semibold">Activate or Update License Key</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="license-key-input">License Key</Label>
                <Input
                  id="license-key-input"
                  required
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder="LUTIC-DEV-VALID-0001"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="license-server-url-input">License Server URL</Label>
                <Input
                  id="license-server-url-input"
                  type="url"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://localhost:4100"
                  className="font-mono"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Activating..." : "Activate License"}
              </Button>
              <Button
                variant="outline"
                onClick={handleDeactivate}
                disabled={busy}
                className="text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Deactivate</span>
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Card className="p-4 text-xs text-muted-foreground">
          Only users with the <strong>admin</strong> role can activate or deactivate instance licenses.
        </Card>
      )}
    </div>
  );
}
