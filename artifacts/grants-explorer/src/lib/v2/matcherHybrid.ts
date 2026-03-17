/**
 * matcherHybrid.ts — Final V2 Hybrid Scorer
 *
 * Merges V1's battle-tested keyword/text matching with V2's structured
 * profile-to-profile dimensions. Signals are blended at the sub-dimension
 * level so each contributes where it's strongest.
 *
 * Score breakdown (base = 100):
 *   missionDomain  25  — 60% V1 keyword overlap + 40% V2 taxonomy tags
 *   eligibility    20  — max(V1 eligibility, V2 eligibility)
 *   orgTypeFit     12  — V2 org-type vs opp-type classifier, scaled
 *   activityFit    10  — V2 activity tags, scaled from max-15
 *   geographyFit   10  — 50% V1 geo text + 50% V2 scope classifier
 *   capacityFit    10  — V2 capacity vs complexity (V1 doesn't have this)
 *   fundingFit      8  — 50% V1 realism + 50% V2 funding band fit
 *   populationFit   5  — V2 population tags, scaled from max-10
 *   ─────────────────
 *   base           100
 *   + semanticBoost  up to +10 (V2 multi-signal alignment)
 *   + maturityBoost  up to  +4 (V1 years-in-operation signal)
 *   − penalties       V2 penalty engine
 *   = finalScore    capped 0–100
 */

import type { OrgProfile, NormalizedOpportunity } from "@/lib/algorithm/types";
import type { HybridScoreTrace } from "./types";
import { filterToActiveOpportunities } from "@/lib/algorithm/matcher";
import {
  scoreMissionFit,
  scoreEligibilityFit,
  scoreGeographyFit,
  scoreFundingFit,
  scoreMaturityFit,
} from "@/lib/algorithm/matcher";
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

// ─── Hybrid Scorer ────────────────────────────────────────────────────────────

export function scoreMatchHybrid(
  org: OrgProfile,
  opp: NormalizedOpportunity,
): HybridScoreTrace {
  const orgProfile = buildOrganizationProfile(org);
  const oppProfile = buildOpportunityProfile(opp);
  const trace: string[] = [];

  // ── V1 Raw Signals ─────────────────────────────────────────────────────────
  const v1Keyword   = scoreMissionFit(org, opp);          // 0–60
  const v1Elig      = scoreEligibilityFit(org, opp);      // 0–20
  const v1Geo       = scoreGeographyFit(org, opp);        // 0–10
  const v1Funding   = scoreFundingFit(org, opp);          // 0–5
  const v1Maturity  = scoreMaturityFit(org, opp);         // 0–5

  trace.push(`[V1 Signals] keyword=${v1Keyword}/60, elig=${v1Elig}/20, geo=${v1Geo}/10, funding=${v1Funding}/5, maturity=${v1Maturity}/5`);

  // ── V2 Raw Signals ─────────────────────────────────────────────────────────
  const { score: v2Elig, reason: v2EligReason, passed: v2EligPassed } =
    scoreEligibilityFitV2(orgProfile, oppProfile);

  // Fast-fail: if BOTH V1 and V2 agree eligibility fails, exit early
  const v1EligFailed = v1Elig === 0;
  if (v1EligFailed && !v2EligPassed) {
    trace.push(`[Eligibility] FAILED both V1 and V2 — ${v2EligReason}`);
    return {
      org, opp, orgProfile, oppProfile,
      passes_eligibility: false,
      eligibility_reason: v2EligReason,
      dimensions: {
        missionDomain: 0, eligibility: 0, orgTypeFit: 0, activityFit: 0,
        geographyFit: 0, capacityFit: 0, fundingFit: 0, populationFit: 0,
      },
      subSignals: {
        v1KeywordScore: v1Keyword, v2DomainScore: 0,
        v1EligibilityScore: 0, v2EligibilityScore: 0,
        v1GeoScore: v1Geo, v2GeoScore: 0,
        v1FundingScore: v1Funding, v2FundingScore: 0,
        v1MaturityScore: v1Maturity,
      },
      baseScore: 0, semanticBoost: 0, maturityBoost: 0,
      penalties: [], penaltyTotal: 0, finalScore: 0,
      reasons: [], risks: [v2EligReason], audit_trace: trace,
    };
  }

  const { score: v2Domain, reason: v2DomainReason } = scoreDomainFitV2(orgProfile, oppProfile);
  const { score: v2Activity, reason: v2ActReason }  = scoreActivityFitV2(orgProfile, oppProfile);
  const { score: v2Pop, reason: v2PopReason }        = scorePopulationFitV2(orgProfile, oppProfile);
  const { score: v2Geo, reason: v2GeoReason }        = scoreGeographyFitV2(orgProfile, oppProfile);
  const { score: v2OrgType, reason: v2OrgTypeReason }= scoreOrganizationTypeFitV2(orgProfile, oppProfile);
  const { score: v2Cap, reason: v2CapReason, penaltyValue: capPenalty } =
    scoreCapacityFitV2(orgProfile, oppProfile);
  const { score: v2Fund, reason: v2FundReason } = scoreFundingFitV2(orgProfile, oppProfile);

  trace.push(`[V2 Signals] domain=${v2Domain}/20, activity=${v2Activity}/15, pop=${v2Pop}/10, geo=${v2Geo}/10, orgType=${v2OrgType}/10, capacity=${v2Cap}/10, funding=${v2Fund}/5`);
  trace.push(`[V2 Eligibility] ${v2EligPassed ? "PASSED" : "FAILED"} ${v2Elig}/20 — ${v2EligReason}`);

  // ── Blend into Hybrid Dimensions ───────────────────────────────────────────

  // 1. Mission/Domain — 60% V1 keyword, 40% V2 taxonomy
  const missionDomain = Math.round(
    0.6 * (v1Keyword / 60) * 25 +
    0.4 * (v2Domain  / 20) * 25
  );
  trace.push(`[Mission/Domain] ${missionDomain}/25 — V1 keyword ${((v1Keyword/60)*15).toFixed(1)} + V2 taxonomy ${((v2Domain/20)*10).toFixed(1)}`);

  // 2. Eligibility — take max (most informed reading from either system)
  const eligibility = Math.min(20, Math.max(v1Elig, v2Elig));
  const eligReason  = v2Elig >= v1Elig ? v2EligReason : `V1 eligibility (${v1Elig}/20)`;
  trace.push(`[Eligibility] ${eligibility}/20 — max(V1=${v1Elig}, V2=${v2Elig}) → ${eligReason}`);

  // 3. Org Type Fit — V2 only, scaled 10→12
  const orgTypeFit = Math.round((v2OrgType / 10) * 12);
  trace.push(`[Org Type Fit] ${orgTypeFit}/12 — ${v2OrgTypeReason}`);

  // 4. Activity Fit — V2 only, scaled 15→10
  const activityFit = Math.round((v2Activity / 15) * 10);
  trace.push(`[Activity Fit] ${activityFit}/10 — ${v2ActReason}`);

  // 5. Geography — 50% V1 text, 50% V2 scope classifier
  const geographyFit = Math.round(0.5 * v1Geo + 0.5 * v2Geo);
  trace.push(`[Geography] ${geographyFit}/10 — V1=${v1Geo} + V2=${v2Geo} (averaged)`);

  // 6. Capacity — V2 only (V1 doesn't have this dimension)
  const capacityFit = v2Cap;
  trace.push(`[Capacity] ${capacityFit}/10 — ${v2CapReason}`);

  // 7. Funding — 50% V1 realism (0–5 → 0–4), 50% V2 band (0–5 → 0–4)
  const fundingFit = Math.round(0.5 * (v1Funding / 5) * 8 + 0.5 * (v2Fund / 5) * 8);
  trace.push(`[Funding] ${fundingFit}/8 — V1 realism ${((v1Funding/5)*4).toFixed(1)} + V2 band ${((v2Fund/5)*4).toFixed(1)}`);

  // 8. Population — V2 only, scaled 10→5
  const populationFit = Math.round((v2Pop / 10) * 5);
  trace.push(`[Population] ${populationFit}/5 — ${v2PopReason}`);

  const dimensions = {
    missionDomain, eligibility, orgTypeFit, activityFit,
    geographyFit, capacityFit, fundingFit, populationFit,
  };

  const baseScore = Object.values(dimensions).reduce((s, v) => s + v, 0);
  trace.push(`[Base Score] ${baseScore}/100 — sum of 8 hybrid dimensions`);

  // ── Boosts ─────────────────────────────────────────────────────────────────

  // V2 semantic boost (multi-signal alignment, max +10)
  const { boost: semanticBoost, reasons: boostReasons } = computeSemanticBoostV2(orgProfile, oppProfile);
  if (semanticBoost > 0) {
    trace.push(`[Semantic Boost] +${semanticBoost} — ${boostReasons.join("; ")}`);
  }

  // V1 maturity boost: years-in-operation bonus, max +4
  const maturityBoost = Math.round((v1Maturity / 5) * 4);
  if (maturityBoost > 0) {
    trace.push(`[Maturity Boost] +${maturityBoost} — ${orgProfile.yearsInOperation ?? "?"} years in operation`);
  }

  // ── Penalties ──────────────────────────────────────────────────────────────
  const penalties  = computePenaltiesV2(orgProfile, oppProfile, capPenalty);
  const penaltyTotal = penalties.reduce((s, p) => s + p.value, 0);
  if (penalties.length > 0) {
    trace.push(`[Penalties] -${penaltyTotal} — ${penalties.map(p => `${p.type}: -${p.value}`).join(", ")}`);
  }

  const finalScore = Math.max(0, Math.min(100, baseScore + semanticBoost + maturityBoost - penaltyTotal));
  trace.push(`[Final] ${baseScore} base + ${semanticBoost} semantic + ${maturityBoost} maturity - ${penaltyTotal} penalties = ${finalScore}`);

  // ── Reasons & Risks ────────────────────────────────────────────────────────
  const reasons: string[] = [];
  const risks: string[]   = [];

  // Mission/Domain
  if (missionDomain >= 18) reasons.push(`Strong mission–opportunity alignment (${missionDomain}/25)`);
  else if (missionDomain >= 10) reasons.push(`Moderate domain overlap (${missionDomain}/25)`);
  else if (missionDomain <= 4) risks.push("Weak keyword and taxonomy overlap — verify mission relevance");

  // Eligibility
  if (eligibility >= 17) reasons.push(`Confirmed eligibility for "${orgProfile.orgClass}" org class`);
  else if (eligibility >= 12) reasons.push("Passes eligibility requirements");

  // Org Type
  if (orgTypeFit >= 10) reasons.push(`${orgProfile.orgClass} is a natural fit for ${oppProfile.opportunityType.replace(/_/g, " ")}`);
  else if (orgTypeFit >= 7) reasons.push(`${orgProfile.orgClass} can competitively apply to ${oppProfile.opportunityType.replace(/_/g, " ")}`);
  else if (orgTypeFit <= 3) risks.push("Org type may not be the primary applicant class for this opportunity");

  // Geography
  if (geographyFit >= 9) reasons.push("Geography aligns with opportunity scope");
  else if (geographyFit <= 2) risks.push("Geographic scope may not match — verify before applying");

  // Capacity
  if (capacityFit >= 8) reasons.push("Organizational capacity matches opportunity complexity");
  else if (capacityFit <= 3) risks.push("Opportunity complexity may exceed current capacity — address in narrative");

  // Funding
  if (fundingFit >= 6) reasons.push("Award size is realistic for this organization's budget");
  else if (fundingFit <= 2) risks.push("Funding size may be misaligned with organizational budget");

  // Semantic boost
  if (semanticBoost >= 6) reasons.push("Multiple strong alignment signals across domains, activities, and populations");

  // Maturity
  if (maturityBoost >= 3) reasons.push(`Track record of ${orgProfile.yearsInOperation} years supports credibility`);
  else if ((orgProfile.yearsInOperation ?? 5) < 2) risks.push("Early-stage organization — strengthen narrative to compensate");

  // V2 penalty risks
  for (const p of penalties) risks.push(p.reason);

  // Complexity caution
  if (orgProfile.capacityBand === "early" && ["high", "very_high"].includes(oppProfile.complexityBand)) {
    risks.push("Early-stage org applying for a complex opportunity — build a strong narrative");
  }

  // Procurement caution
  if (
    oppProfile.opportunityType === "procurement_contract" &&
    !["contractor", "small_business", "government"].includes(orgProfile.orgClass)
  ) {
    risks.push("Procurement opportunities typically require SAM/DUNS registration and past performance documentation");
  }

  const passes_eligibility = eligibility > 0;
  const eligibility_reason = eligReason;

  return {
    org, opp, orgProfile, oppProfile,
    passes_eligibility,
    eligibility_reason,
    dimensions,
    subSignals: {
      v1KeywordScore: v1Keyword,
      v2DomainScore: v2Domain,
      v1EligibilityScore: v1Elig,
      v2EligibilityScore: v2Elig,
      v1GeoScore: v1Geo,
      v2GeoScore: v2Geo,
      v1FundingScore: v1Funding,
      v2FundingScore: v2Fund,
      v1MaturityScore: v1Maturity,
    },
    baseScore,
    semanticBoost,
    maturityBoost,
    penalties,
    penaltyTotal,
    finalScore,
    reasons,
    risks,
    audit_trace: trace,
  };
}

// ─── Top Matches (Hybrid) ─────────────────────────────────────────────────────

export function getTopMatchesHybrid(
  org: OrgProfile,
  opportunities: NormalizedOpportunity[],
  limit = 10,
): HybridScoreTrace[] {
  const { active } = filterToActiveOpportunities(opportunities);
  return active
    .map(opp => scoreMatchHybrid(org, opp))
    .filter(r => r.passes_eligibility && r.finalScore > 0)
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, limit);
}
