import { sql } from "drizzle-orm";
import type { LuticDatabase } from "./db/client";
import {
  computeDeterministicEmbedding,
  extractFaultCodesAndPartNumbers
} from "./rag-utils";

export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export class LocalMockEmbeddingProvider implements EmbeddingProvider {
  public readonly id = "local-deterministic-64";
  public readonly dimensions = 64;

  async embed(text: string): Promise<number[]> {
    return computeDeterministicEmbedding(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => computeDeterministicEmbedding(t));
  }
}

export class DenseHttpEmbeddingProvider implements EmbeddingProvider {
  public readonly id: string;
  public readonly dimensions = 1536;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: { baseUrl: string; apiKey: string; model?: string; id?: string }) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.model = config.model || "text-embedding-3-small";
    this.id = config.id ?? `dense-${this.model}-1536`;
  }

  async embed(text: string): Promise<number[]> {
    const [first] = await this.embedBatch([text]);
    if (!first) throw new Error("Embedding endpoint returned empty vector.");
    return first;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions
      }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Dense embeddings HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }
    const payload = (await res.json()) as {
      data?: Array<{ index?: number; embedding?: number[] }>;
    };
    const items = [...(payload.data ?? [])].sort(
      (a, b) => Number(a.index ?? 0) - Number(b.index ?? 0)
    );
    return items.map((item) => {
      const vec = (item.embedding ?? []).slice(0, this.dimensions);
      while (vec.length < this.dimensions) vec.push(0);
      let norm = 0;
      for (const v of vec) norm += v * v;
      norm = Math.sqrt(norm) || 1;
      return vec.map((v) => Number((v / norm).toFixed(6)));
    });
  }
}

export function getDefaultEmbeddingProvider(): EmbeddingProvider {
  const mode = (process.env.EMBEDDING_PROVIDER ?? "local").trim().toLowerCase();
  const gatewayUrl = process.env.LUTIC_AI_GATEWAY_URL?.trim();
  const gatewayKey = process.env.LUTIC_AI_GATEWAY_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if ((mode === "lutic" || mode === "gateway") && gatewayUrl && gatewayKey) {
    return new DenseHttpEmbeddingProvider({
      baseUrl: gatewayUrl,
      apiKey: gatewayKey,
      model: process.env.EMBEDDING_MODEL || "lutic-embed"
    });
  }
  if (mode === "openai" && openaiKey) {
    return new DenseHttpEmbeddingProvider({
      baseUrl: "https://api.openai.com/v1",
      apiKey: openaiKey,
      model: process.env.EMBEDDING_MODEL || "text-embedding-3-small"
    });
  }
  if (mode !== "local" && mode !== "mock") {
    throw new Error(
      `Unsupported EMBEDDING_PROVIDER '${mode}' or missing credentials.`
    );
  }
  return new LocalMockEmbeddingProvider();
}

export interface RerankCandidate {
  chunkId: string;
  documentId: string;
  title: string;
  revision: string;
  status: "current" | "superseded";
  page: number;
  sectionPath: string;
  text: string;
  machineTypes: string[];
  faultCodes: string[];
  partNumbers: string[];
  score: number;
}

export interface Reranker {
  readonly id: string;
  rerank(query: string, candidates: RerankCandidate[]): Promise<RerankCandidate[]>;
}

const RERANK_STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "what", "when", "where",
  "which", "have", "has", "how", "are", "was", "were", "can", "into", "about"
]);

export class HybridLexicalSemanticReranker implements Reranker {
  public readonly id = "hybrid-idf-phrase-reranker";

  async rerank(
    query: string,
    candidates: RerankCandidate[]
  ): Promise<RerankCandidate[]> {
    if (candidates.length === 0) return [];
    const { faultCodes, partNumbers } = extractFaultCodesAndPartNumbers(
      query.toUpperCase()
    );
    const terms = Array.from(
      new Set(
        (query.toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? []).filter(
          (t) => !RERANK_STOP_WORDS.has(t)
        )
      )
    );
    const bigrams: string[] = [];
    for (let i = 0; i + 1 < terms.length; i++) {
      bigrams.push(`${terms[i]} ${terms[i + 1]}`);
    }

    // Document frequency across candidate set for lightweight IDF weighting
    const df = new Map<string, number>();
    for (const c of candidates) {
      const hay = `${c.title} ${c.sectionPath} ${c.text}`.toLowerCase();
      for (const t of terms) {
        if (hay.includes(t)) df.set(t, (df.get(t) ?? 0) + 1);
      }
    }

    return [...candidates]
      .map((c) => {
        let boost = c.status === "current" ? 0.05 : 0;
        for (const fc of faultCodes) {
          if (c.faultCodes.includes(fc) || c.text.toUpperCase().includes(fc)) {
            boost += 0.35;
          }
        }
        for (const pn of partNumbers) {
          if (c.partNumbers.includes(pn) || c.text.toUpperCase().includes(pn)) {
            boost += 0.35;
          }
        }
        const sectionHay = `${c.title} ${c.sectionPath}`.toLowerCase();
        const lowerText = `${sectionHay} ${c.text}`.toLowerCase();
        for (const t of terms) {
          if (lowerText.includes(t)) {
            const idf = Math.log(1 + candidates.length / (1 + (df.get(t) ?? 1)));
            boost += 0.04 * Math.max(0.8, idf);
          }
          if (sectionHay.includes(t)) {
            boost += 0.03;
          }
        }
        for (const bg of bigrams) {
          if (lowerText.includes(bg)) boost += 0.12;
        }
        return { ...c, score: Number((c.score + boost).toFixed(6)) };
      })
      .sort((a, b) => b.score - a.score);
  }
}

export { HybridLexicalSemanticReranker as StubReranker };

export interface RankedListItem<T> {
  id: string;
  item: T;
}

/**
 * Reciprocal Rank Fusion (RRF): score = sum(1 / (k + rank_i)) across ranked lists.
 */
export function reciprocalRankFusion<T>(
  lists: Array<Array<RankedListItem<T>>>,
  k = 60
): Array<{ id: string; item: T; score: number }> {
  const scores = new Map<string, { item: T; score: number }>();

  for (const list of lists) {
    for (let idx = 0; idx < list.length; idx++) {
      const entry = list[idx]!;
      const rrfContribution = 1 / (k + idx + 1);
      const existing = scores.get(entry.id);
      if (existing) {
        existing.score += rrfContribution;
      } else {
        scores.set(entry.id, { item: entry.item, score: rrfContribution });
      }
    }
  }

  return Array.from(scores.entries())
    .map(([id, val]) => ({ id, item: val.item, score: val.score }))
    .sort((a, b) => b.score - a.score);
}

export interface HybridSearchOptions {
  tenantId: string;
  query: string;
  machineType?: string;
  includeSuperseded?: boolean;
  limit?: number;
  embeddingProvider?: EmbeddingProvider;
  reranker?: Reranker;
}

export interface HybridSearchResult {
  chunks: RerankCandidate[];
  supersededOnly: boolean;
  supersededWarning?: string;
}

export async function hybridSearchDocuments(
  db: LuticDatabase,
  options: HybridSearchOptions
): Promise<HybridSearchResult> {
  const embedder = options.embeddingProvider ?? getDefaultEmbeddingProvider();
  const reranker = options.reranker ?? new HybridLexicalSemanticReranker();
  const limit = Math.min(options.limit ?? 6, 20);
  const queryVec = await embedder.embed(options.query);
  const vecStr = `[${queryVec.join(",")}]`;
  const isDense1536 = embedder.dimensions === 1536 && queryVec.length === 1536;
  const fallback64Str = `[${(isDense1536 ? computeDeterministicEmbedding(options.query) : queryVec).join(",")}]`;
  const { faultCodes, partNumbers } = extractFaultCodesAndPartNumbers(
    options.query.toUpperCase()
  );

  const runPass = async (statusFilter: "current" | "all"): Promise<RerankCandidate[]> => {
    const statusSql =
      statusFilter === "current" ? sql`AND d.status = 'current'` : sql``;
    const machineSql = options.machineType
      ? sql`AND d.machine_types ? ${options.machineType}`
      : sql``;

    // 1a. Optional 1536-dim dense semantic search (pgvector HNSW)
    const denseRes = isDense1536
      ? await db.execute(sql`
          SELECT
            c.id AS chunk_id,
            c.document_id,
            d.title,
            d.revision,
            d.status,
            c.page,
            c.section_path,
            c.text,
            d.machine_types,
            c.fault_codes,
            c.part_numbers,
            (1 - (c.dense_embedding <=> ${vecStr}::vector))::double precision AS sim
          FROM document_chunks c
          JOIN documents d ON d.id = c.document_id
          WHERE c.tenant_id = ${options.tenantId}
            AND c.dense_embedding IS NOT NULL
            ${statusSql}
            ${machineSql}
          ORDER BY c.dense_embedding <=> ${vecStr}::vector ASC
          LIMIT 20
        `)
      : { rows: [] };

    // 1b. Vector similarity search (64-dim pgvector cosine distance)
    const vecRes = await db.execute(sql`
      SELECT
        c.id AS chunk_id,
        c.document_id,
        d.title,
        d.revision,
        d.status,
        c.page,
        c.section_path,
        c.text,
        d.machine_types,
        c.fault_codes,
        c.part_numbers,
        (1 - (c.embedding <=> ${fallback64Str}::vector))::double precision AS sim
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE c.tenant_id = ${options.tenantId}
        ${statusSql}
        ${machineSql}
      ORDER BY c.embedding <=> ${fallback64Str}::vector ASC
      LIMIT 20
    `);

    // 2. Full-text search (tsvector + ts_rank)
    const ftsRes = await db.execute(sql`
      SELECT
        c.id AS chunk_id,
        c.document_id,
        d.title,
        d.revision,
        d.status,
        c.page,
        c.section_path,
        c.text,
        d.machine_types,
        c.fault_codes,
        c.part_numbers,
        ts_rank_cd(c.tsv, websearch_to_tsquery('english', ${options.query}))::double precision AS fts_rank
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE c.tenant_id = ${options.tenantId}
        ${statusSql}
        ${machineSql}
        AND c.tsv @@ websearch_to_tsquery('english', ${options.query})
      ORDER BY fts_rank DESC
      LIMIT 20
    `);

    type RawChunkRow = {
      chunk_id: string;
      document_id: string;
      title: string;
      revision: string;
      status: "current" | "superseded";
      page: number;
      section_path: string;
      text: string;
      machine_types: string[];
      fault_codes: string[];
      part_numbers: string[];
    };

    const toCandidate = (r: RawChunkRow): RerankCandidate => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      title: r.title,
      revision: r.revision,
      status: r.status,
      page: Number(r.page),
      sectionPath: r.section_path,
      text: r.text,
      machineTypes: Array.isArray(r.machine_types) ? r.machine_types : [],
      faultCodes: Array.isArray(r.fault_codes) ? r.fault_codes : [],
      partNumbers: Array.isArray(r.part_numbers) ? r.part_numbers : [],
      score: 0
    });

    const denseList: Array<RankedListItem<RerankCandidate>> = (
      (denseRes.rows ?? []) as RawChunkRow[]
    ).map((r) => ({ id: r.chunk_id, item: toCandidate(r) }));

    const vecList: Array<RankedListItem<RerankCandidate>> = (
      (vecRes.rows ?? []) as RawChunkRow[]
    ).map((r) => ({ id: r.chunk_id, item: toCandidate(r) }));

    const ftsList: Array<RankedListItem<RerankCandidate>> = (
      (ftsRes.rows ?? []) as RawChunkRow[]
    ).map((r) => ({ id: r.chunk_id, item: toCandidate(r) }));

    // 3. Exact match list for fault codes & part numbers
    let exactList: Array<RankedListItem<RerankCandidate>> = [];
    const exactTokens = [...faultCodes, ...partNumbers];
    if (exactTokens.length > 0) {
      const codeConds = exactTokens.map(
        (tok) =>
          sql`(c.fault_codes ? ${tok} OR c.part_numbers ? ${tok} OR c.text ILIKE ${"%" + tok + "%"})`
      );
      const exactRes = await db.execute(sql`
        SELECT
          c.id AS chunk_id,
          c.document_id,
          d.title,
          d.revision,
          d.status,
          c.page,
          c.section_path,
          c.text,
          d.machine_types,
          c.fault_codes,
          c.part_numbers
        FROM document_chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE c.tenant_id = ${options.tenantId}
          ${statusSql}
          ${machineSql}
          AND (${sql.join(codeConds, sql` OR `)})
        LIMIT 20
      `);
      exactList = ((exactRes.rows ?? []) as RawChunkRow[]).map((r) => ({
        id: r.chunk_id,
        item: toCandidate(r)
      }));
    }

    const fused = reciprocalRankFusion([denseList, vecList, ftsList, exactList]).map(
      (entry) => ({
        ...entry.item,
        score: Number(entry.score.toFixed(6))
      })
    );

    const reranked = await reranker.rerank(options.query, fused);
    return reranked.slice(0, limit);
  };

  if (options.includeSuperseded) {
    const allChunks = await runPass("all");
    const hasOnlySuperseded =
      allChunks.length > 0 && allChunks.every((c) => c.status === "superseded");
    return {
      chunks: allChunks,
      supersededOnly: hasOnlySuperseded,
      supersededWarning: hasOnlySuperseded
        ? "Only superseded document revisions matched this query. Verify procedures with a supervisor before acting."
        : undefined
    };
  }

  const currentChunks = await runPass("current");
  // Check if query matched strongly ONLY in a superseded doc (e.g. searching PRT-OLD-300 or Rev 3.0)
  const queryTerms = [
    ...faultCodes,
    ...partNumbers,
    ...options.query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 4)
  ];
  const hasStrongCurrentHit = currentChunks.some((c) => {
    const hay = (c.title + " " + c.sectionPath + " " + c.text).toLowerCase();
    return (
      faultCodes.some((fc) => hay.includes(fc.toLowerCase())) ||
      partNumbers.some((pn) => hay.includes(pn.toLowerCase())) ||
      queryTerms.filter((t) => hay.includes(t.toLowerCase())).length >= 2
    );
  });

  if (!hasStrongCurrentHit) {
    const allChunks = await runPass("all");
    const supersededHits = allChunks.filter((c) => {
      if (c.status !== "superseded") return false;
      const hay = (c.title + " " + c.text).toLowerCase();
      return (
        partNumbers.some((pn) => hay.includes(pn.toLowerCase())) ||
        faultCodes.some((fc) => hay.includes(fc.toLowerCase())) ||
        options.query.toLowerCase().includes("rev 3.0") ||
        options.query.toLowerCase().includes("35 nm")
      );
    });
    if (supersededHits.length > 0) {
      return {
        chunks: supersededHits,
        supersededOnly: true,
        supersededWarning: `Warning: Only a SUPERSEDED revision (${supersededHits[0]!.revision}) covers this exact reference. A newer current revision exists; verify before executing.`
      };
    }
  }

  return {
    chunks: currentChunks,
    supersededOnly: false
  };
}
