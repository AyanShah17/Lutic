"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useClerk } from "@clerk/nextjs";
import type { SessionUser } from "@lutic/core";
import type { SandboxServiceId, TenantSandboxServiceView } from "@lutic/core/sandbox-services";
import { translate, type Locale } from "@/lib/i18n";

export interface OverviewAgentSummaryView {
  scopeId: "overview";
  agentId: string;
  agentName: string;
  activeServiceIds: SandboxServiceId[];
  disabledServiceIds: SandboxServiceId[];
  activeSkills: string[];
}

interface AppContextValue {
  demoEnabled: boolean;
  clerkEnabled: boolean;
  user: SessionUser | null;
  setUser: (u: SessionUser | null) => void;
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
  refreshSession: () => Promise<SessionUser | null>;
  signOutExternal: () => Promise<void>;
  sandboxServices: TenantSandboxServiceView[];
  overviewAgent: OverviewAgentSummaryView | null;
  sandboxLoading: boolean;
  refreshSandboxServices: () => Promise<void>;
  setSandboxServicesState: (
    services: TenantSandboxServiceView[],
    overview?: OverviewAgentSummaryView | null
  ) => void;
}

const AppContext = createContext<AppContextValue>({
  demoEnabled: false,
  clerkEnabled: false,
  user: null,
  setUser: () => {},
  locale: "en",
  setLocale: () => {},
  t: (k) => k,
  refreshSession: async () => null,
  signOutExternal: async () => {},
  sandboxServices: [],
  overviewAgent: null,
  sandboxLoading: false,
  refreshSandboxServices: async () => {},
  setSandboxServicesState: () => {}
});

export function useAppContext() {
  return useContext(AppContext);
}

function ClerkSignOutBridge({
  onReady
}: {
  onReady: (fn: () => Promise<void>) => void;
}) {
  const { signOut } = useClerk();
  useEffect(() => {
    onReady(async () => {
      await signOut({ redirectUrl: "/login" });
    });
  }, [signOut, onReady]);
  return null;
}

export function Providers({
  children,
  initialUser,
  demoEnabled = false,
  clerkEnabled = false
}: {
  children: React.ReactNode;
  initialUser: SessionUser | null;
  demoEnabled?: boolean;
  clerkEnabled?: boolean;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: false
          }
        }
      })
  );
  const [user, setUser] = useState<SessionUser | null>(initialUser);
  const [locale, setLocale] = useState<Locale>("en");
  const [signOutFn, setSignOutFn] = useState<() => Promise<void>>(() => async () => {});
  const [sandboxServices, setSandboxServices] = useState<TenantSandboxServiceView[]>([]);
  const [overviewAgent, setOverviewAgent] = useState<OverviewAgentSummaryView | null>(null);
  const [sandboxLoading, setSandboxLoading] = useState(false);

  const registerSignOut = useCallback((fn: () => Promise<void>) => {
    setSignOutFn(() => fn);
  }, []);

  const setSandboxServicesState = useCallback(
    (services: TenantSandboxServiceView[], overview?: OverviewAgentSummaryView | null) => {
      setSandboxServices(services);
      if (overview !== undefined) setOverviewAgent(overview);
    },
    []
  );

  const refreshSandboxServices = useCallback(async () => {
    setSandboxLoading(true);
    try {
      const res = await fetch("/api/sandbox/services", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          services?: TenantSandboxServiceView[];
          overviewAgent?: OverviewAgentSummaryView;
        };
        if (Array.isArray(data.services)) setSandboxServices(data.services);
        if (data.overviewAgent) setOverviewAgent(data.overviewAgent);
      }
    } catch {
      // ignore transient sandbox fetch failures
    } finally {
      setSandboxLoading(false);
    }
  }, []);

  const refreshSession = useCallback(async (): Promise<SessionUser | null> => {
    const res = await fetch("/api/auth/session", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { user: SessionUser | null };
      setUser(data.user);
      return data.user;
    }
    return null;
  }, []);

  useEffect(() => {
    setUser(initialUser);
  }, [initialUser]);

  useEffect(() => {
    if (!user) {
      setSandboxServices([]);
      setOverviewAgent(null);
      return;
    }
    void refreshSandboxServices();
  }, [user, refreshSandboxServices]);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      themes={["light", "dark", "high-contrast"]}
      enableSystem={false}
    >
      <QueryClientProvider client={queryClient}>
        <AppContext.Provider
          value={{
            demoEnabled,
            clerkEnabled,
            user,
            setUser,
            locale,
            setLocale,
            t: (k) => translate(locale, k),
            refreshSession,
            signOutExternal: signOutFn,
            sandboxServices,
            overviewAgent,
            sandboxLoading,
            refreshSandboxServices,
            setSandboxServicesState
          }}
        >
          {clerkEnabled && <ClerkSignOutBridge onReady={registerSignOut} />}
          {children}
        </AppContext.Provider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
