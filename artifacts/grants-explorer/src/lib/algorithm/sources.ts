import type { SourceConfig } from "./types";

// ─── Source Registry ──────────────────────────────────────────────────────────

export const SOURCE_CONFIGS: SourceConfig[] = [
  {
    id: "simpler_grants",
    name: "Simpler Grants",
    category: "Federal Grants",
    status: "active",
  },
  {
    id: "grants_gov",
    name: "Grants.gov Search",
    category: "Federal Grants",
    status: "active",
  },
  {
    id: "sam_gov",
    name: "SAM.gov Opportunities",
    category: "Federal Procurement",
    status: "active",
  },
  {
    id: "sbir",
    name: "SBIR/STTR",
    category: "Small Business R&D",
    status: "active",
  },
  {
    id: "threesixtygiving",
    name: "360Giving / UKRI",
    category: "UK Philanthropy",
    status: "active",
  },
  {
    id: "california_grants",
    name: "California Grants Portal",
    category: "State Grants",
    status: "active",
  },
  {
    id: "world_bank",
    name: "World Bank Procurement",
    category: "International",
    status: "active",
  },
  {
    id: "ted_eu",
    name: "TED EU",
    category: "EU Procurement",
    status: "active",
  },
  {
    id: "usaspending",
    name: "USASpending",
    category: "Historical Awards",
    status: "excluded",
    exclusion_reason: "Historical award data only — not active opportunities",
  },
  {
    id: "nih_reporter",
    name: "NIH RePORTER",
    category: "Research Intelligence",
    status: "excluded",
    exclusion_reason: "Awarded research projects — training/intelligence data, not open solicitations",
  },
  {
    id: "nsf_awards",
    name: "NSF Awards",
    category: "Research Intelligence",
    status: "excluded",
    exclusion_reason: "Historical NSF award database — not open solicitations",
  },
];

// ─── Normalization Map ────────────────────────────────────────────────────────
// Maps raw source strings from the API to canonical IDs

const SOURCE_ALIAS_MAP: Record<string, string> = {
  // Simpler Grants
  "Simpler Grants": "simpler_grants",
  "simpler_grants": "simpler_grants",
  "simpler grants": "simpler_grants",

  // Grants.gov
  "Grants.gov": "grants_gov",
  "grants_gov": "grants_gov",
  "grantsgov": "grants_gov",

  // SAM.gov
  "SAM.gov": "sam_gov",
  "sam_gov": "sam_gov",
  "samgov": "sam_gov",

  // SBIR
  "SBIR": "sbir",
  "SBIR/STTR": "sbir",
  "sbir": "sbir",
  "SBIR (via USASpending)": "sbir",

  // 360Giving
  "360Giving": "threesixtygiving",
  "360Giving / UKRI": "threesixtygiving",
  "threesixtygiving": "threesixtygiving",

  // California Grants
  "California Grants": "california_grants",
  "california_grants": "california_grants",
  "California Grants (via USASpending)": "california_grants",

  // World Bank
  "World Bank": "world_bank",
  "world_bank": "world_bank",

  // TED EU
  "TED EU": "ted_eu",
  "ted_eu": "ted_eu",

  // Excluded
  "USASpending": "usaspending",
  "usaspending": "usaspending",
  "NIH RePORTER": "nih_reporter",
  "nih_reporter": "nih_reporter",
  "NSF Awards": "nsf_awards",
  "nsf_awards": "nsf_awards",
};

export function normalizeSourceId(raw: string): string {
  return SOURCE_ALIAS_MAP[raw] ?? raw.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

export function isActiveOpportunitySource(rawSource: string): boolean {
  const id = normalizeSourceId(rawSource);
  const config = SOURCE_CONFIGS.find((s) => s.id === id);
  return config?.status === "active";
}

export const ACTIVE_SOURCE_IDS = new Set(
  SOURCE_CONFIGS.filter((s) => s.status === "active").map((s) => s.id)
);

export const EXCLUDED_SOURCE_IDS = new Set(
  SOURCE_CONFIGS.filter((s) => s.status === "excluded").map((s) => s.id)
);
