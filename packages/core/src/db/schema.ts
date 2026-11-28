import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";

export const vector64 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(64)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    const trimmed = String(value).replace(/^\[|\]$/g, "");
    if (!trimmed) return [];
    return trimmed.split(",").map((v) => Number(v));
  }
});

export const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    const trimmed = String(value).replace(/^\[|\]$/g, "");
    if (!trimmed) return [];
    return trimmed.split(",").map((v) => Number(v));
  }
});

// 1. Multi-tenancy, Plants & Identity
export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").$type<"free" | "individual" | "enterprise">().notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const plants = pgTable(
  "plants",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    timezone: text("timezone").notNull().default("America/Detroit"),
    location: text("location").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("plants_tenant_idx").on(t.tenantId)]
);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").$type<"engineer" | "analyst" | "manager" | "admin">().notNull(),
    active: boolean("active").notNull().default(true),
    tokenVersion: integer("token_version").notNull().default(1),
    passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }),
    externalAuthId: text("external_auth_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    uniqueIndex("users_tenant_email_idx").on(t.tenantId, t.email),
    index("users_email_idx").on(t.email),
    uniqueIndex("users_external_auth_id_idx").on(t.externalAuthId)
  ]
);

export const userPlants = pgTable(
  "user_plants",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    plantId: text("plant_id")
      .notNull()
      .references(() => plants.id, { onDelete: "cascade" })
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.plantId] }),
    index("user_plants_tenant_idx").on(t.tenantId)
  ]
);

// 2. ISA-95 Asset Hierarchy
export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plantId: text("plant_id")
      .notNull()
      .references(() => plants.id, { onDelete: "cascade" }),
    type: text("type")
      .$type<"plant" | "area" | "line" | "machine" | "component">()
      .notNull(),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    machineType: text("machine_type").notNull().default(""),
    manufacturer: text("manufacturer").notNull().default(""),
    model: text("model").notNull().default(""),
    serialNo: text("serial_no").notNull().default(""),
    installDate: text("install_date").notNull().default(""),
    criticality: text("criticality").$type<"A" | "B" | "C">().notNull().default("B"),
    qrCode: text("qr_code").notNull().default(""),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({})
  },
  (t) => [
    index("assets_tenant_plant_idx").on(t.tenantId, t.plantId),
    index("assets_parent_idx").on(t.parentId)
  ]
);

// 3. Machine Status, Alarms & Time-Series Readings
export const machineStatus = pgTable(
  "machine_status",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plantId: text("plant_id")
      .notNull()
      .references(() => plants.id, { onDelete: "cascade" }),
    machineId: text("machine_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<"running" | "idle" | "fault" | "offline">()
      .notNull(),
    currentSpeed: doublePrecision("current_speed").notNull().default(0),
    temperature: doublePrecision("temperature").notNull().default(0),
    vibration: doublePrecision("vibration").notNull().default(0),
    pressure: doublePrecision("pressure").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [uniqueIndex("machine_status_machine_idx").on(t.machineId)]
);

export const alarms = pgTable(
  "alarms",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plantId: text("plant_id")
      .notNull()
      .references(() => plants.id, { onDelete: "cascade" }),
    machineId: text("machine_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    severity: text("severity")
      .$type<"critical" | "high" | "medium" | "low">()
      .notNull(),
    message: text("message").notNull(),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull(),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    acknowledgedBy: text("acknowledged_by")
  },
  (t) => [
    index("alarms_tenant_machine_idx").on(t.tenantId, t.machineId),
    index("alarms_raised_idx").on(t.raisedAt)
  ]
);

export const readings = pgTable(
  "readings",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plantId: text("plant_id")
      .notNull()
      .references(() => plants.id, { onDelete: "cascade" }),
    machineId: text("machine_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    value: doublePrecision("value").notNull(),
    unit: text("unit").notNull(),
    quality: text("quality").notNull().default("good")
  },
  (t) => [
    index("readings_machine_ts_idx").on(t.machineId, t.ts),
    index("readings_tenant_tag_idx").on(t.tenantId, t.tag)
  ]
);

// 4. Fault Taxonomy, Work Orders & Parts ERP
export const failureModes = pgTable(
  "failure_modes",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    isoCode: text("iso_code").notNull(),
    mode: text("mode").notNull(),
    mechanism: text("mechanism").notNull(),
    cause: text("cause").notNull()
  },
  (t) => [index("failure_modes_tenant_idx").on(t.tenantId)]
);

export const faultCodes = pgTable(
  "fault_codes",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    machineType: text("machine_type").notNull(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    standardFailureMode: text("standard_failure_mode").notNull()
  },
  (t) => [index("fault_codes_tenant_code_idx").on(t.tenantId, t.code)]
);

export const workOrders = pgTable(
  "work_orders",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plantId: text("plant_id")
      .notNull()
      .references(() => plants.id, { onDelete: "cascade" }),
    machineId: text("machine_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    componentId: text("component_id"),
    type: text("type")
      .$type<"corrective" | "preventive" | "inspection">()
      .notNull(),
    priority: text("priority")
      .$type<"urgent" | "high" | "medium" | "low">()
      .notNull(),
    status: text("status")
      .$type<"open" | "in_progress" | "completed" | "draft">()
      .notNull(),
    faultCode: text("fault_code").notNull().default(""),
    description: text("description").notNull(),
    resolution: text("resolution").notNull().default(""),
    partsUsed: jsonb("parts_used")
      .$type<Array<{ partNo: string; qty: number }>>()
      .default([]),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    technician: text("technician").notNull().default(""),
    idempotencyKey: text("idempotency_key")
  },
  (t) => [
    index("work_orders_tenant_machine_idx").on(t.tenantId, t.machineId),
    index("work_orders_fault_idx").on(t.faultCode),
    uniqueIndex("work_orders_idemp_idx").on(t.tenantId, t.idempotencyKey)
  ]
);

export const parts = pgTable(
  "parts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    partNo: text("part_no").notNull(),
    description: text("description").notNull(),
    compatibleMachineTypes: jsonb("compatible_machine_types")
      .$type<string[]>()
      .notNull()
      .default([]),
    bomLinks: jsonb("bom_links").$type<string[]>().notNull().default([]),
    unitCostUsd: doublePrecision("unit_cost_usd").notNull().default(0)
  },
  (t) => [uniqueIndex("parts_tenant_partno_idx").on(t.tenantId, t.partNo)]
);

export const inventory = pgTable(
  "inventory",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    partId: text("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    plantId: text("plant_id")
      .notNull()
      .references(() => plants.id, { onDelete: "cascade" }),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    minLevel: integer("min_level").notNull().default(1),
    location: text("location").notNull(),
    leadTimeDays: integer("lead_time_days").notNull().default(5)
  },
  (t) => [uniqueIndex("inventory_part_plant_idx").on(t.partId, t.plantId)]
);

// 5. MES Production, Quality, Downtime & Energy
export const productionRuns = pgTable(
  "production_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plantId: text("plant_id")
      .notNull()
      .references(() => plants.id, { onDelete: "cascade" }),
    lineId: text("line_id").notNull(),
    machineId: text("machine_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    shift: text("shift").$type<"A" | "B" | "C">().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    plannedTimeMin: doublePrecision("planned_time_min").notNull(),
    runTimeMin: doublePrecision("run_time_min").notNull(),
    goodCount: integer("good_count").notNull(),
    scrapCount: integer("scrap_count").notNull(),
    idealCycleTimeSec: doublePrecision("ideal_cycle_time_sec").notNull()
  },
  (t) => [index("production_runs_tenant_ts_idx").on(t.tenantId, t.startedAt)]
);

export const qualityEvents = pgTable(
  "quality_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plantId: text("plant_id")
      .notNull()
      .references(() => plants.id, { onDelete: "cascade" }),
    machineId: text("machine_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => productionRuns.id, {
      onDelete: "set null"
    }),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    defectType: text("defect_type").notNull(),
    scrapCount: integer("scrap_count").notNull(),
    notes: text("notes").notNull().default("")
  },
  (t) => [index("quality_events_tenant_ts_idx").on(t.tenantId, t.ts)]
);

export const downtimeEvents = pgTable(
  "downtime_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plantId: text("plant_id")
      .notNull()
      .references(() => plants.id, { onDelete: "cascade" }),
    machineId: text("machine_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    start: timestamp("start", { withTimezone: true }).notNull(),
    end: timestamp("end", { withTimezone: true }).notNull(),
    durationMin: doublePrecision("duration_min").notNull(),
    reasonCode: text("reason_code").notNull(),
    category: text("category").notNull(),
    notes: text("notes").notNull().default("")
  },
  (t) => [index("downtime_events_tenant_start_idx").on(t.tenantId, t.start)]
);

export const energyReadings = pgTable(
  "energy_readings",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plantId: text("plant_id")
      .notNull()
      .references(() => plants.id, { onDelete: "cascade" }),
    machineId: text("machine_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    kwh: doublePrecision("kwh").notNull(),
    peakKw: doublePrecision("peak_kw").notNull()
  },
  (t) => [index("energy_readings_tenant_ts_idx").on(t.tenantId, t.ts)]
);

// 6. Knowledge Base & RAG
export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    type: text("type")
      .$type<"manual" | "sop" | "policy" | "kb" | "datasheet">()
      .notNull(),
    machineTypes: jsonb("machine_types").$type<string[]>().notNull().default([]),
    revision: text("revision").notNull(),
    status: text("status").$type<"current" | "superseded">().notNull(),
    effectiveDate: text("effective_date").notNull(),
    source: text("source").notNull(),
    ingestionStatus: text("ingestion_status")
      .$type<"pending" | "processing" | "completed" | "failed">()
      .notNull()
      .default("completed"),
    ingestionError: text("ingestion_error"),
    rawContent: text("raw_content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("documents_tenant_status_idx").on(t.tenantId, t.status)]
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    page: integer("page").notNull().default(1),
    sectionPath: text("section_path").notNull().default("Overview"),
    text: text("text").notNull(),
    embedding: vector64("embedding").notNull(),
    denseEmbedding: vector1536("dense_embedding"),
    embeddingModel: text("embedding_model").notNull().default("local-deterministic-64"),
    faultCodes: jsonb("fault_codes").$type<string[]>().notNull().default([]),
    partNumbers: jsonb("part_numbers").$type<string[]>().notNull().default([])
  },
  (t) => [index("document_chunks_doc_idx").on(t.documentId)]
);

// 7. Chat, Feedback, Dashboards, Connectors, Toolkits & Audit
export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    machineId: text("machine_id"),
    title: text("title").notNull(),
    shareToken: text("share_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("conversations_user_idx").on(t.tenantId, t.userId)]
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant" | "system">().notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls").$type<Array<Record<string, unknown>>>().default([]),
    citations: jsonb("citations").$type<Array<Record<string, unknown>>>().default([]),
    charts: jsonb("charts").$type<Array<Record<string, unknown>>>().default([]),
    safetyWarning: text("safety_warning"),
    pendingActionId: text("pending_action_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("messages_conv_idx").on(t.conversationId, t.createdAt)]
);

export const feedback = pgTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: text("rating").$type<"up" | "down">().notNull(),
    outcome: text("outcome").$type<"fixed_it" | "not_helpful" | "wrong" | null>(),
    comment: text("comment").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("feedback_tenant_msg_idx").on(t.tenantId, t.messageId)]
);

export const dashboards = pgTable(
  "dashboards",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    plantScope: jsonb("plant_scope").$type<string[]>().notNull().default([]),
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
    currentVersion: integer("current_version").notNull().default(1),
    isTemplate: boolean("is_template").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("dashboards_tenant_idx").on(t.tenantId)]
);

export const dashboardVersions = pgTable(
  "dashboard_versions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    dashboardId: text("dashboard_id")
      .notNull()
      .references(() => dashboards.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
    createdBy: text("created_by").notNull(),
    changeSummary: text("change_summary").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    uniqueIndex("dashboard_versions_uniq").on(t.dashboardId, t.version)
  ]
);

export const dashboardShares = pgTable(
  "dashboard_shares",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    dashboardId: text("dashboard_id")
      .notNull()
      .references(() => dashboards.id, { onDelete: "cascade" }),
    shareType: text("share_type").$type<"role" | "plant">().notNull(),
    targetId: text("target_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("dashboard_shares_dash_idx").on(t.dashboardId)]
);

export const connectors = pgTable(
  "connectors",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    status: text("status")
      .$type<"healthy" | "degraded" | "error">()
      .notNull()
      .default("healthy"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }).defaultNow(),
    lastError: text("last_error"),
    encryptedCredentials: text("encrypted_credentials").notNull().default(""),
    config: jsonb("config").$type<Record<string, unknown>>().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [uniqueIndex("connectors_tenant_kind_idx").on(t.tenantId, t.kind)]
);

export const toolkits = pgTable(
  "toolkits",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull()
  },
  (t) => [uniqueIndex("toolkits_tenant_name_idx").on(t.tenantId, t.name)]
);

export const toolkitTools = pgTable(
  "toolkit_tools",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    toolkitId: text("toolkit_id")
      .notNull()
      .references(() => toolkits.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    enabled: boolean("enabled").notNull().default(true)
  },
  (t) => [uniqueIndex("toolkit_tools_uniq").on(t.tenantId, t.toolkitId, t.toolName)]
);

export const roleToolkits = pgTable(
  "role_toolkits",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    role: text("role").$type<"engineer" | "analyst" | "manager" | "admin">().notNull(),
    toolkitId: text("toolkit_id")
      .notNull()
      .references(() => toolkits.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true)
  },
  (t) => [uniqueIndex("role_toolkits_uniq").on(t.tenantId, t.role, t.toolkitId)]
);

export const pendingActions = pgTable(
  "pending_actions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id"),
    toolName: text("tool_name").notNull(),
    args: jsonb("args").$type<Record<string, unknown>>().notNull(),
    summary: text("summary").notNull(),
    status: text("status")
      .$type<"pending" | "confirmed" | "cancelled" | "executed">()
      .notNull()
      .default("pending"),
    idempotencyKey: text("idempotency_key").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true })
  },
  (t) => [uniqueIndex("pending_actions_idemp_idx").on(t.tenantId, t.idempotencyKey)]
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    conversationId: text("conversation_id"),
    action: text("action").notNull().default("tool_call"),
    toolName: text("tool_name").notNull(),
    args: jsonb("args").$type<Record<string, unknown>>().default({}),
    resultHash: text("result_hash").notNull().default(""),
    status: text("status")
      .$type<"allowed" | "denied" | "confirmed" | "error">()
      .notNull(),
    reason: text("reason").notNull().default(""),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    index("audit_log_tenant_ts_idx").on(t.tenantId, t.createdAt),
    index("audit_log_tool_status_idx").on(t.toolName, t.status)
  ]
);

export const usageLog = pgTable(
  "usage_log",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    conversationId: text("conversation_id"),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    estimatedCostUsd: doublePrecision("estimated_cost_usd").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("usage_log_tenant_ts_idx").on(t.tenantId, t.createdAt)]
);

// 8. Workflows
export const workflows = pgTable(
  "workflows",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plantId: text("plant_id").references(() => plants.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    triggerType: text("trigger_type")
      .$type<"manual" | "schedule" | "alert" | "connector">()
      .notNull()
      .default("manual"),
    triggerConfig: jsonb("trigger_config").$type<Record<string, unknown>>().notNull().default({}),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    currentVersion: integer("current_version").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("workflows_tenant_idx").on(t.tenantId)]
);

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
    changeSummary: text("change_summary").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [uniqueIndex("workflow_versions_uniq").on(t.workflowId, t.version)]
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    status: text("status")
      .$type<"queued" | "running" | "succeeded" | "failed">()
      .notNull()
      .default("queued"),
    triggerSource: text("trigger_source").notNull().default("manual"),
    triggeredBy: text("triggered_by").notNull().default("system"),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb("output").$type<Record<string, unknown>>(),
    stepTraces: jsonb("step_traces").$type<Array<Record<string, unknown>>>().notNull().default([]),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (t) => [index("workflow_runs_tenant_wf_idx").on(t.tenantId, t.workflowId, t.startedAt)]
);

// 9. Connector Hub
export const connectorConnections = pgTable(
  "connector_connections",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    category: text("category")
      .$type<"mcp" | "http" | "scada" | "erp" | "messaging" | "custom">()
      .notNull()
      .default("custom"),
    transport: text("transport")
      .$type<"in_memory_mcp" | "lutic_protocol" | "remote_mcp" | "utcp_http" | "http" | "webhook" | "simulated">()
      .notNull()
      .default("simulated"),
    endpointUrl: text("endpoint_url").notNull().default(""),
    status: text("status")
      .$type<"connected" | "degraded" | "disconnected" | "error">()
      .notNull()
      .default("connected"),
    encryptedCredentials: text("encrypted_credentials").notNull().default(""),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    discoveredTools: jsonb("discovered_tools")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [uniqueIndex("connector_connections_tenant_slug_idx").on(t.tenantId, t.slug)]
);

export const connectorTriggers = pgTable(
  "connector_triggers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connectorConnections.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    eventType: text("event_type").notNull(),
    workflowId: text("workflow_id").references(() => workflows.id, { onDelete: "set null" }),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("connector_triggers_conn_idx").on(t.tenantId, t.connectionId)]
);

export const connectorSyncLogs = pgTable(
  "connector_sync_logs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connectorConnections.id, { onDelete: "cascade" }),
    direction: text("direction")
      .$type<"inbound" | "outbound" | "test" | "invoke" | "code-mode">()
      .notNull()
      .default("inbound"),
    status: text("status").$type<"success" | "partial" | "failed">().notNull(),
    recordsSynced: integer("records_synced").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    message: text("message").notNull().default(""),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("connector_sync_logs_conn_ts_idx").on(t.tenantId, t.connectionId, t.createdAt)]
);

// 10. Notifications & Queues (Lutic Pub/Sub Topics & Dispatch Queues)
export const topics = pgTable(
  "topics",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [uniqueIndex("topics_tenant_name_idx").on(t.tenantId, t.name)]
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    protocol: text("protocol").$type<"in_app" | "queue" | "workflow" | "webhook">().notNull(),
    endpoint: text("endpoint").notNull(),
    filterPolicy: jsonb("filter_policy").$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("subscriptions_topic_idx").on(t.tenantId, t.topicId)]
);

export const queues = pgTable(
  "queues",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    visibilityTimeoutSec: integer("visibility_timeout_sec").notNull().default(30),
    maxReceiveCount: integer("max_receive_count").notNull().default(3),
    deadLetterQueueId: text("dead_letter_queue_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [uniqueIndex("queues_tenant_name_idx").on(t.tenantId, t.name)]
);

export const queueMessages = pgTable(
  "queue_messages",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    queueId: text("queue_id")
      .notNull()
      .references(() => queues.id, { onDelete: "cascade" }),
    body: jsonb("body").$type<Record<string, unknown>>().notNull(),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status")
      .$type<"ready" | "in_flight" | "acked" | "dead_letter">()
      .notNull()
      .default("ready"),
    receiveCount: integer("receive_count").notNull().default(0),
    receiptHandle: text("receipt_handle"),
    visibleAt: timestamp("visible_at", { withTimezone: true }).defaultNow().notNull(),
    enqueuedAt: timestamp("enqueued_at", { withTimezone: true }).defaultNow().notNull(),
    ackedAt: timestamp("acked_at", { withTimezone: true })
  },
  (t) => [index("queue_messages_queue_status_idx").on(t.tenantId, t.queueId, t.status, t.visibleAt)]
);

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    topicId: text("topic_id").references(() => topics.id, { onDelete: "set null" }),
    channel: text("channel")
      .$type<"in_app" | "local_push" | "alert" | "workflow">()
      .notNull()
      .default("in_app"),
    severity: text("severity")
      .$type<"info" | "warning" | "high" | "critical">()
      .notNull()
      .default("info"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    read: boolean("read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("notifications_tenant_user_idx").on(t.tenantId, t.userId, t.read, t.createdAt)]
);

// 11. Monitoring & Alerts
export const alertRules = pgTable(
  "alert_rules",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plantId: text("plant_id").references(() => plants.id, { onDelete: "set null" }),
    machineId: text("machine_id").references(() => assets.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    metricTag: text("metric_tag").notNull(),
    operator: text("operator").$type<"gt" | "gte" | "lt" | "lte" | "eq">().notNull().default("gt"),
    threshold: doublePrecision("threshold").notNull(),
    severity: text("severity").$type<"critical" | "high" | "medium" | "low">().notNull().default("high"),
    evaluationWindowMin: integer("evaluation_window_min").notNull().default(5),
    state: text("state")
      .$type<"OK" | "ALARM" | "INSUFFICIENT_DATA">()
      .notNull()
      .default("OK"),
    notifyTopicId: text("notify_topic_id").references(() => topics.id, { onDelete: "set null" }),
    workflowId: text("workflow_id").references(() => workflows.id, { onDelete: "set null" }),
    enabled: boolean("enabled").notNull().default(true),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("alert_rules_tenant_idx").on(t.tenantId, t.enabled)]
);

export const alertEvents = pgTable(
  "alert_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").references(() => alertRules.id, { onDelete: "set null" }),
    plantId: text("plant_id").references(() => plants.id, { onDelete: "set null" }),
    machineId: text("machine_id").references(() => assets.id, { onDelete: "set null" }),
    status: text("status")
      .$type<"OK" | "ALARM" | "ACKNOWLEDGED" | "RESOLVED">()
      .notNull()
      .default("ALARM"),
    severity: text("severity").$type<"critical" | "high" | "medium" | "low">().notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    metricTag: text("metric_tag").notNull().default(""),
    metricValue: doublePrecision("metric_value"),
    threshold: doublePrecision("threshold"),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).defaultNow().notNull(),
    acknowledgedBy: text("acknowledged_by"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true })
  },
  (t) => [index("alert_events_tenant_status_idx").on(t.tenantId, t.status, t.triggeredAt)]
);

// 12. Instance License State (global, not tenant-scoped)
export const revokedSessions = pgTable("revoked_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
}, (t) => [index("revoked_sessions_expiry_idx").on(t.expiresAt)]);

export const licenseState = pgTable("license_state", {
  id: text("id").primaryKey(),
  licenseKey: text("license_key").notNull().default(""),
  serverUrl: text("server_url").notNull().default(""),
  instanceId: text("instance_id").notNull().default(""),
  status: text("status")
    .$type<"unactivated" | "active" | "invalid" | "revoked" | "expired">()
    .notNull()
    .default("unactivated"),
  plan: text("plan").notNull().default(""),
  signature: text("signature").notNull().default(""),
  reason: text("reason").notNull().default(""),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

// 13. Schema Migration Baseline & Dedicated Ingestion Service Identities
export const schemaMigrations = pgTable("schema_migrations", {
  version: integer("version").primaryKey(),
  name: text("name").notNull(),
  checksum: text("checksum").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull()
});

export const ingestionTokens = pgTable(
  "ingestion_tokens",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plantId: text("plant_id")
      .notNull()
      .references(() => plants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(["telemetry:write"]),
    active: boolean("active").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    rotatedFromId: text("rotated_from_id"),
    createdBy: text("created_by").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    uniqueIndex("ingestion_tokens_hash_idx").on(t.tokenHash),
    index("ingestion_tokens_tenant_plant_idx").on(t.tenantId, t.plantId)
  ]
);

// 14. Operations & Project Execution Board
export const boardIssues = pgTable(
  "board_issues",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plantId: text("plant_id").references(() => plants.id, { onDelete: "set null" }),
    identifier: text("identifier").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status")
      .$type<"backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled">()
      .notNull()
      .default("todo"),
    priority: text("priority")
      .$type<"urgent" | "high" | "medium" | "low">()
      .notNull()
      .default("medium"),
    category: text("category")
      .$type<"operations" | "automation" | "incident" | "connector" | "agent">()
      .notNull()
      .default("operations"),
    assigneeName: text("assignee_name").notNull().default(""),
    labels: jsonb("labels").$type<string[]>().notNull().default([]),
    sourceRef: text("source_ref").notNull().default(""),
    dueDate: text("due_date").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    uniqueIndex("board_issues_tenant_identifier_idx").on(t.tenantId, t.identifier),
    index("board_issues_tenant_status_idx").on(t.tenantId, t.status)
  ]
);

// 15. Per-Tenant Customizable Sandbox Services & Agent Skills
export const sandboxServices = pgTable(
  "sandbox_services",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    serviceId: text("service_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    pinnedToDashboard: boolean("pinned_to_dashboard").notNull().default(true),
    enabledSkills: jsonb("enabled_skills").$type<string[]>().notNull().default([]),
    agentInstructions: text("agent_instructions").notNull().default(""),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    uniqueIndex("sandbox_services_tenant_service_idx").on(t.tenantId, t.serviceId),
    index("sandbox_services_tenant_idx").on(t.tenantId)
  ]
);

// 16. Dedicated Worker Heartbeat (global operational telemetry, not tenant-scoped)
export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  hostname: text("hostname").notNull().default(""),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  lastTickAt: timestamp("last_tick_at", { withTimezone: true }).notNull(),
  lastTickDurationMs: integer("last_tick_duration_ms").notNull().default(0),
  tickCount: integer("tick_count").notNull().default(0),
  lastError: text("last_error"),
  summary: jsonb("summary").$type<Record<string, unknown>>().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});
