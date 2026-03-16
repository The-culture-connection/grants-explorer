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
