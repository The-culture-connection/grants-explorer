/**
 * targetApplicant.ts — Target applicant fit for V3
 *
 * Separate from eligibility: an org may technically be eligible but
 * still not be the intended applicant class for the opportunity.
 */

import type { V2OrgProfile, V2OppProfile } from "@/lib/v2/types";
import { inferIntendedApplicant } from "./eligibility";

// ─── Target Applicant Fit Score ───────────────────────────────────────────────

export function computeTargetApplicantFit(
  org: V2OrgProfile,
  opp: V2OppProfile,
  oppRaw: { title: string; description: string; eligibility: string[] },
): {
  score: number;
  targetApplicantInferred: string;
  reason: string;
  mismatchPenalty: number;
  mismatchReason: string;
} {
  const oppText = [oppRaw.title, oppRaw.description, ...oppRaw.eligibility].join(" ");
  const intended = inferIntendedApplicant(opp, oppText);

  // Mapping: intended target → compatible org classes
  const INTENDED_COMPAT: Record<string, string[]> = {
    community_nonprofit:   ["nonprofit", "tribal", "international_ngo"],
    nonprofit:             ["nonprofit", "tribal", "research_institution", "university", "international_ngo"],
    research_university:   ["university", "research_institution"],
    hbcu_institution:      ["university", "research_institution"],
    contractor:            ["contractor", "small_business"],
    government:            ["government", "tribal"],
    small_business:        ["small_business", "contractor"],
    healthcare_provider:   ["nonprofit", "government", "university"],
    tribal:                ["tribal", "nonprofit", "government"],
    open:                  ["nonprofit", "small_business", "university", "government", "tribal", "research_institution", "contractor", "international_ngo", "other"],
  };

  // Mapping: intended target → org classes that are a POOR fit (apply penalty)
  const INTENDED_POOR_FIT: Record<string, string[]> = {
    research_university:   ["nonprofit", "small_business", "contractor"],
    hbcu_institution:      ["nonprofit", "small_business", "contractor", "government"],
    contractor:            ["nonprofit", "university", "research_institution", "international_ngo"],
    government:            ["nonprofit", "small_business", "contractor", "research_institution"],
    small_business:        ["nonprofit", "university", "government", "research_institution"],
    community_nonprofit:   ["contractor", "government", "small_business"],
  };

  const compatClasses = INTENDED_COMPAT[intended] ?? INTENDED_COMPAT["open"];
  const poorFitClasses = INTENDED_POOR_FIT[intended] ?? [];

  const isGoodFit  = compatClasses.includes(org.orgClass);
  const isPoorFit  = poorFitClasses.includes(org.orgClass);

  // Also check procurement specifically
  const isProcurement = opp.opportunityType === "procurement_contract";
  if (isProcurement && !["contractor", "small_business", "government"].includes(org.orgClass)) {
    return {
      score: 3,
      targetApplicantInferred: "contractor",
      reason: "Procurement contract — intended for contractors/vendors, not nonprofits or academic institutions",
      mismatchPenalty: 10,
      mismatchReason: "Procurement opportunities require SAM/DUNS registration, past-performance documentation, and contractor experience",
    };
  }

  // Research grant for non-academic org
  const isResearchGrant = opp.opportunityType === "research_grant";
  if (isResearchGrant && !["university", "research_institution"].includes(org.orgClass)) {
    const score = org.orgClass === "nonprofit" ? 5 : 3;
    const penalty = org.orgClass === "nonprofit" ? 5 : 8;
    return {
      score,
      targetApplicantInferred: "research_university",
      reason: `Research grant primarily targeting academic/research institutions; org is "${org.orgClass}"`,
      mismatchPenalty: penalty,
      mismatchReason: "Research grants typically require PI credentials, IRB, and academic infrastructure",
    };
  }

  if (isGoodFit) {
    let score = 10;
    if (intended === "community_nonprofit" && org.orgClass === "nonprofit") score = 12;
    else if (intended === "open") score = 8;
    else if (intended === intended) score = 10;
    return {
      score: Math.min(12, score),
      targetApplicantInferred: intended,
      reason: `"${org.orgClass}" is a natural fit for this "${intended.replace(/_/g," ")}" opportunity`,
      mismatchPenalty: 0,
      mismatchReason: "",
    };
  }

  if (isPoorFit) {
    return {
      score: 3,
      targetApplicantInferred: intended,
      reason: `"${org.orgClass}" is not the primary intended applicant class (intended: ${intended.replace(/_/g," ")})`,
      mismatchPenalty: 8,
      mismatchReason: `Opportunity designed for "${intended.replace(/_/g," ")}" — org type may not be competitive`,
    };
  }

  // Neutral — not a clear fit or clear mismatch
  return {
    score: 6,
    targetApplicantInferred: intended,
    reason: `"${org.orgClass}" is a potential fit for "${intended.replace(/_/g," ")}" opportunity`,
    mismatchPenalty: 0,
    mismatchReason: "",
  };
}
