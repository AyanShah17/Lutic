import type { Metadata } from "next";
import { isDemoMode } from "@kojo/core";
import "./globals.css";
import { getSessionUser } from "@/lib/auth";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Kojo — Industrial Operations AI",
  description:
    "Role-governed industrial AI operations platform across manuals, telemetry, workflows, connectors, messaging, and semantic dashboards."
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers initialUser={user} demoEnabled={isDemoMode() && process.env.ALLOW_DEMO_SWITCH !== "false"}>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
