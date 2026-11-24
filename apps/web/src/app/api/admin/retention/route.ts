import { NextResponse } from "next/server";
import { z } from "zod";
import { authorize, runRetentionCleanup } from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { getSessionUser, handleApiError, problemResponse, verifyCsrfOrigin } from "@/lib/auth";
import { readBoundedBody } from "@/lib/request-body";

const RetentionRequestSchema = z.strictObject({
  retentionDays: z.number().int().min(1).max(3650).optional()
});

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "admin:audit", { tenantId: user.tenantId });

    const rawText = await (await readBoundedBody(req, 4096)).text();
    const parsed = rawText.trim().length > 0 ? RetentionRequestSchema.parse(JSON.parse(rawText)) : {};

    return await withWebTenantDb(user.tenantId, async (db) => {
      const summary = await runRetentionCleanup(db, {
        tenantId: user.tenantId,
        retentionDays: parsed.retentionDays,
        actorUserId: user.userId,
        actorRole: user.role
      });
      return NextResponse.json(summary);
    });
  } catch (err) {
    return handleApiError(err);
  }
}
