import Link from "next/link";
import { Lock } from "lucide-react";
import { buttonVariants } from "./button";
import { Card } from "./card";

export function AuthGate({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <Card className="p-6 text-center space-y-4">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
          <Lock className="h-4 w-4" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-bold tracking-tight">{title}</h1>
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        </div>
        <Link href="/login" className={buttonVariants({ size: "lg" })}>
          Sign in
        </Link>
      </Card>
    </div>
  );
}
