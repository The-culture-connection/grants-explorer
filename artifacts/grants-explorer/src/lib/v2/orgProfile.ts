import type { OrgProfile } from "@/lib/algorithm/types";
import type { V2OrgProfile, OrgClass, GeoScope, CapacityBand, ReadinessLevel } from "./types";
import { extractSectorTags, extractActivityTags, extractPopulationTags } from "./taxonomy";

// ─── Org Class Inference ──────────────────────────────────────────────────────

function inferOrgClass(org: OrgProfile): OrgClass {
  const type = org.org_type;
  const missionLower = (org.mission ?? "").toLowerCase();
  const keywords = (org.keywords ?? []).map(k => k.toLowerCase());
  const areas = (org.program_areas ?? []).map(a => a.toLowerCase()).join(" ");
  const allText = `${missionLower} ${keywords.join(" ")} ${areas}`;

  if (type === "small_business") return "small_business";
  if (type === "university") return "university";

  if (type === "government") {
    if (allText.includes("tribal") || allText.includes("native american") || allText.includes("indigenous")) {
      return "tribal";
    }
    return "government";
  }

  if (type === "nonprofit") {
    if (allText.includes("tribal") || allText.includes("native american") || allText.includes("indigenous")) {
      return "tribal";
    }
    if (
      allText.includes("research") || allText.includes("science") ||
      allText.includes("laboratory") || allText.includes("lab") ||
      keywords.some(k => ["research", "science", "lab", "study"].includes(k))
    ) {
      return "research_institution";
    }
    if (allText.includes("international") || allText.includes("global") || allText.includes("overseas")) {
      return "international_ngo";
    }
    return "nonprofit";
  }

  // org_type === "individual" or "other" — infer from text
  if (allText.includes("tribal") || allText.includes("native american")) return "tribal";
  if (allText.includes("university") || allText.includes("college") || allText.includes("academic")) return "university";
  if (allText.includes("contract") || allText.includes("consulting firm") || allText.includes("professional services")) return "contractor";
  if (allText.includes("international") || allText.includes("global") || allText.includes("overseas")) return "international_ngo";

  return "other";
}

// ─── Capacity Band ────────────────────────────────────────────────────────────

function inferCapacityBand(budget: number | null, years: number | null): CapacityBand {
  const BAND_ORDER: CapacityBand[] = ["early", "growing", "established", "enterprise", "unknown"];

  const budgetBand: CapacityBand =
    budget === null ? "unknown"
    : budget < 100_000 ? "early"
    : budget < 500_000 ? "growing"
    : budget < 5_000_000 ? "established"
    : "enterprise";

  const yearsBand: CapacityBand =
    years === null ? "unknown"
    : years < 2 ? "early"
    : years < 5 ? "growing"
    : years < 15 ? "established"
    : "enterprise";

  if (budgetBand === "unknown" && yearsBand === "unknown") return "unknown";
  if (budgetBand === "unknown") return yearsBand;
  if (yearsBand === "unknown") return budgetBand;

  const bi = BAND_ORDER.indexOf(budgetBand);
  const yi = BAND_ORDER.indexOf(yearsBand);
  return bi >= yi ? budgetBand : yearsBand;
}

// ─── Geography Scope ──────────────────────────────────────────────────────────

function inferGeoScope(geographyTags: string[]): GeoScope {
  const geoStr = geographyTags.map(g => g.toLowerCase()).join(" ");
  if (geoStr.includes("international") || geoStr.includes("global") || geoStr.includes("overseas")) {
    return "international";
  }
  if (
    geoStr.includes("national") || geoStr.includes("united states") ||
    geoStr.includes("nationwide") || geoStr === "us" || geoStr === "usa"
  ) {
    return "national";
  }
  if (geographyTags.length === 0) return "unknown";
  // Most org geography lists like "California" or "New York" → state level
  if (geographyTags.some(g => g.length > 2)) return "state";
  return "local";
}

// ─── Main Builder ─────────────────────────────────────────────────────────────

export function buildOrganizationProfile(org: OrgProfile): V2OrgProfile {
  const textSources = [
    org.mission ?? "",
    ...(org.program_areas ?? []),
    ...(org.keywords ?? []),
    ...(org.population_served ?? []),
  ];
  const allText = textSources.join(" ");

  const orgClass = inferOrgClass(org);
  const budget = typeof org.annual_budget === "number" && org.annual_budget > 0 ? org.annual_budget : null;
  const years = typeof org.years_in_operation === "number" && org.years_in_operation >= 0 ? org.years_in_operation : null;
  const capacityBand = inferCapacityBand(budget, years);
  const geographyTags = (org.geography ?? []).filter(Boolean).map(String);
  const geographyScope = inferGeoScope(geographyTags);

  // Readiness levels
  const isResearchOrg = orgClass === "research_institution" || orgClass === "university";
  const hasScienceKw = (org.keywords ?? []).some(k =>
    ["research", "science", "lab", "study", "data", "analysis"].includes(k.toLowerCase())
  );

  const fundingReadiness: ReadinessLevel =
    capacityBand === "enterprise" || capacityBand === "established" ? "high"
    : capacityBand === "growing" ? "medium"
    : capacityBand === "early" ? "low"
    : "unknown";

  const researchReadiness: ReadinessLevel =
    isResearchOrg ? "high"
    : hasScienceKw ? "medium"
    : "low";

  const procurementReadiness: ReadinessLevel =
    orgClass === "contractor" ? "high"
    : (org.is_small_business || orgClass === "government") && capacityBand !== "early" ? "medium"
    : "low";

  const sectorTags = extractSectorTags(allText);

  return {
    orgId: org.id,
    name: org.name,
    orgClass,
    sectorTags,
    domainTags: sectorTags,
    activityTags: extractActivityTags(allText),
    populationTags: extractPopulationTags(
      [org.mission ?? "", ...(org.population_served ?? [])].join(" ")
    ),
    geographyTags,
    geographyScope,
    capacityBand,
    fundingReadiness,
    researchReadiness,
    procurementReadiness,
    annualBudget: budget,
    yearsInOperation: years,
    has501c3: org.has_501c3 ?? null,
    isSmallBusiness: org.is_small_business ?? null,
    rawSourceFields: org,
  };
}
