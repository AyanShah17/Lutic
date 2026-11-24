import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import QRCode from "qrcode";
import {
  and,
  assets,
  auditLog,
  authorize,
  eq,
  inArray,
  machineStatus,
  plants,
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const PatchAssetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2).max(160).optional(),
  manufacturer: z.string().max(120).optional(),
  model: z.string().max(120).optional(),
  criticality: z.enum(["A", "B", "C"]).optional()
});

const AssetId = z.string().trim().min(1).max(160);
const AssetIdentity = { plantId: AssetId, name: z.string().trim().min(2).max(160) };
const CreateAssetSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...AssetIdentity,
    type: z.literal("line")
  }),
  z.strictObject({
    ...AssetIdentity,
    type: z.literal("machine"),
    parentId: AssetId,
    machineType: z.string().trim().max(120).optional(),
    manufacturer: z.string().trim().max(120).optional(),
    model: z.string().trim().max(120).optional(),
    criticality: z.enum(["A", "B", "C"]).optional()
  })
]);

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "admin:assets", { tenantId: user.tenantId });

    const { searchParams } = new URL(req.url);
    const qrMachineId = searchParams.get("qr");

    return await withWebTenantDb(user.tenantId, async (db) => {
      const assetScope = and(eq(assets.tenantId, user.tenantId), inArray(assets.plantId, user.plantIds));
      if (qrMachineId) {
        const [machine] = await db.select({ id: assets.id }).from(assets)
          .where(and(assetScope, eq(assets.type, "machine"), eq(assets.id, qrMachineId))).limit(1);
        if (!machine) return problemResponse(404, "Not Found", "Machine not found.");
        const url = new URL(`/m/${encodeURIComponent(machine.id)}`, req.url).href;
        const svg = await QRCode.toString(url, { type: "svg", margin: 2, width: 220 });
        return NextResponse.json({ machineId: machine.id, url, svg });
      }

      const [assetRows, statusRows, plantRows] = await Promise.all([
        db.select().from(assets).where(assetScope),
        db.select().from(machineStatus).where(
          and(eq(machineStatus.tenantId, user.tenantId), inArray(machineStatus.plantId, user.plantIds))
        ),
        db.select().from(plants).where(and(eq(plants.tenantId, user.tenantId), inArray(plants.id, user.plantIds)))
      ]);

      const statusMap = new Map(statusRows.map((s) => [s.machineId, s.status]));

      return NextResponse.json({
        plants: plantRows,
        assets: assetRows.map((a) => ({
          ...a,
          liveStatus: statusMap.get(a.id) ?? null
        }))
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "admin:assets", { tenantId: user.tenantId });
    const body = CreateAssetSchema.parse(await req.json().catch(() => null));
    authorize(user, "admin:assets", { tenantId: user.tenantId, plantId: body.plantId });

    return await withWebTenantDb(user.tenantId, async (db) => {
      const [plant] = await db.select({ id: plants.id }).from(plants)
        .where(and(eq(plants.id, body.plantId), eq(plants.tenantId, user.tenantId))).limit(1);
      if (!plant) return problemResponse(404, "Not Found", "Plant not found.");

      if (body.type === "machine") {
        const [line] = await db.select({ id: assets.id }).from(assets).where(and(
          eq(assets.id, body.parentId),
          eq(assets.tenantId, user.tenantId),
          eq(assets.plantId, body.plantId),
          eq(assets.type, "line")
        )).limit(1);
        if (!line) return problemResponse(400, "Invalid Line", "Choose a production line in the selected plant.");
      }

      const id = randomUUID();
      const [asset] = await db.insert(assets).values({
        ...body,
        id,
        tenantId: user.tenantId,
        qrCode: body.type === "machine" ? `/m/${id}` : ""
      }).returning();
      await db.insert(auditLog).values({
        id: randomUUID(),
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "admin_create_asset",
        toolName: "admin.assets.create",
        args: { assetId: id, plantId: body.plantId, type: body.type },
        resultHash: "",
        status: "allowed"
      });
      return NextResponse.json({ asset }, { status: 201 });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "admin:assets", { tenantId: user.tenantId });

    const body = PatchAssetSchema.parse(await req.json().catch(() => null));

    const updates: Partial<typeof assets.$inferInsert> = {};
    if (body.name) updates.name = body.name;
    if (typeof body.manufacturer === "string") updates.manufacturer = body.manufacturer;
    if (typeof body.model === "string") updates.model = body.model;
    if (body.criticality) updates.criticality = body.criticality;
    if (!Object.keys(updates).length) return problemResponse(400, "Invalid Update", "Supply at least one asset field.");

    return await withWebTenantDb(user.tenantId, async (db) => {
      const [asset] = await db
        .update(assets)
        .set(updates)
        .where(and(eq(assets.id, body.id), eq(assets.tenantId, user.tenantId), inArray(assets.plantId, user.plantIds)))
        .returning();

      if (!asset) return problemResponse(404, "Not Found", "Asset not found.");
      return NextResponse.json({ ok: true });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
