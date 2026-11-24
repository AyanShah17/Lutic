import { sql } from "drizzle-orm";
import type { KojoDatabase } from "./db/client";

export interface AggregatedReadingBucket {
  bucketStart: string;
  tag: string;
  unit: string;
  avg: number;
  min: number;
  max: number;
  count: number;
}

export interface TimeSeriesQuery {
  tenantId: string;
  machineId: string;
  tag?: string;
  hours?: number;
  bucketMinutes?: number;
  maxBuckets?: number;
}

/**
 * Abstract TimeSeriesStore seam so TimescaleDB or ClickHouse can replace
 * the Postgres readings table later without touching tools or UI.
 */
export interface TimeSeriesStore {
  queryAggregatedReadings(query: TimeSeriesQuery): Promise<{
    buckets: AggregatedReadingBucket[];
    truncated: boolean;
  }>;
}

export class PostgresTimeSeriesStore implements TimeSeriesStore {
  constructor(private readonly db: KojoDatabase) {}

  async queryAggregatedReadings(query: TimeSeriesQuery): Promise<{
    buckets: AggregatedReadingBucket[];
    truncated: boolean;
  }> {
    const hours = Math.min(Math.max(query.hours ?? 24, 1), 24 * 90);
    const maxBuckets = Math.min(query.maxBuckets ?? 50, 50);
    const defaultBucketMin = Math.max(Math.ceil((hours * 60) / maxBuckets), 5);
    const bucketMinutes = Math.max(query.bucketMinutes ?? defaultBucketMin, 1);

    const since = new Date(Date.now() - hours * 3600 * 1000);
    const intervalExpr = `${bucketMinutes} minutes`;
    const tagClause = query.tag ? sql`AND tag = ${query.tag}` : sql``;

    const result = await this.db.execute(sql`
      SELECT
        date_bin(${intervalExpr}::interval, ts, TIMESTAMP WITH TIME ZONE '2026-01-01 00:00:00Z') AS bucket_start,
        tag,
        MAX(unit) AS unit,
        ROUND(AVG(value)::numeric, 3)::double precision AS avg_val,
        ROUND(MIN(value)::numeric, 3)::double precision AS min_val,
        ROUND(MAX(value)::numeric, 3)::double precision AS max_val,
        COUNT(*)::integer AS sample_count
      FROM readings
      WHERE tenant_id = ${query.tenantId}
        AND machine_id = ${query.machineId}
        AND ts >= ${since.toISOString()}::timestamptz
        ${tagClause}
      GROUP BY bucket_start, tag
      ORDER BY bucket_start DESC, tag ASC
      LIMIT ${maxBuckets + 1}
    `);

    const rows = (result.rows ?? []) as Array<{
      bucket_start: string | Date;
      tag: string;
      unit: string;
      avg_val: number;
      min_val: number;
      max_val: number;
      sample_count: number;
    }>;

    const truncated = rows.length > maxBuckets;
    const sliced = rows.slice(0, maxBuckets).reverse();

    return {
      truncated,
      buckets: sliced.map((r) => ({
        bucketStart:
          r.bucket_start instanceof Date
            ? r.bucket_start.toISOString()
            : String(r.bucket_start),
        tag: String(r.tag),
        unit: String(r.unit),
        avg: Number(r.avg_val),
        min: Number(r.min_val),
        max: Number(r.max_val),
        count: Number(r.sample_count)
      }))
    };
  }
}
