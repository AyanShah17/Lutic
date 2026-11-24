import { z } from "zod";
import {
  and,
  asc,
  documentChunks,
  documents,
  eq,
  hybridSearchDocuments,
  type KojoDatabase
} from "@kojo/core";
import {
  buildConnectorMcpServer,
  type Connector,
  type ConnectorHealth,
  type ConnectorToolDefinition
} from "../types";

const DocsCredentialSchema = z.object({
  rootPath: z.string().min(1).default("/knowledge/manuals"),
  readOnly: z.boolean().default(true)
});

const SearchDocumentsSchema = z.object({
  query: z.string().min(1).max(300).describe("Search keywords, fault code, or part number"),
  machineType: z.string().optional().describe("Optional machine type filter (e.g. filler, cnc)"),
  includeSuperseded: z
    .boolean()
    .optional()
    .default(false)
    .describe("Only set true if the user explicitly asks for an older/superseded revision"),
  limit: z.number().int().min(1).max(15).optional().default(5)
});

const GetDocumentSectionSchema = z.object({
  documentId: z.string().min(1),
  chunkId: z.string().optional(),
  page: z.number().int().min(1).optional()
});

const docsTools: ConnectorToolDefinition[] = [
  {
    name: "search_documents",
    description:
      "Hybrid vector + full-text + exact code search across plant manuals, SOPs, safety policies, and KB articles. Excludes superseded revisions unless explicitly requested.",
    inputSchema: SearchDocumentsSchema,
    requiredPermission: "docs:read",
    access: "read",
    toolkit: "knowledge",
    riskLevel: "low",
    connectorKind: "docs",
    execute: async (rawArgs, ctx) => {
      const args = SearchDocumentsSchema.parse(rawArgs);
      const res = await hybridSearchDocuments(ctx.db, {
        tenantId: ctx.user.tenantId,
        query: args.query,
        machineType: args.machineType,
        includeSuperseded: args.includeSuperseded,
        limit: args.limit
      });

      return {
        results: res.chunks.map((c) => ({
          chunkId: c.chunkId,
          documentId: c.documentId,
          title: c.title,
          revision: c.revision,
          status: c.status,
          page: c.page,
          sectionPath: c.sectionPath,
          text: c.text,
          faultCodes: c.faultCodes,
          partNumbers: c.partNumbers,
          score: c.score
        })),
        supersededOnly: res.supersededOnly,
        supersededWarning: res.supersededWarning ?? null
      };
    }
  },
  {
    name: "get_document_section",
    description:
      "Retrieve the full passage, metadata, revision, and page details for a document chunk or page.",
    inputSchema: GetDocumentSectionSchema,
    requiredPermission: "docs:read",
    access: "read",
    toolkit: "knowledge",
    riskLevel: "low",
    connectorKind: "docs",
    execute: async (rawArgs, ctx) => {
      const args = GetDocumentSectionSchema.parse(rawArgs);
      const docRows = await ctx.db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.id, args.documentId),
            eq(documents.tenantId, ctx.user.tenantId)
          )
        )
        .limit(1);

      const doc = docRows[0];
      if (!doc) {
        return { found: false, message: "Document not found in tenant scope." };
      }

      const chunks = await ctx.db
        .select()
        .from(documentChunks)
        .where(
          and(
            eq(documentChunks.documentId, doc.id),
            eq(documentChunks.tenantId, ctx.user.tenantId)
          )
        )
        .orderBy(asc(documentChunks.chunkIndex));

      const filtered = args.chunkId
        ? chunks.filter((c) => c.id === args.chunkId)
        : args.page
        ? chunks.filter((c) => c.page === args.page)
        : chunks.slice(0, 8);

      return {
        found: true,
        document: {
          id: doc.id,
          title: doc.title,
          type: doc.type,
          revision: doc.revision,
          status: doc.status,
          effectiveDate: doc.effectiveDate,
          source: doc.source,
          machineTypes: doc.machineTypes
        },
        sections: filtered.map((c) => ({
          chunkId: c.id,
          page: c.page,
          sectionPath: c.sectionPath,
          text: c.text,
          faultCodes: c.faultCodes,
          partNumbers: c.partNumbers
        }))
      };
    }
  }
];

export const docsConnector: Connector = {
  id: "connector-docs",
  kind: "docs",
  name: "Kojo Knowledge Store",
  credentialSchema: DocsCredentialSchema,
  async healthCheck(db: KojoDatabase, tenantId: string): Promise<ConnectorHealth> {
    const start = Date.now();
    await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.tenantId, tenantId))
      .limit(1);
    return {
      id: "connector-docs",
      kind: "docs",
      status: "healthy",
      latencyMs: Date.now() - start,
      message: "Vector + FTS knowledge index online"
    };
  },
  listTools: () => docsTools,
  createMcpServer: () => buildConnectorMcpServer("docs", docsTools)
};
