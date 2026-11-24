import { NextResponse } from "next/server";
import { z } from "zod";
import { authorize, DashboardSpecSchema } from "@kojo/core";
import { requireWebLicense } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const RefineSchema = z.object({
  instruction: z.string().min(2).max(500),
  spec: DashboardSpecSchema
});

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "dashboard:write", { tenantId: user.tenantId });

    const { instruction, spec } = RefineSchema.parse(await req.json());
    const lower = instruction.toLowerCase();
    const nextWidgets = spec.widgets.map((w) => ({ ...w }));
    const nextLayout = spec.layout.map((l) => ({ ...l }));

    let summary = `Applied refinement: ${instruction}`;

    // Handle "stacked bar by reason code" or "by reason code"
    if (/stacked\s*bar/.test(lower)) {
      const target =
        nextWidgets.find((w) => w.type === "bar" || w.type === "pie" || w.type === "line") ??
        nextWidgets[0];
      if (target) {
        target.type = "stacked_bar";
        if (/reason/.test(lower)) {
          target.groupBy = "reason_code";
          target.metric = "downtime_minutes";
          target.title = "Downtime Stacked by Reason Code";
        }
      }
    } else if (/reason\s*code/.test(lower)) {
      const target = nextWidgets.find((w) => w.metric === "downtime_minutes" && w.groupBy);
      if (target) {
        target.groupBy = "reason_code";
        target.title = "Downtime by Reason Code";
      }
    }

    if (/energy/.test(lower) && !nextWidgets.some((w) => w.metric === "energy_kwh")) {
      const id = `w-${nextWidgets.length + 1}`;
      nextWidgets.push({
        id,
        type: "bar",
        title: "Energy Consumption (kWh) by Line",
        metric: "energy_kwh",
        groupBy: "line",
        range: spec.filters.range ?? "7d",
        sort: "desc",
        limit: 12
      });
      nextLayout.push({ i: id, x: 0, y: 12, w: 6, h: 5 });
    }

    if (/scrap/.test(lower) && !nextWidgets.some((w) => w.metric === "scrap_rate")) {
      const id = `w-${nextWidgets.length + 1}`;
      nextWidgets.push({
        id,
        type: "bar",
        title: "Scrap Rate by Defect Type",
        metric: "scrap_rate",
        groupBy: "defect_type",
        range: spec.filters.range ?? "7d",
        sort: "desc",
        limit: 12
      });
      nextLayout.push({ i: id, x: 6, y: 12, w: 6, h: 5 });
    }

    if (/30\s*d|30 days/.test(lower)) {
      spec.filters.range = "30d";
      for (const w of nextWidgets) w.range = "30d";
      summary = "Updated global and widget time range to 30d";
    }

    const updated = DashboardSpecSchema.parse({
      ...spec,
      widgets: nextWidgets,
      layout: nextLayout
    });

    return NextResponse.json({ spec: updated, summary });
  } catch (err) {
    return handleApiError(err);
  }
}
