"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Activity,
  BarChart3,
  Bell,
  ChevronRight,
  Cpu,
  GitBranch,
  Globe,
  Home,
  Kanban,
  KeyRound,
  Layers,
  LogOut,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Search,
  Sun,
  X
} from "lucide-react";
import { getNavGroupsForUser } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useAppContext } from "./providers";
import { CommandSearch } from "./command-search";
import { FloatingAiAssistant } from "./floating-ai-assistant";
import { LuticLogo } from "./lutic-logo";
import { Badge } from "./ui/badge";
import { Button, buttonVariants } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";

const NAV_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  overview: Home,
  board: Kanban,
  chat: MessageSquare,
  machines: Cpu,
  monitoring: Activity,
  dashboards: BarChart3,
  workflows: GitBranch,
  connectors: Plug,
  notifications: Bell,
  queues: Layers
};

interface NavNotification {
  id: string;
  title: string;
  body: string;
  severity: string;
  read: boolean;
  createdAt: string;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    user,
    locale,
    setLocale,
    t,
    refreshSession,
    setUser,
    signOutExternal,
    clerkEnabled = false,
    sandboxServices = [],
    planLimits = null
  } = useAppContext();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const [notifs, setNotifs] = useState<NavNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if (e.key === "Escape" && bellOpen) {
        setBellOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bellOpen]);

  useEffect(() => {
    if (!bellOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [bellOpen]);

  const activeTheme = mounted ? (theme ?? "light") : "light";
  const enabledServiceIds =
    sandboxServices.length > 0
      ? sandboxServices.filter((s) => s.enabled).map((s) => s.id)
      : undefined;
  const navGroups = getNavGroupsForUser(user, t, enabledServiceIds);

  const activeEntry = (() => {
    for (const group of navGroups) {
      for (const item of group.items) {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href ||
              pathname.startsWith(`${item.href}/`) ||
              (item.id === "machines" && pathname.startsWith("/m/"));
        if (active) return { group: group.label, item: item.label };
      }
    }
    return { group: "Lutic", item: "Workspace" };
  })();

  const loadNotifications = async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          notifications: NavNotification[];
          unreadCount: number;
        };
        setNotifs(data.notifications.slice(0, 8));
        setUnreadCount(data.unreadCount);
      }
    } catch {
      // ignore transient poll failures
    }
  };

  useEffect(() => {
    if (!user) {
      setNotifs([]);
      setUnreadCount(0);
      return;
    }
    void loadNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.userId, user?.role]);

  const markAllRead = async () => {
    const res = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAll: true, read: true })
    });
    if (res.ok) {
      await loadNotifications();
    }
  };

  const handleLogout = async () => {
    try {
      await signOutExternal();
    } catch {
      // Ignore external sign-out errors so local cleanup always runs.
    }
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setMobileOpen(false);
    router.push("/login");
    router.refresh();
  };

  const cycleTheme = () => {
    const next =
      activeTheme === "light"
        ? "dark"
        : activeTheme === "dark"
          ? "high-contrast"
          : "light";
    setTheme(next);
  };

  const isAuthPage =
    (pathname === "/login" || pathname === "/signup" || pathname === "/sso-callback") &&
    !user;

  if (pathname === "/" && !user) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-primary-foreground focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Skip to main content
        </a>
        <main id="main-content" tabIndex={-1} className="min-h-screen focus:outline-none">
          {children}
        </main>
      </div>
    );
  }

  const renderSidebarNav = (onNavigate?: () => void, compact = false) => (
    <div className="flex flex-col h-full">
      <div className="flex h-13 items-center justify-between border-b border-sidebar-border/70 px-3.5 shrink-0 py-3">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-2.5 min-w-0"
        >
          <LuticLogo className="h-7 w-7" />
          {!compact && (
            <div className="min-w-0 flex items-baseline gap-1.5">
              <span className="text-sm font-semibold tracking-tight text-foreground">
                Lutic
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">app</span>
            </div>
          )}
        </Link>
        {!compact && onNavigate && (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="Close navigation menu"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav
        aria-label="Main navigation"
        className="flex-1 overflow-y-auto px-2.5 py-2.5 space-y-3"
      >
        {navGroups.map((group) => (
          <div key={group.id} className="space-y-0.5">
            {!compact && (
              <div className="px-2.5 py-1 text-[11px] font-medium text-muted-foreground/80">
                {group.label}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = NAV_ICONS[item.id] ?? Home;
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href ||
                      pathname.startsWith(`${item.href}/`) ||
                      (item.id === "machines" && pathname.startsWith("/m/"));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    title={compact ? item.label : undefined}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-[color,background-color] duration-150 min-h-[32px]",
                      compact && "justify-center px-0",
                      active
                        ? "bg-foreground/[0.06] dark:bg-foreground/[0.08] text-foreground"
                        : "text-sidebar-foreground/75 hover:bg-foreground/[0.035] hover:text-foreground"
                    )}
                  >
                    {active && !compact && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-primary"
                      />
                    )}
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0 transition-colors",
                        active
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-foreground"
                      )}
                    />
                    {!compact && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
        {user && !compact && sandboxServices.length > 0 && (
          <div className="pt-2">
            <Link
              href="/"
              onClick={onNavigate}
              className="flex items-center justify-between gap-2 rounded-md border border-sidebar-border/80 bg-muted/25 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <span>Manage Services</span>
              <span className="font-mono text-[10px]">
                {sandboxServices.filter((s) => s.enabled).length}/{planLimits?.maxServices ?? sandboxServices.length}
              </span>
            </Link>
          </div>
        )}
      </nav>

      {user && (
        <div className="border-t border-sidebar-border/70 p-3 shrink-0">
          <div
            className={cn(
              "flex items-center gap-2 px-0.5",
              compact ? "justify-center" : "justify-between"
            )}
          >
            {!compact && (
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate">{user.name}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {user.email}
                </div>
              </div>
            )}
            <div className="flex items-center gap-1 shrink-0">
              {!clerkEnabled && (
                <button
                  type="button"
                  onClick={() => {
                    onNavigate?.();
                    setPwError(null);
                    setPwSuccess(null);
                    setPwOpen(true);
                  }}
                  title="Change password"
                  aria-label="Change password"
                  className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 transition-colors"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={handleLogout}
                title="Sign out"
                aria-label="Sign out"
                className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-primary-foreground focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      {!isAuthPage && (
        <aside
          className={cn(
            "no-print hidden lg:flex shrink-0 flex-col border-r border-sidebar-border/70 bg-sidebar transition-[width] duration-150 sticky top-0 h-screen",
            collapsed ? "w-14" : "w-56"
          )}
        >
          {renderSidebarNav(undefined, collapsed)}
        </aside>
      )}

      {!isAuthPage && (
        <Dialog
          open={mobileOpen}
          onOpenChange={setMobileOpen}
          variant="drawer-left"
          ariaLabel="Navigation menu"
          className="no-print lg:hidden bg-sidebar p-0"
        >
          {renderSidebarNav(() => setMobileOpen(false), false)}
        </Dialog>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="no-print sticky top-0 z-40 h-13 py-2 border-b border-border/70 bg-background/85 backdrop-blur-md px-3 sm:px-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {!isAuthPage ? (
              <>
                <button
                  type="button"
                  onClick={() => setMobileOpen(true)}
                  aria-label="Toggle mobile menu"
                  className="lg:hidden inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-muted min-h-[34px] min-w-[34px]"
                >
                  <Menu className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setCollapsed((v) => !v)}
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  className="hidden lg:inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  {collapsed ? (
                    <PanelLeftOpen className="h-4 w-4" />
                  ) : (
                    <PanelLeftClose className="h-4 w-4" />
                  )}
                </button>
                <div className="flex items-center gap-1.5 text-xs min-w-0">
                  <span className="text-muted-foreground hidden sm:inline">
                    {activeEntry.group}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/70 hidden sm:inline shrink-0" />
                  <span className="font-medium text-foreground truncate">
                    {activeEntry.item}
                  </span>
                </div>
              </>
            ) : (
              <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                <LuticLogo className="h-7 w-7" />
                <span className="text-sm">Lutic</span>
              </Link>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!isAuthPage && (
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                aria-label="Open global search"
                className="inline-flex items-center gap-2 rounded-md border border-border/80 bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 min-h-[32px] transition-colors"
              >
                <Search className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Search workspace...</span>
                <kbd className="hidden sm:inline rounded border border-border/80 bg-background px-1 py-0.5 font-mono text-[10px] leading-none">
                  Cmd+K
                </kbd>
              </button>
            )}

            {user && (
              <div ref={bellRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    const next = !bellOpen;
                    setBellOpen(next);
                    if (next) void loadNotifications();
                  }}
                  aria-expanded={bellOpen}
                  aria-label="Toggle notifications"
                  className="relative inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-muted min-h-[32px] min-w-[32px] transition-colors"
                >
                  <Bell className="h-3.5 w-3.5" />
                  {unreadCount > 0 && (
                    <span className="absolute right-0.5 top-0.5 rounded-full bg-destructive px-1 py-0 text-[9px] font-bold leading-tight text-destructive-foreground tabular-nums">
                      {unreadCount}
                    </span>
                  )}
                </button>
                {bellOpen && (
                  <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card p-3 shadow-xl z-50 space-y-2.5 animate-lutic-modal">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>Notifications ({unreadCount} unread)</span>
                      <button
                        type="button"
                        onClick={markAllRead}
                        className="text-primary hover:underline text-[11px] font-medium"
                      >
                        Mark all read
                      </button>
                    </div>
                    <div className="max-h-64 overflow-y-auto space-y-1.5">
                      {notifs.length === 0 ? (
                        <div className="text-xs text-muted-foreground py-4 text-center">
                          No notifications yet.
                        </div>
                      ) : (
                        notifs.map((n) => (
                          <div
                            key={n.id}
                            className={cn(
                              "rounded-lg border p-2.5 text-xs space-y-0.5",
                              n.read
                                ? "border-border/60 opacity-75"
                                : "border-primary/35 bg-primary/5"
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold truncate">{n.title}</span>
                              <Badge variant="outline" className="text-[10px] uppercase">
                                {n.severity}
                              </Badge>
                            </div>
                            <div className="text-muted-foreground line-clamp-2">{n.body}</div>
                          </div>
                        ))
                      )}
                    </div>
                    <Link
                      href="/notifications"
                      onClick={() => setBellOpen(false)}
                      className="block w-full rounded-md border border-border bg-muted/50 py-1.5 text-center text-xs font-medium hover:bg-muted"
                    >
                      Open Notifications &amp; Queues
                    </Link>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={cycleTheme}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted min-h-[32px] transition-colors"
              title="Switch theme (Light / Dark / High-Contrast)"
              aria-label="Switch display theme"
            >
              {activeTheme === "dark" ? (
                <Moon className="h-3.5 w-3.5" />
              ) : activeTheme === "high-contrast" ? (
                <Monitor className="h-3.5 w-3.5" />
              ) : (
                <Sun className="h-3.5 w-3.5" />
              )}
              <span className="hidden xl:inline capitalize">{activeTheme}</span>
            </button>

            <button
              type="button"
              onClick={() => setLocale(locale === "en" ? "es" : "en")}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted min-h-[32px] transition-colors"
              aria-label="Toggle language"
            >
              <Globe className="h-3.5 w-3.5" />
              <span>{locale.toUpperCase()}</span>
            </button>

            {!user && pathname !== "/login" && (
              <Link href="/login" className={buttonVariants({ size: "sm" })}>
                Sign in
              </Link>
            )}
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 focus:outline-none">
          {children}
        </main>
      </div>

      {!isAuthPage && <FloatingAiAssistant />}
      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />

      <Dialog
        open={pwOpen}
        onOpenChange={(open) => {
          setPwOpen(open);
          if (!open) {
            setCurrentPw("");
            setNewPw("");
            setConfirmPw("");
            setPwError(null);
            setPwSuccess(null);
          }
        }}
        ariaLabel="Change account password"
        className="max-w-sm p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Change Password</h2>
            <p className="text-xs text-muted-foreground">
              Updating your password revokes all prior sessions for your account.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPwOpen(false)}
            aria-label="Close change password dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setPwError(null);
            setPwSuccess(null);
            if (newPw !== confirmPw) {
              setPwError("New password confirmation does not match.");
              return;
            }
            setPwSaving(true);
            try {
              const res = await fetch("/api/auth/change-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw })
              });
              const data = (await res.json()) as { detail?: string };
              if (!res.ok) {
                setPwError(data.detail ?? "Password change failed.");
                return;
              }
              setCurrentPw("");
              setNewPw("");
              setConfirmPw("");
              setPwSuccess("Password updated. Existing sessions were revoked.");
              await refreshSession();
            } catch {
              setPwError("Unable to change password right now.");
            } finally {
              setPwSaving(false);
            }
          }}
          className="space-y-3"
        >
          {pwError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {pwError}
            </div>
          )}
          {pwSuccess && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
              {pwSuccess}
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="app-shell-current-pw">
              Current Password
            </label>
            <Input
              id="app-shell-current-pw"
              type="password"
              required
              autoComplete="current-password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="app-shell-new-pw">
              New Password (min 12 chars)
            </label>
            <Input
              id="app-shell-new-pw"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium" htmlFor="app-shell-confirm-pw">
              Confirm New Password
            </label>
            <Input
              id="app-shell-confirm-pw"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => setPwOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pwSaving}>
              {pwSaving ? "Updating..." : "Update Password"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
