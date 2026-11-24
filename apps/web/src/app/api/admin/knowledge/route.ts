import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  auditLog,
  authorize,
  desc,
  documents,
  eq
} from "@kojo/core";
import {
  extractTextFromDocumentFile,
  ingestDocumentJob,
  scanUploadForViruses,
  getMaxUploadBytes,
  validateDocumentUpload
} from "@kojo/agent";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { readBoundedBody } from "@/lib/request-body";
import {
  getSessionUser,
  handleApiError,
  problemResponse,
  verifyCsrfOrigin
} from "@/lib/auth";

const JsonUploadSchema = z.object({
  title: z.string().min(2).max(200),
  type: z.enum(["manual", "sop", "policy", "kb", "datasheet"]).default("manual"),
  machineTypes: z.array(z.string()).default([]),
  revision: z.string().min(1).default("Rev 1.0"),
  status: z.enum(["current", "superseded"]).default("current"),
  effectiveDate: z.string().default(() => new Date().toISOString().slice(0, 10)),
  source: z.string().default("admin-upload.md"),
  rawContent: z.string().min(10).max(500_000),
  supersedePrevious: z.boolean().default(true)
});

const PatchKnowledgeSchema = z.object({
  documentId: z.string().min(1),
  action: z.enum(["supersede", "activate", "reindex"])
});

export async function GET(req: Request) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "admin:knowledge", { tenantId: user.tenantId });

    return await withWebTenantDb(user.tenantId, async (db) => {
    const rows = await db
      .select({
        id: documents.id,
        title: documents.title,
        type: documents.type,
        machineTypes: documents.machineTypes,
        revision: documents.revision,
        status: documents.status,
        effectiveDate: documents.effectiveDate,
        source: documents.source,
        ingestionStatus: documents.ingestionStatus,
        ingestionError: documents.ingestionError,
        createdAt: documents.createdAt
      })
      .from(documents)
      .where(eq(documents.tenantId, user.tenantId))
      .orderBy(desc(documents.createdAt));

    return NextResponse.json({ documents: rows });
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
    authorize(user, "admin:knowledge", { tenantId: user.tenantId });

    const contentType = req.headers.get("content-type") ?? "";
    const boundedBody = await readBoundedBody(req, getMaxUploadBytes() + 64 * 1024);

    let payload: z.infer<typeof JsonUploadSchema>;

    if (contentType.includes("multipart/form-data")) {
      const formData = await boundedBody.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return problemResponse(400, "Validation Error", "Missing uploaded file.");
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
      const machineTypesRaw = String(formData.get("machineTypes") ?? "");
      payload = JsonUploadSchema.parse({
        title: String(formData.get("title") || file.name),
        type: String(formData.get("type") || "manual"),
        machineTypes: machineTypesRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        revision: String(formData.get("revision") || "Rev 1.0"),
        status: String(formData.get("status") || "current"),
        effectiveDate: String(
          formData.get("effectiveDate") || new Date().toISOString().slice(0, 10)
        ),
        source: file.name,
        rawContent: extracted,
        supersedePrevious: formData.get("supersedePrevious") !== "false"
      });
    } else {
      payload = JsonUploadSchema.parse(await boundedBody.json());
      const scan = await scanUploadForViruses(Buffer.from(payload.rawContent), payload.source);
      if (!scan.clean) return problemResponse(422, "Security Scan Blocked Upload", "Malware signature detected.");
    }

    return await withWebTenantDb(user.tenantId, async (db) => {
    const res = await ingestDocumentJob(db, {
      tenantId: user.tenantId,
      ...payload
    });

    await db.insert(auditLog).values({
      id: `aud-${crypto.randomUUID().slice(0, 12)}`,
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
      action: "admin_knowledge_ingest",
      toolName: "admin.knowledge.ingest",
      args: { documentId: res.documentId, title: payload.title, revision: payload.revision },
      resultHash: "",
      status: "allowed",
      reason: `Indexed ${res.chunkCount} chunks`,
      latencyMs: 1
    });

    return NextResponse.json(res, { status: 201 });
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    verifyCsrfOrigin(req);
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "admin:knowledge", { tenantId: user.tenantId });

    const body = PatchKnowledgeSchema.parse(await req.json());

    return await withWebTenantDb(user.tenantId, async (db) => {
    const rows = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, body.documentId),
          eq(documents.tenantId, user.tenantId)
        )
      )
      .limit(1);

    const doc = rows[0];
    if (!doc) return problemResponse(404, "Not Found", "Document not found.");

    if (body.action === "supersede") {
      await db
        .update(documents)
        .set({ status: "superseded" })
        .where(eq(documents.id, doc.id));
    } else if (body.action === "activate") {
      await db
        .update(documents)
        .set({ status: "current" })
        .where(eq(documents.id, doc.id));
    } else if (body.action === "reindex") {
      await ingestDocumentJob(db, {
        tenantId: user.tenantId,
        title: doc.title,
        type: doc.type,
        machineTypes: doc.machineTypes,
        revision: doc.revision,
        status: doc.status,
        effectiveDate: doc.effectiveDate,
        source: doc.source,
        rawContent: doc.rawContent,
        existingDocumentId: doc.id
      });
    }

    return NextResponse.json({ ok: true });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
