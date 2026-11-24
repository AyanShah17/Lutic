"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Cpu,
  GitBranch,
  Home,
  KeyRound,
  Layers,
  MessageSquare,
  Plug,
  Search,
  ShieldCheck,
  X
} from "lucide-react";
import { can } from "@lutic/core/rbac";
import { getNavGroupsForUser } from "@/lib/navigation";
import { useAppContext } from "./providers";
import { Dialog } from "./ui/dialog";
import { Badge } from "./ui/badge";

interface SearchResultItem {
  id: string;
  category: string;
  title: string;
  subtitle?: string;
  href: string;
  badge?: string;
  keywords?: string;
}

const NAV_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  overview: Home,
  chat: MessageSquare,
  machines: Cpu,
  monitoring: Activity,
  dashboards: BarChart3,
  workflows: GitBranch,
  connectors: Plug,
  notifications: Bell,
  queues: Layers,
  admin: ShieldCheck,
  activate: KeyRound
};

export function CommandSearch({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { user, t } = useAppContext();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [remoteItems, setRemoteItems] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!user) {
      setRemoteItems([]);
      return;
    }
    if (!open) return;

    let cancelled = false;
    setLoading(true);

    const loadIndex = async () => {
      const next: SearchResultItem[] = [];
      const tasks: Array<Promise<void>> = [];

      if (can(user, "machine:read")) {
        tasks.push(
          fetch("/api/machines", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then(
              (
                d: {
                  machines?: Array<{
                    id: string;
                    name: string;
                    plantId: string;
                    status: string;
                    machineType: string;
                  }>;
                } | null
              ) => {
                for (const m of d?.machines ?? []) {
                  next.push({
                    id: `m-${m.id}`,
                    category: "Machines",
                    title: m.name,
                    subtitle: `${m.id} · ${m.plantId} · ${m.machineType}`,
                    href: `/m/${m.id}`,
                    badge: m.status
                  });
                }
              }
            )
            .catch(() => {})
        );
      }

      if (can(user, "alert:read")) {
        tasks.push(
          fetch("/api/monitoring/alerts", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then(
              (
                d: {
                  alerts?: Array<{
                    id: string;
                    title: string;
                    machineId?: string | null;
                    status: string;
                    severity: string;
                  }>;
                } | null
              ) => {
                for (const a of (d?.alerts ?? []).slice(0, 12)) {
                  next.push({
                    id: `alert-${a.id}`,
                    category: "Monitoring Alerts",
                    title: a.title,
                    subtitle: `${a.machineId ?? "platform"} · ${a.severity}`,
                    href: "/monitoring",
                    badge: a.status
                  });
                }
              }
            )
            .catch(() => {})
        );
      }

      if (can(user, "workflow:read")) {
        tasks.push(
          fetch("/api/workflows", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then(
              (
                d: {
                  workflows?: Array<{ id: string; name: string; triggerType: string }>;
                } | null
              ) => {
                for (const wf of d?.workflows ?? []) {
                  next.push({
                    id: `wf-${wf.id}`,
                    category: "Workflows",
                    title: wf.name,
                    subtitle: `Trigger: ${wf.triggerType}`,
                    href: `/workflows/${wf.id}`,
                    badge: wf.triggerType
                  });
                }
              }
            )
            .catch(() => {})
        );
      }

      if (can(user, "dashboard:read")) {
        tasks.push(
          fetch("/api/dashboards", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then(
              (
                d: {
                  dashboards?: Array<{
                    id: string;
                    title: string;
                    isTemplate: boolean;
                  }>;
                } | null
              ) => {
                for (const dash of d?.dashboards ?? []) {
                  next.push({
                    id: `dash-${dash.id}`,
                    category: "Dashboards",
                    title: dash.title,
                    subtitle: dash.isTemplate ? "Starter template" : "Saved dashboard",
                    href: `/dashboards/${dash.id}`,
                    badge: dash.isTemplate ? "template" : "custom"
                  });
                }
              }
            )
            .catch(() => {})
        );
      }

      if (can(user, "connector:read")) {
        tasks.push(
          fetch("/api/connectors", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then(
              (
                d: {
                  connectors?: Array<{
                    id: string;
                    name: string;
                    slug: string;
                    category: string;
                  }>;
                } | null
              ) => {
                for (const conn of d?.connectors ?? []) {
                  next.push({
                    id: `conn-${conn.id}`,
                    category: "Connectors",
                    title: conn.name,
                    subtitle: `${conn.slug} · ${conn.category}`,
                    href: "/connectors",
                    badge: conn.category
                  });
                }
              }
            )
            .catch(() => {})
        );
      }

      if (can(user, "queue:read")) {
        tasks.push(
          fetch("/api/queues", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then(
              (
                d: {
                  queues?: Array<{
                    id: string;
                    name: string;
                    readyCount: number;
                  }>;
                } | null
              ) => {
                for (const q of d?.queues ?? []) {
                  next.push({
                    id: `q-${q.id}`,
                    category: "Messaging Queues",
                    title: q.name,
                    subtitle: `${q.id} · ${q.readyCount} ready`,
                    href: "/queues",
                    badge: "Lutic Queue"
                  });
                }
              }
            )
            .catch(() => {})
        );
      }

      await Promise.all(tasks);
      if (!cancelled) {
        setRemoteItems(next);
        setLoading(false);
      }
    };

    void loadIndex();
    return () => {
      cancelled = true;
    };
  }, [open, user]);

  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    setQuery("");
    setSelectedIndex(0);
  }, [open]);

  const navItems = useMemo<SearchResultItem[]>(() => {
    const groups = getNavGroupsForUser(user, t);
    return groups.flatMap((g) =>
      g.items.map((item) => ({
        id: `nav-${item.id}`,
        category: g.label,
        title: item.label,
        subtitle: item.href,
        href: item.href,
        keywords: item.keywords.join(" ")
      }))
    );
  }, [user, t]);

  const filtered = useMemo(() => {
    const all = [...navItems, ...remoteItems];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 14);
    return all
      .filter((item) =>
        `${item.title} ${item.subtitle ?? ""} ${item.category} ${item.keywords ?? ""}`
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 20);
  }, [navItems, remoteItems, query]);

  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(filtered.length - 1, 0));
    }
  }, [filtered.length, selectedIndex]);

  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const grouped = useMemo(() => {
    const map = new Map<string, SearchResultItem[]>();
    for (const item of filtered) {
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const navigateTo = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel="Global search"
      className="max-w-xl overflow-hidden p-0"
    >
      <div className="flex items-center border-b border-border px-3.5">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelectedIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelectedIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && filtered[selectedIndex]) {
              e.preventDefault();
              navigateTo(filtered[selectedIndex]!.href);
            }
          }}
          placeholder="Search pages, machines, alerts, workflows, dashboards, connectors..."
          aria-label="Global search input"
          className="h-11 w-full bg-transparent px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {loading && (
          <span className="text-[10px] font-mono text-muted-foreground mr-2 shrink-0">
            Syncing...
          </span>
        )}
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close search"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto p-2 space-y-3">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            No matching workspace resources for &ldquo;{query}&rdquo;.
          </div>
        ) : (
          grouped.map(([category, items]) => (
            <div key={category} className="space-y-1">
              <div className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {category}
              </div>
              {items.map((item) => {
                const flatIndex = filtered.findIndex((f) => f.id === item.id);
                const active = flatIndex === selectedIndex;
                const navKey = item.id.startsWith("nav-") ? item.id.slice(4) : "";
                const NavIcon = NAV_ICONS[navKey];
                const isAlert = item.id.startsWith("alert-");
                return (
                  <button
                    key={item.id}
                    ref={(el) => {
                      itemRefs.current[flatIndex] = el;
                    }}
                    type="button"
                    onMouseEnter={() => setSelectedIndex(flatIndex)}
                    onClick={() => navigateTo(item.href)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors ${
                      active ? "bg-accent text-accent-foreground" : "hover:bg-muted/60"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {NavIcon ? (
                        <NavIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      ) : isAlert ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-primary shrink-0" />
                      ) : (
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium truncate">{item.title}</div>
                        {item.subtitle && (
                          <div className="text-[11px] text-muted-foreground truncate">
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                    </div>
                    {item.badge && (
                      <Badge variant="outline" className="shrink-0 capitalize text-[10px]">
                        {item.badge}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border bg-muted/40 px-3.5 py-2 text-[11px] text-muted-foreground">
        <span>Use Up/Down arrows and Enter to navigate</span>
        <span className="font-mono">ESC to close</span>
      </div>
    </Dialog>
  );
}
