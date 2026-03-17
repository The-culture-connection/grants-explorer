/**
 * poolLoader.ts — Single source of truth for:
 *   1. Converting raw DB records to NormalizedOpportunity (canonical dbRecordToOpportunity)
 *   2. Coercing Firestore org_profile data to OrgProfile (canonical coerceOrgProfile)
 *   3. Fetching and preparing the full opportunity pool from the API
 *
 * Import from here in EVERY page that runs V3 scoring so the data pipeline
 * is guaranteed to be identical.
 */

import type { NormalizedOpportunity } from "@/lib/algorithm/types";
import type { OrgProfile } from "@/lib/algorithm/types";

// ─── Active sources (must match AlgorithmAudit.tsx) ───────────────────────────
export const ACTIVE_SOURCES = new Set([
  "simpler_grants", "grants_gov", "sam_gov", "sbir",
  "threesixtygiving", "california_grants", "world_bank", "ted_eu",
]);

// ─── Canonical DB → NormalizedOpportunity ─────────────────────────────────────
/**
 * Converts a raw DB record to NormalizedOpportunity.
 * Handles geography stored as JSON string or array.
 * Uses the same field mappings as AlgorithmAudit so scores are identical.
 */
export function dbRecordToOpportunity(rec: any): NormalizedOpportunity {
  // Geography can be stored as a JSON-encoded string or as a real array
  let geoRaw: any[] = [];
  if (Array.isArray(rec.geography)) {
    geoRaw = rec.geography;
  } else if (typeof rec.geography === "string" && rec.geography) {
    try { geoRaw = JSON.parse(rec.geography); } catch { geoRaw = [rec.geography]; }
  }
  const geography: string[] = geoRaw
    .filter((g: any) => g != null)
    .map((g: any) => String(g));

  return {
    id: rec.id,
    source: rec.source,
    source_raw: rec.source,
    title: rec.title ?? "Untitled",
    description: rec.description ?? "",
    agency: rec.agency ?? "",
    funding_type: (rec.funding_type ?? "grant") as any,
    status: (rec.status ?? "active") as any,
    open_date: rec.open_date ?? undefined,
    close_date: rec.close_date ?? undefined,
    min_award: rec.min_award ?? undefined,
    max_award: rec.max_award ?? undefined,
    eligibility: Array.isArray(rec.eligibility) ? rec.eligibility : [],
    categories: Array.isArray(rec.categories) ? rec.categories : [],
    keywords: Array.isArray(rec.keywords) ? rec.keywords : [],
    geography,
    url: rec.url ?? "",
  };
}

// ─── Canonical Firestore org_profile → OrgProfile ─────────────────────────────
const EMPTY_ORG: OrgProfile = {
  id: "unknown",
  name: "My Organization",
  org_type: "nonprofit",
  mission: "",
  program_areas: [],
  population_served: [],
  geography: [],
  annual_budget: 0,
  years_in_operation: 0,
  has_501c3: false,
  is_small_business: false,
  keywords: [],
};

/**
 * Defensively coerces Firestore org_profile data into a valid OrgProfile.
 * Uses uid as the profile id (Firestore UID is always available).
 */
export function coerceOrgProfile(raw: any, uid: string): OrgProfile {
  if (!raw) return { ...EMPTY_ORG, id: uid };
  const toArr = (v: any): string[] =>
    Array.isArray(v) ? v.map(String) : (v ? [String(v)] : []);
  return {
    id: uid,
    name: raw.name ?? raw.org_name ?? "My Organization",
    org_type: raw.org_type ?? "nonprofit",
    mission: raw.mission ?? "",
    program_areas: toArr(raw.program_areas),
    population_served: toArr(raw.population_served),
    geography: toArr(raw.geography),
    annual_budget: Number(raw.annual_budget ?? 0) || 0,
    years_in_operation: Number(raw.years_in_operation ?? 0) || 0,
    has_501c3: Boolean(raw.has_501c3),
    is_small_business: Boolean(raw.is_small_business),
    keywords: toArr(raw.keywords),
  };
}

// ─── Pool loader ───────────────────────────────────────────────────────────────
/**
 * Fetches the opportunity pool from the API and converts all records.
 * Applies ACTIVE_SOURCES filter so only supported sources are included.
 */
export async function loadOpportunityPool(apiBase: string): Promise<NormalizedOpportunity[]> {
  const resp = await fetch(`${apiBase}/indexing/records/for-algorithm`);
  if (!resp.ok) throw new Error(`Pool fetch failed: ${resp.status}`);
  const data = await resp.json();
  return (data.records ?? [])
    .map(dbRecordToOpportunity)
    .filter((o: NormalizedOpportunity) => ACTIVE_SOURCES.has(o.source));
}
