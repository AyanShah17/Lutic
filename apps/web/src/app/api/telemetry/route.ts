import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  assets,
  authenticateIngestionToken,
  authorize,
  consumeRateLimit,
  eq,
  inArray,
  isIngestionTokenFormat,
  machineStatus,
  readings,
  sha256Hex,
  sql,
  type AuthenticatedIngestionToken,
  type SessionUser
} from "@lutic/core";
import { getSessionToken, getSessionUser, handleApiError, problemResponse, verifyCsrfOrigin } from "@/lib/auth";
import { getWebAdministrativeDb, requireWebLicense, withWebTenantDb } from "@/lib/db";
import { readBoundedBody } from "@/lib/request-body";

const SampleSchema = z.strictObject({
  sampleId: z.string().trim().min(1).max(128),
  machineId: z.string().trim().min(1).max(128),
  recordedAt: z.iso.datetime({ offset: true })
    .transform((value) => new Date(value))
    .refine((value) => value.getUTCFullYear() >= 1, "Invalid sample timestamp"),
  status: z.enum(["running", "idle", "fault", "offline"]),
  temperature: z.number().finite(),
  vibration: z.number().finite().nonnegative(),
  pressure: z.number().finite(),
  currentSpeed: z.number().finite().nonnegative()
});
const IntakeSchema = z.strictObject({ samples: z.array(SampleSchema).min(1).max(100) });

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    const rawBearer = await getSessionToken(req);
    let sessionUser: SessionUser | null = null;
    let tokenAuth: AuthenticatedIngestionToken | null = null;

    if (rawBearer && isIngestionTokenFormat(rawBearer)) {
      await requireWebLicense();
      tokenAuth = await authenticateIngestionToken(await getWebAdministrativeDb(), rawBearer);
      if (!tokenAuth) {
        return problemResponse(401, "Unauthorized", "Invalid, expired, or revoked ingestion token.");
      }
    } else {
      sessionUser = await getSessionUser(req);
      if (!sessionUser) return problemResponse(401, "Unauthorized", "Please sign in.");
      authorize(sessionUser, "admin:assets", { tenantId: sessionUser.tenantId });
      await requireWebLicense();
    }

    const tenantId = tokenAuth ? tokenAuth.tenantId : sessionUser!.tenantId;
    const rateLimitKey = tokenAuth ? `${tokenAuth.tenantId}:${tokenAuth.id}` : tenantId;

    const allowed = await consumeRateLimit(await getWebAdministrativeDb(), {
      scope: "telemetry-ingest", key: rateLimitKey, limit: 60, windowMs: 60_000
    });
    if (!allowed) {
      const response = problemResponse(429, "Too Many Requests", "Try submitting telemetry again in one minute.");
      response.headers.set("Retry-After", "60");
      return response;
    }

    const body = await readBoundedBody(req, 64 * 1024);
    const { samples } = IntakeSchema.parse(await body.json());
    const now = Date.now();
    if (samples.some((sample) => sample.recordedAt.getTime() > now)) {
      return problemResponse(400, "Invalid Timestamp", "Sample timestamps must not be in the future.");
    }

    return await withWebTenantDb(tenantId, async (db) => {
      const machineIds = [...new Set(samples.map((sample) => sample.machineId))].sort();
      const machines = await db
        .select({ id: assets.id, plantId: assets.plantId })
        .from(assets)
        .where(and(inArray(assets.id, machineIds), eq(assets.tenantId, tenantId), eq(assets.type, "machine")))
        .orderBy(assets.id)
        .for("share");
      if (machines.length !== machineIds.length) {
        return problemResponse(404, "Not Found", "One or more machines were not found.");
      }
      const plantByMachine = new Map(machines.map((machine) => [machine.id, machine.plantId]));
      if (tokenAuth) {
        const forbidden = machines.find((machine) => machine.plantId !== tokenAuth.plantId);
        if (forbidden) {
          return problemResponse(
            403,
            "Forbidden",
            `Ingestion token is restricted to plant '${tokenAuth.plantId}'.`
          );
        }
      } else {
        authorize(sessionUser!, "admin:assets", {
          tenantId,
          plantIds: machines.map((machine) => machine.plantId)
        });
      }

      const uniqueSamples = new Map<string, typeof samples[number]>();
      for (const sample of samples) {
        const id = `telemetry-${sha256Hex(JSON.stringify([tenantId, sample.machineId, sample.sampleId]))}`;
        if (!uniqueSamples.has(id)) uniqueSamples.set(id, sample);
      }
      const entries = Array.from(uniqueSamples.entries()).sort(([left], [right]) => left.localeCompare(right));
      const readingRows = entries.flatMap(([id, sample]) => {
        const fields = [
          { tag: "temperature", value: sample.temperature, unit: "C" },
          { tag: "vibration", value: sample.vibration, unit: "mm/s" },
          { tag: "pressure", value: sample.pressure, unit: "bar" },
          { tag: "speed", value: sample.currentSpeed, unit: "%" }
        ];
        return fields.map((field) => ({
          ...field,
          id: `${id}-${field.tag}`,
          tenantId,
          plantId: plantByMachine.get(sample.machineId)!,
          machineId: sample.machineId,
          ts: sample.recordedAt
        }));
      });
      const inserted = await db.insert(readings).values(readingRows).onConflictDoNothing({ target: readings.id }).returning();
      const insertedIds = new Set(inserted.map((reading) => reading.id));
      const latest = new Map<string, typeof samples[number]>();
      let acceptedSamples = 0;
      for (const [id, sample] of entries) {
        if (!insertedIds.has(`${id}-temperature`)) continue;
        acceptedSamples += 1;
        const current = latest.get(sample.machineId);
        if (!current || current.recordedAt < sample.recordedAt) latest.set(sample.machineId, sample);
      }

      let updatedMachines = 0;
      if (latest.size > 0) {
        const statusRows = Array.from(latest.values())
          .sort((left, right) => left.machineId.localeCompare(right.machineId))
          .map((sample) => ({
            id: `telemetry-status-${sample.machineId}`,
            tenantId,
            plantId: plantByMachine.get(sample.machineId)!,
            machineId: sample.machineId,
            status: sample.status,
            currentSpeed: sample.currentSpeed,
            temperature: sample.temperature,
            vibration: sample.vibration,
            pressure: sample.pressure,
            updatedAt: sample.recordedAt
          }));
        const updated = await db.insert(machineStatus).values(statusRows).onConflictDoUpdate({
          target: machineStatus.machineId,
          set: {
            plantId: sql`excluded.plant_id`,
            status: sql`excluded.status`,
            currentSpeed: sql`excluded.current_speed`,
            temperature: sql`excluded.temperature`,
            vibration: sql`excluded.vibration`,
            pressure: sql`excluded.pressure`,
            updatedAt: sql`excluded.updated_at`
          },
          setWhere: sql`excluded.tenant_id = ${machineStatus.tenantId} AND excluded.updated_at > ${machineStatus.updatedAt}`
        }).returning();
        updatedMachines = updated.length;
      }

      return NextResponse.json({ acceptedSamples, duplicateSamples: samples.length - acceptedSamples, updatedMachines });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
