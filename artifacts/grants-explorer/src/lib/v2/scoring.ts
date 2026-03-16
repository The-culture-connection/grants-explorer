import type { V2OrgProfile, V2OppProfile, V2Penalty } from "./types";

// ─── 1. Eligibility Fit — max 20 ─────────────────────────────────────────────

export function scoreEligibilityFitV2(
  org: V2OrgProfile,
  opp: V2OppProfile,
): { score: number; reason: string; passed: boolean } {
  const types = opp.applicantTypes;

  if (types.length === 0) {
    return { score: 12, reason: "No eligibility constraints — all applicant types permitted", passed: true };
  }

  // Aliases that each org class satisfies
  const orgClassAliases: Record<string, string[]> = {
    nonprofit: ["nonprofit", "501c3", "community_based_org", "community_org", "ngo", "charity", "foundation"],
    small_business: ["small_business", "for_profit", "8a_certified", "minority_owned", "woman_owned"],
    university: ["university", "higher_education", "academic_institution", "nonprofit", "educational_institution"],
    government: ["government", "public_agency", "local_government", "state_government", "tribal_government", "federal_agency"],
    tribal: ["tribal", "tribal_government", "native_american", "alaska_native", "nonprofit", "government", "public_agency"],
    research_institution: ["nonprofit", "university", "research_institution", "higher_education"],
    contractor: ["small_business", "for_profit", "8a_certified"],
    international_ngo: ["nonprofit", "international", "ngo"],
    other: [],
  };

  const aliases = orgClassAliases[org.orgClass] ?? [];

  // Hard exclusions
  const nonprofitOnly = types.some(t => ["nonprofit", "501c3", "community_based_org", "community_org"].includes(t));
  const excludesForProfit = !types.some(t => ["for_profit", "small_business", "all"].includes(t));

  if (nonprofitOnly && excludesForProfit) {
    if (!["nonprofit", "tribal", "research_institution", "university"].includes(org.orgClass)) {
      return {
        score: 0,
        reason: `Nonprofit-only opportunity; org class is "${org.orgClass}"`,
        passed: false,
      };
    }
  }

  const sbOnly = types.length > 0 && types.every(t => ["small_business", "for_profit", "8a_certified"].includes(t));
  if (sbOnly && !org.isSmallBusiness && !["small_business", "contractor"].includes(org.orgClass)) {
    return { score: 0, reason: "Small-business-only opportunity; org is not a small business", passed: false };
  }

  if (types.includes("501c3") && !org.has501c3) {
    if (!["government", "university", "tribal"].includes(org.orgClass)) {
      return { score: 0, reason: "501(c)(3) required but org does not have it", passed: false };
    }
  }

  // Positive scoring
  let score = 12; // Base for passing eligibility

  const exactMatch = aliases.some(a => types.includes(a));
  if (exactMatch) score += 5;
  if (org.has501c3 && types.includes("501c3")) score += 2;
  if (org.isSmallBusiness && types.some(t => ["small_business", "for_profit"].includes(t))) score += 1;
  if (types.includes("all")) score = 15;

  return {
    score: Math.min(20, score),
    reason: `Eligible — "${org.orgClass}" satisfies applicant type requirements`,
    passed: true,
  };
}

// ─── 2. Domain / Mission Fit — max 20 ────────────────────────────────────────

export function scoreDomainFitV2(
  org: V2OrgProfile,
  opp: V2OppProfile,
): { score: number; reason: string; matches: string[] } {
  const orgSet = new Set(org.sectorTags);
  const oppSet = new Set(opp.domainTags);

  if (orgSet.size === 0 && oppSet.size === 0) {
    return { score: 8, reason: "Insufficient domain data for both org and opportunity", matches: [] };
  }
  if (orgSet.size === 0 || oppSet.size === 0) {
    return { score: 6, reason: "Domain data missing for one side — partial credit", matches: [] };
  }

  const matches = [...orgSet].filter(d => oppSet.has(d));
  const unionSize = new Set([...orgSet, ...oppSet]).size;
  const jaccard = unionSize > 0 ? matches.length / unionSize : 0;

  const score =
    matches.length === 0 ? 0
    : matches.length >= 4 ? 20
    : matches.length === 3 ? 17
    : matches.length === 2 ? Math.round(12 + jaccard * 8)
    : Math.round(8 + jaccard * 8);

  const reason = matches.length > 0
    ? `Domain overlap: ${matches.slice(0, 4).join(", ")}`
    : "No shared sector/domain tags found";

  return { score: Math.min(20, score), reason, matches };
}

// ─── 3. Activity / Model Fit — max 15 ────────────────────────────────────────

export function scoreActivityFitV2(
  org: V2OrgProfile,
  opp: V2OppProfile,
): { score: number; reason: string } {
  const orgSet = new Set(org.activityTags);
  const oppSet = new Set(opp.activityTags);

  if (orgSet.size === 0 || oppSet.size === 0) {
    return { score: 6, reason: "Insufficient activity tag data — partial credit" };
  }

  const matches = [...orgSet].filter(a => oppSet.has(a));
  const score =
    matches.length === 0 ? 2
    : matches.length >= 3 ? 15
    : matches.length === 2 ? 11
    : 7;

  const reason = matches.length > 0
    ? `Activity model overlap: ${matches.slice(0, 3).join(", ")}`
    : "Organization and opportunity activity models differ";

  return { score, reason };
}

// ─── 4. Population Fit — max 10 ──────────────────────────────────────────────

export function scorePopulationFitV2(
  org: V2OrgProfile,
  opp: V2OppProfile,
): { score: number; reason: string } {
  const orgSet = new Set(org.populationTags);
  const oppSet = new Set(opp.populationTags);

  if (orgSet.size === 0 || oppSet.size === 0) {
    return { score: 5, reason: "Population data unavailable — partial credit" };
  }

  const matches = [...orgSet].filter(p => oppSet.has(p));
  const score = matches.length === 0 ? 2 : matches.length >= 2 ? 10 : 6;

  const reason = matches.length > 0
    ? `Population overlap: ${matches.slice(0, 3).join(", ")}`
    : "No shared target populations detected";

  return { score, reason };
}

// ─── 5. Geography Fit — max 10 ────────────────────────────────────────────────

export function scoreGeographyFitV2(
  org: V2OrgProfile,
  opp: V2OppProfile,
): { score: number; reason: string } {
  const oppScope = opp.geographyScope;
  const orgScope = org.geographyScope;

  // Fully open geography
  if (oppScope === "international" || oppScope === "unknown") {
    return { score: 7, reason: `Opportunity geography is "${oppScope}" — broad eligibility` };
  }

  // National US opportunity — any US org qualifies
  if (oppScope === "national") {
    if (["national", "state", "local"].includes(orgScope)) {
      return { score: 10, reason: "Organization operates within national-scope opportunity" };
    }
    if (orgScope === "international") {
      return { score: 5, reason: "International org applying to national US opportunity — partial fit" };
    }
  }

  // Check raw geography tag overlap for state/local
  const orgGeo = org.geographyTags.map(g => g.toLowerCase());
  const oppGeo = opp.geographyRestrictions.map(g => g.toLowerCase());

  if (oppGeo.length > 0 && orgGeo.length > 0) {
    const directOverlap = orgGeo.some(og => oppGeo.some(oppG => og.includes(oppG) || oppG.includes(og)));
    if (directOverlap) return { score: 10, reason: "Geography overlap: org and opportunity regions match" };

    const orgUS = orgGeo.some(g => ["united states", "us", "usa", "u.s."].includes(g));
    const oppUS = oppGeo.some(g => ["united states", "us", "usa", "national", "u.s."].includes(g));
    if (orgUS && oppUS) return { score: 10, reason: "Both org and opportunity are US-based" };

    return {
      score: 2,
      reason: `Geography mismatch — org: ${orgGeo.slice(0, 2).join(", ")}; opp: ${oppGeo.slice(0, 2).join(", ")}`,
    };
  }

  if (orgScope === oppScope) return { score: 9, reason: "Geography scopes align" };
  return { score: 5, reason: "Geography scope partially overlaps" };
}

// ─── 6. Organization Type Fit — max 10 ───────────────────────────────────────

const ORG_TYPE_FIT_MATRIX: Record<string, Record<string, number>> = {
  nonprofit: {
    program_service_grant: 10,
    capacity_building_grant: 10,
    technical_assistance: 9,
    planning_grant: 8,
    fellowship_training: 7,
    research_grant: 5,
    prize_challenge: 6,
    international_implementation: 7,
    procurement_contract: 3,
    infrastructure_capital: 4,
    loan_financing: 4,
    other: 6,
  },
  small_business: {
    procurement_contract: 10,
    prize_challenge: 9,
    research_grant: 8,
    loan_financing: 8,
    capacity_building_grant: 6,
    technical_assistance: 6,
    program_service_grant: 4,
    planning_grant: 5,
    fellowship_training: 4,
    infrastructure_capital: 5,
    international_implementation: 4,
    other: 5,
  },
  university: {
    research_grant: 10,
    fellowship_training: 10,
    capacity_building_grant: 7,
    technical_assistance: 7,
    program_service_grant: 6,
    planning_grant: 6,
    prize_challenge: 7,
    international_implementation: 6,
    procurement_contract: 4,
    infrastructure_capital: 4,
    loan_financing: 3,
    other: 6,
  },
  government: {
    infrastructure_capital: 10,
    planning_grant: 10,
    program_service_grant: 9,
    procurement_contract: 9,
    capacity_building_grant: 8,
    technical_assistance: 8,
    international_implementation: 6,
    research_grant: 5,
    fellowship_training: 5,
    prize_challenge: 5,
    loan_financing: 5,
    other: 6,
  },
  tribal: {
    program_service_grant: 10,
    planning_grant: 10,
    capacity_building_grant: 10,
    technical_assistance: 9,
    infrastructure_capital: 8,
    research_grant: 6,
    procurement_contract: 5,
    fellowship_training: 6,
    international_implementation: 4,
    loan_financing: 5,
    prize_challenge: 5,
    other: 7,
  },
  research_institution: {
    research_grant: 10,
    fellowship_training: 9,
    technical_assistance: 7,
    capacity_building_grant: 6,
    program_service_grant: 6,
    planning_grant: 6,
    prize_challenge: 7,
    international_implementation: 6,
    procurement_contract: 4,
    infrastructure_capital: 4,
    loan_financing: 3,
    other: 5,
  },
  contractor: {
    procurement_contract: 10,
    infrastructure_capital: 9,
    technical_assistance: 8,
    planning_grant: 6,
    program_service_grant: 5,
    capacity_building_grant: 5,
    research_grant: 4,
    loan_financing: 5,
    prize_challenge: 4,
    fellowship_training: 3,
    international_implementation: 6,
    other: 5,
  },
  international_ngo: {
    international_implementation: 10,
    program_service_grant: 9,
    capacity_building_grant: 8,
    technical_assistance: 8,
    research_grant: 6,
    fellowship_training: 6,
    planning_grant: 7,
    prize_challenge: 5,
    procurement_contract: 4,
    infrastructure_capital: 5,
    loan_financing: 4,
    other: 6,
  },
  other: {
    program_service_grant: 7,
    capacity_building_grant: 7,
    technical_assistance: 6,
    planning_grant: 6,
    research_grant: 5,
    fellowship_training: 5,
    prize_challenge: 6,
    procurement_contract: 4,
    infrastructure_capital: 4,
    international_implementation: 5,
    loan_financing: 4,
    other: 5,
  },
};

export function scoreOrganizationTypeFitV2(
  org: V2OrgProfile,
  opp: V2OppProfile,
): { score: number; reason: string } {
  const matrix = ORG_TYPE_FIT_MATRIX[org.orgClass];
  if (!matrix) return { score: 5, reason: "Unknown org class — partial credit" };

  const oppTypeLabel = opp.opportunityType;
  const score = matrix[oppTypeLabel] ?? 5;

  const oppReadable = oppTypeLabel.replace(/_/g, " ");
  const reason =
    score >= 9 ? `${org.orgClass} is a primary target for ${oppReadable}`
    : score >= 7 ? `${org.orgClass} is well-suited for ${oppReadable}`
    : score >= 5 ? `${org.orgClass} can apply to ${oppReadable}`
    : `${org.orgClass} is not the typical applicant for ${oppReadable}`;

  return { score, reason };
}

// ─── 7. Capacity / Complexity Fit — max 10 ───────────────────────────────────

const CAPACITY_IDX: Record<string, number> = { early: 0, growing: 1, established: 2, enterprise: 3, unknown: 1 };
const COMPLEX_IDX: Record<string, number> = { low: 0, medium: 1, high: 2, very_high: 3, unknown: 1 };

export function scoreCapacityFitV2(
  org: V2OrgProfile,
  opp: V2OppProfile,
): { score: number; reason: string; penaltyValue: number } {
  if (org.capacityBand === "unknown" || opp.complexityBand === "unknown") {
    return { score: 6, reason: "Capacity or complexity unknown — partial credit", penaltyValue: 0 };
  }

  const capIdx = CAPACITY_IDX[org.capacityBand] ?? 1;
  const comIdx = COMPLEX_IDX[opp.complexityBand] ?? 1;
  const diff = comIdx - capIdx;

  if (diff <= 0) {
    return {
      score: 10,
      reason: `Org capacity (${org.capacityBand}) meets opportunity complexity (${opp.complexityBand})`,
      penaltyValue: 0,
    };
  }
  if (diff === 1) {
    return {
      score: 6,
      reason: `Org capacity (${org.capacityBand}) slightly below opportunity complexity (${opp.complexityBand})`,
      penaltyValue: 3,
    };
  }
  if (diff === 2) {
    return {
      score: 3,
      reason: `Org capacity (${org.capacityBand}) significantly below complexity (${opp.complexityBand})`,
      penaltyValue: 7,
    };
  }
  return {
    score: 1,
    reason: `Org capacity (${org.capacityBand}) far below complexity (${opp.complexityBand}) — high risk`,
    penaltyValue: 10,
  };
}

// ─── 8. Funding Fit — max 5 ───────────────────────────────────────────────────

export function scoreFundingFitV2(
  org: V2OrgProfile,
  opp: V2OppProfile,
): { score: number; reason: string } {
  const budget = org.annualBudget;
  const fMax = opp.fundingMax;
  const fMin = opp.fundingMin ?? 0;

  if (budget === null || fMax === null) {
    return { score: 3, reason: "Award or budget data missing — partial credit" };
  }

  const lowerIdeal = budget * 0.05;
  const upperIdeal = budget * 3.0;

  if (fMax >= lowerIdeal && fMin <= upperIdeal) {
    return { score: 5, reason: `Award fits budget: $${budget.toLocaleString()} budget, $${fMax.toLocaleString()} max award` };
  }
  if (fMax >= lowerIdeal * 0.4 && fMin <= upperIdeal * 2) {
    return { score: 3, reason: "Award is acceptable but not in the ideal range for this budget" };
  }
  if (fMax < budget * 0.01) {
    return { score: 1, reason: `Award ($${fMax.toLocaleString()}) is very small relative to budget ($${budget.toLocaleString()})` };
  }
  if (fMin > budget * 5) {
    return { score: 1, reason: `Minimum award ($${fMin.toLocaleString()}) may strain org capacity (budget: $${budget.toLocaleString()})` };
  }

  return { score: 2, reason: "Award range partially matches budget" };
}

// ─── Semantic Boost — max 10 ──────────────────────────────────────────────────

export function computeSemanticBoostV2(
  org: V2OrgProfile,
  opp: V2OppProfile,
): { boost: number; reasons: string[] } {
  let boost = 0;
  const reasons: string[] = [];

  // Deep domain alignment
  const domainMatches = org.sectorTags.filter(s => opp.domainTags.includes(s));
  if (domainMatches.length >= 4) { boost += 4; reasons.push(`Deep domain alignment (${domainMatches.length} sectors)`); }
  else if (domainMatches.length === 3) { boost += 3; reasons.push("Strong domain alignment"); }
  else if (domainMatches.length === 2) { boost += 2; }

  // Explicit eligibility confirmation
  if (org.has501c3 && opp.applicantTypes.includes("501c3")) { boost += 2; reasons.push("501(c)(3) explicitly required and confirmed"); }
  if (org.isSmallBusiness && opp.applicantTypes.some(t => ["small_business", "for_profit"].includes(t))) {
    boost += 2; reasons.push("Small business designation aligns with set-aside");
  }

  // Population specificity
  const popMatches = org.populationTags.filter(p => opp.populationTags.includes(p));
  if (popMatches.length >= 2) { boost += 2; reasons.push(`Population alignment (${popMatches.slice(0, 2).join(", ")})`); }
  else if (popMatches.length === 1) { boost += 1; }

  // Activity alignment
  const actMatches = org.activityTags.filter(a => opp.activityTags.includes(a));
  if (actMatches.length >= 2) { boost += 2; reasons.push(`Activity model alignment (${actMatches.slice(0, 2).join(", ")})`); }
  else if (actMatches.length === 1) { boost += 1; }

  return { boost: Math.min(10, boost), reasons };
}

// ─── Penalty Engine ────────────────────────────────────────────────────────────

export function computePenaltiesV2(
  org: V2OrgProfile,
  opp: V2OppProfile,
  capacityPenaltyValue: number,
): V2Penalty[] {
  const penalties: V2Penalty[] = [];

  // Capacity/complexity mismatch
  if (capacityPenaltyValue > 0) {
    penalties.push({
      type: "complexity_mismatch",
      value: capacityPenaltyValue,
      reason: `Org capacity (${org.capacityBand}) is below opportunity complexity (${opp.complexityBand})`,
    });
  }

  // Procurement mismatch
  if (
    opp.opportunityType === "procurement_contract" &&
    org.procurementReadiness === "low" &&
    !["government", "contractor", "small_business"].includes(org.orgClass)
  ) {
    penalties.push({
      type: "procurement_mismatch",
      value: 8,
      reason: "Procurement opportunity requires contracting infrastructure the org may lack",
    });
  }

  // Research readiness mismatch
  if (
    opp.opportunityType === "research_grant" &&
    org.researchReadiness === "low" &&
    !["university", "research_institution"].includes(org.orgClass)
  ) {
    penalties.push({
      type: "research_mismatch",
      value: 5,
      reason: "Research grant typically requires scientific capacity not evident in this org profile",
    });
  }

  // Geography scope mismatch (local opp, international org)
  if (
    ["local", "state"].includes(opp.geographyScope) &&
    org.geographyScope === "international"
  ) {
    penalties.push({
      type: "geography_scope_mismatch",
      value: 5,
      reason: "Local/state-limited opportunity may not accept international organizations",
    });
  }

  // Funding capacity mismatch
  if (org.annualBudget !== null && opp.fundingMin !== null && opp.fundingMin > org.annualBudget * 5) {
    penalties.push({
      type: "funding_capacity_mismatch",
      value: 5,
      reason: `Minimum award ($${opp.fundingMin.toLocaleString()}) may exceed org management capacity (budget: $${org.annualBudget.toLocaleString()})`,
    });
  }

  // EU-specific penalty
  if (opp.source === "ted_eu" && !["contractor", "small_business", "government", "university"].includes(org.orgClass)) {
    penalties.push({
      type: "eu_procurement_barrier",
      value: 5,
      reason: "EU procurement may require business registration or local EU partner",
    });
  }

  return penalties;
}
