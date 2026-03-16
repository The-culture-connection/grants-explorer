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
  mission_topic_fit: 35,
  eligibility_fit: 25,
  geography_fit: 15,
  funding_size_fit: 15,
  maturity_fit: 10,
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
    description: "Default weights: mission 35, eligibility 25, geo 15, funding 15, maturity 10",
    weights: { mission_topic_fit: 35, eligibility_fit: 25, geography_fit: 15, funding_size_fit: 15, maturity_fit: 10 },
  },
  {
    key: "v1_mission_heavy",
    label: "V1 Mission-Heavy",
    description: "Boosts mission/topic fit to 45; reduces eligibility to 20",
    weights: { mission_topic_fit: 45, eligibility_fit: 20, geography_fit: 15, funding_size_fit: 12, maturity_fit: 8 },
  },
  {
    key: "v1_eligibility_strict",
    label: "V1 Eligibility-Strict",
    description: "Raises eligibility weight to 35; reduces mission to 30",
    weights: { mission_topic_fit: 30, eligibility_fit: 35, geography_fit: 15, funding_size_fit: 12, maturity_fit: 8 },
    stricterEligibility: true,
  },
  {
    key: "v1_geo_relaxed",
    label: "V1 Geo-Relaxed",
    description: "Reduces geography weight to 8; boosts mission to 40",
    weights: { mission_topic_fit: 40, eligibility_fit: 25, geography_fit: 8, funding_size_fit: 17, maturity_fit: 10 },
    relaxedGeography: true,
  },
  {
    key: "v1_synonyms",
    label: "V1 + Synonyms",
    description: "Default weights with synonym expansion for keyword matching",
    weights: { mission_topic_fit: 35, eligibility_fit: 25, geography_fit: 15, funding_size_fit: 15, maturity_fit: 10 },
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
