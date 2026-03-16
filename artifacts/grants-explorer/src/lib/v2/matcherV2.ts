import type { OrgProfile, NormalizedOpportunity } from "@/lib/algorithm/types";
import type { V2ScoreTrace } from "./types";
import { buildOrganizationProfile } from "./orgProfile";
import { buildOpportunityProfile } from "./oppProfile";
import {
  scoreEligibilityFitV2,
  scoreDomainFitV2,
  scoreActivityFitV2,
  scorePopulationFitV2,
  scoreGeographyFitV2,
  scoreOrganizationTypeFitV2,
  scoreCapacityFitV2,
  scoreFundingFitV2,
  computeSemanticBoostV2,
  computePenaltiesV2,
} from "./scoring";
import { filterToActiveOpportunities } from "@/lib/algorithm/matcher";

// ─── Core V2 Scorer ───────────────────────────────────────────────────────────

export function scoreMatchV2(org: OrgProfile, opp: NormalizedOpportunity): V2ScoreTrace {
  const orgProfile = buildOrganizationProfile(org);
  const oppProfile = buildOpportunityProfile(opp);
  const trace: string[] = [];

  // 1. Eligibility
  const { score: eligScore, reason: eligReason, passed: eligPassed } =
    scoreEligibilityFitV2(orgProfile, oppProfile);
  trace.push(`[Eligibility] ${eligPassed ? "PASSED" : "FAILED"} — ${eligReason} (${eligScore}/20)`);

  if (!eligPassed) {
    return {
      org, opp, orgProfile, oppProfile,
      passes_eligibility: false,
      eligibility_reason: eligReason,
      dimensions: {
        eligibilityFit: 0, domainFit: 0, activityFit: 0, populationFit: 0,
        geographyFit: 0, organizationTypeFit: 0, capacityFit: 0, fundingFit: 0,
      },
      baseScore: 0, semanticBoost: 0,
      penalties: [], penaltyTotal: 0, finalScore: 0,
      reasons: [],
      risks: [eligReason],
      audit_trace: trace,
    };
  }

  // 2. Domain / Mission Fit
  const { score: domainScore, reason: domainReason } = scoreDomainFitV2(orgProfile, oppProfile);
  trace.push(`[Domain] ${domainScore}/20 — ${domainReason}`);

  // 3. Activity / Model Fit
  const { score: actScore, reason: actReason } = scoreActivityFitV2(orgProfile, oppProfile);
  trace.push(`[Activity] ${actScore}/15 — ${actReason}`);

  // 4. Population Fit
  const { score: popScore, reason: popReason } = scorePopulationFitV2(orgProfile, oppProfile);
  trace.push(`[Population] ${popScore}/10 — ${popReason}`);

  // 5. Geography Fit
  const { score: geoScore, reason: geoReason } = scoreGeographyFitV2(orgProfile, oppProfile);
  trace.push(`[Geography] ${geoScore}/10 — ${geoReason}`);

  // 6. Org Type Fit
  const { score: orgTypeScore, reason: orgTypeReason } = scoreOrganizationTypeFitV2(orgProfile, oppProfile);
  trace.push(`[Org Type] ${orgTypeScore}/10 — ${orgTypeReason}`);

  // 7. Capacity / Complexity Fit
  const { score: capScore, reason: capReason, penaltyValue: capPenalty } =
    scoreCapacityFitV2(orgProfile, oppProfile);
  trace.push(`[Capacity] ${capScore}/10 — ${capReason}`);

  // 8. Funding Fit
  const { score: fundScore, reason: fundReason } = scoreFundingFitV2(orgProfile, oppProfile);
  trace.push(`[Funding] ${fundScore}/5 — ${fundReason}`);

  const dimensions = {
    eligibilityFit: eligScore,
    domainFit: domainScore,
    activityFit: actScore,
    populationFit: popScore,
    geographyFit: geoScore,
    organizationTypeFit: orgTypeScore,
    capacityFit: capScore,
    fundingFit: fundScore,
  };

  const baseScore = Object.values(dimensions).reduce((s, v) => s + v, 0);

  // Semantic boost
  const { boost: semanticBoost, reasons: boostReasons } = computeSemanticBoostV2(orgProfile, oppProfile);
  if (semanticBoost > 0) {
    trace.push(`[Semantic Boost] +${semanticBoost} — ${boostReasons.join("; ")}`);
  }

  // Penalties
  const penalties = computePenaltiesV2(orgProfile, oppProfile, capPenalty);
  const penaltyTotal = penalties.reduce((s, p) => s + p.value, 0);
  if (penalties.length > 0) {
    trace.push(`[Penalties] -${penaltyTotal} — ${penalties.map(p => `${p.type}: -${p.value}`).join(", ")}`);
  }

  const finalScore = Math.max(0, Math.min(100, baseScore + semanticBoost - penaltyTotal));
  trace.push(`[Final Score] ${baseScore} base + ${semanticBoost} boost - ${penaltyTotal} penalties = ${finalScore}`);

  // Reasons
  const reasons: string[] = [];
  const risks: string[] = [];

  if (eligScore >= 17) reasons.push(`Strong eligibility — "${orgProfile.orgClass}" is a primary applicant type`);
  else if (eligScore >= 12) reasons.push("Meets eligibility requirements for this opportunity");

  const domainMatches = orgProfile.sectorTags.filter(s => oppProfile.domainTags.includes(s));
  if (domainScore >= 15) reasons.push(`Strong domain alignment: ${domainMatches.slice(0, 3).join(", ")}`);
  else if (domainScore >= 8) reasons.push("Moderate domain overlap with opportunity focus areas");
  else if (domainScore === 0) risks.push("No domain tag overlap detected — verify mission relevance");

  if (orgTypeScore >= 9) reasons.push(`${orgProfile.orgClass} is a natural fit for ${oppProfile.opportunityType.replace(/_/g, " ")}`);
  else if (orgTypeScore >= 7) reasons.push(`${orgProfile.orgClass} can competitively apply to ${oppProfile.opportunityType.replace(/_/g, " ")}`);

  if (geoScore >= 9) reasons.push("Geography aligns with opportunity scope");
  else if (geoScore <= 2) risks.push("Geographic scope may not match — verify eligibility before applying");

  if (fundScore >= 4) reasons.push("Award size is realistic for this organization's budget");

  if (semanticBoost >= 5) reasons.push("Multiple strong alignment signals detected across domains, activities, and populations");

  // Risks from penalties
  for (const p of penalties) risks.push(p.reason);

  // General risk signals
  if (orgProfile.capacityBand === "early" && ["high", "very_high"].includes(oppProfile.complexityBand)) {
    risks.push("Early-stage org applying for a complex opportunity — build a strong narrative");
  }
  if (oppProfile.opportunityType === "procurement_contract" && !["contractor", "small_business", "government"].includes(orgProfile.orgClass)) {
    risks.push("Procurement opportunities typically require registered SAM/DUNS and past performance documentation");
  }

  return {
    org, opp, orgProfile, oppProfile,
    passes_eligibility: true,
    eligibility_reason: eligReason,
    dimensions,
    baseScore,
    semanticBoost,
    penalties,
    penaltyTotal,
    finalScore,
    reasons,
    risks,
    audit_trace: trace,
  };
}

// ─── Top Matches ──────────────────────────────────────────────────────────────

export function getTopMatchesV2(
  org: OrgProfile,
  opportunities: NormalizedOpportunity[],
  limit = 10,
): V2ScoreTrace[] {
  const { active } = filterToActiveOpportunities(opportunities);
  return active
    .map(opp => scoreMatchV2(org, opp))
    .filter(r => r.passes_eligibility && r.finalScore > 0)
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, limit);
}

// ─── V1 vs V2 Comparison ──────────────────────────────────────────────────────

export interface V1V2ComparisonRow {
  oppId: string;
  title: string;
  source: string;
  v1Score: number | null;
  v2Score: number | null;
  rankV1: number | null;
  rankV2: number | null;
  rankDelta: number | null;    // positive = rose in V2, negative = fell
  scoreDelta: number | null;
  opportunityType: string;
  orgClass: string;
  flag: "rose" | "fell" | "stable" | "new" | "dropped";
}

export function compareV1V2(
  v1Results: Array<{ opp: NormalizedOpportunity; score: { total: number } }>,
  v2Results: V2ScoreTrace[],
): V1V2ComparisonRow[] {
  const v1Map = new Map<string, { rank: number; score: number }>();
  v1Results.forEach((r, i) => v1Map.set(r.opp.id, { rank: i + 1, score: r.score.total }));

  const v2Map = new Map<string, { rank: number; score: number; trace: V2ScoreTrace }>();
  v2Results.forEach((r, i) => v2Map.set(r.opp.id, { rank: i + 1, score: r.finalScore, trace: r }));

  const allIds = new Set([...v1Map.keys(), ...v2Map.keys()]);
  const rows: V1V2ComparisonRow[] = [];

  for (const id of allIds) {
    const v1 = v1Map.get(id) ?? null;
    const v2 = v2Map.get(id) ?? null;

    const trace = v2?.trace;
    const opp = trace?.opp ?? v1Results.find(r => r.opp.id === id)?.opp;
    if (!opp) continue;

    const rankDelta = v1 && v2 ? v1.rank - v2.rank : null; // positive = rose
    const scoreDelta = v1 && v2 ? v2.score - v1.score : null;

    const flag: V1V2ComparisonRow["flag"] =
      !v1 ? "new"
      : !v2 ? "dropped"
      : rankDelta != null && rankDelta >= 3 ? "rose"
      : rankDelta != null && rankDelta <= -3 ? "fell"
      : "stable";

    rows.push({
      oppId: id,
      title: opp.title,
      source: opp.source,
      v1Score: v1?.score ?? null,
      v2Score: v2?.score ?? null,
      rankV1: v1?.rank ?? null,
      rankV2: v2?.rank ?? null,
      rankDelta,
      scoreDelta,
      opportunityType: trace?.oppProfile.opportunityType ?? "unknown",
      orgClass: trace?.orgProfile.orgClass ?? "unknown",
      flag,
    });
  }

  // Sort by V2 rank (nulls at end), then V1 rank
  return rows.sort((a, b) => {
    const aRank = a.rankV2 ?? 999;
    const bRank = b.rankV2 ?? 999;
    if (aRank !== bRank) return aRank - bRank;
    return (a.rankV1 ?? 999) - (b.rankV1 ?? 999);
  });
}
