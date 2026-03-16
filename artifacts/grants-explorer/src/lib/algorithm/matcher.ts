import type { OrgProfile, NormalizedOpportunity, MatchResult, ScoreBreakdown } from "./types";
import { isActiveOpportunitySource, normalizeSourceId } from "./sources";

// ─── Source Filtering ─────────────────────────────────────────────────────────

/**
 * Filters the opportunity pool to only include active-opportunity sources.
 * Excludes USASpending, NIH RePORTER, and NSF Awards.
 */
export function filterToActiveOpportunities(opps: NormalizedOpportunity[]): {
  active: NormalizedOpportunity[];
  excluded: NormalizedOpportunity[];
} {
  const active: NormalizedOpportunity[] = [];
  const excluded: NormalizedOpportunity[] = [];
  for (const opp of opps) {
    if (isActiveOpportunitySource(opp.source)) {
      active.push(opp);
    } else {
      excluded.push(opp);
    }
  }
  return { active, excluded };
}

// ─── Eligibility Gate ─────────────────────────────────────────────────────────

/**
 * Returns true if the organization passes the basic eligibility requirements
 * for this opportunity. A false result means score = 0, excluded from top matches.
 */
export function passesEligibility(org: OrgProfile, opp: NormalizedOpportunity): boolean {
  if (!opp.eligibility || opp.eligibility.length === 0) return true;

  const eligLower = opp.eligibility.map((e) => e.toLowerCase());

  // Check for nonprofit-exclusive opportunities
  const nonprofitOnly = eligLower.some(
    (e) => e === "nonprofit" || e === "501c3" || e === "community_based_org" || e === "community_org"
  );
  const excludesForProfit = !eligLower.some(
    (e) => e === "for_profit" || e === "small_business" || e === "all"
  );
  if (nonprofitOnly && excludesForProfit && org.org_type !== "nonprofit") {
    return false;
  }

  // Check for small-business exclusive
  const sbOnly =
    eligLower.length > 0 &&
    eligLower.every((e) => ["small_business", "for_profit", "8a_certified"].includes(e));
  if (sbOnly && !org.is_small_business && org.org_type !== "small_business") {
    return false;
  }

  // 501c3 requirement
  if (eligLower.includes("501c3") && !org.has_501c3) {
    return false;
  }

  return true;
}

// ─── Scoring Helpers ──────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function overlap(a: string[], b: string[]): number {
  const setB = new Set(b);
  return a.filter((t) => setB.has(t)).length;
}

/**
 * Mission / Topic Fit — 35 points
 * Keyword overlap between org mission/keywords/program_areas and
 * opp title/description/keywords/categories.
 */
export function scoreMissionFit(org: OrgProfile, opp: NormalizedOpportunity): number {
  const orgTerms = [
    ...tokenize(org.mission),
    ...org.keywords.flatMap(tokenize),
    ...org.program_areas.flatMap(tokenize),
    ...org.population_served.flatMap(tokenize),
  ];
  const oppTerms = [
    ...tokenize(opp.title),
    ...tokenize(opp.description),
    ...opp.keywords.flatMap(tokenize),
    ...opp.categories.flatMap(tokenize),
  ];

  const hits = overlap(orgTerms, oppTerms);
  const uniqueOrgTerms = new Set(orgTerms).size;

  // Score based on coverage ratio, capped at 35
  const ratio = uniqueOrgTerms > 0 ? hits / Math.min(uniqueOrgTerms, 20) : 0;
  return Math.round(Math.min(35, ratio * 35 + (hits > 0 ? 5 : 0)));
}

/**
 * Eligibility Fit — 25 points
 * Positive score if eligible; partial score if potentially eligible.
 * 0 if not eligible (and passesEligibility returns false).
 */
export function scoreEligibilityFit(org: OrgProfile, opp: NormalizedOpportunity): number {
  if (!passesEligibility(org, opp)) return 0;

  if (!opp.eligibility || opp.eligibility.length === 0) return 15; // Unknown — partial credit

  const eligLower = opp.eligibility.map((e) => e.toLowerCase());
  let score = 15; // Base for passing

  // Exact org type match
  if (eligLower.includes(org.org_type)) score += 5;

  // 501c3 confirmed
  if (org.has_501c3 && eligLower.includes("501c3")) score += 3;

  // Small business confirmed
  if (org.is_small_business && eligLower.includes("small_business")) score += 2;

  return Math.min(25, score);
}

/**
 * Geography Fit — 15 points
 * Checks if org geography overlaps with opp geography.
 */
export function scoreGeographyFit(org: OrgProfile, opp: NormalizedOpportunity): number {
  const orgGeo = (org.geography ?? []).filter((g) => g != null).map((g) => String(g).toLowerCase());
  const oppGeo = (opp.geography ?? []).filter((g) => g != null).map((g) => String(g).toLowerCase());

  if (
    oppGeo.includes("global") ||
    oppGeo.includes("international") ||
    oppGeo.length === 0
  ) {
    return 10; // Open geographies get partial credit
  }

  for (const og of orgGeo) {
    for (const oppG of oppGeo) {
      if (og.includes(oppG) || oppG.includes(og)) return 15;
    }
  }

  // US-based org vs US opportunity
  const orgInUS = orgGeo.some((g) => g === "united states" || g === "us");
  const oppInUS = oppGeo.some((g) => g === "united states" || g === "us");
  if (orgInUS && oppInUS) return 15;

  return 0;
}

/**
 * Funding Size Fit — 15 points
 * Checks if the award range is realistic for the org's budget and capacity.
 */
export function scoreFundingFit(org: OrgProfile, opp: NormalizedOpportunity): number {
  if (!opp.max_award) return 8; // Unknown — partial credit

  const budget = org.annual_budget;
  const maxAward = opp.max_award;
  const minAward = opp.min_award ?? 0;

  // Ideal: award is between 10% and 200% of annual budget
  const lowerIdeal = budget * 0.1;
  const upperIdeal = budget * 2.0;

  if (maxAward >= lowerIdeal && minAward <= upperIdeal) return 15;
  if (maxAward >= lowerIdeal * 0.5 && minAward <= upperIdeal * 1.5) return 10;
  if (maxAward < lowerIdeal * 0.1) return 3; // Award too small to be worth it
  if (minAward > upperIdeal * 3) return 3; // Award likely too large for org capacity

  return 6;
}

/**
 * Maturity Fit — 10 points
 * Organizations < 2 years may face barriers; 5+ years shows track record.
 */
export function scoreMaturityFit(org: OrgProfile, opp: NormalizedOpportunity): number {
  const years = org.years_in_operation;
  const descLower = (opp.description + " " + opp.title).toLowerCase();

  const requiresExperience =
    descLower.includes("experience") ||
    descLower.includes("track record") ||
    descLower.includes("prior federal") ||
    descLower.includes("established");

  if (years >= 5) return 10;
  if (years >= 3) return requiresExperience ? 6 : 8;
  if (years >= 1) return requiresExperience ? 3 : 6;
  return 2;
}

// ─── Explainability ───────────────────────────────────────────────────────────

export function generateReasons(org: OrgProfile, opp: NormalizedOpportunity, scores: ScoreBreakdown): string[] {
  const reasons: string[] = [];

  if (scores.eligibility_fit >= 20) {
    if (org.org_type === "nonprofit") reasons.push("Eligible nonprofit applicant type confirmed");
    else if (org.is_small_business) reasons.push("Eligible small business applicant type confirmed");
  } else if (scores.eligibility_fit >= 15) {
    reasons.push("Meets basic eligibility requirements");
  }

  if (org.has_501c3) reasons.push("501(c)(3) status satisfies tax-exempt requirement");
  if (org.is_small_business) reasons.push("Small business designation aligns with set-aside opportunities");

  if (scores.mission_topic_fit >= 25) {
    const matchedKw = org.keywords.filter((k) =>
      (opp.title + " " + opp.description + " " + opp.keywords.join(" ")).toLowerCase().includes(k.toLowerCase())
    );
    if (matchedKw.length > 0)
      reasons.push(`Strong topic overlap: ${matchedKw.slice(0, 3).join(", ")}`);
    else reasons.push("Strong mission and topic alignment with funding priorities");
  } else if (scores.mission_topic_fit >= 15) {
    reasons.push("Moderate topic alignment with opportunity focus areas");
  }

  if (scores.geography_fit === 15) {
    reasons.push(`Geographic fit: ${org.geography[0]} aligns with opportunity coverage`);
  } else if (scores.geography_fit === 10) {
    reasons.push("Opportunity open to international or wide geographic applicants");
  }

  if (scores.funding_size_fit === 15) {
    reasons.push("Award size appears realistic for this organization's budget scale");
  }

  if (scores.maturity_fit === 10) {
    reasons.push("Organization's operational history demonstrates funding capacity");
  }

  return reasons;
}

export function generateRisks(org: OrgProfile, opp: NormalizedOpportunity, scores: ScoreBreakdown): string[] {
  const risks: string[] = [];

  if (scores.mission_topic_fit < 15) {
    risks.push("Limited keyword overlap — mission alignment may be weak");
  }

  if (org.years_in_operation < 2) {
    risks.push("Organization is early-stage; funders may require established track record");
  }

  if (opp.funding_type === "contract" || opp.funding_type === "procurement") {
    risks.push("Contract/procurement opportunity may require past performance documentation");
  }

  if (opp.max_award && opp.max_award > org.annual_budget * 3) {
    risks.push("Award ceiling significantly exceeds annual budget — capacity risk");
  }

  if (opp.min_award && opp.min_award < org.annual_budget * 0.05) {
    risks.push("Minimum award may be too small relative to organizational overhead");
  }

  const descLower = (opp.description + " " + opp.title).toLowerCase();
  if (descLower.includes("competitive") || descLower.includes("highly competitive")) {
    risks.push("Opportunity may be highly competitive — strong applications required");
  }

  if (opp.geography.some((g) => g.toLowerCase().includes("international") || g.toLowerCase() === "global")) {
    risks.push("International scope may present compliance or reporting complexity");
  }

  if (opp.source === "ted_eu" || opp.geography.some((g) => g.toLowerCase().includes("european"))) {
    risks.push("EU procurement may require business registration or local partner");
  }

  if (!org.has_501c3 && opp.eligibility.includes("501c3")) {
    risks.push("501(c)(3) required — organization may not currently qualify");
  }

  return risks;
}

// ─── Main Scorer ──────────────────────────────────────────────────────────────

export function scoreMatch(org: OrgProfile, opp: NormalizedOpportunity): MatchResult {
  const passes = passesEligibility(org, opp);

  if (!passes) {
    return {
      opportunity: opp,
      score: { mission_topic_fit: 0, eligibility_fit: 0, geography_fit: 0, funding_size_fit: 0, maturity_fit: 0, total: 0 },
      passes_eligibility: false,
      reasons: [],
      risks: ["Organization does not meet basic eligibility requirements for this opportunity"],
    };
  }

  const mission_topic_fit = scoreMissionFit(org, opp);
  const eligibility_fit = scoreEligibilityFit(org, opp);
  const geography_fit = scoreGeographyFit(org, opp);
  const funding_size_fit = scoreFundingFit(org, opp);
  const maturity_fit = scoreMaturityFit(org, opp);
  const total = mission_topic_fit + eligibility_fit + geography_fit + funding_size_fit + maturity_fit;

  const scores: ScoreBreakdown = {
    mission_topic_fit,
    eligibility_fit,
    geography_fit,
    funding_size_fit,
    maturity_fit,
    total,
  };

  return {
    opportunity: opp,
    score: scores,
    passes_eligibility: true,
    reasons: generateReasons(org, opp, scores),
    risks: generateRisks(org, opp, scores),
  };
}

export function getTopMatches(
  org: OrgProfile,
  opportunities: NormalizedOpportunity[],
  limit = 10
): MatchResult[] {
  // Step 1: Filter to active-opportunity sources only
  const { active } = filterToActiveOpportunities(opportunities);

  // Step 2: Score all active opportunities
  const results = active.map((opp) => scoreMatch(org, opp));

  // Step 3: Filter to only eligible matches, sort by score descending
  return results
    .filter((r) => r.passes_eligibility && r.score.total > 0)
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, limit);
}
