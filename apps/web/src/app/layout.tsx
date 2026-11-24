import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { isDemoMode } from "@lutic/core";
import "./globals.css";
import { getSessionUser } from "@/lib/auth";
import { isClerkEnabled } from "@/lib/clerk";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  metadataBase: new URL("https://lutic.app"),
  title: "Lutic — AI Systems & Industrial Operations Platform",
  description:
    "Lutic turns shop-floor alerts, enterprise systems, AI automations, agentic dashboards, and multi-agent workflows into verified human-approved outcomes."
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  const clerkEnabled = isClerkEnabled();
  const demoEnabled = isDemoMode() && process.env.ALLOW_DEMO_SWITCH !== "false";

  const content = (
    <Providers initialUser={user} demoEnabled={demoEnabled} clerkEnabled={clerkEnabled}>
      <AppShell>{children}</AppShell>
    </Providers>
  );

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        {clerkEnabled ? (
          <ClerkProvider publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}>
            {content}
          </ClerkProvider>
        ) : (
          content
        )}
      </body>
    </html>
  );
}
