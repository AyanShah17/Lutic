export const EMBEDDING_DIM = 64;

/**
 * Deterministic 64-dimensional normalized feature hashing embedding.
 * Preserves lexical similarity, subword n-grams, and technical codes
 * so pgvector hybrid search works offline with zero external API keys.
 */
export function computeDeterministicEmbedding(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const normalized = text.toLowerCase();
  const tokens = normalized.match(/[a-z0-9_-]{2,}/g) ?? [];

  for (const token of tokens) {
    // Boost exact fault codes and part numbers
    const weight = /^[a-z]{1,3}[-_]?\d{2,4}/.test(token) ? 3.0 : 1.0;
    const idx = fnv1a(token) % EMBEDDING_DIM;
    const sign = (fnv1a(token + ":s") & 1) === 0 ? 1 : -1;
    vec[idx] = (vec[idx] ?? 0) + sign * weight;

    if (token.length >= 4) {
      for (let i = 0; i <= token.length - 3; i++) {
        const tri = token.slice(i, i + 3);
        const triIdx = fnv1a("g:" + tri) % EMBEDDING_DIM;
        const triSign = (fnv1a("gs:" + tri) & 1) === 0 ? 1 : -1;
        vec[triIdx] = (vec[triIdx] ?? 0) + triSign * 0.35;
      }
    }
  }

  let norm = 0;
  for (const v of vec) {
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) {
    vec[0] = 1;
    return vec;
  }
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

function fnv1a(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function extractFaultCodesAndPartNumbers(text: string): {
  faultCodes: string[];
  partNumbers: string[];
} {
  const faultMatches =
    text.match(/\b(?:[EFHPRSC]\d{2,4}|ALM[-_]\d{2,4})\b/g) ?? [];
  const partMatches = text.match(/\bPRT-[A-Z]{2,4}-\d{3,4}\b/g) ?? [];
  return {
    faultCodes: Array.from(new Set(faultMatches)),
    partNumbers: Array.from(new Set(partMatches))
  };
}

export interface DocumentChunkDraft {
  chunkIndex: number;
  page: number;
  sectionPath: string;
  text: string;
  faultCodes: string[];
  partNumbers: string[];
}

/**
 * Section-aware chunking preserving explicit `<!-- PAGE N -->` markers,
 * markdown headings (`#`, `##`, `###`), and markdown tables without splitting table rows mid-line.
 */
export function chunkDocumentText(
  rawText: string,
  maxChunkChars = 900
): DocumentChunkDraft[] {
  const lines = rawText.split(/\r?\n/);
  const chunks: DocumentChunkDraft[] = [];

  let currentPage = 1;
  const headingStack: string[] = [];
  let buffer: string[] = [];
  let bufferLen = 0;

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (!body) {
      buffer = [];
      bufferLen = 0;
      return;
    }
    const sectionPath =
      headingStack.length > 0 ? headingStack.join(" > ") : "Overview";
    const { faultCodes, partNumbers } = extractFaultCodesAndPartNumbers(body);
    chunks.push({
      chunkIndex: chunks.length,
      page: currentPage,
      sectionPath,
      text: body,
      faultCodes,
      partNumbers
    });
    buffer = [];
    bufferLen = 0;
  };

  for (const line of lines) {
    const pageMatch = line.match(/<!--\s*PAGE\s+(\d+)\s*-->/i) || line.match(/^\[Page\s+(\d+)\]$/i);
    if (pageMatch && pageMatch[1]) {
      flush();
      currentPage = Number(pageMatch[1]);
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch && headingMatch[1] && headingMatch[2]) {
      const hasBodyContent = buffer.some(
        (l) => l.trim().length > 0 && !/^#{1,3}\s+/.test(l.trim())
      );
      if (hasBodyContent) {
        flush();
      }
      const depth = headingMatch[1].length;
      const title = headingMatch[2].trim();
      headingStack.splice(depth - 1);
      headingStack[depth - 1] = title;
      buffer.push(line);
      bufferLen += line.length + 1;
      continue;
    }

    const isTableLine = line.trim().startsWith("|");
    if (bufferLen + line.length > maxChunkChars && !isTableLine && buffer.length > 0) {
      flush();
    }

    buffer.push(line);
    bufferLen += line.length + 1;
  }

  flush();
  return chunks;
}
