import type { OrgProfile, NormalizedOpportunity } from "@/lib/algorithm/types";

// ─── Enums / Unions ───────────────────────────────────────────────────────────

export type OrgClass =
  | "nonprofit"
  | "small_business"
  | "university"
  | "government"
  | "tribal"
  | "research_institution"
  | "contractor"
  | "international_ngo"
  | "other";

export type GeoScope = "local" | "state" | "national" | "international" | "unknown";
export type CapacityBand = "early" | "growing" | "established" | "enterprise" | "unknown";
export type ReadinessLevel = "low" | "medium" | "high" | "unknown";
export type ComplexityBand = "low" | "medium" | "high" | "very_high" | "unknown";
export type FundingBand = "micro" | "small" | "medium" | "large" | "enterprise" | "unknown";

export type OpportunityTypeV2 =
  | "program_service_grant"
  | "research_grant"
  | "procurement_contract"
  | "capacity_building_grant"
  | "planning_grant"
  | "technical_assistance"
  | "fellowship_training"
  | "prize_challenge"
  | "loan_financing"
  | "infrastructure_capital"
  | "international_implementation"
  | "other";

// ─── Internal Profiles ────────────────────────────────────────────────────────

export interface V2OrgProfile {
  orgId: string;
  name: string;
  orgClass: OrgClass;
  sectorTags: string[];
  domainTags: string[];
  activityTags: string[];
  populationTags: string[];
  geographyTags: string[];
  geographyScope: GeoScope;
  capacityBand: CapacityBand;
  fundingReadiness: ReadinessLevel;
  researchReadiness: ReadinessLevel;
  procurementReadiness: ReadinessLevel;
  annualBudget: number | null;
  yearsInOperation: number | null;
  has501c3: boolean | null;
  isSmallBusiness: boolean | null;
  rawSourceFields: OrgProfile;
}

export interface V2OppProfile {
  opportunityId: string;
  source: string;
  title: string;
  opportunityType: OpportunityTypeV2;
  domainTags: string[];
  activityTags: string[];
  populationTags: string[];
  applicantTypes: string[];
  geographyRestrictions: string[];
  geographyScope: GeoScope;
  complexityBand: ComplexityBand;
  fundingBand: FundingBand;
  fundingMin: number | null;
  fundingMax: number | null;
  status: "open" | "forecasted" | "closed" | "unknown";
  closeDate: string | null;
  rawEligibilityText: string | null;
  rawSourceFields: NormalizedOpportunity;
}

// ─── Scoring Output ───────────────────────────────────────────────────────────

// Hybrid (Final V2) dimension shape — unified score, sub-signals for trace
export interface HybridDimensions {
  missionDomain: number;   // max 25 — 60% V1 keyword + 40% V2 taxonomy
  eligibility: number;     // max 20 — max(V1, V2 eligibility)
  orgTypeFit: number;      // max 12 — V2 org-type classifier, scaled
  activityFit: number;     // max 10 — V2 activity tags, scaled
  geographyFit: number;    // max 10 — 50% V1 geo text + 50% V2 scope
  capacityFit: number;     // max 10 — V2 capacity/complexity
  fundingFit: number;      // max  8 — 50% V1 realism + 50% V2 band fit
  populationFit: number;   // max  5 — V2 population tags, scaled
}

export const HYBRID_DIMENSION_MAXES: Record<keyof HybridDimensions, number> = {
  missionDomain: 25,
  eligibility: 20,
  orgTypeFit: 12,
  activityFit: 10,
  geographyFit: 10,
  capacityFit: 10,
  fundingFit: 8,
  populationFit: 5,
};

export interface HybridSubSignals {
  v1KeywordScore: number;     // raw V1 mission overlap (0–60)
  v2DomainScore: number;      // raw V2 taxonomy domain (0–20)
  v1EligibilityScore: number; // raw V1 eligibility (0–20)
  v2EligibilityScore: number; // raw V2 eligibility (0–20)
  v1GeoScore: number;         // raw V1 geo (0–10)
  v2GeoScore: number;         // raw V2 geo (0–10)
  v1FundingScore: number;     // raw V1 funding (0–5)
  v2FundingScore: number;     // raw V2 funding (0–5)
  v1MaturityScore: number;    // raw V1 maturity (0–5)
}

export interface HybridScoreTrace {
  org: OrgProfile;
  opp: NormalizedOpportunity;
  orgProfile: V2OrgProfile;
  oppProfile: V2OppProfile;
  passes_eligibility: boolean;
  eligibility_reason: string;
  dimensions: HybridDimensions;
  subSignals: HybridSubSignals;
  baseScore: number;        // sum of dimensions
  semanticBoost: number;    // V2 multi-signal boost
  maturityBoost: number;    // V1 years-in-operation bonus
  penalties: V2Penalty[];
  penaltyTotal: number;
  finalScore: number;       // capped 0–100
  reasons: string[];
  risks: string[];
  audit_trace: string[];
}

export interface V2ScoreDimensions {
  eligibilityFit: number;       // max 20
  domainFit: number;            // max 20
  activityFit: number;          // max 15
  populationFit: number;        // max 10
  geographyFit: number;         // max 10
  organizationTypeFit: number;  // max 10
  capacityFit: number;          // max 10
  fundingFit: number;           // max 5
}

export interface V2Penalty {
  type: string;
  value: number;
  reason: string;
}

export interface V2ScoreTrace {
  org: OrgProfile;
  opp: NormalizedOpportunity;
  orgProfile: V2OrgProfile;
  oppProfile: V2OppProfile;
  passes_eligibility: boolean;
  eligibility_reason: string;
  dimensions: V2ScoreDimensions;
  baseScore: number;
  semanticBoost: number;
  penalties: V2Penalty[];
  penaltyTotal: number;
  finalScore: number;
  reasons: string[];
  risks: string[];
  audit_trace: string[];
}
