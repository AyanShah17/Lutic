import { KeyRound } from "lucide-react";
import { ActivateLicensePanel } from "@/components/activate-license-panel";

export default function ActivatePage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 space-y-5">
      <div className="border-b border-border pb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Platform Governance
        </div>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          <span>Lutic License Activation</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Manage your client deployment license key and online verification state.
        </p>
      </div>
      <ActivateLicensePanel />
    </div>
  );
}
