/**
 * matcherV3.ts — RankFix V3 Scorer
 *
 * Specificity-first, intent-aware ranking that fixes the observed issues
 * with the Hybrid V2 engine:
 *
 *   PROBLEM                              FIX
 *   ─────────────────────────────────    ─────────────────────────────────────
 *   Generic terms drive high scores      Phrase-priority conceptFit (req. 1)
 *   Eligibility too permissive           Strict eligibility gate (req. 3)
 *   Geography / capacity / funding       Reduced max + tighter logic (req. 5)
 *     too easy to max out
 *   No concept centrality                computeConceptCentrality (req. 6)
 *   Population too broad                 Specificity-weighted pop (req. 7)
 *   No intended-applicant signal         computeTargetApplicantFit (req. 4)
 *   Broad opportunities over-rank        genericityPenalty + weakSpecificity (req. 2)
 *
 * Score structure (base = 100):
 *   conceptFit          28  — phrase priority + taxonomy (specificity-weighted)
 *   conceptCentrality   12  — title bonus + repeated concept presence
 *   activityFit         10  — activity/model alignment
 *   populationFit        8  — specificity-weighted population match
 *   targetApplicantFit  12  — intended recipient classification
 *   eligibility         10  — strict gate
 *   geographyFit         7  — reduced (no easy max)
 *   capacityFit          7  — reduced
 *   fundingFit           6  — reduced support dimension
 *   ─────────────────────
 *   base               100
 *   + semanticBoost     max +8
 *   − genericityPenalty   0–15
 *   − weakSpecificity     0–8
 *   − targetMismatch      0–10
 *   − populationMismatch  0–6
 *   − complexityMismatch  0–10
 *   = finalScore    capped 0–100
 */

import type { OrgProfile, NormalizedOpportunity } from "@/lib/algorithm/types";
import type { V3ScoreTrace, V3Penalty } from "./types";
import { filterToActiveOpportunities } from "@/lib/algorithm/matcher";
import { buildOrganizationProfile } from "@/lib/v2/orgProfile";
import { buildOpportunityProfile } from "@/lib/v2/oppProfile";
import {
  scoreActivityFitV2,
  scoreGeographyFitV2,
  scoreCapacityFitV2,
  scoreFundingFitV2,
  computeSemanticBoostV2,
} from "@/lib/v2/scoring";
import {
  computePhrasePriorityScore,
  computeConceptCentrality,
  computeGenericityPenalty,
  computeWeakSpecificityPenalty,
} from "./phrases";
import { passesStrictEligibility } from "./eligibility";
import { computePopulationSpecificity, computePopulationMismatchPenalty, normalizePopulationTags } from "./population";
import { computeTargetApplicantFit } from "./targetApplicant";

// ─── Main Scorer ──────────────────────────────────────────────────────────────

export function scoreMatchV3(
  org: OrgProfile,
  opp: NormalizedOpportunity,
): V3ScoreTrace {
  const orgProfile = buildOrganizationProfile(org);
  const oppProfile = buildOpportunityProfile(opp);
  const trace: string[] = [];

  // ── Strict Eligibility Gate ────────────────────────────────────────────────
  const eligResult = passesStrictEligibility(orgProfile, oppProfile);
  trace.push(`[Eligibility] ${eligResult.passes ? "PASSED" : "FAILED"} ${eligResult.score}/10 — ${eligResult.reason}`);

  if (!eligResult.passes) {
    return {
      org, opp, orgProfile, oppProfile,
      passes_eligibility: false,
      eligibility_reason: eligResult.reason,
      dimensions: {
        conceptFit: 0, conceptCentrality: 0, activityFit: 0, populationFit: 0,
        targetApplicantFit: 0, eligibility: 0, geographyFit: 0, capacityFit: 0, fundingFit: 0,
      },
      subSignals: {
        exactPhraseMatches: [], highValueConcepts: [], genericTermsMatched: [],
        specificityRatio: 0, titleMatchBonus: 0, repeatedConceptBonus: 0,
        targetApplicantInferred: "unknown", populationSpecificity: 0,
      },
      baseScore: 0, semanticBoost: 0,
      penalties: [{ type: eligResult.failReason ?? "ineligible", value: 0, reason: eligResult.reason }],
      penaltyTotal: 0, finalScore: 0,
      reasons: [], risks: [eligResult.reason], audit_trace: trace,
    };
  }

  // ── 1. Concept Fit (phrase priority) — max 28 ──────────────────────────────
  const phraseResult = computePhrasePriorityScore(
    orgProfile, oppProfile,
    { title: opp.title, description: opp.description, keywords: opp.keywords, categories: opp.categories },
    { mission: org.mission, keywords: org.keywords, program_areas: org.program_areas },
  );
  const conceptFit = phraseResult.score;
  trace.push(`[Concept Fit] ${conceptFit}/28 — ${phraseResult.reason} | specificity ratio ${(phraseResult.specificityRatio * 100).toFixed(0)}%`);

  // ── 2. Concept Centrality — max 12 ────────────────────────────────────────
  const centralityResult = computeConceptCentrality(
    orgProfile, oppProfile,
    { mission: org.mission, keywords: org.keywords },
    { title: opp.title, description: opp.description },
  );
  const conceptCentrality = centralityResult.score;
  trace.push(`[Concept Centrality] ${conceptCentrality}/12 — ${centralityResult.reason}`);

  // ── 3. Activity Fit — max 10 (reuse V2, same logic) ───────────────────────
  const actResult = scoreActivityFitV2(orgProfile, oppProfile);
  const activityFit = Math.min(10, actResult.score);
  trace.push(`[Activity Fit] ${activityFit}/10 — ${actResult.reason}`);

  // ── 4. Population Fit (specificity-weighted) — max 8 ──────────────────────
  const popResult = computePopulationSpecificity(
    orgProfile, oppProfile,
    { mission: org.mission, population_served: org.population_served },
    { title: opp.title, description: opp.description },
  );
  const populationFit = popResult.score;
  trace.push(`[Population Fit] ${populationFit}/8 — ${popResult.reason}`);

  // ── 5. Target Applicant Fit — max 12 (new in V3) ──────────────────────────
  const taResult = computeTargetApplicantFit(
    orgProfile, oppProfile,
    { title: opp.title, description: opp.description, eligibility: opp.eligibility },
  );
  const targetApplicantFit = Math.min(12, taResult.score);
  trace.push(`[Target Applicant] ${targetApplicantFit}/12 — inferred: "${taResult.targetApplicantInferred}" | ${taResult.reason}`);

  // ── 6. Geography Fit — max 7 (capped from V2 max 10) ──────────────────────
  const geoResult = scoreGeographyFitV2(orgProfile, oppProfile);
  const geographyFit = Math.round((geoResult.score / 10) * 7);
  trace.push(`[Geography] ${geographyFit}/7 — ${geoResult.reason}`);

  // ── 7. Capacity Fit — max 7 (capped from V2 max 10) ───────────────────────
  const capResult = scoreCapacityFitV2(orgProfile, oppProfile);
  // V3 capacity gives LESS benefit of the doubt — unknown = 4 (not 6)
  const capRaw = orgProfile.capacityBand === "unknown" || oppProfile.complexityBand === "unknown"
    ? 4
    : capResult.score;
  const capacityFit = Math.round((capRaw / 10) * 7);
  trace.push(`[Capacity] ${capacityFit}/7 — ${capResult.reason}`);

  // ── 8. Funding Fit — max 6 (capped from V2 max 5) ─────────────────────────
  const fundResult = scoreFundingFitV2(orgProfile, oppProfile);
  // V3 funding gives less default credit — unknown = 2 (not 3)
  const fundRaw = (orgProfile.annualBudget === null || oppProfile.fundingMax === null) ? 2 : fundResult.score;
  const fundingFit = Math.round((fundRaw / 5) * 6);
  trace.push(`[Funding] ${fundingFit}/6 — ${fundResult.reason}`);

  const dimensions = {
    conceptFit, conceptCentrality, activityFit, populationFit,
    targetApplicantFit, eligibility: eligResult.score, geographyFit, capacityFit, fundingFit,
  };

  const baseScore = Object.values(dimensions).reduce((s, v) => s + v, 0);
  trace.push(`[Base Score] ${baseScore}/100`);

  // ── Semantic Boost — max 8 (reduced from V2 max 10) ───────────────────────
  const { boost: rawBoost, reasons: boostReasons } = computeSemanticBoostV2(orgProfile, oppProfile);
  const semanticBoost = Math.round((rawBoost / 10) * 8);
  if (semanticBoost > 0) trace.push(`[Semantic Boost] +${semanticBoost} — ${boostReasons.join("; ")}`);

  // ── Penalty Engine ─────────────────────────────────────────────────────────
  const penalties: V3Penalty[] = [];

  // 1. Genericity penalty
  const { penalty: genPenalty, reason: genReason } = computeGenericityPenalty(
    phraseResult.exactPhraseMatches,
    phraseResult.specificityRatio,
    baseScore,
  );
  if (genPenalty > 0) {
    penalties.push({ type: "genericity_penalty", value: genPenalty, reason: genReason });
    trace.push(`[Genericity Penalty] -${genPenalty} — ${genReason}`);
  }

  // 2. Weak specificity penalty
  const { penalty: wsPenalty, reason: wsReason } = computeWeakSpecificityPenalty(
    conceptFit, conceptCentrality, phraseResult.specificityRatio, phraseResult.exactPhraseMatches,
  );
  if (wsPenalty > 0) {
    penalties.push({ type: "weak_specificity", value: wsPenalty, reason: wsReason });
    trace.push(`[Weak Specificity Penalty] -${wsPenalty} — ${wsReason}`);
  }

  // 3. Target applicant mismatch penalty
  if (taResult.mismatchPenalty > 0) {
    penalties.push({ type: "target_applicant_mismatch", value: taResult.mismatchPenalty, reason: taResult.mismatchReason });
    trace.push(`[Target Applicant Mismatch] -${taResult.mismatchPenalty} — ${taResult.mismatchReason}`);
  }

  // 4. Population mismatch penalty
  const orgPopText = [org.mission, ...org.population_served].join(" ");
  const oppPopText = [opp.title, opp.description.slice(0, 500)].join(" ");
  const orgPops = normalizePopulationTags(orgPopText);
  const oppPops = normalizePopulationTags(oppPopText);
  const { penalty: popMismatch, reason: popMismatchReason } = computePopulationMismatchPenalty(
    orgPops, oppPops, popResult.matches,
  );
  if (popMismatch > 0) {
    penalties.push({ type: "population_mismatch", value: popMismatch, reason: popMismatchReason });
    trace.push(`[Population Mismatch] -${popMismatch} — ${popMismatchReason}`);
  }

  // 5. Complexity mismatch penalty (from capacity)
  if (capResult.penaltyValue > 0 && capRaw === capResult.score) {
    const cmpPenalty = Math.round((capResult.penaltyValue / 10) * 7);
    if (cmpPenalty > 0) {
      penalties.push({
        type: "complexity_mismatch",
        value: cmpPenalty,
        reason: `Org capacity (${orgProfile.capacityBand}) below opportunity complexity (${oppProfile.complexityBand})`,
      });
      trace.push(`[Complexity Mismatch] -${cmpPenalty}`);
    }
  }

  // 6. Procurement barrier
  if (
    oppProfile.opportunityType === "procurement_contract" &&
    !["contractor", "small_business", "government"].includes(orgProfile.orgClass)
  ) {
    const pval = 8;
    penalties.push({ type: "procurement_barrier", value: pval, reason: "Procurement requires SAM registration and past performance" });
    trace.push(`[Procurement Barrier] -${pval}`);
  }

  // 7. EU procurement barrier
  if (opp.source === "ted_eu" && !["contractor", "small_business", "government", "university"].includes(orgProfile.orgClass)) {
    penalties.push({ type: "eu_barrier", value: 4, reason: "EU procurement may require EU business registration or local partner" });
    trace.push(`[EU Barrier] -4`);
  }

  // 8. Funding capacity mismatch
  if (orgProfile.annualBudget !== null && oppProfile.fundingMin !== null && oppProfile.fundingMin > orgProfile.annualBudget * 5) {
    penalties.push({
      type: "funding_capacity_mismatch",
      value: 5,
      reason: `Min award ($${oppProfile.fundingMin.toLocaleString()}) may exceed org management capacity`,
    });
    trace.push(`[Funding Capacity] -5`);
  }

  const penaltyTotal = penalties.reduce((s, p) => s + p.value, 0);
  const finalScore = Math.max(0, Math.min(100, baseScore + semanticBoost - penaltyTotal));
  trace.push(`[Final] ${baseScore} base + ${semanticBoost} boost - ${penaltyTotal} penalties = ${finalScore}`);

  // ── Reasons & Risks ────────────────────────────────────────────────────────
  const reasons: string[] = [];
  const risks: string[] = [];

  if (phraseResult.exactPhraseMatches.length >= 2)
    reasons.push(`${phraseResult.exactPhraseMatches.length} exact concept phrases match: ${phraseResult.exactPhraseMatches.slice(0, 2).join(", ")}`);
  else if (phraseResult.exactPhraseMatches.length === 1)
    reasons.push(`Exact concept match: "${phraseResult.exactPhraseMatches[0]}"`);

  if (conceptCentrality >= 6) reasons.push(`Core concept featured in opportunity title`);
  if (targetApplicantFit >= 10) reasons.push(`"${orgProfile.orgClass}" is the intended applicant type`);
  if (populationFit >= 6) reasons.push(popResult.reason);
  if (eligResult.score >= 9) reasons.push(`Strong eligibility confirmation`);
  if (semanticBoost >= 5) reasons.push(`Multi-signal alignment boost`);

  if (phraseResult.exactPhraseMatches.length === 0 && phraseResult.specificityRatio < 0.3)
    risks.push("Score driven by generic terms — verify mission relevance before applying");
  if (conceptCentrality === 0 && conceptFit < 12)
    risks.push("Core concepts are not centrally featured in opportunity — may be a peripheral match");
  if (taResult.mismatchPenalty > 5)
    risks.push(taResult.mismatchReason);
  if (popMismatch > 0)
    risks.push(popMismatchReason);
  for (const p of penalties) {
    if (!risks.includes(p.reason)) risks.push(p.reason);
  }

  return {
    org, opp, orgProfile, oppProfile,
    passes_eligibility: true,
    eligibility_reason: eligResult.reason,
    dimensions,
    subSignals: {
      exactPhraseMatches: phraseResult.exactPhraseMatches,
      highValueConcepts: phraseResult.highValueConcepts,
      genericTermsMatched: phraseResult.genericTermsMatched,
      specificityRatio: phraseResult.specificityRatio,
      titleMatchBonus: centralityResult.titleMatchBonus,
      repeatedConceptBonus: centralityResult.repeatedConceptBonus,
      targetApplicantInferred: taResult.targetApplicantInferred,
      populationSpecificity: popResult.specificity,
    },
    baseScore, semanticBoost, penalties, penaltyTotal, finalScore,
    reasons, risks, audit_trace: trace,
  };
}

// ─── Top Matches (V3) ─────────────────────────────────────────────────────────

export function getTopMatchesV3(
  org: OrgProfile,
  opportunities: NormalizedOpportunity[],
  limit = 10,
): V3ScoreTrace[] {
  const { active } = filterToActiveOpportunities(opportunities);
  return active
    .map(opp => scoreMatchV3(org, opp))
    .filter(r => r.passes_eligibility && r.finalScore > 0)
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, limit);
}
