import { NextResponse } from "next/server";
import { querySemanticMetric } from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");

    const body = await req.json();
    return await withWebTenantDb(user.tenantId, async (db) => {
      const result = await querySemanticMetric(db, user, body);
      return NextResponse.json(result);
    });
  } catch (err) {
    return handleApiError(err);
  }
}
