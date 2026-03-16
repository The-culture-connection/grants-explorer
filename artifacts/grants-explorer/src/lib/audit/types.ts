import type { OrgProfile, NormalizedOpportunity, ScoreBreakdown } from "@/lib/algorithm/types";

export type FeedbackLabel = "good" | "weak" | "bad" | "unsure";
export type EvalLabel = "strong_fit" | "possible_fit" | "weak_fit" | "not_a_fit";

export interface WeightConfig {
  mission_topic_fit: number;
  eligibility_fit: number;
  geography_fit: number;
  funding_size_fit: number;
  maturity_fit: number;
}

export const DEFAULT_WEIGHTS: WeightConfig = {
  mission_topic_fit: 60,
  eligibility_fit: 20,
  geography_fit: 10,
  funding_size_fit: 5,
  maturity_fit: 5,
};

export interface ScoreTrace {
  org: OrgProfile;
  opp: NormalizedOpportunity;
  weights: WeightConfig;
  passes_eligibility: boolean;
  eligibility_reason: string;
  scores: ScoreBreakdown;
  adjusted_scores: ScoreBreakdown;
  matched_tokens: string[];
  org_tokens: string[];
  opp_tokens: string[];
  synonyms_applied: string[];
  audit_trace: string[];
  risks: string[];
}

export interface AlgorithmVariant {
  key: string;
  label: string;
  description: string;
  weights: WeightConfig;
  useSynonymExpansion?: boolean;
  stricterEligibility?: boolean;
  relaxedGeography?: boolean;
}

export const ALGORITHM_VARIANTS: AlgorithmVariant[] = [
  {
    key: "v1_current",
    label: "V1 Current",
    description: "Default weights: mission 60, eligibility 20, geo 10, funding 5, maturity 5",
    weights: { mission_topic_fit: 60, eligibility_fit: 20, geography_fit: 10, funding_size_fit: 5, maturity_fit: 5 },
  },
  {
    key: "v1_mission_heavy",
    label: "V1 Mission-Heavy",
    description: "Maximum mission focus: mission 70, eligibility 15, geo 7, funding 5, maturity 3",
    weights: { mission_topic_fit: 70, eligibility_fit: 15, geography_fit: 7, funding_size_fit: 5, maturity_fit: 3 },
  },
  {
    key: "v1_eligibility_strict",
    label: "V1 Eligibility-Strict",
    description: "Raises eligibility weight to 30; reduces mission to 50",
    weights: { mission_topic_fit: 50, eligibility_fit: 30, geography_fit: 10, funding_size_fit: 5, maturity_fit: 5 },
    stricterEligibility: true,
  },
  {
    key: "v1_geo_relaxed",
    label: "V1 Geo-Relaxed",
    description: "Reduces geography weight to 5; boosts mission to 65",
    weights: { mission_topic_fit: 65, eligibility_fit: 20, geography_fit: 5, funding_size_fit: 5, maturity_fit: 5 },
    relaxedGeography: true,
  },
  {
    key: "v1_synonyms",
    label: "V1 + Synonyms",
    description: "Default weights with synonym expansion for keyword matching",
    weights: { mission_topic_fit: 60, eligibility_fit: 20, geography_fit: 10, funding_size_fit: 5, maturity_fit: 5 },
    useSynonymExpansion: true,
  },
  {
    key: "v1_balanced",
    label: "V1 Balanced",
    description: "Equal weights across all five components",
    weights: { mission_topic_fit: 20, eligibility_fit: 20, geography_fit: 20, funding_size_fit: 20, maturity_fit: 20 },
  },
];

export interface AuditFeedback {
  opp_id: string;
  label: FeedbackLabel;
  org_id: string;
  note?: string;
}

export interface EvalEntry {
  opp_id: string;
  org_id: string;
  label: EvalLabel;
}

export interface AuditSession {
  org: OrgProfile | null;
  feedback: Record<string, AuditFeedback>;
  evalSet: EvalEntry[];
  customWeights: WeightConfig;
}
