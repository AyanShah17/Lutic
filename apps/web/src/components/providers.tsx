"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SessionUser } from "@lutic/core";
import { translate, type Locale } from "@/lib/i18n";

interface AppContextValue {
  demoEnabled: boolean;
  user: SessionUser | null;
  setUser: (u: SessionUser | null) => void;
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
  refreshSession: () => Promise<void>;
}

const AppContext = createContext<AppContextValue>({
  demoEnabled: false,
  user: null,
  setUser: () => {},
  locale: "en",
  setLocale: () => {},
  t: (k) => k,
  refreshSession: async () => {}
});

export function useAppContext() {
  return useContext(AppContext);
}

export function Providers({
  children,
  initialUser,
  demoEnabled = false
}: {
  children: React.ReactNode;
  initialUser: SessionUser | null;
  demoEnabled?: boolean;
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

  const refreshSession = async () => {
    const res = await fetch("/api/auth/session", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { user: SessionUser | null };
      setUser(data.user);
    }
  };

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
            user,
            setUser,
            locale,
            setLocale,
            t: (k) => translate(locale, k),
            refreshSession
          }}
        >
          {children}
        </AppContext.Provider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
