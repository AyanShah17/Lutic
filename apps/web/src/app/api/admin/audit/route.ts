import { NextResponse } from "next/server";
import { and, auditLog, authorize, desc, eq, gte, lte } from "@lutic/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { getSessionUser, handleApiError, problemResponse } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "admin:audit", { tenantId: user.tenantId });

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");
    const toolName = searchParams.get("toolName");
    const status = searchParams.get("status");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const format = searchParams.get("format");

    const conds = [eq(auditLog.tenantId, user.tenantId)];
    if (userId) conds.push(eq(auditLog.userId, userId));
    if (toolName) conds.push(eq(auditLog.toolName, toolName));
    if (status) conds.push(eq(auditLog.status, status as "allowed" | "denied" | "confirmed" | "error"));
    if (from) conds.push(gte(auditLog.createdAt, new Date(from)));
    if (to) conds.push(lte(auditLog.createdAt, new Date(to)));

    return await withWebTenantDb(user.tenantId, async (db) => {
      const rows = await db
        .select()
        .from(auditLog)
        .where(and(...conds))
        .orderBy(desc(auditLog.createdAt))
        .limit(200);

      if (format === "csv") {
        const header = "id,created_at,user_id,role,action,tool_name,status,reason,latency_ms,result_hash\n";
        const csvRows = rows
          .map((r) =>
            [
              r.id,
              r.createdAt.toISOString(),
              r.userId,
              r.role,
              r.action,
              r.toolName,
              r.status,
              `"${String(r.reason).replace(/"/g, '""')}"`,
              r.latencyMs,
              r.resultHash
            ].join(",")
          )
          .join("\n");

        return new Response(header + csvRows, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="lutic-audit-log.csv"'
          }
        });
      }

      return NextResponse.json({ entries: rows });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
