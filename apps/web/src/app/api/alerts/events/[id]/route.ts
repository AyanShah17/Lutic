import { NextResponse } from "next/server";
import { z } from "zod";
import { POST as ackPost } from "@/app/api/monitoring/alerts/[id]/acknowledge/route";
import { POST as resolvePost } from "@/app/api/monitoring/alerts/[id]/resolve/route";

const PatchEventSchema = z.object({
  action: z.enum(["acknowledge", "resolve"])
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const clone = req.clone();
  const body = PatchEventSchema.safeParse(await clone.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json(
      { error: "action must be acknowledge or resolve" },
      { status: 400 }
    );
  }
  return body.data.action === "acknowledge"
    ? ackPost(req, context)
    : resolvePost(req, context);
}
