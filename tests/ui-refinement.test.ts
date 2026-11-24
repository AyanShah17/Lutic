import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@lutic/core/rbac";
import { resetGlobalDbForTests } from "@lutic/core";
import { getNavGroupsForUser } from "../apps/web/src/lib/navigation";
import { translate } from "../apps/web/src/lib/i18n";
import { cn } from "../apps/web/src/lib/utils";
import { AuthGate } from "../apps/web/src/components/ui/auth-gate";
import { Button, buttonVariants } from "../apps/web/src/components/ui/button";
import { Badge } from "../apps/web/src/components/ui/badge";
import { Card, CardHeader, CardTitle } from "../apps/web/src/components/ui/card";
import { Dialog } from "../apps/web/src/components/ui/dialog";
import { TabsList, TabsTrigger } from "../apps/web/src/components/ui/tabs";
import { GlowBorderCard } from "../apps/web/src/components/vengeance/glow-border-card";
import { SpotlightNavbar } from "../apps/web/src/components/vengeance/spotlight-navbar";
import { AnimatedButton } from "../apps/web/src/components/vengeance/animated-button";
import { LineHoverLink } from "../apps/web/src/components/vengeance/line-hover-link";
import { MachineStatusBadge } from "../apps/web/src/components/machine-status-badge";

let mockedSessionUser: SessionUser | null = null;
let mockedPathname = "/chat";
let mockedDemoEnabled = true;

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => React.createElement("a", { href, ...rest }, children)
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mockedPathname,
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {}
  })
}));

vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  useTheme: () => ({ theme: "light", setTheme: () => {} })
}));

vi.mock("../apps/web/src/lib/auth", () => ({
  getSessionUser: async () => mockedSessionUser
}));

vi.mock("../apps/web/src/components/providers", () => ({
  useAppContext: () => ({
    demoEnabled: mockedDemoEnabled,
    user: mockedSessionUser,
    setUser: () => {},
    locale: "en" as const,
    setLocale: () => {},
    t: (k: string) => translate("en", k),
    refreshSession: async () => {}
  })
}));

vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children);
  return {
    ResponsiveContainer: Stub,
    LineChart: Stub,
    BarChart: Stub,
    PieChart: Stub,
    CartesianGrid: Stub,
    XAxis: Stub,
    YAxis: Stub,
    Tooltip: Stub,
    Legend: Stub,
    Line: Stub,
    Bar: Stub,
    Pie: Stub,
    Cell: Stub
  };
});

vi.mock("react-markdown", () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children)
}));

vi.mock("remark-gfm", () => ({ default: () => {} }));
vi.mock("html-to-image", () => ({ toPng: async () => "" }));
vi.mock("react-grid-layout", () => {
  const Grid = ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children);
  return {
    default: Grid,
    Responsive: Grid,
    WidthProvider: (comp: unknown) => comp
  };
});

function makeUser(
  role: SessionUser["role"],
  plantIds: string[] = ["plant-detroit"]
): SessionUser {
  return {
    userId: `u-${role}`,
    tenantId: "tenant-acme",
    role,
    plantIds,
    email: `${role}@acme.demo`,
    name: role
  };
}

describe("Lutic UI Refinement — Categorized Navigation, Search, Shadcn/Vengeance & Zero Emojis", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = "memory://";
    resetGlobalDbForTests();
  });

  it("categorizes sidebar navigation into labeled groups and enforces RBAC per role", () => {
    const tEn = (k: string) => translate("en", k);
    const tEs = (k: string) => translate("es", k);

    const engGroups = getNavGroupsForUser(makeUser("engineer"), tEn);
    expect(engGroups.map((g) => g.label)).toEqual([
      "Operations",
      "Automation & Data",
      "Messaging"
    ]);
    const engHrefs = engGroups.flatMap((g) => g.items.map((i) => i.href));
    expect(engHrefs).toContain("/chat");
    expect(engHrefs).toContain("/machines");
    expect(engHrefs).toContain("/monitoring");
    expect(engHrefs).toContain("/dashboards");
    expect(engHrefs).toContain("/workflows");
    expect(engHrefs).toContain("/connectors");
    expect(engHrefs).toContain("/notifications");
    expect(engHrefs).toContain("/queues");
    expect(engHrefs).not.toContain("/admin");
    expect(engHrefs).not.toContain("/activate");

    const admGroups = getNavGroupsForUser(makeUser("admin"), tEn);
    expect(admGroups.map((g) => g.label)).toEqual([
      "Operations",
      "Automation & Data",
      "Messaging",
      "Governance"
    ]);
    const admHrefs = admGroups.flatMap((g) => g.items.map((i) => i.href));
    expect(admHrefs).toContain("/admin");
    expect(admHrefs).toContain("/activate");

    const unauthHrefs = getNavGroupsForUser(null, tEn).flatMap((g) =>
      g.items.map((i) => i.href)
    );
    expect(unauthHrefs).not.toContain("/admin");
    expect(unauthHrefs).not.toContain("/activate");

    const esGroups = getNavGroupsForUser(makeUser("admin"), tEs);
    expect(esGroups.map((g) => g.label)).toEqual([
      "Operaciones",
      "Automatización y Datos",
      "Mensajería",
      "Gobernanza"
    ]);
  });

  it("contains zero emojis across apps/ and packages/", () => {
    const emojiRe =
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\uFE0F]/gu;
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx|css|js|jsx)$/.test(entry.name)) {
          const content = fs.readFileSync(full, "utf8");
          const matches = content.match(emojiRe);
          if (matches && matches.length > 0) {
            offenders.push(`${full}: ${matches.join(" ")}`);
          }
        }
      }
    };

    walk(path.resolve(__dirname, "../apps"));
    walk(path.resolve(__dirname, "../packages"));
    expect(offenders).toEqual([]);
  });

  it("has zero invalid Tailwind classes, zero nested Link/Button elements, and AuthGate on all protected consoles", () => {
    const webSrcDir = path.resolve(__dirname, "../apps/web/src");
    const badClasses: string[] = [];
    const nestedButtons: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx|css)$/.test(entry.name)) {
          const s = fs.readFileSync(full, "utf8");
          if (/py-0\.2\b|bg-primary\/12\b|bg-primary\/92\b/.test(s)) {
            badClasses.push(path.relative(webSrcDir, full));
          }
          const linkSegs = s.split(/<\/Link>|<\/a>/);
          for (const seg of linkSegs) {
            if (/<(?:Link|a)\b(?![^>]*\/>)[^>]*>[\s\S]*<Button\b/.test(seg)) {
              nestedButtons.push(path.relative(webSrcDir, full));
            }
          }
        }
      }
    };

    walk(webSrcDir);
    expect(badClasses).toEqual([]);
    expect(nestedButtons).toEqual([]);

    for (const rel of [
      "apps/web/src/components/chat-workspace.tsx",
      "apps/web/src/app/machines/page.tsx",
      "apps/web/src/app/dashboards/page.tsx",
      "apps/web/src/app/workflows/page.tsx",
      "apps/web/src/components/workflow-canvas.tsx",
      "apps/web/src/components/connectors-console.tsx",
      "apps/web/src/components/monitoring-console.tsx",
      "apps/web/src/components/queues-console.tsx",
      "apps/web/src/components/activate-license-panel.tsx"
    ]) {
      const content = fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");
      expect(content, `${rel} must guard unauthenticated users with AuthGate`).toContain("<AuthGate");
    }
  });

  it("wires shadcn/ui and Vengeance UI registry components on React 19", () => {
    const componentsJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../apps/web/components.json"), "utf8")
    ) as {
      registries?: Record<string, string>;
      aliases?: Record<string, string>;
    };
    expect(componentsJson.registries?.["@vengeanceui"]).toContain("VengeanceUI");
    expect(componentsJson.aliases?.ui).toBe("@/components/ui");

    const webPkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../apps/web/package.json"), "utf8")
    ) as { dependencies?: Record<string, string> };
    expect(webPkg.dependencies?.react).toBe(webPkg.dependencies?.["react-dom"]);
    expect(React.version).toMatch(/^19\./);

    for (const rel of [
      "apps/web/src/components/ui/auth-gate.tsx",
      "apps/web/src/components/ui/button.tsx",
      "apps/web/src/components/ui/badge.tsx",
      "apps/web/src/components/ui/card.tsx",
      "apps/web/src/components/ui/input.tsx",
      "apps/web/src/components/ui/select.tsx",
      "apps/web/src/components/ui/tabs.tsx",
      "apps/web/src/components/ui/dialog.tsx",
      "apps/web/src/components/ui/table.tsx",
      "apps/web/src/components/vengeance/glow-border-card.tsx",
      "apps/web/src/components/vengeance/spotlight-navbar.tsx",
      "apps/web/src/components/vengeance/animated-button.tsx",
      "apps/web/src/components/vengeance/line-hover-link.tsx",
      "apps/web/src/components/command-search.tsx"
    ]) {
      expect(fs.existsSync(path.resolve(__dirname, "..", rel)), rel).toBe(true);
    }

    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
    expect(buttonVariants({ variant: "outline", size: "sm" })).toContain("border-border");
  });

  it("renders shadcn/ui, Dialog drawers, AuthGate, and Vengeance UI components cleanly via SSR", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        GlowBorderCard,
        null,
        React.createElement(
          Card,
          null,
          React.createElement(
            CardHeader,
            null,
            React.createElement(CardTitle, null, "Lutic Operations"),
            React.createElement(Badge, { variant: "success" }, "Running"),
            React.createElement(MachineStatusBadge, { status: "fault", size: "sm" }),
            React.createElement(Button, { variant: "outline" }, "Inspect"),
            React.createElement(AnimatedButton, null, "Launch"),
            React.createElement(LineHoverLink, { href: "/chat" }, "Open Chat"),
            React.createElement(
              TabsList,
              null,
              React.createElement(TabsTrigger, { active: true }, "Inspector")
            ),
            React.createElement(SpotlightNavbar, {
              activeId: "all",
              onSelect: () => {},
              items: [
                { id: "all", label: "All", badge: 4 },
                { id: "fault", label: "Fault", badge: 1 }
              ]
            }),
            React.createElement(
              Dialog,
              {
                open: true,
                onOpenChange: () => {},
                variant: "drawer-right",
                ariaLabel: "Test Drawer"
              },
              "Drawer Content"
            ),
            React.createElement(AuthGate, {
              title: "Sign in",
              description: "Auth required"
            })
          )
        )
      )
    );
    expect(html).toContain("Lutic Operations");
    expect(html).toContain("Running");
    expect(html).toContain("Fault");
    expect(html).toContain("Inspect");
    expect(html).toContain("Launch");
    expect(html).toContain("Drawer Content");
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Auth required");
  });

  it("renders AppShell and CommandSearch with role-scoped sidebar groups and search", async () => {
    const { AppShell } = await import("../apps/web/src/components/app-shell");
    const { CommandSearch } = await import("../apps/web/src/components/command-search");

    mockedPathname = "/chat";
    mockedSessionUser = makeUser("engineer", ["plant-detroit"]);
    const engHtml = renderToStaticMarkup(
      React.createElement(AppShell, null, React.createElement("div", null, "Body"))
    );
    expect(engHtml).toContain("Operations");
    expect(engHtml).toContain("Automation &amp; Data");
    expect(engHtml).toContain("Messaging");
    expect(engHtml).not.toContain('href="/admin"');
    expect(engHtml).not.toContain('href="/activate"');
    expect(engHtml).toContain("Search workspace...");
    expect(engHtml).toContain('aria-label="Change password"');

    mockedSessionUser = makeUser("admin", ["plant-detroit", "plant-austin"]);
    const admHtml = renderToStaticMarkup(
      React.createElement(AppShell, null, React.createElement("div", null, "Body"))
    );
    expect(admHtml).toContain("Governance");
    expect(admHtml).toContain('href="/admin"');
    expect(admHtml).toContain('href="/activate"');

    const cmdHtml = renderToStaticMarkup(
      React.createElement(CommandSearch, { open: true, onOpenChange: () => {} })
    );
    expect(cmdHtml).toContain("Global search");
    expect(cmdHtml).toContain("ESC to close");
    expect(cmdHtml).toContain("Dashboards");
  });

  it("renders HomePage with RBAC-filtered modules and plant-scoped operational spotlight", async () => {
    const { default: HomePage } = await import("../apps/web/src/app/page");

    mockedSessionUser = null;
    const unauthHtml = renderToStaticMarkup(await HomePage());
    expect(unauthHtml).toContain("Lutic Industrial Operations PaaS");
    expect(unauthHtml).toContain("Sign in with Demo Role");
    expect(unauthHtml).not.toContain('href="/activate"');
    expect(unauthHtml).not.toContain('href="/admin"');

    mockedSessionUser = makeUser("engineer", ["plant-detroit"]);
    const engHtml = renderToStaticMarkup(await HomePage());
    expect(engHtml).toContain("Fleet Running");
    expect(engHtml).toContain("mach-l3-filler-01");
    expect(engHtml).not.toContain('href="/admin"');
    expect(engHtml).not.toContain('href="/activate"');

    mockedSessionUser = makeUser("engineer", ["plant-austin"]);
    const austinHtml = renderToStaticMarkup(await HomePage());
    expect(austinHtml).toContain("plant-austin");
    expect(austinHtml).not.toContain("mach-l3-filler-01");

    mockedSessionUser = makeUser("admin", ["plant-detroit", "plant-austin"]);
    const admHtml = renderToStaticMarkup(await HomePage());
    expect(admHtml).toContain('href="/admin"');
    expect(admHtml).toContain('href="/activate"');

    // In production / non-demo mode, HomePage drops demo role CTA & demo Detroit fallback
    const prevDemo = process.env.LUTIC_DEMO_MODE;
    try {
      process.env.LUTIC_DEMO_MODE = "false";
      mockedSessionUser = null;
      const prodUnauthHtml = renderToStaticMarkup(await HomePage());
      expect(prodUnauthHtml).not.toContain("Sign in with Demo Role");
      expect(prodUnauthHtml).toContain("Sign in");
      expect(prodUnauthHtml).not.toContain("mach-l3-filler-01");
    } finally {
      if (prevDemo === undefined) delete process.env.LUTIC_DEMO_MODE;
      else process.env.LUTIC_DEMO_MODE = prevDemo;
    }
  });

  it("renders all Lutic consoles cleanly for both unauthenticated and authenticated states", async () => {
    const { default: LoginPage } = await import("../apps/web/src/app/login/page");
    const { default: MachinesPage } = await import("../apps/web/src/app/machines/page");
    const { default: DashboardsListPage } = await import("../apps/web/src/app/dashboards/page");
    const { default: WorkflowsPage } = await import("../apps/web/src/app/workflows/page");
    const { ChatWorkspace } = await import("../apps/web/src/components/chat-workspace");
    const { WorkflowCanvas } = await import("../apps/web/src/components/workflow-canvas");
    const { ConnectorsConsole } = await import("../apps/web/src/components/connectors-console");
    const { MonitoringConsole } = await import("../apps/web/src/components/monitoring-console");
    const { QueuesConsole } = await import("../apps/web/src/components/queues-console");
    const { AdminConsole } = await import("../apps/web/src/components/admin-console");
    const { ActivateLicensePanel } = await import("../apps/web/src/components/activate-license-panel");
    const { DashboardWorkspace } = await import("../apps/web/src/components/dashboard-workspace");

    const qc = new QueryClient();
    const withQuery = (el: React.ReactElement) =>
      React.createElement(QueryClientProvider, { client: qc }, el);

    // 1. Unauthenticated access shows Login or AuthGate / 403 cleanly
    mockedSessionUser = null;
    expect(renderToStaticMarkup(React.createElement(LoginPage))).toContain("engineer@acme.demo");
    for (const elem of [
      withQuery(React.createElement(MachinesPage)),
      withQuery(React.createElement(DashboardsListPage)),
      React.createElement(WorkflowsPage),
      React.createElement(ChatWorkspace),
      React.createElement(WorkflowCanvas, { workflowId: "wf-1" }),
      React.createElement(ConnectorsConsole),
      React.createElement(MonitoringConsole),
      React.createElement(QueuesConsole),
      React.createElement(ActivateLicensePanel)
    ]) {
      const html = renderToStaticMarkup(elem);
      expect(html).toContain('href="/login"');
      expect(html).toContain("Sign in");
    }
    expect(renderToStaticMarkup(React.createElement(AdminConsole))).toContain("403");

    // 2. Authenticated admin access renders every console and its domain controls
    mockedSessionUser = makeUser("admin", ["plant-detroit", "plant-austin"]);
    expect(renderToStaticMarkup(withQuery(React.createElement(MachinesPage)))).toContain(
      "Machine Fleet"
    );
    expect(renderToStaticMarkup(withQuery(React.createElement(DashboardsListPage)))).toContain(
      "Operational Dashboards"
    );
    expect(
      renderToStaticMarkup(
        React.createElement(DashboardWorkspace, {
          dashboardId: "dash-1",
          canEdit: true,
          initialShares: [],
          initialSpec: {
            id: "dash-1",
            title: "Line 3 OEE",
            description: "OEE board",
            plantScope: ["plant-detroit"],
            filters: { range: "7d" },
            widgets: [
              {
                id: "w-1",
                type: "kpi",
                title: "OEE",
                metric: "oee",
                range: "7d",
                sort: "desc",
                limit: 12
              }
            ],
            layout: [{ i: "w-1", x: 0, y: 0, w: 6, h: 5 }],
            version: 1
          }
        })
      )
    ).toContain("Line 3 OEE");
    expect(renderToStaticMarkup(React.createElement(WorkflowsPage))).toContain(
      "Workflows &amp; Builder"
    );
    expect(renderToStaticMarkup(React.createElement(WorkflowCanvas, { workflowId: "wf-1" }))).toContain(
      "Workflow Canvas"
    );
    expect(renderToStaticMarkup(React.createElement(ChatWorkspace))).toContain("Ask Lutic");
    expect(renderToStaticMarkup(React.createElement(ConnectorsConsole))).toContain(
      "Connectors Hub"
    );
    expect(renderToStaticMarkup(React.createElement(MonitoringConsole))).toContain(
      "Monitoring &amp; Alerts"
    );
    expect(
      renderToStaticMarkup(React.createElement(QueuesConsole, { initialTab: "notifications" }))
    ).toContain("Notifications &amp; Queues");
    expect(renderToStaticMarkup(React.createElement(AdminConsole))).toContain(
      "Lutic Admin Console"
    );
    expect(renderToStaticMarkup(React.createElement(AdminConsole))).toContain(
      "Diagnostics &amp; Retention"
    );
    expect(renderToStaticMarkup(React.createElement(ActivateLicensePanel))).toContain(
      "Lutic License Status"
    );
  });

  it("keeps compact AppShell sidebar spacing, min-w-0 WorkflowCanvas grid tracks, and full machine list in MonitoringConsole", async () => {
    const { AppShell } = await import("../apps/web/src/components/app-shell");

    mockedPathname = "/workflows/wf-e42-triage";
    mockedSessionUser = makeUser("admin", ["plant-detroit", "plant-austin"]);
    const admHtml = renderToStaticMarkup(
      React.createElement(AppShell, null, React.createElement("div", null, "Body"))
    );
    expect(admHtml).toContain("py-2.5 space-y-3");
    expect(admHtml).toContain("min-h-[32px]");
    expect(admHtml).toContain("Governance");
    expect(admHtml).toContain('href="/activate"');

    const wfSrc = fs.readFileSync(
      path.resolve(__dirname, "../apps/web/src/components/workflow-canvas.tsx"),
      "utf8"
    );
    expect(wfSrc).toContain('className="grid grid-cols-1 gap-4 lg:grid-cols-3"');
    expect(wfSrc).toContain('className="min-w-0 lg:col-span-2 space-y-3"');
    expect(wfSrc).toContain('<aside className="min-w-0 space-y-3">');

    const monSrc = fs.readFileSync(
      path.resolve(__dirname, "../apps/web/src/components/monitoring-console.tsx"),
      "utf8"
    );
    expect(monSrc).toContain('fetch("/api/monitoring/metrics", { cache: "no-store" })');
    expect(monSrc).not.toContain("/api/monitoring/metrics${qs}");
    expect(monSrc).toContain("fetchMachineSeries");
    expect(monSrc).toContain("[user?.userId, user?.role, plantScopeKey]");
  });

  it("exercises MonitoringConsole and WorkflowCanvas client hooks, machine switching, role fallback, and out-of-order fetch guards", async () => {
    // Minimal DOM environment on globalThis for React createRoot hook execution
    class MiniNode {
      nodeType: number;
      nodeName: string;
      tagName = "";
      nodeValue = "";
      childNodes: MiniNode[] = [];
      parentNode: MiniNode | null = null;
      style: Record<string, string> = {};
      attributes: Record<string, string> = {};
      listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
      ownerDocument: unknown = null;
      className = "";
      value = "";
      private _selected = false;
      defaultSelected = false;
      disabled = false;
      multiple = false;

      constructor(nodeType: number, nodeName: string) {
        this.nodeType = nodeType;
        this.nodeName = nodeName;
      }
      get selected() {
        return this._selected;
      }
      set selected(v: boolean) {
        this._selected = Boolean(v);
        if (
          this._selected &&
          this.parentNode &&
          this.tagName === "OPTION" &&
          !this.parentNode.multiple
        ) {
          for (const sib of this.parentNode.childNodes) {
            if (sib !== this && sib.tagName === "OPTION") {
              sib._selected = false;
            }
          }
        }
      }
      get options() {
        return this.childNodes.filter((c) => c.tagName === "OPTION");
      }
      get firstChild() {
        return this.childNodes[0] ?? null;
      }
      get nextSibling() {
        if (!this.parentNode) return null;
        const idx = this.parentNode.childNodes.indexOf(this);
        return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null;
      }
      appendChild(c: MiniNode) {
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = this;
        this.childNodes.push(c);
        return c;
      }
      insertBefore(c: MiniNode, ref: MiniNode | null) {
        if (!ref) return this.appendChild(c);
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = this;
        const idx = this.childNodes.indexOf(ref);
        if (idx >= 0) this.childNodes.splice(idx, 0, c);
        else this.childNodes.push(c);
        return c;
      }
      removeChild(c: MiniNode) {
        const idx = this.childNodes.indexOf(c);
        if (idx >= 0) this.childNodes.splice(idx, 1);
        c.parentNode = null;
        return c;
      }
      setAttribute(k: string, v: string) {
        this.attributes[k] = String(v);
        if (k === "class") this.className = String(v);
        if (k === "value") this.value = String(v);
        if (k === "disabled") this.disabled = true;
      }
      removeAttribute(k: string) {
        delete this.attributes[k];
        if (k === "disabled") this.disabled = false;
      }
      addEventListener(t: string, fn: (...args: unknown[]) => void) {
        (this.listeners[t] ??= []).push(fn);
      }
      removeEventListener(t: string, fn: (...args: unknown[]) => void) {
        if (this.listeners[t]) {
          this.listeners[t] = this.listeners[t].filter((f) => f !== fn);
        }
      }
      set textContent(v: string) {
        this.childNodes = [];
        if (v !== "" && v != null) {
          this.appendChild(doc.createTextNode(String(v)));
        }
      }
      get textContent(): string {
        return this.nodeType === 3
          ? this.nodeValue
          : this.childNodes.map((c) => c.textContent).join("");
      }
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 600, height: 224, right: 600, bottom: 224 };
      }
      getElementsByClassName(_cls: string) {
        return [];
      }
    }

    const doc = {
      body: new MiniNode(1, "BODY"),
      activeElement: null as MiniNode | null,
      createElement(tag: string) {
        const el = new MiniNode(1, tag.toUpperCase());
        el.tagName = tag.toUpperCase();
        el.ownerDocument = doc;
        return el;
      },
      createElementNS(_ns: string, tag: string) {
        return doc.createElement(tag);
      },
      createTextNode(txt: string) {
        const n = new MiniNode(3, "#text");
        n.nodeValue = String(txt);
        n.ownerDocument = doc;
        return n;
      },
      createComment(txt: string) {
        const n = new MiniNode(8, "#comment");
        n.nodeValue = String(txt);
        n.ownerDocument = doc;
        return n;
      },
      addEventListener() {},
      removeEventListener() {}
    };
    doc.body.ownerDocument = doc;

    const findAll = (root: MiniNode, pred: (n: MiniNode) => boolean): MiniNode[] => {
      const out: MiniNode[] = [];
      const walk = (n: MiniNode) => {
        if (pred(n)) out.push(n);
        for (const c of n.childNodes) walk(c);
      };
      walk(root);
      return out;
    };
    const getReactProps = (n: MiniNode): Record<string, unknown> => {
      const key = Object.keys(n).find((k) => k.startsWith("__reactProps$"));
      return key ? ((n as unknown as Record<string, unknown>)[key] as Record<string, unknown>) : {};
    };
    const flushEffects = async () => {
      for (let i = 0; i < 6; i++) {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
      }
    };

    const g = globalThis as Record<string, unknown>;
    const savedGlobals = {
      Node: g.Node,
      Element: g.Element,
      HTMLElement: g.HTMLElement,
      HTMLInputElement: g.HTMLInputElement,
      HTMLSelectElement: g.HTMLSelectElement,
      HTMLTextAreaElement: g.HTMLTextAreaElement,
      HTMLIFrameElement: g.HTMLIFrameElement,
      document: g.document,
      window: g.window,
      IS_REACT_ACT_ENVIRONMENT: g.IS_REACT_ACT_ENVIRONMENT,
      ResizeObserver: g.ResizeObserver,
      getComputedStyle: g.getComputedStyle,
      fetch: g.fetch
    };

    g.Node = MiniNode;
    g.Element = MiniNode;
    g.HTMLElement = MiniNode;
    g.HTMLInputElement = MiniNode;
    g.HTMLSelectElement = MiniNode;
    g.HTMLTextAreaElement = MiniNode;
    g.HTMLIFrameElement = MiniNode;
    g.document = doc;
    g.window = globalThis;
    g.IS_REACT_ACT_ENVIRONMENT = true;
    g.getComputedStyle = () => ({ fontSize: "11px", letterSpacing: "normal" });
    g.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    const ReactDOMClient = await import("../apps/web/node_modules/react-dom/client.js");
    const { act } = React as unknown as {
      act: (fn: () => void | Promise<void>) => Promise<void>;
    };

    try {
      const { MonitoringConsole } = await import("../apps/web/src/components/monitoring-console");
      const { WorkflowCanvas } = await import("../apps/web/src/components/workflow-canvas");

      const allMachines = [
        { id: "mach-det-01", name: "Detroit CNC 1", plantId: "plant-detroit", status: "running", temperature: 65, vibration: 1.5, pressure: 4 },
        { id: "mach-det-02", name: "Detroit Filler 2", plantId: "plant-detroit", status: "fault", temperature: 82, vibration: 7.2, pressure: 5 },
        { id: "mach-aus-01", name: "Austin Press 1", plantId: "plant-austin", status: "running", temperature: 58, vibration: 1.1, pressure: 6 }
      ];
      const seriesByMachine: Record<string, Array<{ bucketStart: string; tag: string; unit: string; avg: number }>> = {
        "mach-det-01": [{ bucketStart: "2026-11-20T10:00:00Z", tag: "temperature", unit: "C", avg: 65 }],
        "mach-det-02": [{ bucketStart: "2026-11-20T10:05:00Z", tag: "temperature", unit: "C", avg: 82 }],
        "mach-aus-01": [{ bucketStart: "2026-11-20T10:10:00Z", tag: "temperature", unit: "C", avg: 58 }]
      };

      const fetchCalls: string[] = [];
      let deferredSlowSeries: { resolve: (r: Response) => void } | null = null;
      let slowSeriesArmed = false;
      let deferredSlowMetricsLoad: { resolve: (r: Response) => void } | null = null;
      let slowMetricsLoadArmed = false;

      g.fetch = async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        fetchCalls.push(url);
        const visibleMachines =
          mockedSessionUser?.plantIds.includes("plant-austin")
            ? allMachines
            : allMachines.filter((m) => m.plantId === "plant-detroit");

        if (url === "/api/monitoring/metrics") {
          const first = visibleMachines[0];
          const makeResp = () =>
            new Response(
              JSON.stringify({
                machineId: first?.id ?? null,
                machines: visibleMachines,
                series: first ? seriesByMachine[first.id] : []
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            );
          if (slowMetricsLoadArmed) {
            slowMetricsLoadArmed = false;
            return new Promise<Response>((resolve) => {
              deferredSlowMetricsLoad = { resolve };
            });
          }
          return makeResp();
        }
        if (url.startsWith("/api/monitoring/metrics?machineId=")) {
          const mId = decodeURIComponent(url.split("machineId=")[1] ?? "");
          const found = allMachines.find((m) => m.id === mId);
          if (!found || !mockedSessionUser?.plantIds.includes(found.plantId)) {
            return new Response(
              JSON.stringify({ detail: "Machine belongs to a plant outside your scope." }),
              { status: 403, headers: { "content-type": "application/json" } }
            );
          }
          const makeResp = () =>
            new Response(
              JSON.stringify({
                machineId: found.id,
                machines: [found],
                series: seriesByMachine[found.id] ?? []
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            );
          if (slowSeriesArmed && mId === "mach-det-02") {
            slowSeriesArmed = false;
            return new Promise<Response>((resolve) => {
              deferredSlowSeries = { resolve };
            });
          }
          return makeResp();
        }
        if (url === "/api/monitoring/rules") {
          return new Response(JSON.stringify({ rules: [] }), { status: 200 });
        }
        if (url === "/api/monitoring/alerts") {
          return new Response(JSON.stringify({ alerts: [] }), { status: 200 });
        }
        if (url === "/api/monitoring/tick") {
          return new Response(
            JSON.stringify({ summary: { telemetryUpdated: visibleMachines.length, rulesEvaluated: 2, alertsTriggered: 0 } }),
            { status: 200 }
          );
        }
        if (url === "/api/workflows/wf-e42-triage") {
          return new Response(
            JSON.stringify({
              workflow: {
                id: "wf-e42-triage",
                name: "E42 Vibration Triage",
                description: "Checks spares",
                triggerType: "alert",
                triggerConfig: {},
                definition: {
                  nodes: [
                    { id: "n1", type: "trigger", label: "Trigger", config: {}, position: { x: 80, y: 100 } },
                    { id: "n2", type: "work_order", label: "Dispatch WO", config: {}, position: { x: 320, y: 100 } }
                  ],
                  edges: [{ id: "e1", source: "n1", target: "n2" }]
                },
                enabled: true,
                currentVersion: 1
              },
              versions: []
            }),
            { status: 200 }
          );
        }
        if (url === "/api/workflows/wf-e42-triage/runs") {
          return new Response(JSON.stringify({ runs: [] }), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      };

      // 1. Mount MonitoringConsole as Admin (3 machines across Detroit + Austin)
      mockedSessionUser = makeUser("admin", ["plant-detroit", "plant-austin"]);
      const monContainer = doc.createElement("div");
      const monRoot = ReactDOMClient.createRoot(monContainer as unknown as Element);

      await act(async () => {
        monRoot.render(React.createElement(MonitoringConsole));
        await flushEffects();
      });

      const getChartSelect = () =>
        findAll(
          monContainer,
          (n) => n.tagName === "SELECT" && n.attributes["aria-label"] === "Select machine for monitoring chart"
        )[0]!;
      const getRuleSelect = () =>
        findAll(
          monContainer,
          (n) => n.tagName === "SELECT" && n.attributes["aria-label"] === "Rule machine"
        )[0]!;
      const getMonitoredCountText = () => {
        const labels = findAll(
          monContainer,
          (n) => n.nodeType === 1 && n.textContent.trim() === "Monitored Machines"
        );
        const label = labels[labels.length - 1];
        return label?.parentNode?.textContent ?? "";
      };

      expect(getMonitoredCountText()).toContain("3");
      expect(getChartSelect().options.length).toBe(3);
      expect(getChartSelect().options.find((o) => o.selected)?.value).toBe("mach-det-01");
      expect(getRuleSelect().options.length).toBe(3);

      // 2. Switch chart machine to mach-aus-01 and verify full fleet & dropdowns remain 3
      await act(async () => {
        const sel = getChartSelect();
        const props = getReactProps(sel) as { onChange: (e: unknown) => void };
        props.onChange({ target: { value: "mach-aus-01" } });
        await flushEffects();
      });

      expect(fetchCalls).toContain("/api/monitoring/metrics?machineId=mach-aus-01");
      expect(getMonitoredCountText()).toContain("3");
      expect(getChartSelect().options.length).toBe(3);
      expect(getChartSelect().options.find((o) => o.selected)?.value).toBe("mach-aus-01");
      expect(getRuleSelect().options.length).toBe(3);

      // 3. Simulate Telemetry Tick preserves full machine count (3) and selected machine
      const tickBtn = findAll(
        monContainer,
        (n) => n.tagName === "BUTTON" && n.textContent.includes("Simulate Telemetry Tick")
      )[0]!;
      await act(async () => {
        const props = getReactProps(tickBtn) as { onClick: () => void };
        props.onClick();
        await flushEffects();
      });

      expect(fetchCalls).toContain("/api/monitoring/tick");
      expect(getMonitoredCountText()).toContain("3");
      expect(getChartSelect().options.length).toBe(3);
      expect(getChartSelect().options.find((o) => o.selected)?.value).toBe("mach-aus-01");

      // 4. Out-of-order fetchMachineSeries response does not overwrite newer machine selection
      slowSeriesArmed = true;
      await act(async () => {
        const props = getReactProps(getChartSelect()) as { onChange: (e: unknown) => void };
        props.onChange({ target: { value: "mach-det-02" } });
        props.onChange({ target: { value: "mach-det-01" } });
        await flushEffects();
      });
      // Now resolve the slower mach-det-02 response with a custom marker machine name
      await act(async () => {
        deferredSlowSeries?.resolve(
          new Response(
            JSON.stringify({
              machineId: "mach-det-02",
              machines: [{ ...allMachines[1]!, name: "STALE_OVERWRITE_NAME" }],
              series: seriesByMachine["mach-det-02"]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        );
        await flushEffects();
      });
      expect(monContainer.textContent).not.toContain("STALE_OVERWRITE_NAME");
      expect(getChartSelect().options.find((o) => o.selected)?.value).toBe("mach-det-01");

      // 5. Re-select mach-aus-01, then switch Demo Role to Detroit Engineer (plant-detroit only)
      await act(async () => {
        const props = getReactProps(getChartSelect()) as { onChange: (e: unknown) => void };
        props.onChange({ target: { value: "mach-aus-01" } });
        await flushEffects();
      });
      fetchCalls.length = 0;
      mockedSessionUser = makeUser("engineer", ["plant-detroit"]);
      await act(async () => {
        monRoot.render(React.createElement(MonitoringConsole));
        await flushEffects();
      });

      // Must NOT issue a 403 request for mach-aus-01 and must cleanly show 2 Detroit machines
      expect(fetchCalls.some((u) => u.includes("mach-aus-01"))).toBe(false);
      expect(monContainer.textContent).not.toContain("outside your scope");
      expect(getMonitoredCountText()).toContain("2");
      expect(getChartSelect().options.length).toBe(2);
      expect(getChartSelect().options.find((o) => o.selected)?.value).toBe("mach-det-01");

      // 6. Out-of-order full load() on fast role switch must not overwrite newer user's fleet
      slowMetricsLoadArmed = true;
      mockedSessionUser = makeUser("admin", ["plant-detroit", "plant-austin"]);
      await act(async () => {
        monRoot.render(React.createElement(MonitoringConsole));
        await flushEffects();
      });
      // Before Admin's slow metrics response resolves, switch back to Detroit Engineer (fast)
      mockedSessionUser = makeUser("engineer", ["plant-detroit"]);
      await act(async () => {
        monRoot.render(React.createElement(MonitoringConsole));
        await flushEffects();
      });
      await act(async () => {
        deferredSlowMetricsLoad?.resolve(
          new Response(
            JSON.stringify({
              machineId: "mach-det-01",
              machines: [{ ...allMachines[0]!, name: "STALE_ADMIN_MACHINE" }, ...allMachines.slice(1)],
              series: seriesByMachine["mach-det-01"]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        );
        await flushEffects();
      });
      expect(monContainer.textContent).not.toContain("STALE_ADMIN_MACHINE");
      expect(getMonitoredCountText()).toContain("2");

      await act(async () => {
        monRoot.unmount();
      });

      // 5. Mount WorkflowCanvas and verify loaded DOM grid, min-w-0, palette, and Node Inspector
      mockedSessionUser = makeUser("admin", ["plant-detroit", "plant-austin"]);
      const wfContainer = doc.createElement("div");
      const wfRoot = ReactDOMClient.createRoot(wfContainer as unknown as Element);

      await act(async () => {
        wfRoot.render(React.createElement(WorkflowCanvas, { workflowId: "wf-e42-triage" }));
        await flushEffects();
      });

      const gridDivs = findAll(
        wfContainer,
        (n) => n.tagName === "DIV" && (n.className || "").includes("lg:grid-cols-3")
      );
      expect(gridDivs.length).toBe(1);
      expect(gridDivs[0]!.className).toContain("grid-cols-1");
      const gridChildren = gridDivs[0]!.childNodes.filter((c) => c.nodeType === 1);
      expect(gridChildren[0]?.className).toContain("min-w-0");
      expect(gridChildren[0]?.className).toContain("lg:col-span-2");
      expect(gridChildren[1]?.tagName).toBe("ASIDE");
      expect(gridChildren[1]?.className).toContain("min-w-0");
      expect(wfContainer.textContent).toContain("Work Order");
      expect(wfContainer.textContent).toContain("Node Inspector (n1)");
      expect(wfContainer.textContent).toContain("Config (JSON)");

      await act(async () => {
        wfRoot.unmount();
      });
    } finally {
      Object.assign(g, savedGlobals);
    }
  });

  it("maps alert rule states and connector/workflow runtime support flags accurately", async () => {
    const { ruleStateBadgeVariant } = await import("../apps/web/src/components/monitoring-console");
    const { isConnectorSupportedInRuntime } = await import("../apps/web/src/components/connectors-console");
    const { isWorkflowNodeSupportedInRuntime } = await import("../apps/web/src/components/workflow-canvas");

    expect(ruleStateBadgeVariant("ALARM")).toBe("destructive");
    expect(ruleStateBadgeVariant("INSUFFICIENT_DATA")).toBe("warning");
    expect(ruleStateBadgeVariant("OK")).toBe("success");

    expect(isConnectorSupportedInRuntime({ transport: "http", endpointUrl: "https://erp.local" }, true)).toBe(true);
    expect(isConnectorSupportedInRuntime({ transport: "http", endpointUrl: "mcp://cmms" }, false)).toBe(false);
    expect(isConnectorSupportedInRuntime({ transport: "in_memory_mcp", endpointUrl: "mcp://foo/bar" }, false)).toBe(false);
    expect(isConnectorSupportedInRuntime({ transport: "in_memory_mcp", endpointUrl: "mcp://cmms" }, false)).toBe(true);
    expect(isConnectorSupportedInRuntime({ transport: "remote_mcp", endpointUrl: "https://mcp.metorial.example/mcp" }, false)).toBe(true);
    expect(isConnectorSupportedInRuntime({ transport: "utcp_http", endpointUrl: "https://api.example.com/utcp.json" }, false)).toBe(true);
    expect(isConnectorSupportedInRuntime({ transport: "remote_mcp", endpointUrl: "http://127.0.0.1:4000/mcp" }, false)).toBe(false);

    expect(isWorkflowNodeSupportedInRuntime({ type: "ai", config: {} }, true)).toBe(true);
    expect(isWorkflowNodeSupportedInRuntime({ type: "ai", config: {} }, false)).toBe(false);
    expect(isWorkflowNodeSupportedInRuntime({ type: "mcp", config: { tool: "custom_ext_tool" } }, false)).toBe(false);
    expect(isWorkflowNodeSupportedInRuntime({ type: "mcp", config: { tool: "execute_connector_code" } }, false)).toBe(false);
    expect(isWorkflowNodeSupportedInRuntime({ type: "mcp", config: { tool: "get_machine" } }, false)).toBe(true);
    expect(isWorkflowNodeSupportedInRuntime({ type: "mcp", config: { tool: "get_machine_status" } }, false)).toBe(true);
    expect(isWorkflowNodeSupportedInRuntime({ type: "mcp", config: { tool: "get_active_alarms" } }, false)).toBe(true);
    expect(isWorkflowNodeSupportedInRuntime({ type: "mcp", config: { tool: "find_part_for_fault" } }, false)).toBe(true);
    expect(isWorkflowNodeSupportedInRuntime({ type: "mcp", config: { tool: "get_parts_inventory" } }, false)).toBe(true);
    expect(isWorkflowNodeSupportedInRuntime({ type: "mcp", config: { tool: "get_work_orders" } }, false)).toBe(true);
    expect(isWorkflowNodeSupportedInRuntime({ type: "condition", config: {} }, false)).toBe(true);
    expect(isWorkflowNodeSupportedInRuntime({ type: "notify", config: {} }, false)).toBe(true);
    expect(isWorkflowNodeSupportedInRuntime({ type: "queue", config: {} }, false)).toBe(true);
    expect(isWorkflowNodeSupportedInRuntime({ type: "work_order", config: {} }, false)).toBe(true);
  });

  it("renders Retry error states, empty states, non-demo suggestions, Dialog focus trap, skip link, and keyboard activation", async () => {
    class DomNode {
      nodeType: number;
      nodeName: string;
      tagName = "";
      nodeValue = "";
      childNodes: DomNode[] = [];
      parentNode: DomNode | null = null;
      style: Record<string, string> = {};
      attributes: Record<string, string> = {};
      listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
      ownerDocument: unknown = null;
      className = "";
      value = "";
      private _selected = false;
      defaultSelected = false;
      disabled = false;
      multiple = false;
      tabIndex = 0;

      constructor(nodeType: number, nodeName: string) {
        this.nodeType = nodeType;
        this.nodeName = nodeName;
      }
      get selected() {
        return this._selected;
      }
      set selected(v: boolean) {
        this._selected = Boolean(v);
        if (
          this._selected &&
          this.parentNode &&
          this.tagName === "OPTION" &&
          !this.parentNode.multiple
        ) {
          for (const sib of this.parentNode.childNodes) {
            if (sib !== this && sib.tagName === "OPTION") {
              sib._selected = false;
            }
          }
        }
      }
      get options() {
        return this.childNodes.filter((c) => c.tagName === "OPTION");
      }
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 600, height: 224, right: 600, bottom: 224 };
      }
      getElementsByClassName(_cls: string) {
        return [];
      }
      get firstChild() {
        return this.childNodes[0] ?? null;
      }
      get nextSibling() {
        if (!this.parentNode) return null;
        const idx = this.parentNode.childNodes.indexOf(this);
        return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null;
      }
      get isConnected() {
        let cur: DomNode | null = this;
        while (cur) {
          if (cur === doc.body) return true;
          cur = cur.parentNode;
        }
        return false;
      }
      appendChild(c: DomNode) {
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = this;
        this.childNodes.push(c);
        return c;
      }
      insertBefore(c: DomNode, ref: DomNode | null) {
        if (!ref) return this.appendChild(c);
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = this;
        const idx = this.childNodes.indexOf(ref);
        if (idx >= 0) this.childNodes.splice(idx, 0, c);
        else this.childNodes.push(c);
        return c;
      }
      removeChild(c: DomNode) {
        const idx = this.childNodes.indexOf(c);
        if (idx >= 0) this.childNodes.splice(idx, 1);
        c.parentNode = null;
        return c;
      }
      setAttribute(k: string, v: string) {
        this.attributes[k] = String(v);
        if (k === "class") this.className = String(v);
        if (k === "value") this.value = String(v);
        if (k === "disabled") this.disabled = true;
        if (k === "tabindex") this.tabIndex = Number(v);
      }
      removeAttribute(k: string) {
        delete this.attributes[k];
        if (k === "disabled") this.disabled = false;
      }
      addEventListener(t: string, fn: (...args: unknown[]) => void) {
        (this.listeners[t] ??= []).push(fn);
      }
      removeEventListener(t: string, fn: (...args: unknown[]) => void) {
        if (this.listeners[t]) {
          this.listeners[t] = this.listeners[t].filter((f) => f !== fn);
        }
      }
      contains(target: DomNode | null): boolean {
        let cur = target;
        while (cur) {
          if (cur === this) return true;
          cur = cur.parentNode;
        }
        return false;
      }
      focus() {
        doc.activeElement = this;
      }
      querySelectorAll(selector: string): DomNode[] {
        const out: DomNode[] = [];
        const walk = (n: DomNode) => {
          if (n.nodeType === 1 && !n.disabled) {
            const tag = n.tagName;
            const ti = n.attributes.tabindex;
            const matches =
              (tag === "A" && Boolean(n.attributes.href) && selector.includes("a[href]")) ||
              (tag === "BUTTON" && selector.includes("button:not([disabled])")) ||
              (tag === "INPUT" && n.attributes.type !== "hidden" && selector.includes("input:not([disabled])")) ||
              (tag === "SELECT" && selector.includes("select:not([disabled])")) ||
              (tag === "TEXTAREA" && selector.includes("textarea:not([disabled])")) ||
              (ti !== undefined && ti !== "-1");
            if (matches) out.push(n);
          }
          for (const c of n.childNodes) walk(c);
        };
        for (const c of this.childNodes) walk(c);
        return out;
      }
      set textContent(v: string) {
        this.childNodes = [];
        if (v !== "" && v != null) {
          this.appendChild(doc.createTextNode(String(v)));
        }
      }
      get textContent(): string {
        return this.nodeType === 3
          ? this.nodeValue
          : this.childNodes.map((c) => c.textContent).join("");
      }
    }

    const windowListeners: Record<string, Array<(e: unknown) => void>> = {};
    const doc = {
      body: new DomNode(1, "BODY"),
      activeElement: null as DomNode | null,
      createElement(tag: string) {
        const el = new DomNode(1, tag.toUpperCase());
        el.tagName = tag.toUpperCase();
        el.ownerDocument = doc;
        return el;
      },
      createElementNS(_ns: string, tag: string) {
        return doc.createElement(tag);
      },
      createTextNode(txt: string) {
        const n = new DomNode(3, "#text");
        n.nodeValue = String(txt);
        n.ownerDocument = doc;
        return n;
      },
      createComment(txt: string) {
        const n = new DomNode(8, "#comment");
        n.nodeValue = String(txt);
        n.ownerDocument = doc;
        return n;
      },
      addEventListener() {},
      removeEventListener() {}
    };
    doc.body.ownerDocument = doc;

    const findAll = (root: DomNode, pred: (n: DomNode) => boolean): DomNode[] => {
      const out: DomNode[] = [];
      const walk = (n: DomNode) => {
        if (pred(n)) out.push(n);
        for (const c of n.childNodes) walk(c);
      };
      walk(root);
      return out;
    };
    const clickNode = (target: DomNode) => {
      let cur: DomNode | null = target;
      while (cur) {
        const listeners = cur.listeners.click ?? [];
        for (const fn of listeners) {
          fn({
            type: "click",
            target,
            currentTarget: cur,
            bubbles: true,
            cancelable: true,
            defaultPrevented: false,
            preventDefault() {
              this.defaultPrevented = true;
            },
            stopPropagation() {}
          });
        }
        cur = cur.parentNode;
      }
    };
    const flushEffects = async () => {
      for (let i = 0; i < 6; i++) {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
      }
    };

    const g = globalThis as Record<string, unknown>;
    const savedGlobals = {
      Node: g.Node,
      Element: g.Element,
      HTMLElement: g.HTMLElement,
      HTMLInputElement: g.HTMLInputElement,
      HTMLSelectElement: g.HTMLSelectElement,
      HTMLTextAreaElement: g.HTMLTextAreaElement,
      HTMLIFrameElement: g.HTMLIFrameElement,
      document: g.document,
      window: g.window,
      addEventListener: g.addEventListener,
      removeEventListener: g.removeEventListener,
      IS_REACT_ACT_ENVIRONMENT: g.IS_REACT_ACT_ENVIRONMENT,
      fetch: g.fetch
    };

    g.Node = DomNode;
    g.Element = DomNode;
    g.HTMLElement = DomNode;
    g.HTMLInputElement = DomNode;
    g.HTMLSelectElement = DomNode;
    g.HTMLTextAreaElement = DomNode;
    g.HTMLIFrameElement = DomNode;
    g.document = doc;
    g.window = globalThis;
    g.addEventListener = (t: string, fn: (e: unknown) => void) => {
      (windowListeners[t] ??= []).push(fn);
    };
    g.removeEventListener = (t: string, fn: (e: unknown) => void) => {
      if (windowListeners[t]) {
        windowListeners[t] = windowListeners[t].filter((f) => f !== fn);
      }
    };
    g.IS_REACT_ACT_ENVIRONMENT = true;

    const ReactDOMClient = await import("../apps/web/node_modules/react-dom/client.js");
    const { act } = React as unknown as {
      act: (fn: () => void | Promise<void>) => Promise<void>;
    };

    try {
      const { AppShell } = await import("../apps/web/src/components/app-shell");
      const { MonitoringConsole } = await import("../apps/web/src/components/monitoring-console");
      const { WorkflowCanvas } = await import("../apps/web/src/components/workflow-canvas");
      const { QueuesConsole } = await import("../apps/web/src/components/queues-console");
      const { ConnectorsConsole } = await import("../apps/web/src/components/connectors-console");
      const { ChatWorkspace } = await import("../apps/web/src/components/chat-workspace");
      const { AdminConsole } = await import("../apps/web/src/components/admin-console");
      const { default: WorkflowsPage } = await import("../apps/web/src/app/workflows/page");

      // 1. AppShell skip link & #main-content
      mockedSessionUser = makeUser("admin", ["plant-detroit", "plant-austin"]);
      mockedPathname = "/chat";
      const shellHtml = renderToStaticMarkup(
        React.createElement(AppShell, null, React.createElement("div", null, "Content"))
      );
      expect(shellHtml).toContain('href="#main-content"');
      expect(shellHtml).toContain('id="main-content"');

      // 2. Dialog focus move, Tab/Shift+Tab wrap, Escape close & focus restore
      const opener = doc.createElement("button");
      doc.body.appendChild(opener);
      opener.focus();
      const dialogContainer = doc.createElement("div");
      doc.body.appendChild(dialogContainer);
      const dialogRoot = ReactDOMClient.createRoot(dialogContainer as unknown as Element);

      let closedByEsc = false;
      await act(async () => {
        dialogRoot.render(
          React.createElement(
            Dialog,
            {
              open: true,
              onOpenChange: (o) => {
                if (!o) closedByEsc = true;
              },
              ariaLabel: "Focus test dialog"
            },
            React.createElement("button", { type: "button", id: "first-btn" }, "First"),
            React.createElement("button", { type: "button", id: "last-btn" }, "Last")
          )
        );
        await flushEffects();
      });

      expect(doc.activeElement?.attributes.id).toBe("first-btn");
      const buttons = findAll(dialogContainer, (n) => n.tagName === "BUTTON");
      buttons[1]!.focus();
      for (const fn of windowListeners.keydown ?? []) {
        fn({ key: "Tab", shiftKey: false, preventDefault() {} });
      }
      expect(doc.activeElement?.attributes.id).toBe("first-btn");

      for (const fn of windowListeners.keydown ?? []) {
        fn({ key: "Tab", shiftKey: true, preventDefault() {} });
      }
      expect(doc.activeElement?.attributes.id).toBe("last-btn");

      for (const fn of windowListeners.keydown ?? []) {
        fn({ key: "Escape", preventDefault() {} });
      }
      expect(closedByEsc).toBe(true);

      await act(async () => {
        dialogRoot.render(
          React.createElement(Dialog, { open: false, onOpenChange: () => {} }, "Closed")
        );
        await flushEffects();
      });
      expect(doc.activeElement).toBe(opener);
      await act(async () => {
        dialogRoot.unmount();
      });

      // 3. Initial loadError + Retry on Monitoring, WorkflowsPage, WorkflowCanvas, Queues, Connectors
      g.fetch = async () =>
        new Response(JSON.stringify({ detail: "Simulated 500 failure" }), {
          status: 500,
          headers: { "content-type": "application/json" }
        });

      for (const el of [
        React.createElement(MonitoringConsole),
        React.createElement(WorkflowsPage),
        React.createElement(QueuesConsole, { initialTab: "notifications" }),
        React.createElement(ConnectorsConsole)
      ]) {
        const c = doc.createElement("div");
        const r = ReactDOMClient.createRoot(c as unknown as Element);
        await act(async () => {
          r.render(el);
          await flushEffects();
        });
        const alerts = findAll(c, (n) => n.attributes.role === "alert");
        expect(alerts.length).toBeGreaterThan(0);
        expect(c.textContent).toContain("Simulated 500 failure");
        expect(c.textContent).toContain("Retry");
        await act(async () => {
          r.unmount();
        });
      }

      // WorkflowCanvas 500/404 shows error + Retry + Back to Workflows without node-add palette
      const wfErrContainer = doc.createElement("div");
      const wfErrRoot = ReactDOMClient.createRoot(wfErrContainer as unknown as Element);
      await act(async () => {
        wfErrRoot.render(React.createElement(WorkflowCanvas, { workflowId: "wf-missing" }));
        await flushEffects();
      });
      expect(wfErrContainer.textContent).toContain("Unable to open workflow");
      expect(wfErrContainer.textContent).toContain("Retry");
      expect(wfErrContainer.textContent).toContain("Back to Workflows");
      expect(wfErrContainer.textContent).not.toContain("Logic:");
      await act(async () => {
        wfErrRoot.unmount();
      });

      // 4. QueuesConsole empty-target submit disabled + non-demo webhook label
      mockedDemoEnabled = false;
      g.fetch = async (input: RequestInfo | URL) => {
        const u = typeof input === "string" ? input : input.toString();
        if (u === "/api/notifications") return new Response(JSON.stringify({ notifications: [] }), { status: 200 });
        if (u === "/api/topics") return new Response(JSON.stringify({ topics: [] }), { status: 200 });
        if (u === "/api/queues") return new Response(JSON.stringify({ queues: [] }), { status: 200 });
        return new Response("{}", { status: 200 });
      };
      const qTopicsContainer = doc.createElement("div");
      const qTopicsRoot = ReactDOMClient.createRoot(qTopicsContainer as unknown as Element);
      await act(async () => {
        qTopicsRoot.render(React.createElement(QueuesConsole, { initialTab: "topics" }));
        await flushEffects();
      });
      const pubBtn = findAll(qTopicsContainer, (n) => n.tagName === "BUTTON" && n.textContent.includes("Publish Message"))[0]!;
      const subBtn = findAll(qTopicsContainer, (n) => n.tagName === "BUTTON" && n.textContent.trim() === "Subscribe")[0]!;
      expect(pubBtn.disabled).toBe(true);
      expect(subBtn.disabled).toBe(true);
      expect(qTopicsContainer.textContent).toContain("webhook (demo only)");
      await act(async () => {
        qTopicsRoot.unmount();
      });

      const qQueuesContainer = doc.createElement("div");
      const qQueuesRoot = ReactDOMClient.createRoot(qQueuesContainer as unknown as Element);
      await act(async () => {
        qQueuesRoot.render(React.createElement(QueuesConsole, { initialTab: "queues" }));
        await flushEffects();
      });
      const enqBtn = findAll(qQueuesContainer, (n) => n.tagName === "BUTTON" && n.textContent.trim() === "Enqueue")[0]!;
      expect(enqBtn.disabled).toBe(true);
      await act(async () => {
        qQueuesRoot.unmount();
      });

      // 5. ChatWorkspace non-demo suggestions omit Acme demo strings
      g.fetch = async () => new Response(JSON.stringify({ conversations: [] }), { status: 200 });
      const chatContainer = doc.createElement("div");
      const chatRoot = ReactDOMClient.createRoot(chatContainer as unknown as Element);
      await act(async () => {
        chatRoot.render(React.createElement(ChatWorkspace));
        await flushEffects();
      });
      expect(chatContainer.textContent).not.toContain("E42");
      expect(chatContainer.textContent).not.toContain("SOP-001");
      expect(chatContainer.textContent).not.toContain("Rev 4.2");
      await act(async () => {
        chatRoot.unmount();
      });

      // 5b. ChatWorkspace Retry recovers from initial /api/conversations 500 + conditional aria-labels
      let convAttempts = 0;
      g.fetch = async (input: RequestInfo | URL) => {
        const u = typeof input === "string" ? input : input.toString();
        if (u === "/api/conversations") {
          convAttempts++;
          if (convAttempts === 1) {
            return new Response(JSON.stringify({ detail: "Conversations DB down" }), { status: 500 });
          }
          return new Response(
            JSON.stringify({
              conversations: [{ id: "c1", title: "Pump Check", machineId: null, updatedAt: "2026-01-01T00:00:00Z" }]
            }),
            { status: 200 }
          );
        }
        if (u === "/api/conversations/c1") {
          return new Response(
            JSON.stringify({
              conversation: { id: "c1", title: "Pump Check", shareToken: null },
              messages: [{ id: "m1", role: "assistant", content: "Inspect inlet valve." }]
            }),
            { status: 200 }
          );
        }
        return new Response("{}", { status: 200 });
      };
      const chatRetryContainer = doc.createElement("div");
      const chatRetryRoot = ReactDOMClient.createRoot(chatRetryContainer as unknown as Element);
      await act(async () => {
        chatRetryRoot.render(React.createElement(ChatWorkspace));
        await flushEffects();
      });
      expect(convAttempts).toBe(1);
      expect(chatRetryContainer.textContent).toContain("Conversations DB down");
      const retryBtn = findAll(chatRetryContainer, (n) => n.tagName === "BUTTON" && n.textContent.trim() === "Retry")[0]!;
      await act(async () => {
        clickNode(retryBtn);
        await flushEffects();
      });
      expect(convAttempts).toBe(2);
      expect(chatRetryContainer.textContent).not.toContain("Conversations DB down");
      await act(async () => {
        chatRetryRoot.unmount();
      });

      const chatLabelsContainer = doc.createElement("div");
      const chatLabelsRoot = ReactDOMClient.createRoot(chatLabelsContainer as unknown as Element);
      await act(async () => {
        chatLabelsRoot.render(React.createElement(ChatWorkspace, { initialConversationId: "c1" }));
        await flushEffects();
      });
      const attachTextBtn = findAll(chatLabelsContainer, (n) => n.tagName === "BUTTON" && n.textContent.includes("Attach Text"))[0]!;
      const wrongAnswerBtn = findAll(chatLabelsContainer, (n) => n.tagName === "BUTTON" && n.textContent.includes("Wrong answer"))[0]!;
      await act(async () => {
        clickNode(attachTextBtn);
        clickNode(wrongAnswerBtn);
      });
      const snippetEl = findAll(chatLabelsContainer, (n) => n.tagName === "TEXTAREA")[0];
      const wrongEl = findAll(
        chatLabelsContainer,
        (n) => n.tagName === "INPUT" && n.attributes.placeholder === "What was wrong or missing?"
      )[0];
      expect(snippetEl?.attributes["aria-label"]).toBe("Diagnostic log or field note text");
      expect(wrongEl?.attributes["aria-label"]).toBe("Explain what was wrong or missing");
      await act(async () => {
        chatLabelsRoot.unmount();
      });

      // 6. ConnectorsConsole card keyboard accessibility & AdminConsole empty states
      g.fetch = async (input: RequestInfo | URL) => {
        const u = typeof input === "string" ? input : input.toString();
        if (u === "/api/connectors") {
          return new Response(
            JSON.stringify({
              connectors: [
                {
                  id: "c1",
                  slug: "cmms",
                  kind: "cmms",
                  name: "CMMS Bridge",
                  category: "cmms",
                  transport: "in_memory_mcp",
                  endpointUrl: "mcp://cmms",
                  status: "connected",
                  hasCredentials: false,
                  discoveredTools: [{ name: "get_work_orders" }],
                  lastSyncAt: null,
                  lastError: null
                }
              ],
              catalog: [],
              logs: [],
              capabilities: { codeMode: false }
            }),
            { status: 200 }
          );
        }
        if (u === "/api/admin/users") {
          return new Response(JSON.stringify({ users: [], plants: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ toolkits: [], roleToolkits: [] }), { status: 200 });
      };

      const connContainer = doc.createElement("div");
      const connRoot = ReactDOMClient.createRoot(connContainer as unknown as Element);
      await act(async () => {
        connRoot.render(React.createElement(ConnectorsConsole));
        await flushEffects();
      });
      const connCards = findAll(
        connContainer,
        (n) => n.attributes.role === "button" && n.attributes.tabindex === "0"
      );
      expect(connCards.length).toBe(1);
      const codeModeBtn = findAll(
        connContainer,
        (n) => n.tagName === "BUTTON" && n.textContent.trim() === "Lutic Code Mode"
      )[0];
      expect(codeModeBtn).toBeDefined();
      expect(Boolean(codeModeBtn?.disabled || codeModeBtn?.attributes.disabled !== undefined)).toBe(true);
      expect(connContainer.textContent).toContain("Code Mode is available only in trusted development and tests");
      await act(async () => {
        connRoot.unmount();
      });

      const admContainer = doc.createElement("div");
      const admRoot = ReactDOMClient.createRoot(admContainer as unknown as Element);
      await act(async () => {
        admRoot.render(React.createElement(AdminConsole));
        await flushEffects();
      });
      expect(admContainer.textContent).toContain("No toolkits configured.");
      await act(async () => {
        admRoot.unmount();
      });
    } finally {
      mockedDemoEnabled = true;
      Object.assign(g, savedGlobals);
    }
  });
});
