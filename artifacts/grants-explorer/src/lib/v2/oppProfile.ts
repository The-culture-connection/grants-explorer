import type { NormalizedOpportunity } from "@/lib/algorithm/types";
import type { V2OppProfile, OpportunityTypeV2, GeoScope, ComplexityBand, FundingBand } from "./types";
import { extractSectorTags, extractActivityTags, extractPopulationTags } from "./taxonomy";

// ─── Opportunity Type Classifier ──────────────────────────────────────────────

export function classifyOpportunityType(opp: NormalizedOpportunity): OpportunityTypeV2 {
  const titleDesc = `${opp.title} ${opp.description}`.toLowerCase();
  const source = (opp.source ?? "").toLowerCase();
  const ft = opp.funding_type;

  // Source-driven overrides
  if (source === "sam_gov" || source === "ted_eu") return "procurement_contract";
  if (source === "sbir") return "research_grant";
  if (source === "world_bank") {
    if (titleDesc.includes("procurement") || titleDesc.includes("contract")) return "procurement_contract";
    return "international_implementation";
  }

  // Funding type overrides
  if (ft === "contract" || ft === "procurement") return "procurement_contract";
  if (ft === "fellowship") return "fellowship_training";
  if (ft === "loan") return "loan_financing";

  // Keyword-based classification (ordered by specificity)
  if (titleDesc.includes("prize") || titleDesc.includes("challenge") || titleDesc.includes("competition")) return "prize_challenge";
  if (titleDesc.includes("fellowship") || titleDesc.includes("internship")) return "fellowship_training";
  if (
    titleDesc.includes("research") || titleDesc.includes("laboratory") ||
    titleDesc.includes("scientific study") || titleDesc.includes("clinical study")
  ) return "research_grant";
  if (titleDesc.includes("infrastructure") || titleDesc.includes("capital project") || titleDesc.includes("construction")) return "infrastructure_capital";
  if (titleDesc.includes("international") || titleDesc.includes("overseas") || titleDesc.includes("global development")) return "international_implementation";
  if (titleDesc.includes("technical assistance") || titleDesc.includes(" ta ")) return "technical_assistance";
  if (titleDesc.includes("capacity") && titleDesc.includes("build")) return "capacity_building_grant";
  if (titleDesc.includes("planning") || titleDesc.includes("feasibility") || titleDesc.includes("assessment")) return "planning_grant";
  if (titleDesc.includes("training") && !titleDesc.includes("workforce")) return "fellowship_training";
  if (titleDesc.includes("procurement") || titleDesc.includes("solicitation") || titleDesc.includes("rfp")) return "procurement_contract";

  return "program_service_grant";
}

// ─── Geography ────────────────────────────────────────────────────────────────

function inferGeoScope(geoTags: string[]): GeoScope {
  const geoStr = geoTags.map(g => g.toLowerCase()).join(" ");
  if (geoStr.includes("international") || geoStr.includes("global") || geoStr.includes("worldwide")) {
    return "international";
  }
  if (
    geoStr.includes("national") || geoStr.includes("united states") ||
    geoStr.includes("nationwide") || geoStr === "us" || geoStr === "usa"
  ) {
    return "national";
  }
  if (geoTags.length === 0) return "unknown";
  if (geoTags.some(g => g.length > 2)) return "state";
  return "local";
}

// ─── Funding Band ─────────────────────────────────────────────────────────────

function inferFundingBand(min: number | null, max: number | null): FundingBand {
  const amount = max ?? min;
  if (amount === null) return "unknown";
  if (amount < 25_000) return "micro";
  if (amount < 150_000) return "small";
  if (amount < 1_000_000) return "medium";
  if (amount < 10_000_000) return "large";
  return "enterprise";
}

// ─── Complexity Band ──────────────────────────────────────────────────────────

function inferComplexityBand(opp: NormalizedOpportunity, oppType: OpportunityTypeV2): ComplexityBand {
  const titleDesc = `${opp.title} ${opp.description}`.toLowerCase();
  const fb = inferFundingBand(opp.min_award ?? null, opp.max_award ?? null);

  let score = 0;

  // Type-driven complexity
  if (oppType === "procurement_contract") score += 3;
  if (oppType === "research_grant") score += 2;
  if (oppType === "infrastructure_capital") score += 3;
  if (oppType === "international_implementation") score += 2;

  // Funding size drives complexity
  if (fb === "enterprise") score += 3;
  else if (fb === "large") score += 2;
  else if (fb === "medium") score += 1;

  // Language signals
  if (titleDesc.includes("prior federal") || titleDesc.includes("past performance")) score += 2;
  if (titleDesc.includes("cooperative agreement") || titleDesc.includes("multi-site")) score += 1;
  if (titleDesc.includes("international") || titleDesc.includes("overseas")) score += 1;
  if (titleDesc.includes("compliance") || titleDesc.includes("reporting requirements")) score += 1;
  if (titleDesc.includes("environmental review") || titleDesc.includes("audit")) score += 1;

  if (score >= 6) return "very_high";
  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}

// ─── Main Builder ─────────────────────────────────────────────────────────────

export function buildOpportunityProfile(opp: NormalizedOpportunity): V2OppProfile {
  const allText = [
    opp.title,
    opp.description,
    ...(opp.keywords ?? []),
    ...(opp.categories ?? []),
  ].join(" ");

  const geoTags = (opp.geography ?? []).filter(Boolean).map(String);
  const opportunityType = classifyOpportunityType(opp);

  return {
    opportunityId: opp.id,
    source: opp.source,
    title: opp.title,
    opportunityType,
    domainTags: extractSectorTags(allText),
    activityTags: extractActivityTags(allText),
    populationTags: extractPopulationTags(allText),
    applicantTypes: (opp.eligibility ?? []).map(e => e.toLowerCase()),
    geographyRestrictions: geoTags,
    geographyScope: inferGeoScope(geoTags),
    complexityBand: inferComplexityBand(opp, opportunityType),
    fundingBand: inferFundingBand(opp.min_award ?? null, opp.max_award ?? null),
    fundingMin: opp.min_award ?? null,
    fundingMax: opp.max_award ?? null,
    status:
      opp.status === "active" ? "open"
      : opp.status === "forecasted" ? "forecasted"
      : opp.status === "closed" ? "closed"
      : "unknown",
    closeDate: opp.close_date ?? null,
    rawEligibilityText: (opp.eligibility ?? []).join("; ") || null,
    rawSourceFields: opp,
  };
}
