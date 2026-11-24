import crypto from "node:crypto";
import path from "node:path";
import JSZip from "jszip";
import {
  chunkDocumentText,
  computeDeterministicEmbedding,
  documentChunks,
  documents,
  EMBEDDING_DIM,
  eq,
  and,
  LocalMockEmbeddingProvider,
  type EmbeddingProvider,
  type LuticDatabase
} from "@lutic/core";

export {
  chunkDocumentText,
  computeDeterministicEmbedding,
  extractFaultCodesAndPartNumbers,
  hybridSearchDocuments,
  LocalMockEmbeddingProvider,
  reciprocalRankFusion,
  StubReranker,
  type EmbeddingProvider,
  type HybridSearchOptions,
  type HybridSearchResult,
  type RerankCandidate,
  type Reranker
} from "@lutic/core";

export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".pdf",
  ".docx"
]);

export function getMaxUploadBytes(): number {
  const configured = Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : 10 * 1024 * 1024;
}

export function validateDocumentUpload(
  filename: string,
  byteLength: number
): { ok: true; ext: string } | { ok: false; error: string } {
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      error: `Unsupported file type '${ext || "unknown"}'. Allowed: .md, .txt, .pdf, .docx`
    };
  }
  const maxBytes = getMaxUploadBytes();
  if (byteLength <= 0 || byteLength > maxBytes) {
    return {
      ok: false,
      error: `File size (${byteLength} bytes) exceeds allowed limit of ${maxBytes} bytes.`
    };
  }
  return { ok: true, ext };
}

export {
  checkScannerHealth,
  scanUploadForViruses,
  UploadScanUnavailableError,
  type ScannerHealthStatus
} from "./scan";

export function projectVectorTo64(vec: number[]): number[] {
  if (vec.length === EMBEDDING_DIM) return vec;
  const out = new Array<number>(EMBEDDING_DIM).fill(0);
  for (let i = 0; i < vec.length; i++) {
    out[i % EMBEDDING_DIM] = (out[i % EMBEDDING_DIM] ?? 0) + (vec[i] ?? 0);
  }
  let norm = 0;
  for (const v of out) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return out.map((v) => Number((v / norm).toFixed(6)));
}

export function getEmbeddingProvider(): EmbeddingProvider {
  if (process.env.EMBEDDING_PROVIDER && !["local", "mock"].includes(process.env.EMBEDDING_PROVIDER)) {
    throw new Error("Only local deterministic embeddings are supported. Set EMBEDDING_PROVIDER=local.");
  }
  return new LocalMockEmbeddingProvider();
}

export async function extractTextFromDocumentFile(
  filename: string,
  buffer: Buffer
): Promise<string> {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".md" || ext === ".markdown" || ext === ".txt") {
    return buffer.toString("utf8");
  }

  if (ext === ".docx") {
    const zip = await JSZip.loadAsync(buffer);
    const docXmlFile = zip.file("word/document.xml");
    if (!docXmlFile) {
      throw new Error("Invalid DOCX archive: missing word/document.xml");
    }
    const chunks: Buffer[] = [];
    let extractedBytes = 0;
    await new Promise<void>((resolve, reject) => {
      const stream = docXmlFile.nodeStream();
      stream.on("data", (chunk: Buffer) => {
        extractedBytes += chunk.length;
        if (extractedBytes > getMaxUploadBytes()) {
          stream.pause();
          chunks.length = 0;
          reject(new Error("Expanded DOCX text exceeds the upload limit."));
          return;
        }
        chunks.push(Buffer.from(chunk));
      }).on("error", reject).on("end", resolve);
    });
    const xml = Buffer.concat(chunks).toString("utf8");
    const withParagraphs = xml
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:tab\/>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .trim();
    if (!withParagraphs) throw new Error("Unable to extract readable text from DOCX.");
    return withParagraphs;
  }

  if (ext === ".pdf") {
    try {
      const { extractText } = await import("unpdf");
      const result = await extractText(new Uint8Array(buffer), {
        mergePages: false
      });
      const extractedText: unknown = result.text;
      if (Array.isArray(extractedText) && extractedText.some((page) => String(page).trim())) {
        return extractedText
          .map((pageText, idx) => `<!-- PAGE ${idx + 1} -->\n${String(pageText)}`)
          .join("\n\n");
      }
      if (typeof extractedText === "string" && extractedText.trim().length > 0) {
        return extractedText;
      }
    } catch {
      throw new Error("Unable to extract readable text from PDF.");
    }
    throw new Error("Unable to extract readable text from PDF.");
  }

  throw new Error(`Unsupported extension: ${ext}`);
}

export interface IngestDocumentInput {
  tenantId: string;
  title: string;
  type: "manual" | "sop" | "policy" | "kb" | "datasheet";
  machineTypes: string[];
  revision: string;
  status: "current" | "superseded";
  effectiveDate: string;
  source: string;
  rawContent: string;
  supersedePrevious?: boolean;
  existingDocumentId?: string;
}

export async function ingestDocumentJob(
  db: LuticDatabase,
  input: IngestDocumentInput
): Promise<{ documentId: string; chunkCount: number }> {
  const docId =
    input.existingDocumentId ?? `doc-${crypto.randomUUID().slice(0, 10)}`;

  if (input.supersedePrevious && input.status === "current") {
    await db
      .update(documents)
      .set({ status: "superseded" })
      .where(
        and(
          eq(documents.tenantId, input.tenantId),
          eq(documents.title, input.title),
          eq(documents.status, "current")
        )
      );
  }

  if (input.existingDocumentId) {
    await db
      .update(documents)
      .set({
        title: input.title,
        type: input.type,
        machineTypes: input.machineTypes,
        revision: input.revision,
        status: input.status,
        effectiveDate: input.effectiveDate,
        source: input.source,
        rawContent: input.rawContent,
        ingestionStatus: "processing",
        ingestionError: null
      })
      .where(
        and(eq(documents.id, docId), eq(documents.tenantId, input.tenantId))
      );

    await db
      .delete(documentChunks)
      .where(
        and(
          eq(documentChunks.documentId, docId),
          eq(documentChunks.tenantId, input.tenantId)
        )
      );
  } else {
    await db.insert(documents).values({
      id: docId,
      tenantId: input.tenantId,
      title: input.title,
      type: input.type,
      machineTypes: input.machineTypes,
      revision: input.revision,
      status: input.status,
      effectiveDate: input.effectiveDate,
      source: input.source,
      ingestionStatus: "processing",
      ingestionError: null,
      rawContent: input.rawContent
    });
  }

  try {
    const embedder = getEmbeddingProvider();
    const drafts = chunkDocumentText(input.rawContent);
    const embeddings = await embedder.embedBatch(
      drafts.map((d) => `${input.title} ${d.sectionPath} ${d.text}`)
    );

    if (drafts.length > 0) {
      await db.insert(documentChunks).values(
        drafts.map((c, idx) => ({
          id: `${docId}-chunk-${c.chunkIndex}`,
          tenantId: input.tenantId,
          documentId: docId,
          chunkIndex: c.chunkIndex,
          page: c.page,
          sectionPath: c.sectionPath,
          text: c.text,
          embedding: projectVectorTo64(
            embeddings[idx] ?? computeDeterministicEmbedding(c.text)
          ),
          faultCodes: c.faultCodes,
          partNumbers: c.partNumbers
        }))
      );
    }

    await db
      .update(documents)
      .set({ ingestionStatus: "completed", ingestionError: null })
      .where(eq(documents.id, docId));

    return { documentId: docId, chunkCount: drafts.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ingestion failed";
    await db
      .update(documents)
      .set({ ingestionStatus: "failed", ingestionError: msg })
      .where(eq(documents.id, docId));
    throw err;
  }
}
