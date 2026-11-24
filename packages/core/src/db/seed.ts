import { eq } from "drizzle-orm";
import { createDbConnection, type DbConnection } from "./client";
import { ensureSchema } from "./migrate";
import * as schema from "./schema";
import { encryptCredentials, hashPassword } from "../crypto";
import { chunkDocumentText, computeDeterministicEmbedding } from "../rag-utils";
import { SEED_DOCUMENTS } from "./seed-manuals";
import type { DashboardSpec } from "../dashboard/schema";
import { installCoreToolkits, installPaasToolkit } from "./core-toolkits";

export const DEMO_PASSWORD = "lutic-demo-password";

interface MachineBlueprint {
  id: string;
  plantId: string;
  lineId: string;
  name: string;
  machineType: string;
  manufacturer: string;
  model: string;
  criticality: "A" | "B" | "C";
  status: "running" | "idle" | "fault" | "offline";
}

function buildDemoMachines(): MachineBlueprint[] {
  const detMachines: MachineBlueprint[] = [
    // Line 1 - Machining & Stamping (7)
    { id: "mach-l1-cnc-01", plantId: "plant-detroit", lineId: "line-det-1", name: "Line 1 CNC Mill #1", machineType: "cnc", manufacturer: "Mazak", model: "VCN-530C", criticality: "A", status: "fault" },
    { id: "mach-l1-cnc-02", plantId: "plant-detroit", lineId: "line-det-1", name: "Line 1 CNC Mill #2", machineType: "cnc", manufacturer: "Mazak", model: "VCN-530C", criticality: "A", status: "running" },
    { id: "mach-l1-press-01", plantId: "plant-detroit", lineId: "line-det-1", name: "Line 1 Hydraulic Press #1", machineType: "press", manufacturer: "Schuler", model: "HP-250", criticality: "A", status: "running" },
    { id: "mach-l1-press-02", plantId: "plant-detroit", lineId: "line-det-1", name: "Line 1 Hydraulic Press #2", machineType: "press", manufacturer: "Schuler", model: "HP-250", criticality: "B", status: "idle" },
    { id: "mach-l1-robot-01", plantId: "plant-detroit", lineId: "line-det-1", name: "Line 1 Load Robot Cell", machineType: "robot_cell", manufacturer: "FANUC", model: "R-2000iC", criticality: "A", status: "running" },
    { id: "mach-l1-conv-01", plantId: "plant-detroit", lineId: "line-det-1", name: "Line 1 Transfer Conveyor", machineType: "conveyor", manufacturer: "Dorner", model: "2200-HD", criticality: "C", status: "running" },
    { id: "mach-l1-comp-01", plantId: "plant-detroit", lineId: "line-det-1", name: "Line 1 Air Compressor", machineType: "compressor", manufacturer: "Atlas Copco", model: "GA-90", criticality: "A", status: "running" },

    // Line 2 - Molding & Assembly (6)
    { id: "mach-l2-mold-01", plantId: "plant-detroit", lineId: "line-det-2", name: "Line 2 Injection Molder #1", machineType: "injection_molder", manufacturer: "Engel", model: "Victory 220", criticality: "A", status: "fault" },
    { id: "mach-l2-mold-02", plantId: "plant-detroit", lineId: "line-det-2", name: "Line 2 Injection Molder #2", machineType: "injection_molder", manufacturer: "Engel", model: "Victory 220", criticality: "A", status: "running" },
    { id: "mach-l2-mold-03", plantId: "plant-detroit", lineId: "line-det-2", name: "Line 2 Injection Molder #3", machineType: "injection_molder", manufacturer: "Engel", model: "Victory 220", criticality: "B", status: "running" },
    { id: "mach-l2-robot-01", plantId: "plant-detroit", lineId: "line-det-2", name: "Line 2 Pick Robot Cell", machineType: "robot_cell", manufacturer: "FANUC", model: "R-2000iC", criticality: "A", status: "running" },
    { id: "mach-l2-conv-01", plantId: "plant-detroit", lineId: "line-det-2", name: "Line 2 Cooling Conveyor", machineType: "conveyor", manufacturer: "Dorner", model: "3200-Series", criticality: "C", status: "running" },
    { id: "mach-l2-press-01", plantId: "plant-detroit", lineId: "line-det-2", name: "Line 2 Trim Press", machineType: "press", manufacturer: "Schuler", model: "HP-120", criticality: "B", status: "idle" },

    // Line 3 - High-Speed Bottling & Packaging (7)
    { id: "mach-l3-filler-01", plantId: "plant-detroit", lineId: "line-det-3", name: "Line 3 Rotary Filler #1", machineType: "filler", manufacturer: "Krones", model: "RF-400", criticality: "A", status: "fault" },
    { id: "mach-l3-filler-02", plantId: "plant-detroit", lineId: "line-det-3", name: "Line 3 Rotary Filler #2", machineType: "filler", manufacturer: "Krones", model: "RF-400", criticality: "A", status: "running" },
    { id: "mach-l3-pack-01", plantId: "plant-detroit", lineId: "line-det-3", name: "Line 3 Case Packer #1", machineType: "packaging_line", manufacturer: "Sidel", model: "Cermex WB46", criticality: "A", status: "running" },
    { id: "mach-l3-pack-02", plantId: "plant-detroit", lineId: "line-det-3", name: "Line 3 Shrink Wrapper", machineType: "packaging_line", manufacturer: "Sidel", model: "EvoFilm-45", criticality: "B", status: "running" },
    { id: "mach-l3-conv-01", plantId: "plant-detroit", lineId: "line-det-3", name: "Line 3 Infeed Conveyor", machineType: "conveyor", manufacturer: "Dorner", model: "2200-HD", criticality: "B", status: "running" },
    { id: "mach-l3-robot-01", plantId: "plant-detroit", lineId: "line-det-3", name: "Line 3 Palletizer Robot", machineType: "robot_cell", manufacturer: "FANUC", model: "M-410iC", criticality: "A", status: "running" },
    { id: "mach-l3-comp-01", plantId: "plant-detroit", lineId: "line-det-3", name: "Line 3 Booster Compressor", machineType: "compressor", manufacturer: "Atlas Copco", model: "GA-90", criticality: "B", status: "offline" }
  ];

  const ausMachines: MachineBlueprint[] = [
    // Austin Line A - CNC Cell (7)
    { id: "mach-aus-cnc-01", plantId: "plant-austin", lineId: "line-aus-1", name: "Austin Line A CNC #1", machineType: "cnc", manufacturer: "Mazak", model: "VCN-530C", criticality: "A", status: "running" },
    { id: "mach-aus-cnc-02", plantId: "plant-austin", lineId: "line-aus-1", name: "Austin Line A CNC #2", machineType: "cnc", manufacturer: "Mazak", model: "VCN-530C", criticality: "A", status: "running" },
    { id: "mach-aus-cnc-03", plantId: "plant-austin", lineId: "line-aus-1", name: "Austin Line A CNC #3", machineType: "cnc", manufacturer: "Mazak", model: "VCN-530C", criticality: "B", status: "idle" },
    { id: "mach-aus-robot-01", plantId: "plant-austin", lineId: "line-aus-1", name: "Austin Line A Tend Robot", machineType: "robot_cell", manufacturer: "FANUC", model: "R-2000iC", criticality: "A", status: "running" },
    { id: "mach-aus-conv-01", plantId: "plant-austin", lineId: "line-aus-1", name: "Austin Line A Chip Conveyor", machineType: "conveyor", manufacturer: "Dorner", model: "2200-HD", criticality: "C", status: "running" },
    { id: "mach-aus-press-01", plantId: "plant-austin", lineId: "line-aus-1", name: "Austin Line A Deburr Press", machineType: "press", manufacturer: "Schuler", model: "HP-120", criticality: "B", status: "running" },
    { id: "mach-aus-comp-01", plantId: "plant-austin", lineId: "line-aus-1", name: "Austin Plant Air Compressor #1", machineType: "compressor", manufacturer: "Atlas Copco", model: "GA-90", criticality: "A", status: "fault" },

    // Austin Line B - Injection Molding (7)
    { id: "mach-aus-mold-01", plantId: "plant-austin", lineId: "line-aus-2", name: "Austin Line B Molder #1", machineType: "injection_molder", manufacturer: "Engel", model: "Victory 220", criticality: "A", status: "running" },
    { id: "mach-aus-mold-02", plantId: "plant-austin", lineId: "line-aus-2", name: "Austin Line B Molder #2", machineType: "injection_molder", manufacturer: "Engel", model: "Victory 220", criticality: "A", status: "running" },
    { id: "mach-aus-mold-03", plantId: "plant-austin", lineId: "line-aus-2", name: "Austin Line B Molder #3", machineType: "injection_molder", manufacturer: "Engel", model: "Victory 220", criticality: "B", status: "running" },
    { id: "mach-aus-robot-02", plantId: "plant-austin", lineId: "line-aus-2", name: "Austin Line B Sprue Robot", machineType: "robot_cell", manufacturer: "FANUC", model: "R-2000iC", criticality: "A", status: "running" },
    { id: "mach-aus-conv-02", plantId: "plant-austin", lineId: "line-aus-2", name: "Austin Line B Part Conveyor", machineType: "conveyor", manufacturer: "Dorner", model: "3200-Series", criticality: "C", status: "running" },
    { id: "mach-aus-press-02", plantId: "plant-austin", lineId: "line-aus-2", name: "Austin Line B Insert Press", machineType: "press", manufacturer: "Schuler", model: "HP-250", criticality: "B", status: "running" },
    { id: "mach-aus-pack-01", plantId: "plant-austin", lineId: "line-aus-2", name: "Austin Line B Tray Packer", machineType: "packaging_line", manufacturer: "Sidel", model: "Cermex WB46", criticality: "B", status: "idle" },

    // Austin Line C - Packaging & Fill (6)
    { id: "mach-aus-filler-01", plantId: "plant-austin", lineId: "line-aus-3", name: "Austin Line C Filler #1", machineType: "filler", manufacturer: "Krones", model: "RF-400", criticality: "A", status: "running" },
    { id: "mach-aus-filler-02", plantId: "plant-austin", lineId: "line-aus-3", name: "Austin Line C Filler #2", machineType: "filler", manufacturer: "Krones", model: "RF-400", criticality: "A", status: "running" },
    { id: "mach-aus-pack-02", plantId: "plant-austin", lineId: "line-aus-3", name: "Austin Line C Case Packer", machineType: "packaging_line", manufacturer: "Sidel", model: "Cermex WB46", criticality: "A", status: "running" },
    { id: "mach-aus-conv-03", plantId: "plant-austin", lineId: "line-aus-3", name: "Austin Line C Outfeed Conveyor", machineType: "conveyor", manufacturer: "Dorner", model: "3200-Series", criticality: "B", status: "running" },
    { id: "mach-aus-robot-03", plantId: "plant-austin", lineId: "line-aus-3", name: "Austin Line C Palletizer", machineType: "robot_cell", manufacturer: "FANUC", model: "M-410iC", criticality: "A", status: "running" },
    { id: "mach-aus-comp-02", plantId: "plant-austin", lineId: "line-aus-3", name: "Austin Line C Backup Compressor", machineType: "compressor", manufacturer: "Atlas Copco", model: "GA-90", criticality: "C", status: "offline" }
  ];

  return [...detMachines, ...ausMachines];
}

function deterministicRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export async function seedDatabase(conn?: DbConnection): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo seeding is disabled in production");
  }
  const connection = conn ?? (await createDbConnection());
  const db = connection.db;
  await ensureSchema(connection);

  // Check if core seed already exists
  const existing = await db.select().from(schema.tenants).limit(1);
  const now = new Date();
  if (existing.length === 0) {
    const rand = deterministicRand(20261118);
    const demoPassHash = hashPassword(DEMO_PASSWORD);

  // 1. Tenants & Plants
  await db.insert(schema.tenants).values([
    { id: "tenant-acme", name: "Acme Industrial Manufacturing", slug: "acme-mfg" },
    { id: "tenant-beta", name: "Beta Precision Corp", slug: "beta-corp" }
  ]);

  await db.insert(schema.plants).values([
    {
      id: "plant-detroit",
      tenantId: "tenant-acme",
      name: "Detroit Assembly & Packaging",
      code: "DET-01",
      timezone: "America/Detroit",
      location: "Detroit, MI"
    },
    {
      id: "plant-austin",
      tenantId: "tenant-acme",
      name: "Austin Precision Machining",
      code: "AUS-02",
      timezone: "America/Chicago",
      location: "Austin, TX"
    },
    {
      id: "plant-beta-01",
      tenantId: "tenant-beta",
      name: "Beta Monterrey Plant",
      code: "BTA-01",
      timezone: "America/Monterrey",
      location: "Monterrey, MX"
    }
  ]);

  // 2. Users & Plant Scoping
  const seedUsers = [
    { id: "user-det-eng", tenantId: "tenant-acme", email: "engineer@acme.demo", name: "Marcus Vance (Floor Engineer)", role: "engineer" as const, plants: ["plant-detroit"] },
    { id: "user-aus-eng", tenantId: "tenant-acme", email: "austin.engineer@acme.demo", name: "Elena Rostova (Austin Engineer)", role: "engineer" as const, plants: ["plant-austin"] },
    { id: "user-analyst", tenantId: "tenant-acme", email: "analyst@acme.demo", name: "Priya Nair (Process Analyst)", role: "analyst" as const, plants: ["plant-detroit", "plant-austin"] },
    { id: "user-det-analyst", tenantId: "tenant-acme", email: "detroit.analyst@acme.demo", name: "Devon Brooks (Detroit Analyst)", role: "analyst" as const, plants: ["plant-detroit"] },
    { id: "user-manager", tenantId: "tenant-acme", email: "manager@acme.demo", name: "Sarah Chen (Plant Director)", role: "manager" as const, plants: ["plant-detroit", "plant-austin"] },
    { id: "user-det-mgr", tenantId: "tenant-acme", email: "detroit.manager@acme.demo", name: "Carlos Vega (Detroit Manager)", role: "manager" as const, plants: ["plant-detroit"] },
    { id: "user-admin", tenantId: "tenant-acme", email: "admin@acme.demo", name: "Alex Rivera (OT/IT Admin)", role: "admin" as const, plants: ["plant-detroit", "plant-austin"] },
    { id: "user-beta-admin", tenantId: "tenant-beta", email: "user@beta.demo", name: "Beta Operations Lead", role: "admin" as const, plants: ["plant-beta-01"] }
  ];

  await db.insert(schema.users).values(
    seedUsers.map((u) => ({
      id: u.id,
      tenantId: u.tenantId,
      email: u.email,
      name: u.name,
      passwordHash: demoPassHash,
      role: u.role,
      active: true
    }))
  );

  await db.insert(schema.userPlants).values(
    seedUsers.flatMap((u) =>
      u.plants.map((plantId) => ({
        tenantId: u.tenantId,
        userId: u.id,
        plantId
      }))
    )
  );

  // 3. ISA-95 Asset Hierarchy (Plants -> Lines -> 40 Machines + Components)
  const lineAssets = [
    { id: "asset-plant-detroit", tenantId: "tenant-acme", plantId: "plant-detroit", type: "plant" as const, parentId: null, name: "Detroit Plant Root" },
    { id: "asset-plant-austin", tenantId: "tenant-acme", plantId: "plant-austin", type: "plant" as const, parentId: null, name: "Austin Plant Root" },
    { id: "line-det-1", tenantId: "tenant-acme", plantId: "plant-detroit", type: "line" as const, parentId: "asset-plant-detroit", name: "Detroit Line 1 — Machining & Stamping" },
    { id: "line-det-2", tenantId: "tenant-acme", plantId: "plant-detroit", type: "line" as const, parentId: "asset-plant-detroit", name: "Detroit Line 2 — Molding & Assembly" },
    { id: "line-det-3", tenantId: "tenant-acme", plantId: "plant-detroit", type: "line" as const, parentId: "asset-plant-detroit", name: "Detroit Line 3 — Bottling & Packaging" },
    { id: "line-aus-1", tenantId: "tenant-acme", plantId: "plant-austin", type: "line" as const, parentId: "asset-plant-austin", name: "Austin Line A — CNC Cell" },
    { id: "line-aus-2", tenantId: "tenant-acme", plantId: "plant-austin", type: "line" as const, parentId: "asset-plant-austin", name: "Austin Line B — Injection Molding" },
    { id: "line-aus-3", tenantId: "tenant-acme", plantId: "plant-austin", type: "line" as const, parentId: "asset-plant-austin", name: "Austin Line C — Packaging & Fill" }
  ];

  const machines = buildDemoMachines();
  await db.insert(schema.assets).values([
    ...lineAssets.map((l) => ({
      ...l,
      machineType: "",
      manufacturer: "",
      model: "",
      serialNo: "",
      installDate: "2022-01-15",
      criticality: "A" as const,
      qrCode: `/m/${l.id}`,
      metadata: {}
    })),
    ...machines.map((m, idx) => ({
      id: m.id,
      tenantId: "tenant-acme",
      plantId: m.plantId,
      type: "machine" as const,
      parentId: m.lineId,
      name: m.name,
      machineType: m.machineType,
      manufacturer: m.manufacturer,
      model: m.model,
      serialNo: `SN-${m.plantId.slice(6, 9).toUpperCase()}-${1000 + idx}`,
      installDate: `202${1 + (idx % 4)}-0${1 + (idx % 9)}-15`,
      criticality: m.criticality,
      qrCode: `/m/${m.id}`,
      metadata: { bay: `Bay ${(idx % 6) + 1}` }
    })),
    // Key component under Line 3 Rotary Filler
    {
      id: "comp-l3-filler-starwheel",
      tenantId: "tenant-acme",
      plantId: "plant-detroit",
      type: "component" as const,
      parentId: "mach-l3-filler-01",
      name: "Fill Head #4 & Starwheel Index Drive",
      machineType: "servo_drive",
      manufacturer: "Krones",
      model: "IDX-400",
      serialNo: "SN-COMP-402",
      installDate: "2023-05-10",
      criticality: "A" as const,
      qrCode: "/m/mach-l3-filler-01",
      metadata: {}
    },
    // Secondary tenant asset for cross-tenant testing
    {
      id: "mach-beta-cnc-01",
      tenantId: "tenant-beta",
      plantId: "plant-beta-01",
      type: "machine" as const,
      parentId: null,
      name: "Beta Monterrey CNC #1 (CONFIDENTIAL)",
      machineType: "cnc",
      manufacturer: "Haas",
      model: "VF-4",
      serialNo: "BETA-9001",
      installDate: "2024-02-01",
      criticality: "A" as const,
      qrCode: "/m/mach-beta-cnc-01",
      metadata: {}
    }
  ]);

  // 4. Machine Status
  await db.insert(schema.machineStatus).values([
    ...machines.map((m) => ({
      id: `ms-${m.id}`,
      tenantId: "tenant-acme",
      plantId: m.plantId,
      machineId: m.id,
      status: m.status,
      currentSpeed: m.status === "running" ? 85 + Math.round(rand() * 15) : 0,
      temperature: m.id === "mach-l1-cnc-01" ? 81.4 : 42 + Number((rand() * 14).toFixed(1)),
      vibration: m.id === "mach-l3-filler-01" ? 7.8 : 1.4 + Number((rand() * 1.6).toFixed(2)),
      pressure: m.id === "mach-l2-mold-01" ? 98.2 : m.machineType === "injection_molder" ? 145 : 6.2,
      updatedAt: now
    })),
    {
      id: "ms-beta-cnc-01",
      tenantId: "tenant-beta",
      plantId: "plant-beta-01",
      machineId: "mach-beta-cnc-01",
      status: "running",
      currentSpeed: 100,
      temperature: 48.0,
      vibration: 1.1,
      pressure: 6.5,
      updatedAt: now
    }
  ]);

  // 5. Alarms (Active + Historical)
  const activeAlarms = [
    {
      id: "alm-l3-e42",
      tenantId: "tenant-acme",
      plantId: "plant-detroit",
      machineId: "mach-l3-filler-01",
      code: "E42",
      severity: "critical" as const,
      message: "Servo Indexing Torque Overload on Fill Head #4 (torque spike 148%)",
      raisedAt: new Date(now.getTime() - 42 * 60 * 1000),
      clearedAt: null,
      acknowledgedBy: null
    },
    {
      id: "alm-l1-f104",
      tenantId: "tenant-acme",
      plantId: "plant-detroit",
      machineId: "mach-l1-cnc-01",
      code: "F104",
      severity: "high" as const,
      message: "Spindle Bearing Over-Temperature (81.4°C > 78.0°C limit)",
      raisedAt: new Date(now.getTime() - 95 * 60 * 1000),
      clearedAt: null,
      acknowledgedBy: null
    },
    {
      id: "alm-l2-h22",
      tenantId: "tenant-acme",
      plantId: "plant-detroit",
      machineId: "mach-l2-mold-01",
      code: "H22",
      severity: "high" as const,
      message: "Hydraulic Manifold Pressure Drop (98.2 bar < 115 bar min)",
      raisedAt: new Date(now.getTime() - 140 * 60 * 1000),
      clearedAt: null,
      acknowledgedBy: null
    },
    {
      id: "alm-aus-p08",
      tenantId: "tenant-acme",
      plantId: "plant-austin",
      machineId: "mach-aus-comp-01",
      code: "P08",
      severity: "medium" as const,
      message: "Oil Separator Differential Pressure High (0.92 bar)",
      raisedAt: new Date(now.getTime() - 65 * 60 * 1000),
      clearedAt: null,
      acknowledgedBy: null
    }
  ];

  const historicalAlarms = Array.from({ length: 28 }).map((_, i) => {
    const m = machines[i % machines.length]!;
    const codes = ["E42", "F104", "H22", "P08", "R15", "S31", "C07"];
    const code = codes[i % codes.length]!;
    const raised = new Date(now.getTime() - (2 + i * 2.5) * 24 * 3600 * 1000);
    return {
      id: `alm-hist-${i + 1}`,
      tenantId: "tenant-acme",
      plantId: m.plantId,
      machineId: m.id,
      code,
      severity: (i % 3 === 0 ? "high" : "medium") as "high" | "medium",
      message: `Historical fault ${code} on ${m.name}`,
      raisedAt: raised,
      clearedAt: new Date(raised.getTime() + (45 + (i % 6) * 20) * 60 * 1000),
      acknowledgedBy: "Marcus Vance"
    };
  });

  await db.insert(schema.alarms).values([...activeAlarms, ...historicalAlarms]);

  // 6. Failure Modes & Fault Codes
  await db.insert(schema.failureModes).values([
    { id: "fm-1", tenantId: "tenant-acme", isoCode: "ISO-ELM-01", mode: "Torque Overload", mechanism: "Mechanical binding / coupling wear", cause: "Elastomer spider fatigue or starwheel misalignment" },
    { id: "fm-2", tenantId: "tenant-acme", isoCode: "ISO-BRG-04", mode: "Thermal Runaway", mechanism: "Bearing friction / chiller restriction", cause: "Coolant flow drop or raceway spalling" },
    { id: "fm-3", tenantId: "tenant-acme", isoCode: "ISO-HYD-02", mode: "Pressure Loss", mechanism: "Filter occlusion / seal bypass", cause: "Clogged return filter or proportional valve wear" },
    { id: "fm-4", tenantId: "tenant-acme", isoCode: "ISO-PNE-03", mode: "High Differential Pressure", mechanism: "Filter media saturation", cause: "Oil separator coalescer fouling" }
  ]);

  await db.insert(schema.faultCodes).values([
    { id: "fc-e42", tenantId: "tenant-acme", machineType: "filler", code: "E42", title: "Servo Indexing Torque Overload", description: "Starwheel or fill head servo torque exceeds 130% rated limit during indexing.", standardFailureMode: "ISO-ELM-01" },
    { id: "fc-e45", tenantId: "tenant-acme", machineType: "filler", code: "E45", title: "Fill Valve Pneumatic Timeout", description: "Fill head actuator failed to reach seat position within 180 ms.", standardFailureMode: "ISO-PNE-03" },
    { id: "fc-f104", tenantId: "tenant-acme", machineType: "cnc", code: "F104", title: "Spindle Bearing Over-Temperature", description: "Front spindle bearing thermocouple exceeds 78°C interlock threshold.", standardFailureMode: "ISO-BRG-04" },
    { id: "fc-h22", tenantId: "tenant-acme", machineType: "injection_molder", code: "H22", title: "Hydraulic Manifold Pressure Drop", description: "Main hydraulic pressure fell below 115 bar during clamp lock.", standardFailureMode: "ISO-HYD-02" },
    { id: "fc-p08", tenantId: "tenant-acme", machineType: "compressor", code: "P08", title: "Oil Separator High Differential Pressure", description: "Pressure drop across separator element exceeds 0.8 bar.", standardFailureMode: "ISO-PNE-03" },
    { id: "fc-r15", tenantId: "tenant-acme", machineType: "robot_cell", code: "R15", title: "Fence Open / Dual-Channel Safety Fault", description: "Safety cell gate interlock mismatch.", standardFailureMode: "ISO-ELM-01" },
    { id: "fc-s31", tenantId: "tenant-acme", machineType: "press", code: "S31", title: "Light Curtain Optical Alignment Fault", description: "Safety curtain receiver misaligned or lens fouled.", standardFailureMode: "ISO-ELM-01" },
    { id: "fc-c07", tenantId: "tenant-acme", machineType: "conveyor", code: "C07", title: "Infeed Photoeye Blocked > 5s", description: "Carton jam detected at line transfer.", standardFailureMode: "ISO-ELM-01" }
  ]);

  // 7. 90 Days of Simulated Sensor Readings (with planted anomalies before E42 & F104)
  const readingRows: Array<typeof schema.readings.$inferInsert> = [];
  // 90-day coarse points (every 48 hours = 45 points) + recent 48 hours (hourly = 48 points) for key machines
  for (let mIdx = 0; mIdx < machines.length; mIdx++) {
    const m = machines[mIdx]!;
    const tags = [
      { tag: "vibration", base: 1.8, unit: "mm/s" },
      { tag: "temperature", base: 44.0, unit: "C" },
      { tag: "current", base: 18.5, unit: "A" }
    ];

    for (let d = 90; d >= 2; d -= 2) {
      const ts = new Date(now.getTime() - d * 24 * 3600 * 1000);
      const diurnal = Math.sin(((90 - d) / 7) * Math.PI) * 0.6;
      for (const t of tags) {
        readingRows.push({
          id: `rd-${m.id}-${t.tag}-d${d}`,
          tenantId: "tenant-acme",
          plantId: m.plantId,
          machineId: m.id,
          tag: t.tag,
          ts,
          value: Number((t.base + diurnal + (rand() - 0.5) * 0.8).toFixed(2)),
          unit: t.unit,
          quality: "good"
        });
      }
    }

    // Recent 24 hours (every 2 hours = 12 buckets per tag)
    for (let h = 24; h >= 0; h -= 2) {
      const ts = new Date(now.getTime() - h * 3600 * 1000);
      for (const t of tags) {
        let anomalyBoost = 0;
        // Planted anomaly leading up to E42 on Line 3 Rotary Filler
        if (m.id === "mach-l3-filler-01" && (t.tag === "vibration" || t.tag === "current")) {
          anomalyBoost = ((24 - h) / 24) * (t.tag === "vibration" ? 6.0 : 11.5);
        }
        // Planted thermal drift leading up to F104 on Line 1 CNC #1
        if (m.id === "mach-l1-cnc-01" && t.tag === "temperature") {
          anomalyBoost = ((24 - h) / 24) * 36.0;
        }
        readingRows.push({
          id: `rd-${m.id}-${t.tag}-h${h}`,
          tenantId: "tenant-acme",
          plantId: m.plantId,
          machineId: m.id,
          tag: t.tag,
          ts,
          value: Number((t.base + anomalyBoost + (rand() - 0.5) * 0.5).toFixed(2)),
          unit: t.unit,
          quality: "good"
        });
      }
    }
  }

  for (let i = 0; i < readingRows.length; i += 500) {
    await db.insert(schema.readings).values(readingRows.slice(i, i + 500));
  }

  // 8. Parts & Inventory (with low-stock items)
  const seedParts = [
    { id: "part-sv-402", partNo: "PRT-SV-402", description: "Servo Drive Coupling Kit (Krones RF-400)", compatibleMachineTypes: ["filler"], bomLinks: ["comp-l3-filler-starwheel"], unitCostUsd: 245, detOnHand: 4, detReserved: 1, detMin: 2, ausOnHand: 3, ausMin: 2 },
    { id: "part-val-118", partNo: "PRT-VAL-118", description: "Pneumatic Fill Valve Viton Seal Kit (Pack of 6)", compatibleMachineTypes: ["filler"], bomLinks: ["comp-l3-filler-starwheel"], unitCostUsd: 88, detOnHand: 2, detReserved: 1, detMin: 4, ausOnHand: 5, ausMin: 3 },
    { id: "part-brg-204", partNo: "PRT-BRG-204", description: "Ceramic Angular Contact Spindle Bearing Set", compatibleMachineTypes: ["cnc"], bomLinks: [], unitCostUsd: 890, detOnHand: 1, detReserved: 0, detMin: 2, ausOnHand: 4, ausMin: 2 },
    { id: "part-flt-091", partNo: "PRT-FLT-091", description: "Hydraulic Return Line Filter Element 10µm", compatibleMachineTypes: ["injection_molder", "press"], bomLinks: [], unitCostUsd: 64, detOnHand: 3, detReserved: 0, detMin: 5, ausOnHand: 8, ausMin: 4 },
    { id: "part-sep-501", partNo: "PRT-SEP-501", description: "Compressor Oil Separator Coalescer Element", compatibleMachineTypes: ["compressor"], bomLinks: [], unitCostUsd: 310, detOnHand: 3, detReserved: 0, detMin: 2, ausOnHand: 1, ausMin: 2 },
    { id: "part-sen-310", partNo: "PRT-SEN-310", description: "Inductive & Optical Proximity Sensor M12 PNP", compatibleMachineTypes: ["filler", "conveyor", "cnc", "packaging_line"], bomLinks: [], unitCostUsd: 72, detOnHand: 14, detReserved: 0, detMin: 6, ausOnHand: 11, ausMin: 6 },
    { id: "part-lck-602", partNo: "PRT-LCK-602", description: "Dual-Channel Magnetic Safety Gate Interlock", compatibleMachineTypes: ["robot_cell", "packaging_line"], bomLinks: [], unitCostUsd: 195, detOnHand: 5, detReserved: 0, detMin: 2, ausOnHand: 4, ausMin: 2 },
    { id: "part-clm-710", partNo: "PRT-CLM-710", description: "Heavy-Duty T-Slot Die Clamp Bolt Assembly", compatibleMachineTypes: ["press"], bomLinks: [], unitCostUsd: 42, detOnHand: 18, detReserved: 0, detMin: 8, ausOnHand: 12, ausMin: 8 },
    { id: "part-htr-155", partNo: "PRT-HTR-155", description: "Barrel Ceramic Heater Band 220V 1800W", compatibleMachineTypes: ["injection_molder"], bomLinks: [], unitCostUsd: 135, detOnHand: 6, detReserved: 0, detMin: 3, ausOnHand: 2, ausMin: 3 }
  ];

  await db.insert(schema.parts).values(
    seedParts.map((p) => ({
      id: p.id,
      tenantId: "tenant-acme",
      partNo: p.partNo,
      description: p.description,
      compatibleMachineTypes: p.compatibleMachineTypes,
      bomLinks: p.bomLinks,
      unitCostUsd: p.unitCostUsd
    }))
  );

  await db.insert(schema.inventory).values(
    seedParts.flatMap((p, idx) => [
      {
        id: `inv-det-${p.id}`,
        tenantId: "tenant-acme",
        partId: p.id,
        plantId: "plant-detroit",
        onHand: p.detOnHand,
        reserved: p.detReserved,
        minLevel: p.detMin,
        location: `DET-CRIB-A${idx + 1}`,
        leadTimeDays: 3 + (idx % 5)
      },
      {
        id: `inv-aus-${p.id}`,
        tenantId: "tenant-acme",
        partId: p.id,
        plantId: "plant-austin",
        onHand: p.ausOnHand,
        reserved: 0,
        minLevel: p.ausMin,
        location: `AUS-CRIB-B${idx + 1}`,
        leadTimeDays: 4 + (idx % 4)
      }
    ])
  );

  // 9. 320+ Work Orders (including rich E42 & F104 history + beta tenant WO)
  const woRows: Array<typeof schema.workOrders.$inferInsert> = [
    {
      id: "wo-e42-recent-1",
      tenantId: "tenant-acme",
      plantId: "plant-detroit",
      machineId: "mach-l3-filler-01",
      componentId: "comp-l3-filler-starwheel",
      type: "corrective",
      priority: "high",
      status: "completed",
      faultCode: "E42",
      description: "Line 3 Rotary Filler tripped E42 during shift change high-speed ramp.",
      resolution: "Replaced cracked coupling spider PRT-SV-402, verified starwheel clearance 0.25mm, torqued flange bolts to 42 Nm per Rev 4.2.",
      partsUsed: [{ partNo: "PRT-SV-402", qty: 1 }],
      openedAt: new Date(now.getTime() - 12 * 24 * 3600 * 1000),
      closedAt: new Date(now.getTime() - 12 * 24 * 3600 * 1000 + 2.4 * 3600 * 1000),
      technician: "Marcus Vance"
    },
    {
      id: "wo-e42-recent-2",
      tenantId: "tenant-acme",
      plantId: "plant-detroit",
      machineId: "mach-l3-filler-01",
      componentId: "comp-l3-filler-starwheel",
      type: "corrective",
      priority: "urgent",
      status: "completed",
      faultCode: "E42",
      description: "Intermittent E42 servo indexing torque overload on fill head #4.",
      resolution: "Found worn fill valve guide seal causing bottle drag; installed PRT-VAL-118 seal kit and cleaned cam rail.",
      partsUsed: [{ partNo: "PRT-VAL-118", qty: 1 }],
      openedAt: new Date(now.getTime() - 29 * 24 * 3600 * 1000),
      closedAt: new Date(now.getTime() - 29 * 24 * 3600 * 1000 + 3.1 * 3600 * 1000),
      technician: "J. Kowalski"
    },
    {
      id: "wo-e42-open-1",
      tenantId: "tenant-acme",
      plantId: "plant-detroit",
      machineId: "mach-l3-filler-01",
      componentId: "comp-l3-filler-starwheel",
      type: "corrective",
      priority: "urgent",
      status: "open",
      faultCode: "E42",
      description: "Active alarm E42: Servo torque spike 148% on Line 3 Rotary Filler #1.",
      resolution: "",
      partsUsed: [],
      openedAt: new Date(now.getTime() - 40 * 60 * 1000),
      closedAt: null,
      technician: "Marcus Vance"
    },
    {
      id: "wo-f104-open-1",
      tenantId: "tenant-acme",
      plantId: "plant-detroit",
      machineId: "mach-l1-cnc-01",
      componentId: null,
      type: "corrective",
      priority: "high",
      status: "in_progress",
      faultCode: "F104",
      description: "Spindle temperature climbed to 81.4C during aluminum housing roughing.",
      resolution: "Inspecting spindle chiller flow rate and bearing preload.",
      partsUsed: [],
      openedAt: new Date(now.getTime() - 90 * 60 * 1000),
      closedAt: null,
      technician: "T. Morales"
    },
    {
      id: "wo-beta-secret",
      tenantId: "tenant-beta",
      plantId: "plant-beta-01",
      machineId: "mach-beta-cnc-01",
      componentId: null,
      type: "corrective",
      priority: "high",
      status: "open",
      faultCode: "B01",
      description: "CONFIDENTIAL BETA CORP WORK ORDER — SECRET EXPORT TEST",
      resolution: "",
      partsUsed: [],
      openedAt: now,
      closedAt: null,
      technician: "Beta Tech"
    }
  ];

  const faultMap: Record<string, string> = {
    filler: "E42",
    cnc: "F104",
    injection_molder: "H22",
    compressor: "P08",
    robot_cell: "R15",
    press: "S31",
    conveyor: "C07",
    packaging_line: "C07"
  };

  for (let i = 0; i < 320; i++) {
    const m = machines[i % machines.length]!;
    const daysAgo = 1 + Math.floor(rand() * 88);
    const opened = new Date(now.getTime() - daysAgo * 24 * 3600 * 1000 - Math.floor(rand() * 12) * 3600 * 1000);
    const isOpen = i < 14;
    const repairHours = 1.2 + rand() * 4.5;
    const woType = i % 5 === 0 ? "preventive" : i % 7 === 0 ? "inspection" : "corrective";
    const fCode = woType === "corrective" ? (faultMap[m.machineType] ?? "E42") : "";
    const resolutions = [
      `Inspected ${m.name}, cleaned sensor and verified tolerances per manual.`,
      `Replaced worn component, performed LOTO verification, tested under load.`,
      `Adjusted alignment and cleared ${fCode || "PM"} checklist.`,
      `Tightened mounting fasteners; monitored vibration for 30 minutes.`
    ];

    woRows.push({
      id: `wo-seed-${i + 1}`,
      tenantId: "tenant-acme",
      plantId: m.plantId,
      machineId: m.id,
      componentId: null,
      type: woType,
      priority: i % 8 === 0 ? "urgent" : i % 3 === 0 ? "high" : "medium",
      status: isOpen ? (i % 2 === 0 ? "open" : "in_progress") : "completed",
      faultCode: fCode,
      description: `${woType === "preventive" ? "Scheduled PM" : `Fault ${fCode} troubleshooting`} on ${m.name}`,
      resolution: isOpen ? "" : resolutions[i % resolutions.length]!,
      partsUsed: [],
      openedAt: opened,
      closedAt: isOpen ? null : new Date(opened.getTime() + repairHours * 3600 * 1000),
      technician: ["Marcus Vance", "Elena Rostova", "J. Kowalski", "T. Morales"][i % 4]!
    });
  }

  for (let i = 0; i < woRows.length; i += 100) {
    await db.insert(schema.workOrders).values(woRows.slice(i, i + 100));
  }

  // 10. Production Runs, Quality Events, Downtime Events, Energy Readings (35 days)
  const prodRows: Array<typeof schema.productionRuns.$inferInsert> = [];
  const qualRows: Array<typeof schema.qualityEvents.$inferInsert> = [];
  const dtRows: Array<typeof schema.downtimeEvents.$inferInsert> = [];
  const energyRows: Array<typeof schema.energyReadings.$inferInsert> = [];

  const shifts: Array<"A" | "B" | "C"> = ["A", "B", "C"];
  const reasonCodes = ["E42_TORQUE_OVERLOAD", "F104_SPINDLE_TEMP", "H22_HYD_PRESSURE", "CHANGEOVER", "MATERIAL_STARVE", "CONVEYOR_JAM"];
  const defectTypes = ["SEAL_MISALIGN", "SHORT_SHOT", "SURFACE_BURR", "UNDERFILL", "LABEL_SKEW"];

  for (let day = 0; day < 35; day++) {
    for (let mIdx = 0; mIdx < machines.length; mIdx++) {
      const m = machines[mIdx]!;
      const shift = shifts[(day + mIdx) % 3]!;
      const started = new Date(now.getTime() - day * 24 * 3600 * 1000 - 8 * 3600 * 1000);
      const ended = new Date(started.getTime() + 8 * 3600 * 1000);
      const planned = 480;
      const downtime = m.lineId === "line-det-3" ? 45 + Math.round(rand() * 55) : 15 + Math.round(rand() * 35);
      const runTime = Math.max(planned - downtime, 260);
      const idealCycleSec = 6;
      const perfFactor = 0.88 + rand() * 0.1;
      const totalUnits = Math.round((runTime * 60) / idealCycleSec * perfFactor);
      const scrap = Math.max(1, Math.round(totalUnits * (0.01 + rand() * 0.025)));
      const good = totalUnits - scrap;
      const runId = `run-${day}-${m.id}`;

      prodRows.push({
        id: runId,
        tenantId: "tenant-acme",
        plantId: m.plantId,
        lineId: m.lineId,
        machineId: m.id,
        shift,
        startedAt: started,
        endedAt: ended,
        plannedTimeMin: planned,
        runTimeMin: runTime,
        goodCount: good,
        scrapCount: scrap,
        idealCycleTimeSec: idealCycleSec
      });

      if (day % 2 === 0 || m.lineId === "line-det-3") {
        const dtStart = new Date(started.getTime() + 2 * 3600 * 1000);
        const dtEnd = new Date(dtStart.getTime() + downtime * 60 * 1000);
        const rc =
          m.id === "mach-l3-filler-01"
            ? "E42_TORQUE_OVERLOAD"
            : reasonCodes[(day + mIdx) % reasonCodes.length]!;
        dtRows.push({
          id: `dt-${day}-${m.id}`,
          tenantId: "tenant-acme",
          plantId: m.plantId,
          machineId: m.id,
          start: dtStart,
          end: dtEnd,
          durationMin: downtime,
          reasonCode: rc,
          category: rc === "CHANGEOVER" ? "planned" : "unplanned",
          notes: `Downtime event (${rc}) on ${m.name}`
        });
      }

      if (day % 3 === 0) {
        qualRows.push({
          id: `qe-${day}-${m.id}`,
          tenantId: "tenant-acme",
          plantId: m.plantId,
          machineId: m.id,
          runId,
          ts: ended,
          defectType: defectTypes[(day + mIdx) % defectTypes.length]!,
          scrapCount: scrap,
          notes: "Shift quality audit"
        });
      }

      energyRows.push({
        id: `eng-${day}-${m.id}`,
        tenantId: "tenant-acme",
        plantId: m.plantId,
        machineId: m.id,
        ts: ended,
        kwh: Number((120 + rand() * 190).toFixed(1)),
        peakKw: Number((28 + rand() * 32).toFixed(1))
      });
    }
  }

  for (let i = 0; i < prodRows.length; i += 200) {
    await db.insert(schema.productionRuns).values(prodRows.slice(i, i + 200));
  }
  for (let i = 0; i < dtRows.length; i += 200) {
    await db.insert(schema.downtimeEvents).values(dtRows.slice(i, i + 200));
  }
  for (let i = 0; i < qualRows.length; i += 200) {
    await db.insert(schema.qualityEvents).values(qualRows.slice(i, i + 200));
  }
  for (let i = 0; i < energyRows.length; i += 200) {
    await db.insert(schema.energyReadings).values(energyRows.slice(i, i + 200));
  }

  // 11. Knowledge Base Documents & Vector/FTS Chunks
  for (const doc of SEED_DOCUMENTS) {
    await db.insert(schema.documents).values({
      id: doc.id,
      tenantId: doc.tenantId,
      title: doc.title,
      type: doc.type,
      machineTypes: doc.machineTypes,
      revision: doc.revision,
      status: doc.status,
      effectiveDate: doc.effectiveDate,
      source: doc.source,
      ingestionStatus: "completed",
      ingestionError: null,
      rawContent: doc.rawContent
    });

    const drafts = chunkDocumentText(doc.rawContent);
    await db.insert(schema.documentChunks).values(
      drafts.map((c) => ({
        id: `${doc.id}-chunk-${c.chunkIndex}`,
        tenantId: doc.tenantId,
        documentId: doc.id,
        chunkIndex: c.chunkIndex,
        page: c.page,
        sectionPath: c.sectionPath,
        text: c.text,
        embedding: computeDeterministicEmbedding(`${doc.title} ${c.sectionPath} ${c.text}`),
        faultCodes: c.faultCodes,
        partNumbers: c.partNumbers
      }))
    );
  }

  // 12. Connectors (with encrypted credentials)
  const connectorSeeds = [
    { id: "conn-cmms", kind: "cmms", name: "Lutic CMMS Connector", status: "healthy" as const, creds: { endpoint: "mock://cmms.local", apiKey: "cmms-demo-secret-key" } },
    { id: "conn-historian", kind: "historian", name: "Lutic Historian & SCADA Connector", status: "healthy" as const, creds: { endpoint: "mock://historian.local", token: "historian-demo-secret-token" } },
    { id: "conn-mes", kind: "mes", name: "Lutic MES & Quality Connector", status: "healthy" as const, creds: { endpoint: "mock://mes.local", apiKey: "mes-demo-secret-key" } },
    { id: "conn-parts", kind: "parts-erp", name: "Lutic Parts & Inventory Connector", status: "healthy" as const, creds: { endpoint: "mock://parts-erp.local", clientSecret: "erp-demo-secret" } },
    { id: "conn-docs", kind: "docs", name: "Lutic Knowledge Document Store", status: "healthy" as const, creds: { rootPath: "/knowledge/manuals", readOnly: true } }
  ];

  await db.insert(schema.connectors).values(
    connectorSeeds.map((c) => ({
      id: c.id,
      tenantId: "tenant-acme",
      kind: c.kind,
      name: c.name,
      status: c.status,
      lastSyncAt: now,
      lastError: null,
      encryptedCredentials: encryptCredentials(c.creds),
      config: { mode: "mock", readOnlyByDefault: true }
    }))
  );

  // 13. Toolkits, Tools & Role Mappings
  await installCoreToolkits(db, "tenant-acme", "");

  // 14. 3 Starter Dashboard Templates
  const templateSpecs: Array<{
    id: string;
    title: string;
    description: string;
    plantScope: string[];
    spec: DashboardSpec;
  }> = [
    {
      id: "dash-tpl-line-overview",
      title: "Line Overview — OEE & Production Health",
      description: "Starter template tracking OEE, Availability, Quality, and Throughput across lines.",
      plantScope: ["plant-detroit", "plant-austin"],
      spec: {
        id: "dash-tpl-line-overview",
        title: "Line Overview — OEE & Production Health",
        description: "OEE, Availability, Quality and line comparison",
        plantScope: ["plant-detroit", "plant-austin"],
        filters: { range: "7d" },
        version: 1,
        widgets: [
          { id: "w-oee-kpi", type: "kpi", title: "Plant OEE", metric: "oee", range: "7d", compareTo: "previous_period", target: 82, sort: "desc", limit: 12 },
          { id: "w-avail-kpi", type: "kpi", title: "Availability", metric: "availability", range: "7d", target: 90, sort: "desc", limit: 12 },
          { id: "w-qual-kpi", type: "kpi", title: "Quality Yield", metric: "quality", range: "7d", target: 98, sort: "desc", limit: 12 },
          { id: "w-oee-by-line", type: "bar", title: "OEE by Production Line", metric: "oee", groupBy: "line", range: "7d", sort: "desc", limit: 12 },
          { id: "w-oee-trend", type: "line", title: "Daily OEE Trend", metric: "oee", groupBy: "day", range: "30d", sort: "asc", limit: 30 },
          { id: "w-status-grid", type: "status_grid", title: "Live Machine Status Grid", range: "24h", sort: "desc", limit: 16 }
        ],
        layout: [
          { i: "w-oee-kpi", x: 0, y: 0, w: 4, h: 3 },
          { i: "w-avail-kpi", x: 4, y: 0, w: 4, h: 3 },
          { i: "w-qual-kpi", x: 8, y: 0, w: 4, h: 3 },
          { i: "w-oee-by-line", x: 0, y: 3, w: 6, h: 5 },
          { i: "w-oee-trend", x: 6, y: 3, w: 6, h: 5 },
          { i: "w-status-grid", x: 0, y: 8, w: 12, h: 5 }
        ]
      }
    },
    {
      id: "dash-tpl-maintenance",
      title: "Maintenance Health — MTBF, MTTR & Spares",
      description: "Starter template monitoring reliability KPIs, open work orders, and low-stock parts.",
      plantScope: ["plant-detroit", "plant-austin"],
      spec: {
        id: "dash-tpl-maintenance",
        title: "Maintenance Health — MTBF, MTTR & Spares",
        description: "Reliability KPIs and maintenance backlog",
        plantScope: ["plant-detroit", "plant-austin"],
        filters: { range: "30d" },
        version: 1,
        widgets: [
          { id: "w-mtbf", type: "kpi", title: "Mean Time Between Failures", metric: "mtbf", range: "30d", target: 168, sort: "desc", limit: 12 },
          { id: "w-mttr", type: "kpi", title: "Mean Time To Repair", metric: "mttr", range: "30d", target: 3.5, sort: "desc", limit: 12 },
          { id: "w-open-wo", type: "kpi", title: "Open Work Orders", metric: "open_work_orders", range: "30d", sort: "desc", limit: 12 },
          { id: "w-low-stock", type: "kpi", title: "Parts Below Min Stock", metric: "parts_below_min_stock", range: "30d", sort: "desc", limit: 12 },
          { id: "w-wo-machine", type: "bar", title: "Open Work Orders by Machine", metric: "open_work_orders", groupBy: "machine", range: "30d", sort: "desc", limit: 10 },
          { id: "w-mttr-line", type: "table", title: "MTTR Breakdown by Line", metric: "mttr", groupBy: "line", range: "30d", sort: "desc", limit: 12 }
        ],
        layout: [
          { i: "w-mtbf", x: 0, y: 0, w: 3, h: 3 },
          { i: "w-mttr", x: 3, y: 0, w: 3, h: 3 },
          { i: "w-open-wo", x: 6, y: 0, w: 3, h: 3 },
          { i: "w-low-stock", x: 9, y: 0, w: 3, h: 3 },
          { i: "w-wo-machine", x: 0, y: 3, w: 7, h: 5 },
          { i: "w-mttr-line", x: 7, y: 3, w: 5, h: 5 }
        ]
      }
    },
    {
      id: "dash-tpl-downtime",
      title: "Downtime Analysis — Root Causes & Energy",
      description: "Starter template isolating top downtime machines, reason codes, and energy load.",
      plantScope: ["plant-detroit", "plant-austin"],
      spec: {
        id: "dash-tpl-downtime",
        title: "Downtime Analysis — Root Causes & Energy",
        description: "Top downtime reasons and equipment bottlenecks",
        plantScope: ["plant-detroit", "plant-austin"],
        filters: { range: "7d" },
        version: 1,
        widgets: [
          { id: "w-dt-total", type: "kpi", title: "Total Downtime", metric: "downtime_minutes", range: "7d", compareTo: "previous_period", sort: "desc", limit: 12 },
          { id: "w-scrap", type: "gauge", title: "Scrap Rate (%)", metric: "scrap_rate", range: "7d", target: 2.0, sort: "desc", limit: 12 },
          { id: "w-dt-reason", type: "pie", title: "Downtime by Reason Code", metric: "downtime_minutes", groupBy: "reason_code", range: "7d", sort: "desc", limit: 10 },
          { id: "w-dt-machine", type: "bar", title: "Top Downtime Machines", metric: "downtime_minutes", groupBy: "machine", range: "7d", sort: "desc", limit: 10 },
          { id: "w-energy-line", type: "stacked_bar", title: "Energy Consumption by Line", metric: "energy_kwh", groupBy: "line", range: "7d", sort: "desc", limit: 10 }
        ],
        layout: [
          { i: "w-dt-total", x: 0, y: 0, w: 6, h: 3 },
          { i: "w-scrap", x: 6, y: 0, w: 6, h: 3 },
          { i: "w-dt-reason", x: 0, y: 3, w: 5, h: 5 },
          { i: "w-dt-machine", x: 5, y: 3, w: 7, h: 5 },
          { i: "w-energy-line", x: 0, y: 8, w: 12, h: 5 }
        ]
      }
    }
  ];

  for (const tpl of templateSpecs) {
    await db.insert(schema.dashboards).values({
      id: tpl.id,
      tenantId: "tenant-acme",
      ownerId: "user-analyst",
      title: tpl.title,
      description: tpl.description,
      plantScope: tpl.plantScope,
      spec: tpl.spec as unknown as Record<string, unknown>,
      currentVersion: 1,
      isTemplate: true
    });

    await db.insert(schema.dashboardVersions).values({
      id: `dv-${tpl.id}-v1`,
      tenantId: "tenant-acme",
      dashboardId: tpl.id,
      version: 1,
      spec: tpl.spec as unknown as Record<string, unknown>,
      createdBy: "user-analyst",
      changeSummary: "Initial starter template"
    });

    // Share starter templates with analyst, manager, admin, and engineer (engineer sees locked metric placeholders where unauthorized, or status_grid!)
    await db.insert(schema.dashboardShares).values([
      { id: `ds-${tpl.id}-analyst`, tenantId: "tenant-acme", dashboardId: tpl.id, shareType: "role", targetId: "analyst" },
      { id: `ds-${tpl.id}-manager`, tenantId: "tenant-acme", dashboardId: tpl.id, shareType: "role", targetId: "manager" },
      { id: `ds-${tpl.id}-engineer`, tenantId: "tenant-acme", dashboardId: tpl.id, shareType: "role", targetId: "engineer" }
    ]);
  }
  }

  // 15. PaaS Services Seed Data (idempotent across fresh & upgraded DBs)
  const existingPaaS = await db
    .select({ id: schema.workflows.id })
    .from(schema.workflows)
    .limit(1);

  if (existingPaaS.length === 0) {
    const wfE42Def = {
      nodes: [
        { id: "n1", type: "trigger", label: "Alert: Vibration > 6.0", config: { event: "alert.triggered" }, position: { x: 80, y: 100 } },
        { id: "n2", type: "mcp", label: "Check Spares (PRT-SV-402)", config: { tool: "find_part_for_fault", args: { faultCode: "E42" } }, position: { x: 320, y: 100 } },
        { id: "n3", type: "notify", label: "Publish Plant Alerts", config: { topicId: "topic-plant-alerts", severity: "critical" }, position: { x: 560, y: 100 } }
      ],
      edges: [
        { id: "e1", source: "n1", target: "n2" },
        { id: "e2", source: "n2", target: "n3" }
      ]
    };

    const wfSpindleDef = {
      nodes: [
        { id: "n1", type: "trigger", label: "Manual Spindle Triage", config: {}, position: { x: 80, y: 100 } },
        { id: "n2", type: "mcp", label: "Inspect Machine Status", config: { tool: "get_machine_status", args: { machineId: "mach-l1-cnc-01" } }, position: { x: 320, y: 100 } }
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }]
    };

    const wfBetaDef = {
      nodes: [{ id: "n1", type: "trigger", label: "Beta Private Trigger", config: {}, position: { x: 80, y: 100 } }],
      edges: []
    };

    await db.insert(schema.workflows).values([
      {
        id: "wf-e42-triage",
        tenantId: "tenant-acme",
        plantId: "plant-detroit",
        name: "E42 Vibration Triage & Spares Dispatch",
        description: "Evaluates Filler #1 E42 vibration alerts, checks PRT-SV-402 stock, and notifies plant ops.",
        triggerType: "alert",
        triggerConfig: { metricTag: "vibration", machineId: "mach-l3-filler-01" },
        definition: wfE42Def,
        enabled: true,
        currentVersion: 1,
        createdBy: "user-analyst"
      },
      {
        id: "wf-spindle-thermal",
        tenantId: "tenant-acme",
        plantId: "plant-detroit",
        name: "CNC Spindle Thermal Inspection",
        description: "Checks CNC Mill #1 bearing temperature telemetry and logs triage trace.",
        triggerType: "manual",
        triggerConfig: {},
        definition: wfSpindleDef,
        enabled: true,
        currentVersion: 1,
        createdBy: "user-admin"
      },
      {
        id: "wf-beta-private",
        tenantId: "tenant-beta",
        plantId: "plant-beta-01",
        name: "Beta Confidential Workflow",
        description: "Tenant-beta isolated workflow for RLS checks.",
        triggerType: "manual",
        triggerConfig: {},
        definition: wfBetaDef,
        enabled: true,
        currentVersion: 1,
        createdBy: "user-beta-admin"
      }
    ]);

    await db.insert(schema.workflowVersions).values([
      {
        id: "wfv-e42-v1",
        tenantId: "tenant-acme",
        workflowId: "wf-e42-triage",
        version: 1,
        definition: wfE42Def,
        changeSummary: "Initial E42 triage workflow",
        createdBy: "user-analyst"
      },
      {
        id: "wfv-spindle-v1",
        tenantId: "tenant-acme",
        workflowId: "wf-spindle-thermal",
        version: 1,
        definition: wfSpindleDef,
        changeSummary: "Initial spindle thermal check",
        createdBy: "user-admin"
      },
      {
        id: "wfv-beta-v1",
        tenantId: "tenant-beta",
        workflowId: "wf-beta-private",
        version: 1,
        definition: wfBetaDef,
        changeSummary: "Initial beta workflow",
        createdBy: "user-beta-admin"
      }
    ]);

    await db.insert(schema.workflowRuns).values([
      {
        id: "wfr-seed-1",
        tenantId: "tenant-acme",
        workflowId: "wf-e42-triage",
        version: 1,
        status: "succeeded",
        triggerSource: "alert",
        triggeredBy: "system",
        input: { machineId: "mach-l3-filler-01", vibration: 7.8 },
        output: { notified: true, partNo: "PRT-SV-402", available: 3 },
        stepTraces: [
          { nodeId: "n1", status: "succeeded", durationMs: 4 },
          { nodeId: "n2", status: "succeeded", durationMs: 18 },
          { nodeId: "n3", status: "succeeded", durationMs: 9 }
        ],
        startedAt: new Date(now.getTime() - 35 * 60 * 1000),
        completedAt: new Date(now.getTime() - 34 * 60 * 1000)
      },
      {
        id: "wfr-seed-2",
        tenantId: "tenant-acme",
        workflowId: "wf-spindle-thermal",
        version: 1,
        status: "succeeded",
        triggerSource: "manual",
        triggeredBy: "user-det-eng",
        input: { machineId: "mach-l1-cnc-01" },
        output: { temperature: 81.4, status: "fault" },
        stepTraces: [
          { nodeId: "n1", status: "succeeded", durationMs: 2 },
          { nodeId: "n2", status: "succeeded", durationMs: 12 }
        ],
        startedAt: new Date(now.getTime() - 80 * 60 * 1000),
        completedAt: new Date(now.getTime() - 79 * 60 * 1000)
      }
    ]);

    const hubSeeds: Array<{
      id: string;
      slug: string;
      name: string;
      category: "mcp" | "http" | "scada" | "erp" | "messaging" | "custom";
      transport: "in_memory_mcp" | "http" | "webhook" | "simulated";
      endpointUrl: string;
      creds: Record<string, unknown>;
      tools: Array<Record<string, unknown>>;
    }> = [
      {
        id: "conn-hub-cmms",
        slug: "cmms",
        name: "Lutic CMMS Hub",
        category: "mcp",
        transport: "in_memory_mcp",
        endpointUrl: "mcp://cmms",
        creds: { endpoint: "mock://cmms.local", apiKey: "cmms-demo-secret-key" },
        tools: [{ name: "get_work_orders" }, { name: "draft_work_order" }]
      },
      {
        id: "conn-hub-historian",
        slug: "historian",
        name: "Lutic Historian & SCADA Hub",
        category: "scada",
        transport: "in_memory_mcp",
        endpointUrl: "mcp://historian",
        creds: { endpoint: "mock://historian.local", token: "historian-demo-secret-token" },
        tools: [{ name: "get_machine_status" }, { name: "get_recent_readings" }]
      },
      {
        id: "conn-hub-mes",
        slug: "mes",
        name: "Lutic MES Production Hub",
        category: "mcp",
        transport: "in_memory_mcp",
        endpointUrl: "mcp://mes",
        creds: { endpoint: "mock://mes.local", apiKey: "mes-demo-secret-key" },
        tools: [{ name: "list_metrics" }, { name: "query_metric" }]
      },
      {
        id: "conn-hub-parts-erp",
        slug: "parts-erp",
        name: "Lutic Parts & Inventory Hub",
        category: "erp",
        transport: "in_memory_mcp",
        endpointUrl: "mcp://parts-erp",
        creds: { endpoint: "mock://parts-erp.local", clientSecret: "erp-demo-secret" },
        tools: [{ name: "get_parts_inventory" }, { name: "reserve_part" }]
      },
      {
        id: "conn-hub-docs",
        slug: "docs",
        name: "Lutic Knowledge & SOP Hub",
        category: "mcp",
        transport: "in_memory_mcp",
        endpointUrl: "mcp://docs",
        creds: { rootPath: "/knowledge/manuals", readOnly: true },
        tools: [{ name: "search_documents" }, { name: "get_document_section" }]
      },
      {
        id: "conn-hub-ops-webhook",
        slug: "ops-webhook",
        name: "Lutic Outbound Webhook Bridge",
        category: "messaging",
        transport: "simulated",
        endpointUrl: "sim://ops-webhook.local/events",
        creds: { secret: "ops-webhook-sim-secret" },
        tools: [{ name: "dispatch_ops_webhook" }]
      }
    ];

    await db.insert(schema.connectorConnections).values(
      hubSeeds.map((c) => ({
        id: c.id,
        tenantId: "tenant-acme",
        slug: c.slug,
        name: c.name,
        category: c.category,
        transport: c.transport,
        endpointUrl: c.endpointUrl,
        status: "connected" as const,
        encryptedCredentials: encryptCredentials(c.creds),
        config: { mode: "self_contained", syncIntervalSec: 60 },
        discoveredTools: c.tools,
        lastSyncAt: now,
        lastError: null
      }))
    );

    await db.insert(schema.connectorTriggers).values([
      {
        id: "trig-historian-vib",
        tenantId: "tenant-acme",
        connectionId: "conn-hub-historian",
        name: "High Vibration Telemetry Spike",
        eventType: "telemetry.vibration.spike",
        workflowId: "wf-e42-triage",
        config: { threshold: 6.0, intervalSec: 60 },
        enabled: true,
        lastFiredAt: new Date(now.getTime() - 35 * 60 * 1000)
      },
      {
        id: "trig-cmms-urgent",
        tenantId: "tenant-acme",
        connectionId: "conn-hub-cmms",
        name: "Urgent Work Order Created",
        eventType: "cmms.work_order.urgent",
        workflowId: "wf-spindle-thermal",
        config: { priority: "urgent", intervalSec: 120 },
        enabled: true,
        lastFiredAt: new Date(now.getTime() - 90 * 60 * 1000)
      }
    ]);

    await db.insert(schema.connectorSyncLogs).values([
      {
        id: "csl-seed-1",
        tenantId: "tenant-acme",
        connectionId: "conn-hub-historian",
        direction: "inbound",
        status: "success",
        recordsSynced: 40,
        latencyMs: 14,
        message: "Synced 40 machine telemetry snapshots",
        payload: { machines: 40 }
      },
      {
        id: "csl-seed-2",
        tenantId: "tenant-acme",
        connectionId: "conn-hub-cmms",
        direction: "inbound",
        status: "success",
        recordsSynced: 14,
        latencyMs: 21,
        message: "Synced open work orders from CMMS",
        payload: { openWorkOrders: 14 }
      },
      {
        id: "csl-seed-3",
        tenantId: "tenant-acme",
        connectionId: "conn-hub-ops-webhook",
        direction: "outbound",
        status: "success",
        recordsSynced: 1,
        latencyMs: 6,
        message: "Simulated webhook health check passed",
        payload: { ok: true }
      }
    ]);

    await db.insert(schema.topics).values([
      {
        id: "topic-plant-alerts",
        tenantId: "tenant-acme",
        name: "plant-alerts",
        description: "Critical and high machine monitoring alerts across Detroit and Austin plants"
      },
      {
        id: "topic-workflow-events",
        tenantId: "tenant-acme",
        name: "workflow-events",
        description: "Automated workflow execution status and completion notifications"
      }
    ]);

    await db.insert(schema.queues).values([
      {
        id: "queue-maintenance-dlq",
        tenantId: "tenant-acme",
        name: "maintenance-dlq",
        description: "Dead-letter queue for undelivered maintenance dispatch messages",
        visibilityTimeoutSec: 30,
        maxReceiveCount: 3,
        deadLetterQueueId: null
      },
      {
        id: "queue-maintenance-dispatch",
        tenantId: "tenant-acme",
        name: "maintenance-dispatch",
        description: "Lutic dispatch queue for technician inspections and parts triage",
        visibilityTimeoutSec: 30,
        maxReceiveCount: 3,
        deadLetterQueueId: "queue-maintenance-dlq"
      }
    ]);

    await db.insert(schema.subscriptions).values([
      {
        id: "sub-alerts-inapp",
        tenantId: "tenant-acme",
        topicId: "topic-plant-alerts",
        protocol: "in_app",
        endpoint: "all",
        filterPolicy: {},
        enabled: true
      },
      {
        id: "sub-alerts-queue",
        tenantId: "tenant-acme",
        topicId: "topic-plant-alerts",
        protocol: "queue",
        endpoint: "queue-maintenance-dispatch",
        filterPolicy: {},
        enabled: true
      },
      {
        id: "sub-wf-inapp",
        tenantId: "tenant-acme",
        topicId: "topic-workflow-events",
        protocol: "in_app",
        endpoint: "user-admin",
        filterPolicy: {},
        enabled: true
      }
    ]);

    await db.insert(schema.queueMessages).values([
      {
        id: "qmsg-seed-1",
        tenantId: "tenant-acme",
        queueId: "queue-maintenance-dispatch",
        body: {
          machineId: "mach-l3-filler-01",
          faultCode: "E42",
          action: "Inspect Fill Head #4 coupling spider (PRT-SV-402)"
        },
        attributes: { priority: "critical", plantId: "plant-detroit" },
        status: "ready",
        receiveCount: 0,
        visibleAt: now,
        enqueuedAt: new Date(now.getTime() - 20 * 60 * 1000)
      },
      {
        id: "qmsg-seed-2",
        tenantId: "tenant-acme",
        queueId: "queue-maintenance-dispatch",
        body: {
          machineId: "mach-l1-cnc-01",
          faultCode: "F104",
          action: "Check CNC Mill #1 spindle chiller flow rate"
        },
        attributes: { priority: "high", plantId: "plant-detroit" },
        status: "ready",
        receiveCount: 0,
        visibleAt: now,
        enqueuedAt: new Date(now.getTime() - 45 * 60 * 1000)
      }
    ]);

    await db.insert(schema.notifications).values([
      {
        id: "notif-seed-1",
        tenantId: "tenant-acme",
        userId: null,
        topicId: "topic-plant-alerts",
        channel: "alert",
        severity: "critical",
        title: "ALARM: Line 3 Rotary Filler Vibration (7.8 mm/s)",
        body: "mach-l3-filler-01 exceeded 6.0 mm/s vibration threshold (E42).",
        metadata: { machineId: "mach-l3-filler-01", ruleId: "ar-filler-vib" },
        read: false
      },
      {
        id: "notif-seed-2",
        tenantId: "tenant-acme",
        userId: null,
        topicId: "topic-plant-alerts",
        channel: "alert",
        severity: "high",
        title: "ALARM: Line 1 CNC Mill #1 Spindle Temp (81.4°C)",
        body: "mach-l1-cnc-01 exceeded 78.0°C bearing temperature threshold (F104).",
        metadata: { machineId: "mach-l1-cnc-01", ruleId: "ar-cnc-temp" },
        read: false
      },
      {
        id: "notif-seed-3",
        tenantId: "tenant-acme",
        userId: "user-admin",
        topicId: "topic-workflow-events",
        channel: "in_app",
        severity: "info",
        title: "Workflow E42 Triage Completed",
        body: "Automated spares check confirmed 3 unreserved PRT-SV-402 kits in Detroit.",
        metadata: { workflowId: "wf-e42-triage" },
        read: true,
        readAt: new Date(now.getTime() - 30 * 60 * 1000)
      }
    ]);

    await db.insert(schema.alertRules).values([
      {
        id: "ar-filler-vib",
        tenantId: "tenant-acme",
        plantId: "plant-detroit",
        machineId: "mach-l3-filler-01",
        name: "Filler #1 High Vibration",
        metricTag: "vibration",
        operator: "gt",
        threshold: 6.0,
        severity: "critical",
        evaluationWindowMin: 5,
        state: "ALARM",
        notifyTopicId: "topic-plant-alerts",
        workflowId: "wf-e42-triage",
        enabled: true,
        lastEvaluatedAt: now
      },
      {
        id: "ar-cnc-temp",
        tenantId: "tenant-acme",
        plantId: "plant-detroit",
        machineId: "mach-l1-cnc-01",
        name: "CNC #1 Spindle Over-Temperature",
        metricTag: "temperature",
        operator: "gt",
        threshold: 78.0,
        severity: "high",
        evaluationWindowMin: 5,
        state: "ALARM",
        notifyTopicId: "topic-plant-alerts",
        workflowId: null,
        enabled: true,
        lastEvaluatedAt: now
      },
      {
        id: "ar-molder-press",
        tenantId: "tenant-acme",
        plantId: "plant-detroit",
        machineId: "mach-l2-mold-01",
        name: "Molder #1 Low Hydraulic Pressure",
        metricTag: "pressure",
        operator: "lt",
        threshold: 115.0,
        severity: "high",
        evaluationWindowMin: 5,
        state: "OK",
        notifyTopicId: "topic-plant-alerts",
        workflowId: null,
        enabled: true,
        lastEvaluatedAt: now
      }
    ]);

    await db.insert(schema.alertEvents).values([
      {
        id: "ae-seed-1",
        tenantId: "tenant-acme",
        ruleId: "ar-filler-vib",
        plantId: "plant-detroit",
        machineId: "mach-l3-filler-01",
        status: "ALARM",
        severity: "critical",
        title: "Filler #1 High Vibration",
        message: "vibration = 7.8 mm/s (gt 6.0)",
        metricTag: "vibration",
        metricValue: 7.8,
        threshold: 6.0,
        triggeredAt: new Date(now.getTime() - 40 * 60 * 1000)
      },
      {
        id: "ae-seed-2",
        tenantId: "tenant-acme",
        ruleId: "ar-cnc-temp",
        plantId: "plant-detroit",
        machineId: "mach-l1-cnc-01",
        status: "ALARM",
        severity: "high",
        title: "CNC #1 Spindle Over-Temperature",
        message: "temperature = 81.4 °C (gt 78.0)",
        metricTag: "temperature",
        metricValue: 81.4,
        threshold: 78.0,
        triggeredAt: new Date(now.getTime() - 90 * 60 * 1000)
      }
    ]);
  }

  // 16. PaaS Toolkit & Tools (idempotent across fresh & upgraded DBs)
  const existingPaasToolkit = await db
    .select({ id: schema.toolkits.id })
    .from(schema.toolkits)
    .where(eq(schema.toolkits.id, "tk-paas"))
    .limit(1);

  if (existingPaasToolkit.length === 0) {
    await installPaasToolkit(db, "tenant-acme");
  } else {
    const existingCodeModeTool = await db
      .select({ id: schema.toolkitTools.id })
      .from(schema.toolkitTools)
      .where(eq(schema.toolkitTools.id, "tt-paas-execute_connector_code"))
      .limit(1);
    if (existingCodeModeTool.length === 0) {
      await db.insert(schema.toolkitTools).values({
        id: "tt-paas-execute_connector_code",
        tenantId: "tenant-acme",
        toolkitId: "tk-paas",
        toolName: "execute_connector_code",
        enabled: true
      });
    }
  }

  // 17. Enterprise & Industrial Connectors + Operations Board Seed (idempotent)
  const enterpriseConnSeeds = [
    {
      id: "conn-hub-sap-pm",
      slug: "sap-pm",
      name: "SAP S/4HANA PM (Plant Maintenance)",
      category: "erp" as const,
      transport: "simulated" as const,
      endpointUrl: "sap://s4hana-prd.acme.internal/sap/opu/odata/sap/API_MAINTORDER",
      creds: { client: "300", apiKey: "sap-pm-demo-secret" },
      tools: [
        { name: "sap_pm_list_notifications", description: "List open SAP PM M2 notifications" },
        { name: "sap_pm_create_order", description: "Create SAP PM corrective order" },
        { name: "sap_pm_confirm_operation", description: "Post completion hours to SAP PM" }
      ]
    },
    {
      id: "conn-hub-sap-mm",
      slug: "sap-mm",
      name: "SAP S/4HANA MM (Materials & Spares)",
      category: "erp" as const,
      transport: "simulated" as const,
      endpointUrl: "sap://s4hana-prd.acme.internal/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV",
      creds: { client: "300", apiKey: "sap-mm-demo-secret" },
      tools: [
        { name: "sap_mm_check_stock", description: "Query plant warehouse stock in SAP MM" },
        { name: "sap_mm_create_purchase_req", description: "Raise SAP MM purchase requisition" },
        { name: "sap_mm_reserve_material", description: "Reserve spare material for order" }
      ]
    },
    {
      id: "conn-hub-sap-pp",
      slug: "sap-pp",
      name: "SAP S/4HANA PP (Production Planning)",
      category: "erp" as const,
      transport: "simulated" as const,
      endpointUrl: "sap://s4hana-prd.acme.internal/sap/opu/odata/sap/API_PRODUCTION_ORDER_2_SRV",
      creds: { client: "300", apiKey: "sap-pp-demo-secret" },
      tools: [
        { name: "sap_pp_list_orders", description: "List scheduled production orders" },
        { name: "sap_pp_confirm_yield", description: "Post line yield and scrap to SAP PP" }
      ]
    },
    {
      id: "conn-hub-sap-qm",
      slug: "sap-qm",
      name: "SAP S/4HANA QM (Quality Management)",
      category: "erp" as const,
      transport: "simulated" as const,
      endpointUrl: "sap://s4hana-prd.acme.internal/sap/opu/odata/sap/API_INSPECTIONLOT_SRV",
      creds: { client: "300", apiKey: "sap-qm-demo-secret" },
      tools: [
        { name: "sap_qm_list_inspection_lots", description: "List active inspection lots" },
        { name: "sap_qm_record_usage_decision", description: "Record lot usage decision in SAP QM" }
      ]
    },
    {
      id: "conn-hub-aws-iot",
      slug: "aws-iot",
      name: "AWS IoT SiteWise & IoT Core",
      category: "scada" as const,
      transport: "simulated" as const,
      endpointUrl: "https://data.iotsitewise.us-east-1.amazonaws.com",
      creds: { roleArn: "arn:aws:iam::123456789012:role/lutic-iot", apiKey: "aws-iot-demo-token" },
      tools: [
        { name: "aws_iot_get_asset_property", description: "Fetch live AWS IoT SiteWise asset value" },
        { name: "aws_iot_query_aggregates", description: "Query time-windowed IoT aggregates" }
      ]
    },
    {
      id: "conn-hub-aws-s3",
      slug: "aws-s3",
      name: "AWS S3 Operational Data Lake",
      category: "http" as const,
      transport: "simulated" as const,
      endpointUrl: "https://acme-plant-datalake.s3.us-east-1.amazonaws.com",
      creds: { bucket: "acme-plant-datalake", apiKey: "aws-s3-demo-token" },
      tools: [
        { name: "aws_s3_list_objects", description: "List archived shift telemetry objects" },
        { name: "aws_s3_put_report_snapshot", description: "Archive report bundle to S3" }
      ]
    },
    {
      id: "conn-hub-servicenow",
      slug: "servicenow",
      name: "ServiceNow ITSM & OT Incident Bridge",
      category: "messaging" as const,
      transport: "simulated" as const,
      endpointUrl: "https://acme.service-now.com/api/now",
      creds: { instance: "acme", apiKey: "snow-demo-bearer-token" },
      tools: [
        { name: "snow_list_incidents", description: "Query active ServiceNow OT/IT incidents" },
        { name: "snow_create_incident", description: "Create high-priority ServiceNow incident" }
      ]
    },
    {
      id: "conn-hub-mqtt",
      slug: "mqtt-broker",
      name: "MQTT Broker (Sparkplug B / Telemetry)",
      category: "scada" as const,
      transport: "simulated" as const,
      endpointUrl: "mqtts://broker.detroit.local:8883",
      creds: { clientId: "lutic-edge-detroit", apiKey: "mqtt-demo-secret" },
      tools: [
        { name: "mqtt_list_active_topics", description: "List active Sparkplug B topics" },
        { name: "mqtt_read_topic_snapshot", description: "Read latest retained topic message" },
        { name: "mqtt_publish_payload", description: "Publish governed status payload" }
      ]
    },
    {
      id: "conn-hub-opcua",
      slug: "opc-ua",
      name: "OPC-UA Industrial Server (PLC / CNC)",
      category: "scada" as const,
      transport: "simulated" as const,
      endpointUrl: "opc.tcp://plc-line3.detroit.local:4840",
      creds: { securityPolicy: "Basic256Sha256", apiKey: "opcua-demo-cert-key" },
      tools: [
        { name: "opcua_browse_namespace", description: "Browse PLC OPC-UA namespace" },
        { name: "opcua_read_nodes", description: "Read live PLC node tag values" },
        { name: "opcua_write_setpoint", description: "Write approved PLC setpoint" }
      ]
    },
    {
      id: "conn-hub-modbus",
      slug: "modbus-tcp",
      name: "Modbus TCP / RTU Fieldbus Gateway",
      category: "scada" as const,
      transport: "simulated" as const,
      endpointUrl: "modbus://gateway-l3.detroit.local:502",
      creds: { unitId: "1", apiKey: "modbus-demo-token" },
      tools: [
        { name: "modbus_read_holding_registers", description: "Read 16-bit Modbus holding registers" },
        { name: "modbus_read_input_registers", description: "Sample sensor analog input registers" },
        { name: "modbus_write_coil", description: "Toggle governed Modbus output coil" }
      ]
    }
  ];

  const existingConns = await db
    .select({ id: schema.connectorConnections.id })
    .from(schema.connectorConnections)
    .where(eq(schema.connectorConnections.tenantId, "tenant-acme"));
  const existingConnIds = new Set(existingConns.map((c) => c.id));
  const missingConns = enterpriseConnSeeds.filter((c) => !existingConnIds.has(c.id));
  if (missingConns.length > 0) {
    const connNow = new Date();
    await db.insert(schema.connectorConnections).values(
      missingConns.map((c) => ({
        id: c.id,
        tenantId: "tenant-acme",
        slug: c.slug,
        name: c.name,
        category: c.category,
        transport: c.transport,
        endpointUrl: c.endpointUrl,
        status: "connected" as const,
        encryptedCredentials: encryptCredentials(c.creds),
        config: { mode: "managed", syncIntervalSec: 60 },
        discoveredTools: c.tools,
        lastSyncAt: connNow,
        lastError: null
      }))
    );
  }

  const existingBoardRows = await db
    .select({ id: schema.boardIssues.id })
    .from(schema.boardIssues)
    .where(eq(schema.boardIssues.tenantId, "tenant-acme"))
    .limit(1);

  if (existingBoardRows.length === 0) {
    await db.insert(schema.boardIssues).values([
      {
        id: "brd-lut-101",
        tenantId: "tenant-acme",
        plantId: "plant-detroit",
        identifier: "LUT-101",
        title: "Investigate Line 3 Filler E42 bearing vibration spike (OPC-UA)",
        description:
          "OPC-UA node ns=2;s=Line3.FillerE42.VibrationRMS crossed 6.2 mm/s. Multi-agent triage linked OEM bearing spec and drafted maintenance order.",
        status: "in_progress",
        priority: "urgent",
        category: "incident",
        assigneeName: "Marcus Rivera",
        labels: ["opc-ua", "line-3", "safety"],
        sourceRef: "SAP PM #4000812",
        dueDate: "2026-11-26",
        createdBy: "usr-eng-detroit"
      },
      {
        id: "brd-lut-102",
        tenantId: "tenant-acme",
        plantId: "plant-detroit",
        identifier: "LUT-102",
        title: "Reserve 2x SKF-6208 seal kits in SAP MM before shift handover",
        description:
          "Confirm stock in Detroit warehouse SLOC 0001 and hold 2 units against corrective work order WO-104.",
        status: "todo",
        priority: "high",
        category: "operations",
        assigneeName: "Elena Park",
        labels: ["sap-mm", "spares"],
        sourceRef: "SAP MM #1009482",
        dueDate: "2026-11-26",
        createdBy: "usr-manager"
      },
      {
        id: "brd-lut-103",
        tenantId: "tenant-acme",
        plantId: "plant-detroit",
        identifier: "LUT-103",
        title: "Automate ServiceNow P2 ticket creation on CNC thermal alarm",
        description:
          "Workflow rule publishes alert event and opens ServiceNow CMDB-linked incident with operator approval trace.",
        status: "in_review",
        priority: "high",
        category: "automation",
        assigneeName: "Priya Nair",
        labels: ["servicenow", "workflow"],
        sourceRef: "ServiceNow INC004192",
        dueDate: "2026-11-27",
        createdBy: "usr-analyst"
      },
      {
        id: "brd-lut-104",
        tenantId: "tenant-acme",
        plantId: "plant-detroit",
        identifier: "LUT-104",
        title: "Calibrate Modbus TCP chiller gateway registers on Austin bay",
        description:
          "Validate holding registers 40001-40012 scaling factor after firmware patch and verify zero packet loss in MQTT broker.",
        status: "todo",
        priority: "medium",
        category: "connector",
        assigneeName: "Austin Crew",
        labels: ["modbus", "mqtt"],
        sourceRef: "Modbus GW-02",
        dueDate: "2026-11-28",
        createdBy: "usr-eng-austin"
      },
      {
        id: "brd-lut-105",
        tenantId: "tenant-acme",
        plantId: null,
        identifier: "LUT-105",
        title: "Enable executive weekly OEE anomaly summary to AWS S3 data lake",
        description:
          "Schedule Agentic Dashboard snapshot export and compliance manifest archiving to S3 every Friday.",
        status: "backlog",
        priority: "low",
        category: "agent",
        assigneeName: "Priya Nair",
        labels: ["aws-s3", "dashboards"],
        sourceRef: "Executive Board",
        dueDate: "2026-12-01",
        createdBy: "usr-analyst"
      },
      {
        id: "brd-lut-106",
        tenantId: "tenant-acme",
        plantId: "plant-detroit",
        identifier: "LUT-106",
        title: "Configure AWS IoT SiteWise property rollup for Detroit Line 3",
        description:
          "Stream 1-minute temperature and vibration aggregates into semantic KPI board metrics.",
        status: "done",
        priority: "medium",
        category: "connector",
        assigneeName: "David Kim",
        labels: ["aws-iot", "telemetry"],
        sourceRef: "AWS SiteWise",
        dueDate: "2026-11-24",
        createdBy: "usr-admin"
      },
      {
        id: "brd-lut-107",
        tenantId: "tenant-acme",
        plantId: "plant-austin",
        identifier: "LUT-107",
        title: "Sync SAP QM inspection lot hold alerts to Autonomous Triage Agent",
        description:
          "Correlate quality hold lots in Austin Press #2 with upstream torque drift readings.",
        status: "backlog",
        priority: "medium",
        category: "agent",
        assigneeName: "Elena Park",
        labels: ["sap-qm", "multi-agent"],
        sourceRef: "SAP QM #8900012",
        dueDate: "2026-11-29",
        createdBy: "usr-manager"
      },
      {
        id: "brd-lut-108",
        tenantId: "tenant-acme",
        plantId: null,
        identifier: "LUT-108",
        title: "Roll out Google & Microsoft login for plant supervisors",
        description:
          "Verify Clerk custom domain routing and enterprise invite-only access controls.",
        status: "done",
        priority: "high",
        category: "operations",
        assigneeName: "David Kim",
        labels: ["auth", "governance"],
        sourceRef: "Lutic IAM",
        dueDate: "2026-11-25",
        createdBy: "usr-admin"
      }
    ]);
  }
}

const isCli =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("seed.ts");

if (isCli) {
  createDbConnection()
    .then(async (conn) => {
      try {
        await seedDatabase(conn);
        console.log("Lutic seed complete! Demo password:", DEMO_PASSWORD);
      } finally {
        await conn.close();
      }
    })
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
