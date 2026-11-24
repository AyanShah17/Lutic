import type { Metadata } from "next";
import { isDemoMode } from "@lutic/core";
import "./globals.css";
import { getSessionUser } from "@/lib/auth";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  metadataBase: new URL("https://lutic.app"),
  title: "Lutic — Industrial Operations Platform",
  description:
    "Lutic turns shop-floor alerts, plant manuals, telemetry, and cross-system operations into fast, verified, human-approved outcomes."
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
