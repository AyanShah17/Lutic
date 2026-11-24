import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  auditLog,
  authorize,
  eq,
  hashPassword,
  inArray,
  plants,
  RoleSchema,
  sql,
  userPlants,
  users,
  type KojoDatabase,
  type SessionUser
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const CreateUserSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().min(2).max(120),
  role: RoleSchema,
  plantIds: z.array(z.string()).min(1).max(100).transform((ids) => [...new Set(ids)]),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(1024)
    .refine(
      (password) =>
        password !== "kojo-demo-password" &&
        password.trim() === password &&
        new Set(password).size >= 8,
      "Choose a unique password with varied characters"
    )
});

const PatchUserSchema = z.object({
  userId: z.string().min(1),
  role: RoleSchema.optional(),
  plantIds: z.array(z.string()).min(1).max(100).transform((ids) => [...new Set(ids)]).optional(),
  active: z.boolean().optional(),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(1024)
    .refine(
      (password) => password !== "kojo-demo-password" && new Set(password).size >= 8,
      "Choose a unique password with varied characters"
    )
    .optional(),
  revokeSessions: z.boolean().optional()
});

async function canAssignPlants(db: KojoDatabase, user: SessionUser, ids: string[]): Promise<boolean> {
  if (ids.some((id) => !user.plantIds.includes(id))) return false;
  const rows = await db.select({ id: plants.id }).from(plants)
    .where(and(eq(plants.tenantId, user.tenantId), inArray(plants.id, ids)));
  return rows.length === ids.length;
}

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "admin:users", { tenantId: user.tenantId });

    return await withWebTenantDb(user.tenantId, async (db) => {
      const [userRows, upRows, plantRows] = await Promise.all([
        db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            role: users.role,
            active: users.active,
            tokenVersion: users.tokenVersion,
            passwordUpdatedAt: users.passwordUpdatedAt,
            createdAt: users.createdAt
          })
          .from(users)
          .where(eq(users.tenantId, user.tenantId)),
        db
          .select()
          .from(userPlants)
          .where(eq(userPlants.tenantId, user.tenantId)),
        db
          .select()
          .from(plants)
          .where(eq(plants.tenantId, user.tenantId))
      ]);

      const plantMap = new Map<string, string[]>();
      for (const up of upRows) {
        const list = plantMap.get(up.userId) ?? [];
        list.push(up.plantId);
        plantMap.set(up.userId, list);
      }

      return NextResponse.json({
        plants: plantRows,
        users: userRows.map((u) => ({
          ...u,
          plantIds: plantMap.get(u.id) ?? []
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
    authorize(user, "admin:users", { tenantId: user.tenantId });

    const body = CreateUserSchema.parse(await req.json());
    const newId = `usr-${crypto.randomUUID().slice(0, 8)}`;

    return await withWebTenantDb(user.tenantId, async (db) => {
      if (!await canAssignPlants(db, user, body.plantIds)) {
        return problemResponse(403, "Forbidden", "Plant assignments must be within your authorized plants.");
      }
      const existing = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.tenantId, user.tenantId), eq(users.email, body.email.toLowerCase()))).limit(1);
      if (existing.length) return problemResponse(409, "Already Exists", "A user with that email already exists.");
      await db.insert(users).values({
        id: newId,
        tenantId: user.tenantId,
        email: body.email.toLowerCase().trim(),
        name: body.name.trim(),
        passwordHash: hashPassword(body.password),
        role: body.role,
        active: true
      });

      await db.insert(userPlants).values(
        body.plantIds.map((pid) => ({
          tenantId: user.tenantId,
          userId: newId,
          plantId: pid
        }))
      );

      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "admin_invite_user",
        toolName: "admin.users.create",
        args: { email: body.email, role: body.role, plantIds: body.plantIds },
        resultHash: "",
        status: "allowed",
        reason: "User invited",
        latencyMs: 1
      });

      return NextResponse.json({ id: newId }, { status: 201 });
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
    authorize(user, "admin:users", { tenantId: user.tenantId });

    const body = PatchUserSchema.parse(await req.json());

    return await withWebTenantDb(user.tenantId, async (db) => {
      // Serialize role changes so concurrent requests cannot remove both final admins.
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${user.tenantId}, 41))`);
      const [target] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, body.userId), eq(users.tenantId, user.tenantId)))
        .limit(1)
        .for("update");
      if (!target) return problemResponse(404, "Not Found", "User not found.");
      if (body.plantIds && !await canAssignPlants(db, user, body.plantIds)) {
        return problemResponse(403, "Forbidden", "Plant assignments must be within your authorized plants.");
      }
      if (target.active && target.role === "admin" &&
          (body.active === false || (body.role && body.role !== "admin"))) {
        const admins = await db.select({ id: users.id }).from(users)
          .where(and(eq(users.tenantId, user.tenantId), eq(users.role, "admin"), eq(users.active, true)));
        if (admins.length <= 1) return problemResponse(409, "Last Administrator", "Keep at least one active administrator.");
      }

      let plantIdsChanged = false;
      if (body.plantIds) {
        const currentPlantRows = await db
          .select({ plantId: userPlants.plantId })
          .from(userPlants)
          .where(and(eq(userPlants.userId, body.userId), eq(userPlants.tenantId, user.tenantId)));
        const curSorted = [...new Set(currentPlantRows.map((p) => p.plantId))].sort();
        const nextSorted = [...body.plantIds].sort();
        plantIdsChanged =
          curSorted.length !== nextSorted.length ||
          curSorted.some((id, idx) => id !== nextSorted[idx]);
      }

      const roleChanged = Boolean(body.role && body.role !== target.role);
      const bumpTokenVersion = Boolean(
        body.password ||
          body.revokeSessions === true ||
          body.active === false ||
          roleChanged ||
          plantIdsChanged
      );
      const hasAccountUpdates = Boolean(
        body.role || typeof body.active === "boolean" || body.password || bumpTokenVersion
      );

      if (hasAccountUpdates) {
        const [updated] = await db
          .update(users)
          .set({
            ...(body.role ? { role: body.role } : {}),
            ...(typeof body.active === "boolean" ? { active: body.active } : {}),
            ...(body.password
              ? {
                  passwordHash: hashPassword(body.password),
                  passwordUpdatedAt: new Date()
                }
              : {}),
            ...(bumpTokenVersion ? { tokenVersion: sql`${users.tokenVersion} + 1` } : {})
          })
          .where(
            and(
              eq(users.id, body.userId),
              eq(users.tenantId, user.tenantId),
              eq(users.tokenVersion, target.tokenVersion)
            )
          )
          .returning();
        if (!updated) {
          return problemResponse(409, "Conflict", "User was modified concurrently; please retry.");
        }
      }

      if (body.plantIds && plantIdsChanged) {
        await db
          .delete(userPlants)
          .where(
            and(
              eq(userPlants.userId, body.userId),
              eq(userPlants.tenantId, user.tenantId)
            )
          );
        await db.insert(userPlants).values(
          body.plantIds.map((pid) => ({
            tenantId: user.tenantId,
            userId: body.userId,
            plantId: pid
          }))
        );
      }

      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "admin_update_user",
        toolName: "admin.users.update",
        args: {
          userId: body.userId,
          role: body.role,
          plantIds: body.plantIds,
          active: body.active,
          passwordReset: Boolean(body.password),
          revokeSessions: bumpTokenVersion
        },
        resultHash: "",
        status: "allowed",
        reason: "User account updated",
        latencyMs: 1
      });

      return NextResponse.json({ ok: true });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
