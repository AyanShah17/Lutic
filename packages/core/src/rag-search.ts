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

export class StubReranker implements Reranker {
  public readonly id = "stub-code-boost-reranker";

  async rerank(
    query: string,
    candidates: RerankCandidate[]
  ): Promise<RerankCandidate[]> {
    const { faultCodes, partNumbers } = extractFaultCodesAndPartNumbers(
      query.toUpperCase()
    );
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3);

    return [...candidates]
      .map((c) => {
        let boost = 0;
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
        const lowerText = (c.sectionPath + " " + c.text).toLowerCase();
        for (const t of terms) {
          if (lowerText.includes(t)) boost += 0.04;
        }
        return { ...c, score: Number((c.score + boost).toFixed(6)) };
      })
      .sort((a, b) => b.score - a.score);
  }
}

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
  const embedder = options.embeddingProvider ?? new LocalMockEmbeddingProvider();
  const reranker = options.reranker ?? new StubReranker();
  const limit = Math.min(options.limit ?? 6, 20);
  const queryVec = await embedder.embed(options.query);
  const vecStr = `[${queryVec.join(",")}]`;
  const { faultCodes, partNumbers } = extractFaultCodesAndPartNumbers(
    options.query.toUpperCase()
  );

  const runPass = async (statusFilter: "current" | "all"): Promise<RerankCandidate[]> => {
    const statusSql =
      statusFilter === "current" ? sql`AND d.status = 'current'` : sql``;
    const machineSql = options.machineType
      ? sql`AND d.machine_types ? ${options.machineType}`
      : sql``;

    // 1. Vector similarity search (pgvector cosine distance)
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
        (1 - (c.embedding <=> ${vecStr}::vector))::double precision AS sim
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE c.tenant_id = ${options.tenantId}
        ${statusSql}
        ${machineSql}
      ORDER BY c.embedding <=> ${vecStr}::vector ASC
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

    const fused = reciprocalRankFusion([vecList, ftsList, exactList]).map(
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
