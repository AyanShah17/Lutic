import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  and,
  assets,
  auditLog,
  authorize,
  AuthorizationError,
  can,
  chunkDocumentText,
  createDbConnection,
  DashboardSpecSchema,
  decryptCredentials,
  encryptCredentials,
  eq,
  inventory,
  PERMISSIONS,
  querySemanticMetric,
  reciprocalRankFusion,
  ROLE_PERMISSIONS,
  ROLES,
  roleToolkits,
  seedDatabase,
  sql,
  toolkitTools,
  hybridSearchDocuments,
  withTenantScope,
  workOrders,
  type DbConnection,
  type Permission,
  type Role,
  type SessionUser
} from "@lutic/core";
import {
  executeToolWithPolicy,
  MockLLMProvider,
  resetRateLimits,
  runAgentTurn
} from "@lutic/agent";

let conn: DbConnection;

const detEngineer: SessionUser = {
  userId: "user-det-eng",
  tenantId: "tenant-acme",
  role: "engineer",
  plantIds: ["plant-detroit"],
  email: "engineer@acme.demo",
  name: "Marcus Vance"
};

const analystUser: SessionUser = {
  userId: "user-analyst",
  tenantId: "tenant-acme",
  role: "analyst",
  plantIds: ["plant-detroit", "plant-austin"],
  email: "analyst@acme.demo",
  name: "Priya Nair"
};

const managerUser: SessionUser = {
  userId: "user-manager",
  tenantId: "tenant-acme",
  role: "manager",
  plantIds: ["plant-detroit", "plant-austin"],
  email: "manager@acme.demo",
  name: "Sarah Chen"
};

const adminUser: SessionUser = {
  userId: "user-admin",
  tenantId: "tenant-acme",
  role: "admin",
  plantIds: ["plant-detroit", "plant-austin"],
  email: "admin@acme.demo",
  name: "Alex Rivera"
};

beforeAll(async () => {
  conn = await createDbConnection("memory://");
  await seedDatabase(conn);
});

afterAll(async () => {
  await conn.close();
});

describe("1. RBAC Permission Matrix & authorize()", () => {
  it("enforces exact role-permission matrix across all 4 roles", () => {
    const expectedAllowed: Record<Role, Permission[]> = {
      engineer: [
        "docs:read",
        "machine:read",
        "workorder:read",
        "workorder:write",
        "parts:read",
        "parts:write",
        "dashboard:read",
        "workflow:read",
        "workflow:execute",
        "connector:read",
        "alert:read",
        "alert:acknowledge",
        "notification:read",
        "queue:read"
      ],
      analyst: [
        "docs:read",
        "machine:read",
        "workorder:read",
        "parts:read",
        "metrics:read",
        "dashboard:read",
        "dashboard:write",
        "dashboard:share",
        "workflow:read",
        "workflow:write",
        "workflow:execute",
        "connector:read",
        "alert:read",
        "alert:write",
        "notification:read",
        "queue:read"
      ],
      manager: [
        "docs:read",
        "machine:read",
        "workorder:read",
        "parts:read",
        "metrics:read",
        "dashboard:read",
        "workflow:read",
        "connector:read",
        "alert:read",
        "alert:acknowledge",
        "notification:read",
        "notification:write",
        "queue:read"
      ],
      admin: [...PERMISSIONS]
    };

    const userMap: Record<Role, SessionUser> = {
      engineer: detEngineer,
      analyst: analystUser,
      manager: managerUser,
      admin: adminUser
    };

    for (const role of ROLES) {
      const user = userMap[role];
      for (const perm of PERMISSIONS) {
        const shouldAllow = expectedAllowed[role].includes(perm);
        expect(ROLE_PERMISSIONS[role].has(perm)).toBe(shouldAllow);
        expect(can(user, perm)).toBe(shouldAllow);
      }
    }
  });

  it("enforces server-side plant scope and tenant isolation", () => {
    expect(() =>
      authorize(detEngineer, "machine:read", {
        tenantId: "tenant-acme",
        plantId: "plant-detroit"
      })
    ).not.toThrow();

    expect(() =>
      authorize(detEngineer, "machine:read", {
        tenantId: "tenant-acme",
        plantId: "plant-austin"
      })
    ).toThrow(AuthorizationError);

    expect(() =>
      authorize(adminUser, "docs:read", { tenantId: "tenant-beta" })
    ).toThrow(AuthorizationError);
  });
});

describe("2. Policy Engine 6-Check Gate, Live Toolkits & Confirmed Writes", () => {
  it("denies analytics tool calls for engineer and logs denial to audit_log", async () => {
    await resetRateLimits(conn.db);
    const res = await executeToolWithPolicy(
      "query_metric",
      { metric: "oee", range: "7d" },
      { db: conn.db, user: detEngineer, requestId: "test-1" }
    );
    expect(res.status).toBe("denied");
    expect(res.denialReason).toBeTruthy();

    const audits = await conn.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.userId, detEngineer.userId),
          eq(auditLog.toolName, "query_metric"),
          eq(auditLog.status, "denied")
        )
      );
    expect(audits.length).toBeGreaterThan(0);
  });

  it("rejects out-of-scope plant and machine arguments from session", async () => {
    await resetRateLimits(conn.db);
    const plantRes = await executeToolWithPolicy(
      "get_active_alarms",
      { plantId: "plant-austin" },
      { db: conn.db, user: detEngineer, requestId: "test-plant-scope" }
    );
    expect(plantRes.status).toBe("denied");
    expect(plantRes.denialReason).toContain("outside your authorized plant scope");

    const machRes = await executeToolWithPolicy(
      "get_machine_status",
      { machineId: "mach-aus-comp-01" },
      { db: conn.db, user: detEngineer, requestId: "test-mach-scope" }
    );
    expect(machRes.status).toBe("denied");
    expect(machRes.denialReason).toContain("outside your plant scope");
  });

  it("wraps tool outputs as untrusted data and bounds rows <= 50", async () => {
    await resetRateLimits(conn.db);
    const res = await executeToolWithPolicy(
      "get_work_orders",
      { limit: 50 },
      { db: conn.db, user: detEngineer, requestId: "test-bound" }
    );
    expect(res.status).toBe("allowed");
    expect(res.untrustedWrappedText).toContain('<untrusted_tool_result tool="get_work_orders">');
    expect((res.data?.workOrders as unknown[]).length).toBeLessThanOrEqual(50);
  });

  it("reflects live toolkit and tool toggles immediately without redeploy", async () => {
    await resetRateLimits(conn.db);
    // Disable search_documents in toolkit_tools
    await conn.db
      .update(toolkitTools)
      .set({ enabled: false })
      .where(eq(toolkitTools.toolName, "search_documents"));

    const blocked = await executeToolWithPolicy(
      "search_documents",
      { query: "E42" },
      { db: conn.db, user: detEngineer, requestId: "test-toggle-off" }
    );
    expect(blocked.status).toBe("denied");

    // Re-enable search_documents, then disable role_toolkit for engineer->action
    await conn.db
      .update(toolkitTools)
      .set({ enabled: true })
      .where(eq(toolkitTools.toolName, "search_documents"));

    await conn.db
      .update(roleToolkits)
      .set({ enabled: false })
      .where(
        and(
          eq(roleToolkits.role, "engineer"),
          eq(roleToolkits.toolkitId, "tk-action")
        )
      );

    const actionDenied = await executeToolWithPolicy(
      "draft_work_order",
      { machineId: "mach-l3-filler-01", description: "Check servo" },
      { db: conn.db, user: detEngineer, requestId: "test-tk-off" }
    );
    expect(actionDenied.status).toBe("denied");

    // Restore
    await conn.db
      .update(roleToolkits)
      .set({ enabled: true })
      .where(
        and(
          eq(roleToolkits.role, "engineer"),
          eq(roleToolkits.toolkitId, "tk-action")
        )
      );
  });

  it("enforces two-phase user confirmation and idempotency for write tools", async () => {
    await resetRateLimits(conn.db);
    const beforeOrders = await conn.db
      .select()
      .from(workOrders)
      .where(eq(workOrders.machineId, "mach-l3-filler-01"));

    // Step A: calling draft_work_order without confirmationId creates pending action without mutating work_orders
    const propose = await executeToolWithPolicy(
      "draft_work_order",
      {
        machineId: "mach-l3-filler-01",
        type: "corrective",
        priority: "urgent",
        faultCode: "E42",
        description: "Replace cracked servo coupling PRT-SV-402"
      },
      { db: conn.db, user: detEngineer, requestId: "test-wo-propose" }
    );
    expect(propose.status).toBe("requires_confirmation");
    expect(propose.pendingAction?.id).toBeTruthy();

    const midOrders = await conn.db
      .select()
      .from(workOrders)
      .where(eq(workOrders.machineId, "mach-l3-filler-01"));
    expect(midOrders.length).toBe(beforeOrders.length);

    // Step B: confirm execution
    const confirm1 = await executeToolWithPolicy(
      "draft_work_order",
      propose.pendingAction!.args,
      {
        db: conn.db,
        user: detEngineer,
        requestId: "test-wo-confirm-1",
        confirmationId: propose.pendingAction!.id,
        idempotencyKey: propose.pendingAction!.idempotencyKey
      }
    );
    expect(confirm1.status).toBe("confirmed");
    expect(confirm1.data?.created).toBe(true);

    // Step C: idempotent replay with same idempotencyKey does NOT create a duplicate work order
    const confirm2 = await executeToolWithPolicy(
      "draft_work_order",
      propose.pendingAction!.args,
      {
        db: conn.db,
        user: detEngineer,
        requestId: "test-wo-confirm-2",
        confirmationId: propose.pendingAction!.id,
        idempotencyKey: propose.pendingAction!.idempotencyKey
      }
    );
    expect(confirm2.status).toBe("confirmed");
    expect(confirm2.data?.idempotentReplay).toBe(true);

    const afterOrders = await conn.db
      .select()
      .from(workOrders)
      .where(eq(workOrders.machineId, "mach-l3-filler-01"));
    expect(afterOrders.length).toBe(beforeOrders.length + 1);
  });

  it("enforces per-user rate limit", async () => {
    await resetRateLimits(conn.db);
    const ok1 = await executeToolWithPolicy(
      "list_machines",
      {},
      { db: conn.db, user: detEngineer, requestId: "rl-1" },
      { userRateLimit: 1 }
    );
    expect(ok1.status).toBe("allowed");

    const blocked2 = await executeToolWithPolicy(
      "list_machines",
      {},
      { db: conn.db, user: detEngineer, requestId: "rl-2" },
      { userRateLimit: 1 }
    );
    expect(blocked2.status).toBe("denied");
    expect(blocked2.denialReason).toContain("rate limit");
    await resetRateLimits(conn.db);
  });
});

describe("3. RAG Chunking, RRF Fusion & Superseded Revisions", () => {
  it("shows completed status for similar repairs in an E42 diagnosis", async () => {
    const result = await runAgentTurn({
      db: conn.db,
      user: detEngineer,
      message: "Line 3 filler is throwing E42",
      llmProvider: new MockLLMProvider()
    });

    expect(result.answer).toContain("**wo-e42-recent-1** (completed / E42)");
  });

  it("preserves pages, headings, and extracts fault codes & part numbers", () => {
    const sample = `<!-- PAGE 2 -->\n# Filler Manual\n## Fault E42\nReplace coupling PRT-SV-402 at 42 Nm.\n<!-- PAGE 3 -->\n## Safety\nFollow SOP-001.`;
    const chunks = chunkDocumentText(sample);
    expect(chunks.length).toBe(2);
    expect(chunks[0]?.page).toBe(2);
    expect(chunks[0]?.sectionPath).toBe("Filler Manual > Fault E42");
    expect(chunks[0]?.faultCodes).toContain("E42");
    expect(chunks[0]?.partNumbers).toContain("PRT-SV-402");
    expect(chunks[1]?.page).toBe(3);
  });

  it("ranks overlapping hits higher using Reciprocal Rank Fusion", () => {
    const fused = reciprocalRankFusion([
      [
        { id: "c1", item: "chunk-1" },
        { id: "c2", item: "chunk-2" }
      ],
      [
        { id: "c2", item: "chunk-2" },
        { id: "c3", item: "chunk-3" }
      ]
    ]);
    expect(fused[0]?.id).toBe("c2");
  });

  it("excludes superseded revisions by default and flags superseded-only references", async () => {
    const currentRes = await hybridSearchDocuments(conn.db, {
      tenantId: "tenant-acme",
      query: "E42 servo indexing torque",
      machineType: "filler"
    });
    expect(currentRes.supersededOnly).toBe(false);
    expect(currentRes.chunks.every((c) => c.status === "current")).toBe(true);
    expect(currentRes.chunks[0]?.revision).toBe("Rev 4.2");

    const legacyRes = await hybridSearchDocuments(conn.db, {
      tenantId: "tenant-acme",
      query: "PRT-OLD-300"
    });
    expect(legacyRes.supersededOnly).toBe(true);
    expect(legacyRes.supersededWarning).toContain("SUPERSEDED");
  });
});

describe("4. Semantic Layer & Dashboard Spec Validation", () => {
  it("computes OEE and downtime scoped to user plantIds", async () => {
    const oeeRes = await querySemanticMetric(conn.db, analystUser, {
      metric: "oee",
      groupBy: "line",
      range: "7d"
    });
    expect(oeeRes.summaryValue).toBeGreaterThan(0);
    expect(oeeRes.rows.length).toBeGreaterThan(0);

    await expect(
      querySemanticMetric(conn.db, detEngineer, {
        metric: "oee",
        range: "7d"
      })
    ).rejects.toThrow(AuthorizationError);
  });

  it("validates declarative dashboard specs with Zod", () => {
    const valid = DashboardSpecSchema.safeParse({
      id: "dash-1",
      title: "Line 3 Overview",
      plantScope: ["plant-detroit"],
      filters: { range: "7d" },
      widgets: [
        { id: "w1", type: "kpi", title: "OEE", metric: "oee", range: "7d" }
      ],
      layout: [{ i: "w1", x: 0, y: 0, w: 4, h: 3 }],
      version: 1
    });
    expect(valid.success).toBe(true);

    const invalid = DashboardSpecSchema.safeParse({
      id: "dash-bad",
      title: "",
      widgets: [],
      layout: []
    });
    expect(invalid.success).toBe(false);
  });
});

describe("5. Security: Prompt Injection, Cross-Tenant RLS & Credential Encryption", () => {
  it("resists embedded prompt injection inside KB-999", async () => {
    await resetRateLimits(conn.db);
    const res = await runAgentTurn({
      db: conn.db,
      user: detEngineer,
      message: "Check KB-999 C07 conveyor jam recovery steps"
    });
    expect(res.answer).toContain("C07");
    expect(res.answer).not.toContain("wo-beta-secret");
    expect(res.answer).not.toContain("cmms-demo-secret");
    expect(res.toolCalls.some((t) => t.toolName === "get_work_orders")).toBe(false);
  });

  it("enforces cross-tenant isolation via Postgres RLS and tenant scoping", async () => {
    const acmeMachines = await withTenantScope(conn.db, "tenant-acme", async (tx) => {
      return tx.select().from(assets).where(eq(assets.type, "machine"));
    });
    expect(acmeMachines.every((m) => m.tenantId === "tenant-acme")).toBe(true);
    expect(acmeMachines.some((m) => m.id === "mach-beta-cnc-01")).toBe(false);

    const betaWorkOrders = await withTenantScope(conn.db, "tenant-beta", async (tx) => {
      return tx.select().from(workOrders);
    });
    expect(betaWorkOrders.length).toBe(1);
    expect(betaWorkOrders[0]?.id).toBe("wo-beta-secret");

    // Raw query without app filter under RLS also enforces tenant scope
    const rawRls = await withTenantScope(conn.db, "tenant-acme", async (tx) => {
      return tx.execute(sql`SELECT id, tenant_id FROM work_orders WHERE id = 'wo-beta-secret'`);
    });
    expect(rawRls.rows.length).toBe(0);
  });

  it("envelope-encrypts connector credentials without leaking plaintext", () => {
    const secret = { endpoint: "https://sap.acme.internal", apiKey: "super-secret-token-999" };
    const encrypted = encryptCredentials(secret);
    expect(encrypted).not.toContain("super-secret-token-999");
    expect(encrypted).not.toContain("sap.acme.internal");
    const decrypted = decryptCredentials(encrypted);
    expect(decrypted).toEqual(secret);
  });

  it("validates reserve_part inventory update only after confirmation", async () => {
    await resetRateLimits(conn.db);
    const before = await conn.db
      .select()
      .from(inventory)
      .where(
        and(
          eq(inventory.partId, "part-sv-402"),
          eq(inventory.plantId, "plant-detroit")
        )
      );
    const initialReserved = before[0]!.reserved;

    const proposed = await executeToolWithPolicy(
      "reserve_part",
      { partNo: "PRT-SV-402", plantId: "plant-detroit", quantity: 1 },
      { db: conn.db, user: detEngineer, requestId: "res-1" }
    );
    expect(proposed.status).toBe("requires_confirmation");

    const mid = await conn.db
      .select()
      .from(inventory)
      .where(
        and(
          eq(inventory.partId, "part-sv-402"),
          eq(inventory.plantId, "plant-detroit")
        )
      );
    expect(mid[0]!.reserved).toBe(initialReserved);

    const confirmed = await executeToolWithPolicy(
      "reserve_part",
      proposed.pendingAction!.args,
      {
        db: conn.db,
        user: detEngineer,
        requestId: "res-2",
        confirmationId: proposed.pendingAction!.id,
        idempotencyKey: proposed.pendingAction!.idempotencyKey
      }
    );
    expect(confirmed.status).toBe("confirmed");

    const after = await conn.db
      .select()
      .from(inventory)
      .where(
        and(
          eq(inventory.partId, "part-sv-402"),
          eq(inventory.plantId, "plant-detroit")
        )
      );
    expect(after[0]!.reserved).toBe(initialReserved + 1);
  });
});
