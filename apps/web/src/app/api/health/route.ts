import { NextResponse } from "next/server";
import { getLicenseStatus, logger, sql } from "@kojo/core";
import { getWebAdministrativeDb } from "@/lib/db";
import { ensureBackgroundRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getWebAdministrativeDb();
    await db.execute(sql`SELECT 1`);
    const license = await getLicenseStatus(db);
    ensureBackgroundRuntime();
    return NextResponse.json({
      ok: true,
      service: "kojo-web",
      db: "ok",
      license: {
        enforced: license.enforced,
        status: license.status,
        active: license.active,
        plan: license.plan,
        expiresAt: license.expiresAt
      }
    });
  } catch (err) {
    logger.error({ err }, "Health check failed");
    const detail = "Service unavailable. Check server logs.";
    return NextResponse.json(
      { ok: false, service: "kojo-web", db: "error", detail },
      { status: 503 }
    );
  }
}
