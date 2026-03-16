import type { OrgProfile, NormalizedOpportunity, ScoreBreakdown } from "@/lib/algorithm/types";
import type { WeightConfig, ScoreTrace } from "./types";
import { DEFAULT_WEIGHTS } from "./types";
import { tokenize, expandWithSynonyms, SYNONYM_GROUPS } from "./keywords";
import { passesEligibility } from "@/lib/algorithm/matcher";

function overlap(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return a.filter((t) => setB.has(t));
}

function scaleScore(raw: number, maxRaw: number, maxWeighted: number): number {
  return Math.round((raw / maxRaw) * maxWeighted);
}

export function buildScoreTrace(
  org: OrgProfile,
  opp: NormalizedOpportunity,
  weights: WeightConfig = DEFAULT_WEIGHTS,
  useSynonymExpansion = false
): ScoreTrace {
  const trace: string[] = [];
  const synonymsApplied: string[] = [];

  // ── Eligibility ──────────────────────────────────────────────────────────
  const passes = passesEligibility(org, opp);
  let eligibilityReason = "";

  if (!opp.eligibility || opp.eligibility.length === 0) {
    eligibilityReason = "No eligibility constraints specified — all applicant types permitted";
    trace.push("Eligibility: PASSED — no restrictions found in opportunity record");
  } else {
    const eligLower = opp.eligibility.map((e) => e.toLowerCase());
    const nonprofitOnly = eligLower.some((e) =>
      ["nonprofit", "501c3", "community_based_org", "community_org"].includes(e)
    );
    const excludesForProfit = !eligLower.some((e) => ["for_profit", "small_business", "all"].includes(e));

    if (!passes) {
      if (nonprofitOnly && excludesForProfit && org.org_type !== "nonprofit") {
        eligibilityReason = `FAILED — opportunity requires nonprofit; org type is "${org.org_type}"`;
        trace.push(`Eligibility: FAILED — requires nonprofit applicant, org is ${org.org_type}`);
      } else if (eligLower.includes("501c3") && !org.has_501c3) {
        eligibilityReason = "FAILED — 501(c)(3) status required but org does not have it";
        trace.push("Eligibility: FAILED — 501(c)(3) required but not indicated in org profile");
      } else {
        eligibilityReason = "FAILED — eligibility constraints not met";
        trace.push("Eligibility: FAILED — applicant type does not match opportunity requirements");
      }
    } else {
      if (eligLower.includes(org.org_type)) {
        eligibilityReason = `PASSED — org type "${org.org_type}" explicitly listed in eligibility`;
        trace.push(`Eligibility: PASSED — org type "${org.org_type}" matches opportunity`);
      } else {
        eligibilityReason = "PASSED — org type not excluded by eligibility constraints";
        trace.push("Eligibility: PASSED — no conflicting eligibility constraints found");
      }
      if (org.has_501c3 && eligLower.includes("501c3")) {
        trace.push("Eligibility bonus: 501(c)(3) confirmed, satisfies tax-exempt requirement");
      }
    }
  }

  // ── Mission / Topic Fit ────────────────────────────────────────────────────
  let orgTerms = [
    ...tokenize(org.mission),
    ...org.keywords.flatMap(tokenize),
    ...org.program_areas.flatMap(tokenize),
    ...org.population_served.flatMap(tokenize),
  ];
  let oppTerms = [
    ...tokenize(opp.title),
    ...tokenize(opp.description),
    ...opp.keywords.flatMap(tokenize),
    ...opp.categories.flatMap(tokenize),
  ];

  if (useSynonymExpansion) {
    const before = orgTerms.length;
    orgTerms = expandWithSynonyms(orgTerms, SYNONYM_GROUPS);
    const added = orgTerms.length - before;
    if (added > 0) synonymsApplied.push(`+${added} synonym tokens added to org profile`);
  }

  const matchedTokens = overlap([...new Set(orgTerms)], [...new Set(oppTerms)]);
  const uniqueOrgTerms = new Set(orgTerms).size;
  const hits = matchedTokens.length;
  const ratio = uniqueOrgTerms > 0 ? hits / Math.min(uniqueOrgTerms, 20) : 0;
  const rawMission = Math.round(Math.min(35, ratio * 35 + (hits > 0 ? 5 : 0)));
  const missionScore = scaleScore(rawMission, 35, weights.mission_topic_fit);

  if (hits === 0) {
    trace.push(`Mission: scored ${missionScore}/${weights.mission_topic_fit} — no keyword overlap found between org and opportunity`);
  } else if (hits >= 5) {
    trace.push(`Mission: scored ${missionScore}/${weights.mission_topic_fit} — strong overlap (${hits} shared tokens: ${matchedTokens.slice(0, 4).join(", ")})`);
  } else {
    trace.push(`Mission: scored ${missionScore}/${weights.mission_topic_fit} — partial overlap (${hits} shared tokens: ${matchedTokens.slice(0, 3).join(", ")})`);
  }

  // ── Eligibility Score ────────────────────────────────────────────────────
  let rawEligibility = 0;
  if (passes) {
    if (!opp.eligibility || opp.eligibility.length === 0) rawEligibility = 15;
    else {
      const eligLower = opp.eligibility.map((e) => e.toLowerCase());
      rawEligibility = 15;
      if (eligLower.includes(org.org_type)) rawEligibility += 5;
      if (org.has_501c3 && eligLower.includes("501c3")) rawEligibility += 3;
      if (org.is_small_business && eligLower.includes("small_business")) rawEligibility += 2;
    }
  }
  const eligibilityScore = passes ? scaleScore(Math.min(25, rawEligibility), 25, weights.eligibility_fit) : 0;
  trace.push(`Eligibility score: ${eligibilityScore}/${weights.eligibility_fit}`);

  // ── Geography ──────────────────────────────────────────────────────────────
  const orgGeo = (org.geography ?? []).filter((g) => g != null).map((g) => String(g).toLowerCase());
  const oppGeo = (opp.geography ?? []).filter((g) => g != null).map((g) => String(g).toLowerCase());

  let rawGeo = 0;
  let geoReason = "";
  if (oppGeo.includes("global") || oppGeo.includes("international") || oppGeo.length === 0) {
    rawGeo = 10;
    geoReason = "Open/international geography — partial credit";
  } else {
    let exactGeoHit = false;
    for (const og of orgGeo) {
      for (const oppG of oppGeo) {
        if (og.includes(oppG) || oppG.includes(og)) { exactGeoHit = true; break; }
      }
    }
    const orgInUS = orgGeo.some((g) => g === "united states" || g === "us");
    const oppInUS = oppGeo.some((g) => g === "united states" || g === "us");
    if (exactGeoHit || (orgInUS && oppInUS)) {
      rawGeo = 15;
      geoReason = `Geography match: org in ${orgGeo[0] ?? "unknown"}, opp in ${oppGeo[0] ?? "unknown"}`;
    } else {
      rawGeo = 0;
      geoReason = `Geography mismatch: org operates in ${orgGeo.join(", ") || "unknown"}, opportunity is ${oppGeo.join(", ") || "unknown"}`;
    }
  }
  const geoScore = scaleScore(rawGeo, 15, weights.geography_fit);
  trace.push(`Geography: scored ${geoScore}/${weights.geography_fit} — ${geoReason}`);

  // ── Funding Size ────────────────────────────────────────────────────────────
  let rawFunding = 0;
  let fundingReason = "";
  if (!opp.max_award) {
    rawFunding = 8;
    fundingReason = "Award amount unknown — partial credit";
  } else {
    const budget = org.annual_budget;
    const maxAward = opp.max_award;
    const minAward = opp.min_award ?? 0;
    const lower = budget * 0.1;
    const upper = budget * 2.0;
    if (maxAward >= lower && minAward <= upper) {
      rawFunding = 15;
      fundingReason = `Award range $${minAward.toLocaleString()}–$${maxAward.toLocaleString()} fits budget of $${budget.toLocaleString()}`;
    } else if (maxAward >= lower * 0.5 && minAward <= upper * 1.5) {
      rawFunding = 10;
      fundingReason = "Award range is acceptable but not ideal for this budget";
    } else if (maxAward < lower * 0.1) {
      rawFunding = 3;
      fundingReason = `Award too small ($${maxAward.toLocaleString()}) for org budget`;
    } else if (minAward > upper * 3) {
      rawFunding = 3;
      fundingReason = `Award too large ($${minAward.toLocaleString()}) — capacity risk`;
    } else {
      rawFunding = 6;
      fundingReason = "Award range partially fits budget";
    }
  }
  const fundingScore = scaleScore(rawFunding, 15, weights.funding_size_fit);
  trace.push(`Funding: scored ${fundingScore}/${weights.funding_size_fit} — ${fundingReason}`);

  // ── Maturity ──────────────────────────────────────────────────────────────
  const years = org.years_in_operation;
  const descLower = (opp.description + " " + opp.title).toLowerCase();
  const requiresExperience =
    descLower.includes("experience") || descLower.includes("track record") ||
    descLower.includes("prior federal") || descLower.includes("established");

  let rawMaturity = 0;
  let maturityReason = "";
  if (years >= 5) { rawMaturity = 10; maturityReason = `${years} years of operation demonstrates track record`; }
  else if (years >= 3) {
    rawMaturity = requiresExperience ? 6 : 8;
    maturityReason = requiresExperience ? "Experience required — 3-yr org may be at risk" : `${years} years — adequate maturity`;
  } else if (years >= 1) {
    rawMaturity = requiresExperience ? 3 : 6;
    maturityReason = `${years} years — early-stage org${requiresExperience ? ", experience required" : ""}`;
  } else {
    rawMaturity = 2;
    maturityReason = "Pre-revenue / brand new org — high maturity risk";
  }
  const maturityScore = scaleScore(rawMaturity, 10, weights.maturity_fit);
  trace.push(`Maturity: scored ${maturityScore}/${weights.maturity_fit} — ${maturityReason}`);

  const scores: ScoreBreakdown = {
    mission_topic_fit: passes ? missionScore : 0,
    eligibility_fit: eligibilityScore,
    geography_fit: passes ? geoScore : 0,
    funding_size_fit: passes ? fundingScore : 0,
    maturity_fit: passes ? maturityScore : 0,
    total: passes ? missionScore + eligibilityScore + geoScore + fundingScore + maturityScore : 0,
  };

  return {
    org,
    opp,
    weights,
    passes_eligibility: passes,
    eligibility_reason: eligibilityReason,
    scores,
    adjusted_scores: scores,
    matched_tokens: matchedTokens,
    org_tokens: [...new Set(orgTerms)],
    opp_tokens: [...new Set(oppTerms)],
    synonyms_applied: synonymsApplied,
    audit_trace: trace,
    risks: [],
  };
}

export interface ScoredWithTrace {
  trace: ScoreTrace;
  rank: number;
}

export function runVariantScoring(
  org: OrgProfile,
  pool: NormalizedOpportunity[],
  weights: WeightConfig,
  useSynonymExpansion = false,
  limit = 20
): ScoredWithTrace[] {
  const results = pool.map((opp) => buildScoreTrace(org, opp, weights, useSynonymExpansion));
  return results
    .filter((t) => t.passes_eligibility && t.scores.total > 0)
    .sort((a, b) => b.scores.total - a.scores.total)
    .slice(0, limit)
    .map((trace, i) => ({ trace, rank: i + 1 }));
}
