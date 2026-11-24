"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useClerk } from "@clerk/nextjs";
import type { SessionUser } from "@lutic/core";
import { translate, type Locale } from "@/lib/i18n";

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
  signOutExternal: async () => {}
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

  const registerSignOut = useCallback((fn: () => Promise<void>) => {
    setSignOutFn(() => fn);
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
            signOutExternal: signOutFn
          }}
        >
          {clerkEnabled && <ClerkSignOutBridge onReady={registerSignOut} />}
          {children}
        </AppContext.Provider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
