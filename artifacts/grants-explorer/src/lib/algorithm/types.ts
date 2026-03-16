// ─── Organization Profile ───────────────────────────────────────────────────

export type OrgType = "nonprofit" | "small_business" | "university" | "government" | "individual" | "other";

export interface OrgProfile {
  id: string;
  name: string;
  org_type: OrgType;
  mission: string;
  program_areas: string[];
  population_served: string[];
  geography: string[];
  annual_budget: number;
  years_in_operation: number;
  has_501c3: boolean;
  is_small_business: boolean;
  keywords: string[];
}

// ─── Normalized Opportunity ──────────────────────────────────────────────────

export type FundingType =
  | "grant"
  | "contract"
  | "cooperative_agreement"
  | "loan"
  | "procurement"
  | "fellowship"
  | "other";

export type OpportunityStatus = "active" | "forecasted" | "closed" | "archived";

export interface NormalizedOpportunity {
  id: string;
  source: string;
  source_raw: string;
  title: string;
  description: string;
  agency: string;
  funding_type: FundingType;
  status: OpportunityStatus;
  open_date?: string;
  close_date?: string;
  min_award?: number;
  max_award?: number;
  eligibility: string[];
  categories: string[];
  keywords: string[];
  geography: string[];
  url: string;
}

// ─── Match Result ────────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  mission_topic_fit: number;   // max 35
  eligibility_fit: number;     // max 25
  geography_fit: number;       // max 15
  funding_size_fit: number;    // max 15
  maturity_fit: number;        // max 10
  total: number;               // max 100
}

export interface MatchResult {
  opportunity: NormalizedOpportunity;
  score: ScoreBreakdown;
  passes_eligibility: boolean;
  reasons: string[];
  risks: string[];
}

// ─── Source Config ────────────────────────────────────────────────────────────

export type SourceStatus = "active" | "excluded";

export interface SourceConfig {
  id: string;
  name: string;
  category: string;
  status: SourceStatus;
  exclusion_reason?: string;
  record_count?: number;
}
