import { NextResponse } from "next/server";
import { z } from "zod";
import {
  activateLicense,
  authorize,
  deactivateLicense,
  getLicenseStatus,
  validateCurrentLicense
} from "@kojo/core";
import { getWebAdministrativeDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const ActivateSchema = z.object({
  key: z.string().min(1),
  serverUrl: z.string().url().optional()
});

export async function GET(req: Request) {
  try {
    const db = await getWebAdministrativeDb();
    const url = new URL(req.url);
    if (url.searchParams.get("verify") === "true") {
      await validateCurrentLicense(db);
    }
    const status = await getLicenseStatus(db);
    return NextResponse.json(status);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "license:manage", { tenantId: user.tenantId });

    const body = ActivateSchema.parse(await req.json());
    const db = await getWebAdministrativeDb();
    const result = await activateLicense(db, {
      key: body.key,
      serverUrl: body.serverUrl
    });

    if (!result.valid) {
      return problemResponse(
        result.status === "missing" ? 400 : 403,
        "License Activation Failed",
        result.reason ?? "License key rejected."
      );
    }

    const status = await getLicenseStatus(db);
    return NextResponse.json({ ...result, license: status });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: Request) {
  try {
    verifyCsrfOrigin(req);
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "license:manage", { tenantId: user.tenantId });

    const db = await getWebAdministrativeDb();
    await deactivateLicense(db);
    return NextResponse.json({ ok: true, status: "unactivated" });
  } catch (err) {
    return handleApiError(err);
  }
}
