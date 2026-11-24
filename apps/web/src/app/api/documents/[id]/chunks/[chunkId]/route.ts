import { NextResponse } from "next/server";
import {
  and,
  authorize,
  documentChunks,
  documents,
  eq,
} from "@kojo/core";
import { requireWebLicense, withWebTenantDb } from "@/lib/db";
import { getSessionUser, handleApiError, problemResponse } from "@/lib/auth";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string; chunkId: string }> }
) {
  try {
    await requireWebLicense();
    const user = await getSessionUser(req);
    if (!user) return problemResponse(401, "Unauthorized", "Please sign in.");
    authorize(user, "docs:read", { tenantId: user.tenantId });

    const params = await context.params;
    return await withWebTenantDb(user.tenantId, async (db) => {
      const docRows = await db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.id, params.id),
            eq(documents.tenantId, user.tenantId)
          )
        )
        .limit(1);

      const doc = docRows[0];
      if (!doc) {
        return problemResponse(404, "Not Found", "Document not found.");
      }

      const chunkRows = await db
        .select()
        .from(documentChunks)
        .where(
          and(
            eq(documentChunks.id, params.chunkId),
            eq(documentChunks.documentId, doc.id),
            eq(documentChunks.tenantId, user.tenantId)
          )
        )
        .limit(1);

      const chunk = chunkRows[0];
      if (!chunk) {
        return NextResponse.json({
          document: {
            id: doc.id,
            title: doc.title,
            type: doc.type,
            revision: doc.revision,
            status: doc.status,
            effectiveDate: doc.effectiveDate,
            source: doc.source
          },
          chunk: null,
          fallbackNotice: "Specific page/chunk was not found; showing document metadata."
        });
      }

      return NextResponse.json({
        document: {
          id: doc.id,
          title: doc.title,
          type: doc.type,
          revision: doc.revision,
          status: doc.status,
          effectiveDate: doc.effectiveDate,
          source: doc.source
        },
        chunk: {
          id: chunk.id,
          page: chunk.page,
          sectionPath: chunk.sectionPath,
          text: chunk.text,
          faultCodes: chunk.faultCodes,
          partNumbers: chunk.partNumbers
        }
      });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
