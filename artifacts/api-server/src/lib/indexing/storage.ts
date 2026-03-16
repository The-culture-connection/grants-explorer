import { db, indexedOpportunitiesTable, indexingRunsTable } from "@workspace/db";
import { eq, sql, and, ilike } from "drizzle-orm";
import type { NormalizedRecord } from "./normalize";

export interface UpsertStats {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

export async function ensureTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS indexed_opportunities (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_record_id TEXT NOT NULL,
      classification TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      agency TEXT,
      funding_type TEXT,
      status TEXT,
      open_date TEXT,
      close_date TEXT,
      min_award INTEGER,
      max_award INTEGER,
      eligibility JSONB NOT NULL DEFAULT '[]',
      categories JSONB NOT NULL DEFAULT '[]',
      keywords JSONB NOT NULL DEFAULT '[]',
      geography JSONB NOT NULL DEFAULT '[]',
      url TEXT,
      raw_payload JSONB,
      normalized_at TIMESTAMP NOT NULL DEFAULT NOW(),
      dedupe_key TEXT NOT NULL UNIQUE
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS indexing_runs (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      total_fetched INTEGER NOT NULL DEFAULT 0,
      total_inserted INTEGER NOT NULL DEFAULT 0,
      total_updated INTEGER NOT NULL DEFAULT 0,
      total_skipped INTEGER NOT NULL DEFAULT 0,
      total_errors INTEGER NOT NULL DEFAULT 0,
      last_page INTEGER NOT NULL DEFAULT 0,
      stop_reason TEXT,
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP,
      error_message TEXT
    )
  `);
}

export async function upsertRecords(records: NormalizedRecord[]): Promise<UpsertStats> {
  const stats: UpsertStats = { inserted: 0, updated: 0, skipped: 0, errors: 0 };

  for (const rec of records) {
    try {
      await db
        .insert(indexedOpportunitiesTable)
        .values({
          id: rec.id,
          source: rec.source,
          sourceRecordId: rec.sourceRecordId,
          classification: rec.classification,
          title: rec.title,
          description: rec.description,
          agency: rec.agency,
          fundingType: rec.fundingType,
          status: rec.status,
          openDate: rec.openDate,
          closeDate: rec.closeDate,
          minAward: rec.minAward,
          maxAward: rec.maxAward,
          eligibility: rec.eligibility,
          categories: rec.categories,
          keywords: rec.keywords,
          geography: rec.geography,
          url: rec.url,
          rawPayload: rec.rawPayload,
          dedupeKey: rec.dedupeKey,
        })
        .onConflictDoUpdate({
          target: indexedOpportunitiesTable.dedupeKey,
          set: {
            title: rec.title,
            description: rec.description,
            agency: rec.agency,
            status: rec.status,
            closeDate: rec.closeDate,
            minAward: rec.minAward,
            maxAward: rec.maxAward,
            url: rec.url,
            rawPayload: rec.rawPayload,
            normalizedAt: new Date(),
          },
        });
      stats.inserted++;
    } catch {
      stats.errors++;
    }
  }

  return stats;
}

export async function getRecordCountBySource(): Promise<Record<string, number>> {
  const rows = await db.execute(sql`
    SELECT source, COUNT(*) as count
    FROM indexed_opportunities
    GROUP BY source
  `);
  const result: Record<string, number> = {};
  for (const row of rows.rows as any[]) {
    result[row.source] = parseInt(row.count, 10);
  }
  return result;
}

export async function deleteRecordsBySource(sourceKey: string): Promise<number> {
  const result = await db
    .delete(indexedOpportunitiesTable)
    .where(eq(indexedOpportunitiesTable.source, sourceKey));
  return (result as any).rowCount ?? 0;
}

export async function deleteAllRecords(): Promise<void> {
  await db.execute(sql`TRUNCATE indexed_opportunities`);
}

export async function getIndexedRecords(opts: {
  source?: string;
  classification?: string;
  keyword?: string;
  limit?: number;
  offset?: number;
}): Promise<{ records: any[]; total: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const conditions = [];
  if (opts.source) conditions.push(eq(indexedOpportunitiesTable.source, opts.source));
  if (opts.classification) conditions.push(eq(indexedOpportunitiesTable.classification, opts.classification));
  if (opts.keyword) {
    conditions.push(ilike(indexedOpportunitiesTable.title, `%${opts.keyword}%`));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const countResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(indexedOpportunitiesTable)
    .where(where);
  const total = Number(countResult[0]?.count ?? 0);

  const records = await db
    .select({
      id: indexedOpportunitiesTable.id,
      source: indexedOpportunitiesTable.source,
      source_record_id: indexedOpportunitiesTable.sourceRecordId,
      classification: indexedOpportunitiesTable.classification,
      title: indexedOpportunitiesTable.title,
      agency: indexedOpportunitiesTable.agency,
      funding_type: indexedOpportunitiesTable.fundingType,
      status: indexedOpportunitiesTable.status,
      open_date: indexedOpportunitiesTable.openDate,
      close_date: indexedOpportunitiesTable.closeDate,
      min_award: indexedOpportunitiesTable.minAward,
      max_award: indexedOpportunitiesTable.maxAward,
      geography: indexedOpportunitiesTable.geography,
      url: indexedOpportunitiesTable.url,
      normalized_at: indexedOpportunitiesTable.normalizedAt,
      dedupe_key: indexedOpportunitiesTable.dedupeKey,
    })
    .from(indexedOpportunitiesTable)
    .where(where)
    .orderBy(sql`${indexedOpportunitiesTable.normalizedAt} DESC`)
    .limit(limit)
    .offset(offset);

  return { records, total };
}

export async function getIndexedStats(): Promise<{
  total: number;
  active: number;
  historical: number;
  bySource: Record<string, number>;
}> {
  const bySourceMap = await getRecordCountBySource();
  const total = Object.values(bySourceMap).reduce((a, b) => a + b, 0);

  const classResult = await db.execute(sql`
    SELECT classification, COUNT(*) as count
    FROM indexed_opportunities
    GROUP BY classification
  `);
  let active = 0;
  let historical = 0;
  for (const row of classResult.rows as any[]) {
    if (row.classification === "active_opportunity") active = parseInt(row.count, 10);
    if (row.classification === "historical_intelligence") historical = parseInt(row.count, 10);
  }

  return { total, active, historical, bySource: bySourceMap };
}

export async function saveIndexingRun(run: {
  id: string;
  source: string;
  status: string;
  totalFetched: number;
  totalInserted: number;
  totalUpdated: number;
  totalSkipped: number;
  totalErrors: number;
  lastPage: number;
  stopReason: string | null;
  errorMessage: string | null;
  completedAt: Date | null;
}): Promise<void> {
  await db
    .insert(indexingRunsTable)
    .values({
      id: run.id,
      source: run.source,
      status: run.status,
      totalFetched: run.totalFetched,
      totalInserted: run.totalInserted,
      totalUpdated: run.totalUpdated,
      totalSkipped: run.totalSkipped,
      totalErrors: run.totalErrors,
      lastPage: run.lastPage,
      stopReason: run.stopReason,
      errorMessage: run.errorMessage,
      completedAt: run.completedAt,
    })
    .onConflictDoUpdate({
      target: indexingRunsTable.id,
      set: {
        status: run.status,
        totalFetched: run.totalFetched,
        totalInserted: run.totalInserted,
        totalUpdated: run.totalUpdated,
        totalSkipped: run.totalSkipped,
        totalErrors: run.totalErrors,
        lastPage: run.lastPage,
        stopReason: run.stopReason,
        errorMessage: run.errorMessage,
        completedAt: run.completedAt,
      },
    });
}
