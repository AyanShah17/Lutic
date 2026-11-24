import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  auditLog,
  authorize,
  desc,
  eq,
  generateIngestionTokenSecret,
  inArray,
  ingestionTokens,
  isNull,
  plants
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { getSessionUser, handleApiError, problemResponse, verifyCsrfOrigin } from "@/lib/auth";
import { readBoundedBody } from "@/lib/request-body";

const CreateTokenSchema = z.strictObject({
  plantId: z.string().trim().min(1).max(160),
  name: z.string().trim().min(2).max(120),
  expiresInDays: z.number().int().min(1).max(730).optional()
});

const PatchTokenSchema = z.strictObject({
  id: z.string().trim().min(1).max(160),
  action: z.enum(["revoke", "rotate"]),
  expiresInDays: z.number().int().min(1).max(730).optional()
});

function toPublicRecord(row: typeof ingestionTokens.$inferSelect) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    plantId: row.plantId,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    scopes: row.scopes,
    active: row.active,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    rotatedFromId: row.rotatedFromId,
    createdBy: row.createdBy,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt
  };
}

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "admin:assets", { tenantId: user.tenantId });

    return await withWebTenantDb(user.tenantId, async (db) => {
      const [rows, plantRows] = await Promise.all([
        db
          .select()
          .from(ingestionTokens)
          .where(
            and(
              eq(ingestionTokens.tenantId, user.tenantId),
              inArray(ingestionTokens.plantId, user.plantIds)
            )
          )
          .orderBy(desc(ingestionTokens.createdAt)),
        db
          .select()
          .from(plants)
          .where(and(eq(plants.tenantId, user.tenantId), inArray(plants.id, user.plantIds)))
      ]);

      return NextResponse.json({
        plants: plantRows,
        tokens: rows.map(toPublicRecord)
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

    const body = CreateTokenSchema.parse(await (await readBoundedBody(req, 16 * 1024)).json());

    return await withWebTenantDb(user.tenantId, async (db) => {
      authorize(user, "admin:assets", { tenantId: user.tenantId, plantId: body.plantId });

      const [plant] = await db
        .select({ id: plants.id })
        .from(plants)
        .where(and(eq(plants.tenantId, user.tenantId), eq(plants.id, body.plantId)))
        .limit(1);
      if (!plant) {
        return problemResponse(404, "Not Found", `Plant '${body.plantId}' was not found in your tenant.`);
      }

      const secret = generateIngestionTokenSecret();
      const id = `itok-${crypto.randomUUID().slice(0, 12)}`;
      const expiresAt = body.expiresInDays
        ? new Date(Date.now() + body.expiresInDays * 86_400_000)
        : null;

      const [inserted] = await db
        .insert(ingestionTokens)
        .values({
          id,
          tenantId: user.tenantId,
          plantId: body.plantId,
          name: body.name,
          tokenPrefix: secret.tokenPrefix,
          tokenHash: secret.tokenHash,
          scopes: ["telemetry:write"],
          active: true,
          expiresAt,
          createdBy: user.userId
        })
        .returning();

      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "admin_create_ingestion_token",
        toolName: "admin.ingestion_tokens.create",
        args: { id, plantId: body.plantId, name: body.name, expiresAt: expiresAt?.toISOString() ?? null },
        resultHash: "",
        status: "allowed",
        reason: "Gateway ingestion token created",
        latencyMs: 1
      });

      return NextResponse.json(
        {
          token: secret.rawToken,
          record: toPublicRecord(inserted!)
        },
        { status: 201 }
      );
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

    const body = PatchTokenSchema.parse(await (await readBoundedBody(req, 16 * 1024)).json());

    return await withWebTenantDb(user.tenantId, async (db) => {
      const [existing] = await db
        .select()
        .from(ingestionTokens)
        .where(
          and(
            eq(ingestionTokens.id, body.id),
            eq(ingestionTokens.tenantId, user.tenantId),
            inArray(ingestionTokens.plantId, user.plantIds)
          )
        )
        .limit(1)
        .for("update");

      if (!existing) {
        return problemResponse(404, "Not Found", "Ingestion token not found.");
      }

      authorize(user, "admin:assets", { tenantId: user.tenantId, plantId: existing.plantId });

      const now = new Date();
      if (body.action === "revoke") {
        const [revoked] = await db
          .update(ingestionTokens)
          .set({ active: false, revokedAt: existing.revokedAt ?? now })
          .where(and(eq(ingestionTokens.id, existing.id), eq(ingestionTokens.tenantId, user.tenantId)))
          .returning();

        await db.insert(auditLog).values({
          id: `aud-${crypto.randomUUID().slice(0, 12)}`,
          tenantId: user.tenantId,
          userId: user.userId,
          role: user.role,
          action: "admin_revoke_ingestion_token",
          toolName: "admin.ingestion_tokens.revoke",
          args: { id: existing.id, plantId: existing.plantId },
          resultHash: "",
          status: "allowed",
          reason: "Gateway ingestion token revoked",
          latencyMs: 1
        });

        return NextResponse.json({ record: toPublicRecord(revoked!) });
      }

      // Rotate: reject revoked or expired tokens (unless extended), then atomically deactivate and replace.
      if (!existing.active || existing.revokedAt) {
        return problemResponse(409, "Conflict", "Cannot rotate a revoked ingestion token.");
      }
      if (existing.expiresAt && existing.expiresAt.getTime() <= now.getTime() && !body.expiresInDays) {
        return problemResponse(409, "Conflict", "Supply expiresInDays when rotating an expired token.");
      }

      const deactivated = await db
        .update(ingestionTokens)
        .set({ active: false, revokedAt: now })
        .where(
          and(
            eq(ingestionTokens.id, existing.id),
            eq(ingestionTokens.tenantId, user.tenantId),
            eq(ingestionTokens.active, true),
            isNull(ingestionTokens.revokedAt)
          )
        )
        .returning();

      if (!deactivated.length) {
        return problemResponse(409, "Conflict", "Cannot rotate a revoked ingestion token.");
      }

      const secret = generateIngestionTokenSecret();
      const newId = `itok-${crypto.randomUUID().slice(0, 12)}`;
      const expiresAt = body.expiresInDays
        ? new Date(Date.now() + body.expiresInDays * 86_400_000)
        : existing.expiresAt;

      const [rotated] = await db
        .insert(ingestionTokens)
        .values({
          id: newId,
          tenantId: user.tenantId,
          plantId: existing.plantId,
          name: existing.name,
          tokenPrefix: secret.tokenPrefix,
          tokenHash: secret.tokenHash,
          scopes: existing.scopes,
          active: true,
          expiresAt,
          rotatedFromId: existing.id,
          createdBy: user.userId
        })
        .returning();

      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "admin_rotate_ingestion_token",
        toolName: "admin.ingestion_tokens.rotate",
        args: { previousId: existing.id, newId, plantId: existing.plantId },
        resultHash: "",
        status: "allowed",
        reason: "Gateway ingestion token rotated",
        latencyMs: 1
      });

      return NextResponse.json({
        token: secret.rawToken,
        record: toPublicRecord(rotated!)
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
