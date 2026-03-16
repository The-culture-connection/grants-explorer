import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const indexedOpportunitiesTable = pgTable("indexed_opportunities", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  sourceRecordId: text("source_record_id").notNull(),
  classification: text("classification").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  agency: text("agency"),
  fundingType: text("funding_type"),
  status: text("status"),
  openDate: text("open_date"),
  closeDate: text("close_date"),
  minAward: integer("min_award"),
  maxAward: integer("max_award"),
  eligibility: jsonb("eligibility").$type<string[]>().notNull().default([]),
  categories: jsonb("categories").$type<string[]>().notNull().default([]),
  keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
  geography: jsonb("geography").$type<string[]>().notNull().default([]),
  url: text("url"),
  rawPayload: jsonb("raw_payload"),
  normalizedAt: timestamp("normalized_at").notNull().defaultNow(),
  dedupeKey: text("dedupe_key").notNull().unique(),
});

export const indexingRunsTable = pgTable("indexing_runs", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  status: text("status").notNull().default("idle"),
  totalFetched: integer("total_fetched").notNull().default(0),
  totalInserted: integer("total_inserted").notNull().default(0),
  totalUpdated: integer("total_updated").notNull().default(0),
  totalSkipped: integer("total_skipped").notNull().default(0),
  totalErrors: integer("total_errors").notNull().default(0),
  lastPage: integer("last_page").notNull().default(0),
  stopReason: text("stop_reason"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
});

export type IndexedOpportunity = typeof indexedOpportunitiesTable.$inferSelect;
export type IndexingRun = typeof indexingRunsTable.$inferSelect;
