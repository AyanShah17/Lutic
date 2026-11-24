import { NextResponse } from "next/server";
import {
  authorize,
  desc,
  eq,
  feedback,
  messages,
  usageLog
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { getSessionUser, handleApiError, problemResponse } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "admin:usage", { tenantId: user.tenantId });

    return await withWebTenantDb(user.tenantId, async (db) => {
      const [usageRows, fbRows] = await Promise.all([
        db
          .select()
          .from(usageLog)
          .where(eq(usageLog.tenantId, user.tenantId))
          .orderBy(desc(usageLog.createdAt))
          .limit(200),
        db
          .select({
            id: feedback.id,
            messageId: feedback.messageId,
            userId: feedback.userId,
            rating: feedback.rating,
            outcome: feedback.outcome,
            comment: feedback.comment,
            createdAt: feedback.createdAt,
            answerExcerpt: messages.content
          })
          .from(feedback)
          .leftJoin(messages, eq(messages.id, feedback.messageId))
          .where(eq(feedback.tenantId, user.tenantId))
          .orderBy(desc(feedback.createdAt))
          .limit(100)
      ]);

      const totalCostUsd = usageRows.reduce((s, r) => s + r.estimatedCostUsd, 0);
      const totalTokens = usageRows.reduce(
        (s, r) => s + r.promptTokens + r.completionTokens,
        0
      );

      const byModel = new Map<
        string,
        { model: string; calls: number; tokens: number; costUsd: number }
      >();
      const byUser = new Map<
        string,
        { userId: string; role: string; calls: number; tokens: number; costUsd: number }
      >();

      for (const u of usageRows) {
        const m = byModel.get(u.model) ?? {
          model: u.model,
          calls: 0,
          tokens: 0,
          costUsd: 0
        };
        m.calls += 1;
        m.tokens += u.promptTokens + u.completionTokens;
        m.costUsd += u.estimatedCostUsd;
        byModel.set(u.model, m);

        const usr = byUser.get(u.userId) ?? {
          userId: u.userId,
          role: u.role,
          calls: 0,
          tokens: 0,
          costUsd: 0
        };
        usr.calls += 1;
        usr.tokens += u.promptTokens + u.completionTokens;
        usr.costUsd += u.estimatedCostUsd;
        byUser.set(u.userId, usr);
      }

      const totalFeedback = fbRows.length;
      const upCount = fbRows.filter((f) => f.rating === "up").length;
      const fixedCount = fbRows.filter((f) => f.outcome === "fixed_it").length;
      const wrongList = fbRows.filter(
        (f) => f.outcome === "wrong" || f.rating === "down"
      );

      return NextResponse.json({
        summary: {
          totalCalls: usageRows.length,
          totalTokens,
          totalCostUsd: Number(totalCostUsd.toFixed(4)),
          helpfulnessRate:
            totalFeedback > 0 ? Math.round((upCount / totalFeedback) * 100) : 100,
          fixedCount,
          totalFeedback
        },
        byModel: Array.from(byModel.values()),
        byUser: Array.from(byUser.values()),
        wrongAnswers: wrongList
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
