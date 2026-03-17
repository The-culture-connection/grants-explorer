/**
 * poolLoader.ts — Single source of truth for:
 *   1. Converting live API responses to NormalizedOpportunity
 *   2. Coercing Firestore org_profile data to OrgProfile
 *   3. Fetching the full opportunity pool from all live grant APIs
 *
 * The pool is fetched LIVE from all active grant endpoints on each call.
 * No database is required — this mirrors exactly what the Explore page does.
 */

import type { NormalizedOpportunity } from "@/lib/algorithm/types";
import type { OrgProfile } from "@/lib/algorithm/types";

// ─── Active sources ────────────────────────────────────────────────────────────
export const ACTIVE_SOURCES = new Set([
  "simpler_grants", "grants_gov", "sam_gov", "sbir",
  "threesixtygiving", "california_grants", "world_bank", "ted_eu",
]);

// Maps the human-readable source strings returned by the API to snake_case keys
const SOURCE_NAME_MAP: Record<string, string> = {
  "Simpler Grants": "simpler_grants",
  "Grants.gov": "grants_gov",
  "SAM.gov": "sam_gov",
  "SBIR": "sbir",
  "SBIR (via USASpending)": "sbir",
  "360Giving / UKRI": "threesixtygiving",
  "California Grants": "california_grants",
  "California Grants (via USASpending)": "california_grants",
  "World Bank": "world_bank",
  "TED EU": "ted_eu",
};

function normalizeSourceName(raw: string): string {
  return SOURCE_NAME_MAP[raw] ?? raw.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

function parseAmount(amount?: string): number | undefined {
  if (!amount) return undefined;
  const n = Number(amount.replace(/[^0-9.]/g, ""));
  return isNaN(n) || n === 0 ? undefined : n;
}

// ─── Live API item → NormalizedOpportunity ────────────────────────────────────
function liveItemToOpportunity(item: any, sourceRaw: string): NormalizedOpportunity {
  const source = normalizeSourceName(sourceRaw);
  return {
    id: `${source}_${String(item.id ?? Math.random())}`,
    source,
    source_raw: sourceRaw,
    title: item.title ?? "Untitled",
    description: item.description ?? "",
    agency: item.agency ?? "",
    funding_type: "grant" as any,
    status: "active" as any,
    open_date: undefined,
    close_date: item.deadline ?? undefined,
    min_award: undefined,
    max_award: parseAmount(item.amount),
    eligibility: [],
    categories: [],
    keywords: [],
    geography: [],
    url: item.url ?? "",
  };
}

// ─── Canonical DB record → NormalizedOpportunity (kept for legacy use) ────────
export function dbRecordToOpportunity(rec: any): NormalizedOpportunity {
  let geoRaw: any[] = [];
  if (Array.isArray(rec.geography)) {
    geoRaw = rec.geography;
  } else if (typeof rec.geography === "string" && rec.geography) {
    try { geoRaw = JSON.parse(rec.geography); } catch { geoRaw = [rec.geography]; }
  }
  const geography: string[] = geoRaw.filter((g: any) => g != null).map((g: any) => String(g));

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

// ─── Live grant API endpoints ─────────────────────────────────────────────────
const GRANT_ENDPOINTS = [
  "/grants/simplergrants",
  "/grants/grantsgov",
  "/grants/samgov",
  "/grants/sbir",
  "/grants/threesixtygiving",
  "/grants/cagrants",
  "/grants/worldbank",
  "/grants/tedeu",
];

// Broad keywords to maximize pool diversity
const POOL_KEYWORDS = ["community", "health", "education", "workforce", "technology", "environment"];

// Extended keywords for full corpus fetch
const FULL_POOL_KEYWORDS = [
  "community", "health", "education", "workforce", "technology", "environment",
  "arts", "housing", "food", "youth", "justice", "research",
];

const ROWS_PER_FETCH = 25;
const FULL_ROWS_PER_FETCH = 100;

// ─── Pool Diagnostics ──────────────────────────────────────────────────────────
export interface PoolDiagnostics {
  totalFetched: number;       // raw items across all requests (with dupes)
  totalUnique: number;        // after dedup
  fetchErrors: number;        // number of failed requests
  perSource: Record<string, number>;  // unique count per source key
  durationMs: number;
}

/**
 * Fetches the opportunity pool by calling all active grant API endpoints live.
 * Uses multiple broad keywords to get diverse coverage across categories.
 * Deduplicates by ID and filters to ACTIVE_SOURCES only.
 */
export async function loadOpportunityPool(apiBase: string): Promise<NormalizedOpportunity[]> {
  // Build all fetch tasks: each endpoint × each keyword
  const fetches = GRANT_ENDPOINTS.flatMap((endpoint) =>
    POOL_KEYWORDS.map((kw) =>
      fetch(`${apiBase}${endpoint}?keyword=${encodeURIComponent(kw)}&rows=${ROWS_PER_FETCH}`, {
        signal: AbortSignal.timeout(15000),
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ),
  );

  const results = await Promise.all(fetches);

  const seen = new Set<string>();
  const opps: NormalizedOpportunity[] = [];

  for (const data of results) {
    if (!data || !Array.isArray(data.items)) continue;
    const sourceRaw: string = data.source ?? "";
    for (const item of data.items) {
      if (!item || !item.id) continue;
      const uid = `${normalizeSourceName(sourceRaw)}_${item.id}`;
      if (seen.has(uid)) continue;
      seen.add(uid);
      const opp = liveItemToOpportunity(item, sourceRaw);
      if (ACTIVE_SOURCES.has(opp.source)) opps.push(opp);
    }
  }

  return opps;
}

/**
 * Fetches the FULL opportunity corpus with extended keywords and 100 rows per request.
 * Returns both the deduplicated pool and detailed diagnostics for the corpus panel.
 */
export async function loadFullOpportunityPool(
  apiBase: string,
): Promise<{ pool: NormalizedOpportunity[]; diagnostics: PoolDiagnostics }> {
  const t0 = Date.now();

  const tasks = GRANT_ENDPOINTS.flatMap((endpoint) =>
    FULL_POOL_KEYWORDS.map((kw) =>
      fetch(`${apiBase}${endpoint}?keyword=${encodeURIComponent(kw)}&rows=${FULL_ROWS_PER_FETCH}`, {
        signal: AbortSignal.timeout(20000),
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ),
  );

  const results = await Promise.all(tasks);

  const seen = new Set<string>();
  const opps: NormalizedOpportunity[] = [];
  const perSource: Record<string, number> = {};
  let totalFetched = 0;
  let fetchErrors = 0;

  for (const data of results) {
    if (!data) { fetchErrors++; continue; }
    if (!Array.isArray(data.items)) continue;
    const sourceRaw: string = data.source ?? "";
    for (const item of data.items) {
      if (!item || !item.id) continue;
      totalFetched++;
      const uid = `${normalizeSourceName(sourceRaw)}_${item.id}`;
      if (seen.has(uid)) continue;
      seen.add(uid);
      const opp = liveItemToOpportunity(item, sourceRaw);
      if (!ACTIVE_SOURCES.has(opp.source)) continue;
      opps.push(opp);
      perSource[opp.source] = (perSource[opp.source] ?? 0) + 1;
    }
  }

  return {
    pool: opps,
    diagnostics: {
      totalFetched,
      totalUnique: opps.length,
      fetchErrors,
      perSource,
      durationMs: Date.now() - t0,
    },
  };
}
