/**
 * V3 RankFix types — specificity-first, intent-aware scoring model
 */

import type { OrgProfile, NormalizedOpportunity } from "@/lib/algorithm/types";
import type { V2OrgProfile, V2OppProfile } from "@/lib/v2/types";

// ─── Score Dimensions ─────────────────────────────────────────────────────────

export interface V3Dimensions {
  conceptFit: number;          // max 28 — phrase-priority + taxonomy (specificity-weighted)
  conceptCentrality: number;   // max 12 — title bonus + repeated presence + population specificity
  activityFit: number;         // max 10 — activity/model alignment
  populationFit: number;       // max 8  — specificity-weighted population match
  targetApplicantFit: number;  // max 12 — intended recipient classification
  eligibility: number;         // max 10 — strict gate
  geographyFit: number;        // max 7  — reduced (no easy max)
  capacityFit: number;         // max 7  — reduced (requires evidence)
  fundingFit: number;          // max 6  — reduced support dimension
}

export const V3_DIMENSION_MAXES: Record<keyof V3Dimensions, number> = {
  conceptFit: 28,
  conceptCentrality: 12,
  activityFit: 10,
  populationFit: 8,
  targetApplicantFit: 12,
  eligibility: 10,
  geographyFit: 7,
  capacityFit: 7,
  fundingFit: 6,
};

export interface V3Penalty {
  type: string;
  value: number;
  reason: string;
}

// ─── Sub-signals ──────────────────────────────────────────────────────────────

export interface V3SubSignals {
  exactPhraseMatches: string[];
  highValueConcepts: string[];
  genericTermsMatched: string[];
  specificityRatio: number;       // 0–1, fraction of matched terms that are specific (not generic)
  titleMatchBonus: number;        // 0–6
  repeatedConceptBonus: number;   // 0–4
  targetApplicantInferred: string; // e.g. "nonprofit", "research_institution", "small_business"
  populationSpecificity: number;  // 0–1 (1 = highly specific match)
}

// ─── Full Trace ───────────────────────────────────────────────────────────────

export interface V3ScoreTrace {
  org: OrgProfile;
  opp: NormalizedOpportunity;
  orgProfile: V2OrgProfile;
  oppProfile: V2OppProfile;

  passes_eligibility: boolean;
  eligibility_reason: string;

  dimensions: V3Dimensions;
  subSignals: V3SubSignals;

  baseScore: number;
  semanticBoost: number;
  penalties: V3Penalty[];
  penaltyTotal: number;
  finalScore: number;

  reasons: string[];
  risks: string[];
  audit_trace: string[];
}
