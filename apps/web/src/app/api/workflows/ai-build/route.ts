import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authorize,
  buildWorkflowFromPrompt,
} from "@kojo/core";
import { requireWebLicense } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const AiBuildSchema = z.object({
  prompt: z.string().min(3).max(2000)
});

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "workflow:write", { tenantId: user.tenantId });

    const body = AiBuildSchema.parse(await req.json());
    const draft = buildWorkflowFromPrompt(body.prompt);

    return NextResponse.json({
      draft,
      workflow: draft
    });
  } catch (err) {
    return handleApiError(err);
  }
}
