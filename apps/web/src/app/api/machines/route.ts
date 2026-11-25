import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  alarms,
  and,
  assets,
  auditLog,
  authorize,
  can,
  documentChunks,
  documents,
  eq,
  inArray,
  isNull,
  machineStatus,
  plants
} from "@lutic/core";
import {
  extractTextFromDocumentFile,
  getMaxUploadBytes,
  ingestDocumentJob,
  scanUploadForViruses,
  validateDocumentUpload
} from "@lutic/agent";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";
import { readBoundedBody } from "@/lib/request-body";
import { buildDocumentGroundedTopology } from "@/lib/machine-topology";

const JsonTopologyUploadSchema = z.object({
  title: z.string().min(2).max(200),
  revision: z.string().min(1).default("Rev 1.0"),
  source: z.string().default("topology-drawing.md"),
  rawContent: z.string().min(10).max(500_000)
});

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "machine:read", { tenantId: user.tenantId });

    if (user.plantIds.length === 0) {
      return NextResponse.json({
        machines: [],
        plants: [],
        lines: [],
        topology: {
          nodes: [],
          edges: [],
          zones: [],
          documentsIndexed: 0,
          canvasWidth: 960,
          canvasHeight: 420
        }
      });
    }

    return await withWebTenantDb(user.tenantId, async (db) => {
      const [machineRows, lineRows, activeAlarmRows, plantRows, docRows, chunkRows] =
        await Promise.all([
          db
            .select({
              id: assets.id,
              name: assets.name,
              plantId: assets.plantId,
              lineId: assets.parentId,
              machineType: assets.machineType,
              manufacturer: assets.manufacturer,
              model: assets.model,
              criticality: assets.criticality,
              metadata: assets.metadata,
              status: machineStatus.status,
              temperature: machineStatus.temperature,
              vibration: machineStatus.vibration,
              pressure: machineStatus.pressure,
              updatedAt: machineStatus.updatedAt
            })
            .from(assets)
            .leftJoin(machineStatus, eq(machineStatus.machineId, assets.id))
            .where(
              and(
                eq(assets.tenantId, user.tenantId),
                eq(assets.type, "machine"),
                inArray(assets.plantId, user.plantIds)
              )
            ),
          db
            .select({
              id: assets.id,
              name: assets.name,
              plantId: assets.plantId
            })
            .from(assets)
            .where(
              and(
                eq(assets.tenantId, user.tenantId),
                eq(assets.type, "line"),
                inArray(assets.plantId, user.plantIds)
              )
            ),
          db
            .select({
              machineId: alarms.machineId,
              code: alarms.code,
              severity: alarms.severity
            })
            .from(alarms)
            .where(
              and(
                eq(alarms.tenantId, user.tenantId),
                inArray(alarms.plantId, user.plantIds),
                isNull(alarms.clearedAt)
              )
            ),
          db
            .select()
            .from(plants)
            .where(
              and(
                eq(plants.tenantId, user.tenantId),
                inArray(plants.id, user.plantIds)
              )
            ),
          db
            .select({
              id: documents.id,
              title: documents.title,
              type: documents.type,
              machineTypes: documents.machineTypes,
              revision: documents.revision,
              status: documents.status,
              source: documents.source,
              rawContent: documents.rawContent
            })
            .from(documents)
            .where(
              and(
                eq(documents.tenantId, user.tenantId),
                eq(documents.status, "current")
              )
            ),
          db
            .select({
              id: documentChunks.id,
              documentId: documentChunks.documentId,
              page: documentChunks.page,
              sectionPath: documentChunks.sectionPath,
              text: documentChunks.text
            })
            .from(documentChunks)
            .where(eq(documentChunks.tenantId, user.tenantId))
        ]);

      const alarmMap = new Map<string, Array<{ code: string; severity: string }>>();
      for (const a of activeAlarmRows) {
        const list = alarmMap.get(a.machineId) ?? [];
        list.push({ code: a.code, severity: a.severity });
        alarmMap.set(a.machineId, list);
      }

      const enrichedMachines = machineRows.map((m) => ({
        ...m,
        activeAlarms: alarmMap.get(m.id) ?? []
      }));

      const topology = buildDocumentGroundedTopology({
        machines: enrichedMachines,
        lines: lineRows,
        plants: plantRows,
        documents: docRows,
        chunks: chunkRows
      });

      return NextResponse.json({
        plants: plantRows,
        lines: lineRows,
        machines: enrichedMachines,
        topology
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "machine:read", { tenantId: user.tenantId });
    if (
      !can(user, "admin:knowledge") &&
      !can(user, "docs:write") &&
      !can(user, "workorder:write")
    ) {
      return problemResponse(
        403,
        "Forbidden",
        "Your role does not permit uploading topology documents or drawings."
      );
    }

    const contentType = req.headers.get("content-type") ?? "";
    const boundedBody = await readBoundedBody(req, getMaxUploadBytes() + 64 * 1024);

    let payload: {
      title: string;
      revision: string;
      source: string;
      rawContent: string;
    };

    if (contentType.includes("multipart/form-data")) {
      const formData = await boundedBody.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return problemResponse(400, "Validation Error", "Missing drawing or PDF file.");
      }

      const buf = Buffer.from(await file.arrayBuffer());
      const check = validateDocumentUpload(file.name, buf.byteLength);
      if (!check.ok) {
        return problemResponse(400, "Invalid Upload", check.error);
      }

      const virusRes = await scanUploadForViruses(buf, file.name);
      if (!virusRes.clean) {
        return problemResponse(
          422,
          "Security Scan Blocked Upload",
          `Malware signature detected: ${virusRes.threat}`
        );
      }

      const extracted = await extractTextFromDocumentFile(file.name, buf);
      payload = JsonTopologyUploadSchema.parse({
        title: String(formData.get("title") || file.name),
        revision: String(formData.get("revision") || "Rev 1.0"),
        source: file.name,
        rawContent: extracted
      });
    } else {
      payload = JsonTopologyUploadSchema.parse(await boundedBody.json());
      const scan = await scanUploadForViruses(
        Buffer.from(payload.rawContent),
        payload.source
      );
      if (!scan.clean) {
        return problemResponse(
          422,
          "Security Scan Blocked Upload",
          "Malware signature detected."
        );
      }
    }

    return await withWebTenantDb(user.tenantId, async (db) => {
      const res = await ingestDocumentJob(db, {
        tenantId: user.tenantId,
        title: payload.title,
        type: "datasheet",
        machineTypes: [
          "cnc",
          "press",
          "robot_cell",
          "conveyor",
          "compressor",
          "injection_molder",
          "filler",
          "packaging_line"
        ],
        revision: payload.revision,
        status: "current",
        effectiveDate: new Date().toISOString().slice(0, 10),
        source: payload.source,
        rawContent: payload.rawContent,
        supersedePrevious: true
      });

      await db.insert(auditLog).values({
        id: `aud-${crypto.randomUUID().slice(0, 12)}`,
        tenantId: user.tenantId,
        userId: user.userId,
        role: user.role,
        action: "machine_topology_doc_ingest",
        toolName: "machines.topology.ingest",
        args: { documentId: res.documentId, title: payload.title, source: payload.source },
        resultHash: "",
        status: "allowed",
        reason: `Indexed ${res.chunkCount} chunks for machine topology`,
        latencyMs: 1
      });

      return NextResponse.json(res, { status: 201 });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
