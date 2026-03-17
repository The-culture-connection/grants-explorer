/**
 * eligibility.ts — Strict eligibility gate for V3
 *
 * V2 eligibility was too permissive — it returned partial credit (12/20)
 * even when there was no clear eligibility constraint.  V3 makes the gate
 * binary: PASS (award points) or FAIL (exclude from ranking).
 */

import type { V2OrgProfile, V2OppProfile } from "@/lib/v2/types";

// ─── Applicant Type Constraints ───────────────────────────────────────────────

interface EligibilityResult {
  passes: boolean;
  score: number;   // 0–10 in V3
  reason: string;
  failReason?: string;
}

// Comprehensive org-class → eligible tags mapping
const ORG_CLASS_SATISFIES: Record<string, string[]> = {
  nonprofit: [
    "nonprofit", "501c3", "community_based_org", "community_org",
    "ngo", "charity", "foundation", "nonprofit_organization",
    "community_nonprofit", "health_center",
  ],
  small_business: [
    "small_business", "for_profit", "8a_certified",
    "minority_owned", "woman_owned", "disadvantaged_business",
    "hubzone", "veteran_owned", "sdvosb",
  ],
  university: [
    "university", "higher_education", "academic_institution",
    "nonprofit", "educational_institution", "college",
    "community_college", "hbcu", "msi", "tribal_college",
  ],
  government: [
    "government", "public_agency", "local_government",
    "state_government", "tribal_government", "federal_agency",
    "municipal", "county",
  ],
  tribal: [
    "tribal", "tribal_government", "native_american",
    "alaska_native", "nonprofit", "government", "public_agency",
    "tribal_college", "indigenous",
  ],
  research_institution: [
    "nonprofit", "university", "research_institution",
    "higher_education", "academic", "scientific",
    "laboratory", "institute",
  ],
  contractor: [
    "small_business", "for_profit", "8a_certified",
    "minority_owned", "veteran_owned",
  ],
  international_ngo: [
    "nonprofit", "international", "ngo", "international_ngo",
    "nonprofit_organization",
  ],
  other: ["all"],
};

// Applicant types that EXCLUDE an org class
// Key = org class → which applicant-type tags in the opp exclude them
const ORG_CLASS_EXCLUDED_BY: Record<string, string[]> = {
  nonprofit: ["small_business", "for_profit", "8a_certified", "contractor"],
  small_business: ["nonprofit", "501c3", "university", "higher_education"],
  university: ["small_business", "for_profit", "contractor"],
  government: ["small_business", "for_profit", "nonprofit"],
  contractor: ["nonprofit", "501c3", "university", "higher_education"],
  international_ngo: ["domestic_only", "us_organizations_only"],
};

// Applicant types that strongly imply a specific class (hard excludes others)
const EXCLUSIVE_TYPES: Record<string, string[]> = {
  small_business: ["small_business_only", "sb_only"],
  government: ["government_only", "public_agency_only"],
  university: ["hbcu_only", "university_only", "higher_ed_only"],
  tribal: ["tribal_only", "tribal_government_only", "native_american_only"],
};

export function passesStrictEligibility(
  org: V2OrgProfile,
  opp: V2OppProfile,
): EligibilityResult {
  const types = opp.applicantTypes;

  // No constraints — all pass, but with reduced credit (less certainty)
  if (types.length === 0) {
    return {
      passes: true,
      score: 6,
      reason: "No eligibility constraints — all applicant types permitted",
    };
  }

  const allowed = ORG_CLASS_SATISFIES[org.orgClass] ?? [];
  const excluded = ORG_CLASS_EXCLUDED_BY[org.orgClass] ?? [];

  // ── Hard Exclusions ────────────────────────────────────────────────────────

  // 501(c)(3) required
  if (types.includes("501c3") && !org.has501c3) {
    if (!["government", "university", "tribal"].includes(org.orgClass)) {
      return {
        passes: false,
        score: 0,
        reason: "501(c)(3) required — org does not have it",
        failReason: "501c3_required",
      };
    }
  }

  // Small-business-only check
  const sbOnly = types.length > 0 &&
    types.every(t => ["small_business", "for_profit", "8a_certified", "hubzone", "sdvosb"].includes(t));
  if (sbOnly && !org.isSmallBusiness && !["small_business", "contractor"].includes(org.orgClass)) {
    return {
      passes: false,
      score: 0,
      reason: "Small-business-only opportunity; org is not a small business",
      failReason: "small_business_only",
    };
  }

  // Nonprofit-only check (strictly excluding for-profit)
  const nonprofitOnly = types.some(t =>
    ["nonprofit", "501c3", "community_based_org", "community_org", "ngo"].includes(t)
  );
  const excludesForProfit = !types.some(t => ["for_profit", "small_business", "all"].includes(t));
  if (nonprofitOnly && excludesForProfit) {
    if (!["nonprofit", "tribal", "research_institution", "university", "international_ngo"].includes(org.orgClass)) {
      return {
        passes: false,
        score: 0,
        reason: `Nonprofit-only; org class is "${org.orgClass}"`,
        failReason: "nonprofit_only",
      };
    }
  }

  // Government-only check
  const govOnly = types.length > 0 &&
    types.every(t => ["government", "public_agency", "state_government", "local_government", "federal_agency"].includes(t));
  if (govOnly && !["government", "tribal"].includes(org.orgClass)) {
    return {
      passes: false,
      score: 0,
      reason: "Government-only opportunity; org is not a government entity",
      failReason: "government_only",
    };
  }

  // Check for explicit exclusion keywords
  const explicitly_excluded = excluded.some(ex => types.includes(ex));
  if (explicitly_excluded) {
    return {
      passes: false,
      score: 0,
      reason: `Org class "${org.orgClass}" is explicitly excluded by applicant type constraints`,
      failReason: "explicitly_excluded",
    };
  }

  // ── Positive Scoring ────────────────────────────────────────────────────────
  const openToAll = types.includes("all");
  if (openToAll) return { passes: true, score: 8, reason: "Open to all applicant types" };

  const exactMatch = allowed.some(a => types.includes(a));
  if (exactMatch) {
    let score = 8;
    if (org.has501c3 && types.includes("501c3")) score = 10;
    else if (org.isSmallBusiness && types.some(t => ["small_business", "for_profit"].includes(t))) score = 9;
    return {
      passes: true,
      score: Math.min(10, score),
      reason: `"${org.orgClass}" satisfies eligibility requirement`,
    };
  }

  // Partial — passes but weak match
  return {
    passes: true,
    score: 5,
    reason: `"${org.orgClass}" not explicitly listed but not excluded; partial eligibility`,
  };
}

// ─── Applicant Type Inference ─────────────────────────────────────────────────
// Infer the INTENDED applicant from opportunity text — for target applicant fit

export function inferIntendedApplicant(opp: V2OppProfile, oppText: string): string {
  const text = oppText.toLowerCase();

  if (text.includes("hbcu") || text.includes("historically black college")) return "hbcu_institution";
  if (text.includes("tribal college") || text.includes("tribal nation") || text.includes("native american")) return "tribal";
  if (
    text.includes("university") || text.includes("college") ||
    text.includes("higher education") || text.includes("academic institution") ||
    text.includes("research institution") || text.includes("principal investigator") ||
    opp.opportunityType === "research_grant"
  ) return "research_university";
  if (
    opp.opportunityType === "procurement_contract" ||
    text.includes("vendor") || text.includes("contractor") ||
    text.includes("solicitation") || text.includes("rfp") || text.includes("rfq")
  ) return "contractor";
  if (
    text.includes("government agency") || text.includes("public agency") ||
    text.includes("local government") || text.includes("state agency") ||
    text.includes("municipal")
  ) return "government";
  if (
    text.includes("small business") || text.includes("startup") ||
    text.includes("entrepreneur") || text.includes("for-profit")
  ) return "small_business";
  if (
    text.includes("community nonprofit") || text.includes("community-based") ||
    text.includes("nonprofit organization") || text.includes("501(c)(3)") ||
    text.includes("community organization")
  ) return "community_nonprofit";
  if (
    text.includes("healthcare provider") || text.includes("health center") ||
    text.includes("hospital") || text.includes("clinic") ||
    text.includes("federally qualified")
  ) return "healthcare_provider";
  if (
    text.includes("nonprofit") || text.includes("ngo") ||
    text.includes("charity") || text.includes("foundation")
  ) return "nonprofit";

  return "open";
}
