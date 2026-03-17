/**
 * matcherV4.ts — Consolidated V4 Matching Engine
 *
 * Single-file, source-aware engine that fixes and extends V3:
 *
 *   V3 ISSUE                              V4 FIX
 *   ──────────────────────────────────    ──────────────────────────────────────
 *   Logic spread across 4+ files          Everything consolidated here
 *   Source-blind scoring                  Per-source modifier layer (±15 pts)
 *   No temporal signal                    Recency boost for newly posted opps
 *   Top-K can be all one source           Source-diversity cap in ranking
 *   Static phrase list (80 phrases)       Extended to 140+ phrases
 *   Geography: state matching weak        Explicit US state alias table
 *   Funding fit: binary penalty only      Smooth fit curve (5 zones)
 *   No confidence tier output             score → Excellent/Strong/Moderate/Weak
 *
 * Score structure (base = 100):
 *   conceptFit          26  — phrase-priority + domain overlap
 *   conceptCentrality   10  — title + opening-text concept presence
 *   activityFit         10  — activity/model tag alignment
 *   populationFit        8  — specificity-weighted population match
 *   targetApplicantFit  12  — intended-recipient classification
 *   eligibility         10  — strict pass/fail gate
 *   geographyFit         8  — improved state matching
 *   capacityFit          7  — complexity vs org band
 *   fundingFit           6  — smooth fit curve
 *   sourceRelevance      3  — per-source bonus (NEW)
 *   ─────────────────────
 *   base               100
 *   + semanticBoost     max +8
 *   + recencyBoost      max +3  (NEW)
 *   − genericity        0–15
 *   − weakSpec          0–8
 *   − targetMismatch    0–10
 *   − populationMismatch 0–6
 *   − complexityMismatch 0–10
 *   − sourceBarrier     0–15  (NEW — for cross-border/procurement)
 *   = finalScore   capped 0–100
 */

import type { OrgProfile, NormalizedOpportunity } from "@/lib/algorithm/types";
import { buildOrganizationProfile } from "@/lib/v2/orgProfile";
import { buildOpportunityProfile } from "@/lib/v2/oppProfile";
import type { V2OrgProfile, V2OppProfile } from "@/lib/v2/types";
import {
  scoreActivityFitV2,
  scoreGeographyFitV2,
  scoreCapacityFitV2,
  scoreFundingFitV2,
  computeSemanticBoostV2,
} from "@/lib/v2/scoring";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConfidenceTier = "excellent" | "strong" | "moderate" | "weak" | "ineligible";

export interface V4Penalty {
  type: string;
  value: number;
  reason: string;
}

export interface V4Dimensions {
  conceptFit: number;         // max 26
  conceptCentrality: number;  // max 10
  activityFit: number;        // max 10
  populationFit: number;      // max 8
  targetApplicantFit: number; // max 12
  eligibility: number;        // max 10
  geographyFit: number;       // max 8
  capacityFit: number;        // max 7
  fundingFit: number;         // max 6
  sourceRelevance: number;    // max 3
}

export interface V4ScoreTrace {
  org: OrgProfile;
  opp: NormalizedOpportunity;
  /** Internal derived profiles — exposed for audit/sweep analytics */
  orgProfile: V2OrgProfile;
  oppProfile: V2OppProfile;

  passes_eligibility: boolean;
  eligibility_reason: string;

  dimensions: V4Dimensions;

  exactPhraseMatches: string[];
  highValueConcepts: string[];
  specificityRatio: number;
  targetApplicantInferred: string;
  populationMatches: string[];

  baseScore: number;
  semanticBoost: number;
  recencyBoost: number;
  penalties: V4Penalty[];
  penaltyTotal: number;
  finalScore: number;

  confidence: ConfidenceTier;
  reasons: string[];
  risks: string[];
  audit_trace: string[];
}

// ─── Generic Terms ────────────────────────────────────────────────────────────

const GENERIC_TERMS = new Set([
  "health", "community", "support", "outcomes", "improve", "innovation",
  "services", "equity", "development", "research", "program", "project",
  "initiative", "work", "provide", "need", "build", "help", "service",
  "data", "fund", "grant", "award", "capacity", "impact", "resource",
  "local", "national", "public", "access", "benefit", "plan", "system",
  "organization", "address", "population", "underserved", "diverse",
  "strengthen", "increase", "reduce", "partner", "engage", "promote",
  "activity", "opportunity", "challenge", "solution", "approach",
  "strategy", "model", "framework", "outcome", "result", "goal",
  "technology", "platform", "digital", "tools", "education", "training",
]);

// ─── High-Value Concept Phrases (extended to 140+) ───────────────────────────

const HIGH_VALUE_PHRASES: string[] = [
  // Maternal / reproductive health
  "black maternal health", "maternal mortality", "maternal morbidity",
  "maternal health", "birth equity", "reproductive health", "birth outcomes",
  "prenatal care", "postpartum care", "obstetric care", "midwifery",
  "perinatal health", "neonatal health", "infant mortality",
  "pregnancy outcomes", "pregnant people", "pregnant women",
  "family planning", "reproductive justice", "doula services",
  // Racial equity & specific populations
  "racial equity", "racial justice", "health disparities", "health inequities",
  "social determinants", "structural racism", "implicit bias",
  "black women", "black youth", "black communities", "black men",
  "indigenous peoples", "native communities", "tribal nations",
  "latino communities", "asian american", "pacific islander",
  "hbcu", "minority serving institution", "minority owned",
  "first generation", "english learner", "immigrant communities",
  // Specific health domains
  "mental health", "behavioral health", "substance use disorder",
  "opioid crisis", "addiction treatment", "recovery support",
  "trauma informed", "violence prevention", "domestic violence",
  "sexual assault", "gun violence", "community violence",
  "suicide prevention", "crisis intervention", "peer support",
  "chronic disease", "diabetes prevention", "cancer screening",
  "hiv prevention", "tuberculosis", "infectious disease",
  "oral health", "dental care", "vision care",
  "food insecurity", "food security", "hunger relief", "food desert",
  "disability services", "independent living", "assistive technology",
  "veteran health", "veteran services", "veteran housing",
  // Workforce / economic
  "workforce development", "job training", "career pathway",
  "workforce training", "career development", "job placement",
  "apprenticeship program", "work readiness", "economic mobility",
  "small business development", "entrepreneurship training",
  "microenterprise", "minority business", "women owned business",
  "women entrepreneurs", "startup funding", "seed capital",
  "angel investment", "venture capital", "business incubator",
  // Housing / community
  "affordable housing", "housing instability", "housing insecurity",
  "homelessness prevention", "transitional housing", "permanent supportive housing",
  "community development", "neighborhood revitalization", "community land trust",
  "financial literacy", "asset building", "wealth building",
  "community reinvestment", "place-based investment",
  // Environment / energy
  "clean energy", "renewable energy", "energy efficiency",
  "climate resilience", "climate adaptation", "climate justice",
  "environmental justice", "clean water", "air quality",
  "solar energy", "green infrastructure", "carbon reduction",
  "carbon emissions", "carbon footprint", "sustainable technology",
  "water sanitation", "water access", "drinking water",
  "agricultural technology", "precision agriculture", "sustainable agriculture",
  "food systems", "local food", "farm to table",
  // Education
  "early childhood education", "early learning", "school readiness",
  "literacy program", "adult literacy", "college access", "college readiness",
  "stem education", "afterschool program", "summer learning",
  "special education", "inclusive education", "arts education",
  "digital learning", "edtech", "learning platform",
  "coding education", "computer science education",
  // Public health systems
  "public health workforce", "community health worker", "health navigator",
  "community health center", "federally qualified health center",
  "rural health", "telehealth", "telemedicine", "health equity",
  // Technology / innovation
  "digital equity", "digital inclusion", "broadband access",
  "technology access", "data privacy", "cybersecurity",
  "government technology", "civic technology", "open data",
  "data infrastructure", "artificial intelligence", "machine learning",
  // Justice / legal
  "criminal justice reform", "reentry services", "legal aid",
  "civil rights", "voting rights", "immigration services",
  "refugee resettlement", "asylum seekers",
  "legal services", "public defender", "access to justice",
  // Transportation / infrastructure
  "public transit", "transportation equity", "mobility access",
  "transit-oriented development", "active transportation",
  // Arts / culture
  "arts education", "cultural programs", "creative economy",
  "performing arts", "visual arts", "public art",
  // International development / disaster
  "humanitarian aid", "disaster relief", "disaster recovery",
  "international development", "global health", "global development",
  "conflict affected", "fragile states", "emergency response",
];

// ─── US State Geography Aliases ───────────────────────────────────────────────

const US_STATE_ALIASES: Record<string, string[]> = {
  "california": ["ca", "california"],
  "texas": ["tx", "texas"],
  "ohio": ["oh", "ohio"],
  "illinois": ["il", "illinois"],
  "new york": ["ny", "new york"],
  "florida": ["fl", "florida"],
  "michigan": ["mi", "michigan"],
  "pennsylvania": ["pa", "pennsylvania"],
  "georgia": ["ga", "georgia"],
  "north carolina": ["nc", "north carolina"],
  "virginia": ["va", "virginia"],
  "washington": ["wa", "washington"],
  "arizona": ["az", "arizona"],
  "colorado": ["co", "colorado"],
  "maryland": ["md", "maryland"],
  "massachusetts": ["ma", "massachusetts"],
  "minnesota": ["mn", "minnesota"],
  "midwest": ["illinois", "ohio", "michigan", "indiana", "wisconsin", "minnesota", "iowa", "missouri", "north dakota", "south dakota", "nebraska", "kansas"],
  "southeast": ["florida", "georgia", "north carolina", "south carolina", "virginia", "alabama", "mississippi", "tennessee", "kentucky"],
  "united states": ["united states", "us", "usa", "national", "nationwide"],
  "global": ["global", "international", "worldwide"],
};

// ─── Population Specificity ───────────────────────────────────────────────────

const POPULATION_SPECIFICITY: Record<string, number> = {
  "black women": 4, "black maternal": 4, "pregnant people": 4, "pregnant women": 4,
  "black youth": 4, "black men": 4, "black girls": 4, "black boys": 4,
  "indigenous women": 4, "native women": 4, "latina women": 4,
  "undocumented immigrants": 4, "asylum seekers": 4, "trafficking survivors": 4,
  "domestic violence survivors": 4, "formerly incarcerated": 4, "returning citizens": 4,
  "people with disabilities": 4, "people with hiv": 4, "lgbtq youth": 4,
  "transgender women": 4, "queer youth": 4, "infants and toddlers": 4, "newborns": 4,
  "black communities": 3, "african american": 3, "indigenous peoples": 3,
  "native american": 3, "latino communities": 3, "hispanic communities": 3,
  "asian american": 3, "pacific islander": 3, "refugee": 3, "immigrants": 3,
  "veterans": 3, "justice involved": 3, "homeless individuals": 3,
  "rural communities": 3, "tribal members": 3, "elderly": 3, "older adults": 3,
  "children": 3, "youth": 3, "adolescents": 3, "young people": 3,
  "survivors": 3, "caregivers": 3, "single parents": 3, "foster youth": 3,
  "farmers": 3, "small business owners": 3,
  "women": 2, "men": 2, "families": 2, "low income": 2, "low-income": 2,
  "marginalized communities": 2, "vulnerable populations": 2,
  "underserved communities": 2, "underserved populations": 2,
  "disadvantaged": 2, "minority": 2, "minorities": 2, "people of color": 2, "bipoc": 2,
  "entrepreneurs": 2, "startups": 2, "businesses": 2, "homeowners": 2,
  "students": 2, "girls": 2,
  "general public": 1, "community members": 1, "community": 1,
  "residents": 1, "individuals": 1, "all": 1,
  "public agencies": 1, "municipalities": 1, "urban communities": 1,
};

// ─── Source-Specific Scoring Table ───────────────────────────────────────────
// [bonus for compatible org classes, penalty for incompatible]

const SOURCE_MODIFIERS: Record<string, {
  bonus_classes: string[];
  bonus: number;
  penalty_classes: string[];
  penalty: number;
  penalty_reason: string;
}> = {
  sbir: {
    bonus_classes: ["small_business", "contractor"],
    bonus: 6,
    penalty_classes: ["nonprofit", "university", "government", "international_ngo"],
    penalty: 12,
    penalty_reason: "SBIR/STTR is exclusively for small businesses — nonprofits and universities are not eligible",
  },
  sam_gov: {
    bonus_classes: ["small_business", "contractor", "government"],
    bonus: 3,
    penalty_classes: ["nonprofit", "university", "international_ngo"],
    penalty: 8,
    penalty_reason: "SAM.gov primarily lists federal procurement contracts requiring SAM registration and past performance",
  },
  ted_eu: {
    bonus_classes: ["contractor", "small_business", "international_ngo"],
    bonus: 2,
    penalty_classes: ["nonprofit", "government", "tribal"],
    penalty: 10,
    penalty_reason: "EU procurement requires EU business registration or local EU partner",
  },
  world_bank: {
    bonus_classes: ["international_ngo", "university", "contractor"],
    bonus: 4,
    penalty_classes: ["nonprofit", "tribal"],
    penalty: 5,
    penalty_reason: "World Bank procurement typically requires international operations capability",
  },
  threesixtygiving: {
    bonus_classes: ["international_ngo", "university", "nonprofit"],
    bonus: 2,
    penalty_classes: ["small_business", "contractor"],
    penalty: 6,
    penalty_reason: "360Giving / UKRI awards philanthropic grants primarily to nonprofits and academic institutions",
  },
  california_grants: {
    bonus_classes: [],
    bonus: 0,
    penalty_classes: [],
    penalty: 0,
    penalty_reason: "",
  },
  simpler_grants: {
    bonus_classes: ["nonprofit", "university", "government", "tribal"],
    bonus: 2,
    penalty_classes: [],
    penalty: 0,
    penalty_reason: "",
  },
  grants_gov: {
    bonus_classes: ["nonprofit", "university", "government", "tribal", "research_institution"],
    bonus: 2,
    penalty_classes: [],
    penalty: 0,
    penalty_reason: "",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function extractPhrases(text: string): string[] {
  const norm = normText(text);
  return HIGH_VALUE_PHRASES.filter(p => norm.includes(p));
}

function detectExactMatches(orgPhrases: string[], oppPhrases: string[]): string[] {
  const oppSet = new Set(oppPhrases);
  return orgPhrases.filter(p => oppSet.has(p));
}

function normalizePopTags(text: string): string[] {
  const norm = normText(text);
  const found: string[] = [];
  for (const tag of Object.keys(POPULATION_SPECIFICITY)) {
    if (norm.includes(tag)) found.push(tag);
  }
  // Remove subsumed tags (e.g. remove "youth" if "black youth" already matched)
  return found.filter(t =>
    !found.some(other => other !== t && other.includes(t) && other.length > t.length)
  );
}

// ─── Geography Fit (V4) — max 8 ───────────────────────────────────────────────

function scoreGeographyV4(org: OrgProfile, oppGeo: string[]): number {
  const orgGeoNorm = org.geography.map(g => normText(g));
  const oppGeoNorm = oppGeo.map(g => normText(g));

  if (oppGeoNorm.length === 0) return 5; // No constraint

  const oppGeoStr = oppGeoNorm.join(" ");

  // Global/international = partial credit for all
  if (oppGeoStr.includes("global") || oppGeoStr.includes("international")) return 5;

  // National US
  if (
    oppGeoStr.includes("united states") || oppGeoStr.includes("national") ||
    oppGeoStr.includes("nationwide") || oppGeoStr === "us" || oppGeoStr === "usa"
  ) {
    const orgInUS = orgGeoNorm.some(g =>
      g.includes("united states") || g === "us" || g === "usa" || g === "national" || g === "nationwide"
    );
    if (orgInUS) return 8;
    // Check state aliases — if org is a US state it's still in the US
    const orgHasUSState = orgGeoNorm.some(g =>
      Object.keys(US_STATE_ALIASES).some(state => g.includes(state) || state.includes(g))
    );
    if (orgHasUSState) return 8;
    return 2;
  }

  // State-level: check if org geography overlaps with opp geography
  for (const orgG of orgGeoNorm) {
    for (const oppG of oppGeoNorm) {
      if (orgG.includes(oppG) || oppG.includes(orgG)) return 8;
      // Alias expansion
      const orgAliases = US_STATE_ALIASES[orgG] ?? [orgG];
      const oppAliases = US_STATE_ALIASES[oppG] ?? [oppG];
      if (orgAliases.some(a => oppAliases.includes(a))) return 8;
      // Regional: midwest, southeast etc.
      for (const [region, states] of Object.entries(US_STATE_ALIASES)) {
        if ((orgG.includes(region) || region === orgG) && states.some(s => oppG.includes(s) || s.includes(oppG))) return 6;
        if ((oppG.includes(region) || region === oppG) && states.some(s => orgG.includes(s) || s.includes(orgG))) return 6;
      }
    }
  }

  return 0;
}

// ─── Funding Fit V4 (smooth 5-zone curve) — max 6 ───────────────────────────

function scoreFundingV4(org: OrgProfile, minAward?: number, maxAward?: number): { score: number; reason: string } {
  if (maxAward == null && minAward == null) return { score: 3, reason: "Award range unknown" };
  const budget = org.annual_budget;
  if (!budget || budget <= 0) return { score: 3, reason: "Org budget unknown" };

  const max = maxAward ?? minAward!;
  const min = minAward ?? 0;

  // Zone 1 — ideal: 10%–300% of annual budget
  if (max >= budget * 0.10 && min <= budget * 3.0) return { score: 6, reason: "Award range is ideal for org budget" };
  // Zone 2 — acceptable: 5%–500%
  if (max >= budget * 0.05 && min <= budget * 5.0) return { score: 4, reason: "Award range is acceptable for org budget" };
  // Zone 3 — too small: max < 5% of budget
  if (max < budget * 0.05) return { score: 2, reason: "Award too small relative to org overhead" };
  // Zone 4 — too large but reachable: 500%–1000%
  if (min <= budget * 10.0) return { score: 3, reason: "Award at high end — capacity risk" };
  // Zone 5 — far out of range
  return { score: 1, reason: "Award far exceeds org management capacity" };
}

// ─── Eligibility Gate (V4) — max 10, binary pass/fail ────────────────────────

function checkEligibilityV4(orgClass: string, has501c3: boolean, isSmallBusiness: boolean, applicantTypes: string[]): {
  passes: boolean;
  score: number;
  reason: string;
  failReason?: string;
} {
  if (applicantTypes.length === 0) {
    return { passes: true, score: 6, reason: "No eligibility constraints — all applicant types permitted" };
  }

  const types = applicantTypes;

  // 501c3 required
  if (types.includes("501c3") && !has501c3) {
    if (!["government", "university", "tribal"].includes(orgClass)) {
      return { passes: false, score: 0, reason: "501(c)(3) required — org does not have it", failReason: "501c3_required" };
    }
  }

  // Small-business-only
  const sbOnly = types.length > 0 && types.every(t => ["small_business", "for_profit", "8a_certified", "hubzone", "sdvosb"].includes(t));
  if (sbOnly && !isSmallBusiness && !["small_business", "contractor"].includes(orgClass)) {
    return { passes: false, score: 0, reason: "Small-business-only opportunity; org is not a small business", failReason: "small_business_only" };
  }

  // Nonprofit-only
  const nonprofitOnly = types.some(t => ["nonprofit", "501c3", "community_based_org", "community_org", "ngo"].includes(t));
  const excludesForProfit = !types.some(t => ["for_profit", "small_business", "all"].includes(t));
  if (nonprofitOnly && excludesForProfit) {
    if (!["nonprofit", "tribal", "research_institution", "university", "international_ngo"].includes(orgClass)) {
      return { passes: false, score: 0, reason: `Nonprofit-only; org class is "${orgClass}"`, failReason: "nonprofit_only" };
    }
  }

  // Government-only
  const govOnly = types.length > 0 && types.every(t => ["government", "public_agency", "state_government", "local_government", "federal_agency"].includes(t));
  if (govOnly && !["government", "tribal"].includes(orgClass)) {
    return { passes: false, score: 0, reason: "Government-only opportunity; org is not a government entity", failReason: "government_only" };
  }

  // Org class satisfies requirement
  const ORG_SATISFIES: Record<string, string[]> = {
    nonprofit: ["nonprofit", "501c3", "community_based_org", "community_org", "ngo", "charity", "foundation", "nonprofit_organization", "community_nonprofit", "health_center"],
    small_business: ["small_business", "for_profit", "8a_certified", "minority_owned", "woman_owned", "disadvantaged_business", "hubzone", "veteran_owned"],
    university: ["university", "higher_education", "academic_institution", "nonprofit", "educational_institution", "college", "hbcu", "msi"],
    government: ["government", "public_agency", "local_government", "state_government", "tribal_government", "federal_agency", "municipal"],
    tribal: ["tribal", "tribal_government", "native_american", "alaska_native", "nonprofit", "government", "tribal_college"],
    research_institution: ["nonprofit", "university", "research_institution", "higher_education", "academic"],
    contractor: ["small_business", "for_profit", "8a_certified", "minority_owned", "veteran_owned"],
    international_ngo: ["nonprofit", "international", "ngo", "international_ngo", "nonprofit_organization"],
    other: ["all"],
  };

  const openToAll = types.includes("all");
  if (openToAll) return { passes: true, score: 8, reason: "Open to all applicant types" };

  const allowed = ORG_SATISFIES[orgClass] ?? [];
  const exactMatch = allowed.some(a => types.includes(a));
  if (exactMatch) {
    let score = 8;
    if (has501c3 && types.includes("501c3")) score = 10;
    else if (isSmallBusiness && types.some(t => ["small_business", "for_profit"].includes(t))) score = 9;
    return { passes: true, score: Math.min(10, score), reason: `"${orgClass}" satisfies eligibility requirement` };
  }

  return { passes: true, score: 5, reason: `"${orgClass}" not explicitly listed but not excluded; partial eligibility` };
}

// ─── Target Applicant Fit (V4) — max 12 ──────────────────────────────────────

function computeTargetApplicantV4(orgClass: string, oppType: string, oppText: string): {
  score: number;
  inferred: string;
  mismatchPenalty: number;
  mismatchReason: string;
} {
  const text = oppText.toLowerCase();

  // Infer intended applicant
  let intended = "open";
  if (text.includes("hbcu") || text.includes("historically black college")) intended = "hbcu_institution";
  else if (text.includes("tribal college") || text.includes("tribal nation") || text.includes("native american")) intended = "tribal";
  else if (oppType === "procurement_contract" || text.includes("vendor") || text.includes("contractor") || text.includes("solicitation") || text.includes("rfp") || text.includes("rfq")) intended = "contractor";
  else if (text.includes("government agency") || text.includes("public agency") || text.includes("local government") || text.includes("municipal")) intended = "government";
  else if (text.includes("small business") || text.includes("startup") || text.includes("entrepreneur") || text.includes("for-profit")) intended = "small_business";
  else if (text.includes("university") || text.includes("college") || text.includes("higher education") || text.includes("principal investigator") || oppType === "research_grant") intended = "research_university";
  else if (text.includes("community nonprofit") || text.includes("community-based") || text.includes("nonprofit organization") || text.includes("501(c)(3)") || text.includes("community organization")) intended = "community_nonprofit";
  else if (text.includes("healthcare provider") || text.includes("health center") || text.includes("hospital") || text.includes("clinic") || text.includes("federally qualified")) intended = "healthcare_provider";
  else if (text.includes("nonprofit") || text.includes("ngo") || text.includes("charity") || text.includes("foundation")) intended = "nonprofit";

  // Procurement barrier (most restrictive)
  if (oppType === "procurement_contract" && !["contractor", "small_business", "government"].includes(orgClass)) {
    return { score: 3, inferred: "contractor", mismatchPenalty: 10, mismatchReason: "Procurement requires SAM registration, past-performance documentation, and contractor experience" };
  }

  // Research grant for non-academic
  if (oppType === "research_grant" && !["university", "research_institution"].includes(orgClass)) {
    const penalty = orgClass === "nonprofit" ? 5 : 8;
    const score = orgClass === "nonprofit" ? 5 : 3;
    return { score, inferred: "research_university", mismatchPenalty: penalty, mismatchReason: "Research grants typically require PI credentials, IRB, and academic infrastructure" };
  }

  const COMPAT: Record<string, string[]> = {
    community_nonprofit: ["nonprofit", "tribal", "international_ngo"],
    nonprofit: ["nonprofit", "tribal", "research_institution", "university", "international_ngo"],
    research_university: ["university", "research_institution"],
    hbcu_institution: ["university", "research_institution"],
    contractor: ["contractor", "small_business"],
    government: ["government", "tribal"],
    small_business: ["small_business", "contractor"],
    healthcare_provider: ["nonprofit", "government", "university"],
    tribal: ["tribal", "nonprofit", "government"],
    open: ["nonprofit", "small_business", "university", "government", "tribal", "research_institution", "contractor", "international_ngo", "other"],
  };

  const POOR_FIT: Record<string, string[]> = {
    research_university: ["nonprofit", "small_business", "contractor"],
    hbcu_institution: ["nonprofit", "small_business", "contractor", "government"],
    contractor: ["nonprofit", "university", "research_institution", "international_ngo"],
    government: ["nonprofit", "small_business", "contractor", "research_institution"],
    small_business: ["nonprofit", "university", "government", "research_institution"],
    community_nonprofit: ["contractor", "government", "small_business"],
  };

  const compat = COMPAT[intended] ?? COMPAT["open"];
  const poorFit = POOR_FIT[intended] ?? [];
  const isGoodFit = compat.includes(orgClass);
  const isPoorFit = poorFit.includes(orgClass);

  if (isGoodFit) {
    let score = intended === "community_nonprofit" && orgClass === "nonprofit" ? 12
                : intended === "open" ? 8
                : 10;
    return { score: Math.min(12, score), inferred: intended, mismatchPenalty: 0, mismatchReason: "" };
  }
  if (isPoorFit) {
    return { score: 3, inferred: intended, mismatchPenalty: 8, mismatchReason: `Opportunity designed for "${intended.replace(/_/g, " ")}" — org type may not be competitive` };
  }
  return { score: 6, inferred: intended, mismatchPenalty: 0, mismatchReason: "" };
}

// ─── Recency Boost — max +3 (NEW in V4) ──────────────────────────────────────

function computeRecencyBoost(openDate?: string): number {
  if (!openDate) return 0;
  const msAgo = Date.now() - new Date(openDate).getTime();
  const daysAgo = msAgo / (1000 * 60 * 60 * 24);
  if (daysAgo <= 14) return 3;
  if (daysAgo <= 30) return 2;
  if (daysAgo <= 60) return 1;
  return 0;
}

// ─── Source Relevance Score — max 3 (NEW in V4) ──────────────────────────────

function computeSourceRelevance(sourceKey: string, orgClass: string): { score: number; modifier?: V4Penalty } {
  const mod = SOURCE_MODIFIERS[sourceKey];
  if (!mod) return { score: 1 }; // Neutral for unknown source

  if (mod.bonus_classes.includes(orgClass)) {
    return { score: 3 };
  }
  // No penalty here — source barrier is handled in the penalty block
  return { score: 1 };
}

// ─── Source Barrier Penalty (NEW in V4) ──────────────────────────────────────

function computeSourceBarrierPenalty(sourceKey: string, orgClass: string): V4Penalty | null {
  const mod = SOURCE_MODIFIERS[sourceKey];
  if (!mod || mod.penalty <= 0) return null;
  if (!mod.penalty_classes.includes(orgClass)) return null;
  return { type: "source_barrier", value: mod.penalty, reason: mod.penalty_reason };
}

// ─── Main Scorer ──────────────────────────────────────────────────────────────

export function scoreMatchV4(org: OrgProfile, opp: NormalizedOpportunity): V4ScoreTrace {
  const orgProfile = buildOrganizationProfile(org);
  const oppProfile = buildOpportunityProfile(opp);
  const trace: string[] = [];

  // Normalize source key
  const sourceKey = opp.source.toLowerCase().replace(/[^a-z0-9]/g, "_");

  // ── Strict Eligibility Gate ────────────────────────────────────────────────
  const elig = checkEligibilityV4(orgProfile.orgClass, orgProfile.has501c3 ?? false, orgProfile.isSmallBusiness ?? false, oppProfile.applicantTypes);
  trace.push(`[Eligibility] ${elig.passes ? "PASSED" : "FAILED"} ${elig.score}/10 — ${elig.reason}`);

  if (!elig.passes) {
    return {
      org, opp,
      orgProfile, oppProfile,
      passes_eligibility: false,
      eligibility_reason: elig.reason,
      dimensions: { conceptFit: 0, conceptCentrality: 0, activityFit: 0, populationFit: 0, targetApplicantFit: 0, eligibility: 0, geographyFit: 0, capacityFit: 0, fundingFit: 0, sourceRelevance: 0 },
      exactPhraseMatches: [], highValueConcepts: [], specificityRatio: 0,
      targetApplicantInferred: "unknown", populationMatches: [],
      baseScore: 0, semanticBoost: 0, recencyBoost: 0,
      penalties: [{ type: elig.failReason ?? "ineligible", value: 0, reason: elig.reason }],
      penaltyTotal: 0, finalScore: 0, confidence: "ineligible",
      reasons: [], risks: [elig.reason], audit_trace: trace,
    };
  }

  // ── 1. Concept Fit (phrase priority) — max 26 ──────────────────────────────
  const oppFullText = [opp.title, opp.description, ...opp.keywords, ...opp.categories].join(" ");
  const orgFullText = [org.mission, ...org.keywords, ...org.program_areas].join(" ");

  const oppPhrases = extractPhrases(oppFullText);
  const orgPhrases = extractPhrases(orgFullText);
  const exactMatches = detectExactMatches(orgPhrases, oppPhrases);

  // Domain tag overlap from V2 profiles
  const orgDomains = new Set(orgProfile.sectorTags);
  const oppDomains = new Set(oppProfile.domainTags);
  const domainOverlap = [...orgDomains].filter(d => oppDomains.has(d));

  // Specificity ratio
  const oppTokens = normText(opp.title + " " + opp.description).split(" ").filter(t => t.length > 2);
  const orgTokenSet = new Set(normText(orgFullText).split(" "));
  const matchedTokens = oppTokens.filter(t => orgTokenSet.has(t));
  const specificMatched = matchedTokens.filter(t => !GENERIC_TERMS.has(t) && t.length > 3);
  const specificityRatio = matchedTokens.length > 0 ? specificMatched.length / matchedTokens.length : 0;

  let conceptFitScore = 0;
  if (exactMatches.length >= 3) conceptFitScore += 18;
  else if (exactMatches.length === 2) conceptFitScore += 14;
  else if (exactMatches.length === 1) conceptFitScore += 9;
  else if (orgPhrases.length > 0 && oppPhrases.length > 0) conceptFitScore += 3;

  if (domainOverlap.length >= 3) conceptFitScore += 8;
  else if (domainOverlap.length === 2) conceptFitScore += 5;
  else if (domainOverlap.length === 1) conceptFitScore += 3;

  if (exactMatches.length === 0 && specificityRatio < 0.3 && conceptFitScore > 3) {
    conceptFitScore = Math.max(0, conceptFitScore - 3);
  }

  const conceptFit = Math.min(26, conceptFitScore);
  trace.push(`[Concept Fit] ${conceptFit}/26 — ${exactMatches.length} exact matches, ${domainOverlap.length} domain overlaps | specificity ${(specificityRatio * 100).toFixed(0)}%`);

  // ── 2. Concept Centrality — max 10 ────────────────────────────────────────
  const titleNorm = normText(opp.title);
  const titlePhrases = extractPhrases(opp.title);
  const titleMatches = detectExactMatches(orgPhrases, titlePhrases);

  let titleMatchBonus = 0;
  let repeatedConceptBonus = 0;

  if (titleMatches.length >= 2) titleMatchBonus = 5;
  else if (titleMatches.length === 1) titleMatchBonus = 4;
  else if (orgProfile.sectorTags.some(t => titleNorm.includes(t))) titleMatchBonus = 2;

  const openingText = normText(opp.description.slice(0, 350));
  const openingMatches = detectExactMatches(orgPhrases, extractPhrases(openingText));
  if (openingMatches.length >= 2) repeatedConceptBonus = 4;
  else if (openingMatches.length === 1) repeatedConceptBonus = 2;

  if (orgPhrases.length > 0) {
    const phrase = orgPhrases[0];
    const count = (normText(opp.description).match(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
    if (count >= 3) repeatedConceptBonus = Math.max(repeatedConceptBonus, 3);
  }

  const conceptCentrality = Math.min(10, titleMatchBonus + repeatedConceptBonus);
  trace.push(`[Concept Centrality] ${conceptCentrality}/10 — title +${titleMatchBonus}, repeated +${repeatedConceptBonus}`);

  // ── 3. Activity Fit — max 10 ───────────────────────────────────────────────
  const actResult = scoreActivityFitV2(orgProfile, oppProfile);
  const activityFit = Math.min(10, actResult.score);
  trace.push(`[Activity Fit] ${activityFit}/10 — ${actResult.reason}`);

  // ── 4. Population Fit — max 8 ─────────────────────────────────────────────
  const orgPopText = [org.mission, ...org.population_served].join(" ");
  const oppPopText = [opp.title, opp.description.slice(0, 500)].join(" ");
  const orgPops = normalizePopTags(orgPopText);
  const oppPops = normalizePopTags(oppPopText);
  let populationFit = 2;
  let populationMatches: string[] = [];

  if (orgPops.length > 0 && oppPops.length > 0) {
    const orgSet = new Set(orgPops);
    const matches = oppPops.filter(p => orgSet.has(p));
    populationMatches = matches;
    if (matches.length > 0) {
      const maxSpec = Math.max(...matches.map(m => POPULATION_SPECIFICITY[m] ?? 1));
      if (maxSpec === 4) populationFit = matches.length >= 2 ? 8 : 7;
      else if (maxSpec === 3) populationFit = matches.length >= 2 ? 6 : 5;
      else if (maxSpec === 2) populationFit = matches.length >= 2 ? 4 : 3;
      else populationFit = 2;
    } else {
      const hasPartial = orgPops.some(op => oppPops.some(pp => op.includes(pp) || pp.includes(op)));
      populationFit = hasPartial ? 3 : 1;
    }
  } else {
    // Fall back to V2 tag overlap
    const popOverlap = orgProfile.populationTags.filter(p => (oppProfile.populationTags as string[]).includes(p));
    populationFit = popOverlap.length > 0 ? 4 : 2;
  }
  trace.push(`[Population Fit] ${populationFit}/8 — matches: ${populationMatches.join(", ") || "none"}`);

  // ── 5. Target Applicant Fit — max 12 ──────────────────────────────────────
  const oppTargetText = [opp.title, opp.description, ...opp.eligibility].join(" ");
  const taResult = computeTargetApplicantV4(orgProfile.orgClass, oppProfile.opportunityType, oppTargetText);
  const targetApplicantFit = Math.min(12, taResult.score);
  trace.push(`[Target Applicant] ${targetApplicantFit}/12 — inferred: "${taResult.inferred}"`);

  // ── 6. Geography Fit — max 8 (improved state matching) ────────────────────
  const geographyFit = scoreGeographyV4(org, opp.geography);
  trace.push(`[Geography] ${geographyFit}/8`);

  // ── 7. Capacity Fit — max 7 ───────────────────────────────────────────────
  const capResult = scoreCapacityFitV2(orgProfile, oppProfile);
  const capRaw = orgProfile.capacityBand === "unknown" || oppProfile.complexityBand === "unknown" ? 4 : capResult.score;
  const capacityFit = Math.round((capRaw / 10) * 7);
  trace.push(`[Capacity] ${capacityFit}/7 — ${capResult.reason}`);

  // ── 8. Funding Fit — max 6 (smooth curve) ─────────────────────────────────
  const fundV4 = scoreFundingV4(org, opp.min_award, opp.max_award);
  const fundingFit = fundV4.score;
  trace.push(`[Funding] ${fundingFit}/6 — ${fundV4.reason}`);

  // ── 9. Source Relevance — max 3 (NEW) ─────────────────────────────────────
  const srcRel = computeSourceRelevance(sourceKey, orgProfile.orgClass);
  const sourceRelevance = srcRel.score;
  trace.push(`[Source Relevance] ${sourceRelevance}/3 — source: ${opp.source}`);

  const dimensions: V4Dimensions = {
    conceptFit, conceptCentrality, activityFit, populationFit,
    targetApplicantFit, eligibility: elig.score, geographyFit,
    capacityFit, fundingFit, sourceRelevance,
  };

  const baseScore = Object.values(dimensions).reduce((s, v) => s + v, 0);
  trace.push(`[Base Score] ${baseScore}/100`);

  // ── Semantic Boost — max 8 ────────────────────────────────────────────────
  const { boost: rawBoost } = computeSemanticBoostV2(orgProfile, oppProfile);
  const semanticBoost = Math.round((rawBoost / 10) * 8);
  if (semanticBoost > 0) trace.push(`[Semantic Boost] +${semanticBoost}`);

  // ── Recency Boost — max 3 (NEW) ───────────────────────────────────────────
  const recencyBoost = computeRecencyBoost(opp.open_date);
  if (recencyBoost > 0) trace.push(`[Recency Boost] +${recencyBoost} — opened recently`);

  // ── Penalty Engine ─────────────────────────────────────────────────────────
  const penalties: V4Penalty[] = [];

  // 1. Genericity penalty
  if (exactMatches.length === 0 && specificityRatio < 0.2 && baseScore > 30) {
    const genPenalty = Math.min(15, Math.round(baseScore * (1 - specificityRatio) * 0.35));
    if (genPenalty > 0) {
      penalties.push({ type: "genericity_penalty", value: genPenalty, reason: `Score driven by generic terms (specificity ${(specificityRatio * 100).toFixed(0)}%)` });
      trace.push(`[Genericity Penalty] -${genPenalty}`);
    }
  } else if (exactMatches.length === 0 && specificityRatio < 0.35) {
    const wkPenalty = Math.min(8, Math.round(baseScore * (1 - specificityRatio) * 0.15));
    if (wkPenalty > 0) {
      penalties.push({ type: "genericity_penalty", value: wkPenalty, reason: "Mostly generic overlap" });
      trace.push(`[Weak Specificity] -${wkPenalty}`);
    }
  }

  // 2. Weak specificity (concept)
  if (exactMatches.length === 0 && conceptCentrality < 4) {
    if (conceptFit < 8) {
      penalties.push({ type: "weak_specificity", value: 8, reason: "Weak concept fit and low centrality" });
      trace.push(`[Weak Specificity Penalty] -8`);
    } else if (conceptFit < 12) {
      penalties.push({ type: "weak_specificity", value: 4, reason: "No central concept connection found" });
      trace.push(`[Weak Specificity Penalty] -4`);
    }
  }

  // 3. Target applicant mismatch
  if (taResult.mismatchPenalty > 0) {
    penalties.push({ type: "target_applicant_mismatch", value: taResult.mismatchPenalty, reason: taResult.mismatchReason });
    trace.push(`[Target Mismatch] -${taResult.mismatchPenalty}`);
  }

  // 4. Population mismatch
  if (populationMatches.length === 0 && orgPops.length > 0 && oppPops.length > 0) {
    const oppHighSpec = oppPops.filter(p => (POPULATION_SPECIFICITY[p] ?? 1) >= 3);
    if (oppHighSpec.length > 0) {
      const orgHighSpec = orgPops.filter(p => (POPULATION_SPECIFICITY[p] ?? 1) >= 3);
      const popPenalty = orgHighSpec.length > 0 ? 6 : 3;
      penalties.push({ type: "population_mismatch", value: popPenalty, reason: `Pop mismatch: org serves ${orgPops[0] ?? "?"}, opp targets ${oppHighSpec[0] ?? "?"}` });
      trace.push(`[Population Mismatch] -${popPenalty}`);
    }
  }

  // 5. Complexity mismatch
  if (capResult.penaltyValue > 0 && capRaw === capResult.score) {
    const cmpPenalty = Math.round((capResult.penaltyValue / 10) * 7);
    if (cmpPenalty > 0) {
      penalties.push({ type: "complexity_mismatch", value: cmpPenalty, reason: `Org capacity (${orgProfile.capacityBand}) below opportunity complexity (${oppProfile.complexityBand})` });
      trace.push(`[Complexity Mismatch] -${cmpPenalty}`);
    }
  }

  // 6. Source barrier (NEW in V4)
  const srcBarrier = computeSourceBarrierPenalty(sourceKey, orgProfile.orgClass);
  if (srcBarrier) {
    penalties.push(srcBarrier);
    trace.push(`[Source Barrier] -${srcBarrier.value} — ${srcBarrier.reason}`);
  }

  // 7. Funding capacity mismatch
  if (org.annual_budget > 0 && opp.min_award != null && opp.min_award > org.annual_budget * 5) {
    penalties.push({ type: "funding_capacity_mismatch", value: 5, reason: `Min award ($${opp.min_award.toLocaleString()}) may exceed org management capacity` });
    trace.push(`[Funding Capacity] -5`);
  }

  const penaltyTotal = penalties.reduce((s, p) => s + p.value, 0);
  const finalScore = Math.max(0, Math.min(100, baseScore + semanticBoost + recencyBoost - penaltyTotal));
  trace.push(`[Final] ${baseScore} base + ${semanticBoost} boost + ${recencyBoost} recency - ${penaltyTotal} penalties = ${finalScore}`);

  // ── Confidence Tier ────────────────────────────────────────────────────────
  const confidence: ConfidenceTier =
    finalScore >= 70 ? "excellent" :
    finalScore >= 55 ? "strong" :
    finalScore >= 38 ? "moderate" :
    "weak";

  // ── Reasons & Risks ────────────────────────────────────────────────────────
  const reasons: string[] = [];
  const risks: string[] = [];

  if (exactMatches.length >= 2) reasons.push(`${exactMatches.length} exact concept phrases: ${exactMatches.slice(0, 2).join(", ")}`);
  else if (exactMatches.length === 1) reasons.push(`Exact concept match: "${exactMatches[0]}"`);
  if (conceptCentrality >= 5) reasons.push("Core concept featured in opportunity title");
  if (targetApplicantFit >= 10) reasons.push(`"${orgProfile.orgClass}" is the intended applicant type`);
  if (populationMatches.length > 0) reasons.push(`Population match: ${populationMatches.slice(0, 2).join(", ")}`);
  if (elig.score >= 9) reasons.push("Strong eligibility confirmation");
  if (geographyFit >= 7) reasons.push("Geographic alignment confirmed");
  if (semanticBoost >= 5) reasons.push("Multi-signal alignment boost");
  if (recencyBoost > 0) reasons.push("Recently posted opportunity");

  if (exactMatches.length === 0 && specificityRatio < 0.3) risks.push("Score driven by generic terms — verify mission relevance");
  if (taResult.mismatchPenalty > 5) risks.push(taResult.mismatchReason);
  for (const p of penalties) {
    if (!risks.includes(p.reason)) risks.push(p.reason);
  }

  return {
    org, opp,
    orgProfile, oppProfile,
    passes_eligibility: true,
    eligibility_reason: elig.reason,
    dimensions,
    exactPhraseMatches: exactMatches,
    highValueConcepts: [...new Set([...exactMatches, ...domainOverlap])],
    specificityRatio,
    targetApplicantInferred: taResult.inferred,
    populationMatches,
    baseScore, semanticBoost, recencyBoost,
    penalties, penaltyTotal, finalScore,
    confidence, reasons, risks,
    audit_trace: trace,
  };
}

// ─── Top Matches V4 — diversity-aware ranking ─────────────────────────────────

export interface V4RankOptions {
  limit?: number;          // default 10
  minScore?: number;       // default 25
  maxPerSource?: number;   // default 3 — source diversity cap
}

/**
 * Scores org against the full opportunity pool and returns top matches.
 * Applies source diversity: no more than `maxPerSource` results from any single source.
 * Automatically filters to active sources and removes expired deadlines.
 */
export function getTopMatchesV4(
  org: OrgProfile,
  opportunities: NormalizedOpportunity[],
  options: V4RankOptions = {},
): V4ScoreTrace[] {
  const { limit = 10, minScore = 25, maxPerSource = 3 } = options;

  const ACTIVE_SOURCES = new Set([
    "simpler_grants", "grants_gov", "sam_gov", "sbir",
    "threesixtygiving", "california_grants", "world_bank", "ted_eu",
  ]);

  // Filter to active sources and non-expired opportunities
  const pool = opportunities.filter(o => {
    const src = o.source.toLowerCase().replace(/[^a-z0-9]/g, "_");
    if (!ACTIVE_SOURCES.has(src)) return false;
    if (o.close_date && new Date(o.close_date) < new Date()) return false;
    return true;
  });

  // Score all
  const scored = pool
    .map(opp => scoreMatchV4(org, opp))
    .filter(r => r.passes_eligibility && r.finalScore >= minScore)
    .sort((a, b) => b.finalScore - a.finalScore);

  // Source diversity cap
  const sourceCounts: Record<string, number> = {};
  const results: V4ScoreTrace[] = [];

  for (const r of scored) {
    if (results.length >= limit) break;
    const src = r.opp.source.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const count = sourceCounts[src] ?? 0;
    if (count >= maxPerSource) continue;
    sourceCounts[src] = count + 1;
    results.push(r);
  }

  return results;
}

// ─── Multi-source pool builder (convenience) ─────────────────────────────────

/**
 * Converts raw API response records (from /indexing/records/for-algorithm
 * or from individual grant endpoints) into NormalizedOpportunity[].
 * Handles geography stored as JSON string or array.
 */
export function buildOpportunityPool(rawRecords: any[]): NormalizedOpportunity[] {
  return rawRecords.map((rec: any) => {
    let geoRaw: any[] = [];
    if (Array.isArray(rec.geography)) {
      geoRaw = rec.geography;
    } else if (typeof rec.geography === "string" && rec.geography) {
      try { geoRaw = JSON.parse(rec.geography); } catch { geoRaw = [rec.geography]; }
    }
    const geography: string[] = geoRaw.filter((g: any) => g != null).map((g: any) => String(g));

    return {
      id: String(rec.id ?? rec.noticeId ?? Math.random()),
      source: rec.source ?? "unknown",
      source_raw: rec.source ?? "unknown",
      title: rec.title ?? "Untitled",
      description: rec.description ?? "",
      agency: rec.agency ?? "",
      funding_type: (rec.funding_type ?? rec.fundingType ?? "grant") as any,
      status: (rec.status ?? "active") as any,
      open_date: rec.open_date ?? rec.openDate ?? undefined,
      close_date: rec.close_date ?? rec.closeDate ?? rec.deadline ?? undefined,
      min_award: rec.min_award ?? rec.minAward ?? undefined,
      max_award: rec.max_award ?? rec.maxAward ?? (rec.amount ? Number(String(rec.amount).replace(/[^0-9.]/g, "")) || undefined : undefined),
      eligibility: Array.isArray(rec.eligibility) ? rec.eligibility : [],
      categories: Array.isArray(rec.categories) ? rec.categories : [],
      keywords: Array.isArray(rec.keywords) ? rec.keywords : [],
      geography,
      url: rec.url ?? "",
    };
  });
}
