/**
 * phrases.ts — Phrase-priority scoring and concept centrality
 *
 * Key insight: a single exact phrase match (e.g. "maternal health") should
 * outrank many generic token overlaps (e.g. "health", "community", "support").
 */

import type { V2OrgProfile, V2OppProfile } from "@/lib/v2/types";

// ─── Generic Terms (should not drive high scores alone) ───────────────────────

export const GENERIC_TERMS = new Set([
  "health", "community", "support", "outcomes", "improve", "innovation",
  "services", "equity", "development", "research", "program", "project",
  "initiative", "work", "provide", "need", "build", "help", "service",
  "data", "fund", "grant", "award", "capacity", "impact", "resource",
  "local", "national", "public", "access", "benefit", "plan", "system",
  "organization", "address", "population", "underserved", "diverse",
  "strengthen", "increase", "reduce", "partner", "engage", "promote",
  "activity", "opportunity", "challenge", "solution", "approach",
  "strategy", "model", "framework", "outcome", "result", "goal",
]);

// ─── High-Value Concept Phrases ───────────────────────────────────────────────
// Ordered roughly by specificity (most specific first)

export const HIGH_VALUE_PHRASES: string[] = [
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
  // Workforce / economic
  "workforce development", "job training", "career pathway",
  "workforce training", "career development", "job placement",
  "apprenticeship program", "work readiness", "economic mobility",
  "small business development", "entrepreneurship training",
  "microenterprise", "minority business", "women owned business",
  // Housing / community
  "affordable housing", "housing instability", "housing insecurity",
  "homelessness prevention", "transitional housing", "permanent supportive housing",
  "community development", "neighborhood revitalization", "community land trust",
  "financial literacy", "asset building", "wealth building",
  // Environment / energy
  "clean energy", "renewable energy", "energy efficiency",
  "climate resilience", "climate adaptation", "climate justice",
  "environmental justice", "clean water", "air quality",
  "solar energy", "green infrastructure", "carbon reduction",
  // Education
  "early childhood education", "early learning", "school readiness",
  "literacy program", "adult literacy", "college access", "college readiness",
  "stem education", "afterschool program", "summer learning",
  "special education", "inclusive education",
  // Public health systems
  "public health workforce", "community health worker", "health navigator",
  "community health center", "federally qualified health center",
  "rural health", "telehealth", "telemedicine", "health equity",
  // Technology / innovation
  "digital equity", "digital inclusion", "broadband access",
  "technology access", "data privacy", "cybersecurity",
  // Justice / legal
  "criminal justice reform", "reentry services", "legal aid",
  "civil rights", "voting rights", "immigration services",
  "refugee resettlement", "asylum seekers",
];

// ─── Tokenize for phrase detection ───────────────────────────────────────────

function normText(text: string): string {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Phrase Extraction ────────────────────────────────────────────────────────

export function extractHighValuePhrases(text: string): string[] {
  const norm = normText(text);
  const found: string[] = [];
  for (const phrase of HIGH_VALUE_PHRASES) {
    if (norm.includes(phrase)) {
      found.push(phrase);
    }
  }
  return found;
}

// ─── Exact / Near-Exact Concept Matches ──────────────────────────────────────

export function detectExactConceptMatches(
  orgPhrases: string[],
  oppPhrases: string[],
): string[] {
  const oppSet = new Set(oppPhrases);
  return orgPhrases.filter(p => oppSet.has(p));
}

// ─── Phrase Priority Score ────────────────────────────────────────────────────
// Returns 0–28 (the conceptFit max)

export function computePhrasePriorityScore(
  org: V2OrgProfile,
  opp: V2OppProfile,
  oppRaw: { title: string; description: string; keywords: string[]; categories: string[] },
  orgRaw: { mission: string; keywords: string[]; program_areas: string[] },
): {
  score: number;
  exactPhraseMatches: string[];
  highValueConcepts: string[];
  genericTermsMatched: string[];
  specificityRatio: number;
  reason: string;
} {
  const oppFullText = [oppRaw.title, oppRaw.description, ...oppRaw.keywords, ...oppRaw.categories].join(" ");
  const orgFullText = [orgRaw.mission, ...orgRaw.keywords, ...orgRaw.program_areas].join(" ");

  const oppPhrases = extractHighValuePhrases(oppFullText);
  const orgPhrases = extractHighValuePhrases(orgFullText);
  const exactMatches = detectExactConceptMatches(orgPhrases, oppPhrases);

  // Also capture broad domain tag overlap from V2 profiles
  const orgDomains = new Set(org.sectorTags);
  const oppDomains = new Set(opp.domainTags);
  const domainOverlap = [...orgDomains].filter(d => oppDomains.has(d));

  // Generic term detection in the opp text
  const oppTokens = normText(oppRaw.title + " " + oppRaw.description)
    .split(" ")
    .filter(t => t.length > 2);
  const matchedTokens = oppTokens.filter(t =>
    normText(orgFullText).split(" ").includes(t)
  );
  const genericMatched = matchedTokens.filter(t => GENERIC_TERMS.has(t));
  const specificMatched = matchedTokens.filter(t => !GENERIC_TERMS.has(t) && t.length > 3);
  const specificityRatio = matchedTokens.length > 0
    ? specificMatched.length / matchedTokens.length
    : 0;

  // Score computation
  let score = 0;
  const reasons: string[] = [];

  // Exact phrase matches are the highest signal (up to 20 pts)
  if (exactMatches.length >= 3) {
    score += 20;
    reasons.push(`${exactMatches.length} exact concept phrases matched`);
  } else if (exactMatches.length === 2) {
    score += 16;
    reasons.push(`2 exact concept phrases: ${exactMatches.slice(0, 2).join(", ")}`);
  } else if (exactMatches.length === 1) {
    score += 11;
    reasons.push(`Exact phrase: "${exactMatches[0]}"`);
  } else if (orgPhrases.length > 0 && oppPhrases.length > 0) {
    // Phrases exist on both sides but no exact match — partial domain adjacency
    score += 4;
    reasons.push(`Domain-adjacent (org: ${orgPhrases[0]}; opp: ${oppPhrases[0]})`);
  }

  // Domain tag overlap (taxonomy layer, max 8 pts)
  if (domainOverlap.length >= 3) {
    score += 8;
  } else if (domainOverlap.length === 2) {
    score += 6;
  } else if (domainOverlap.length === 1) {
    score += 3;
  }
  if (domainOverlap.length > 0) {
    reasons.push(`Domain overlap: ${domainOverlap.slice(0, 3).join(", ")}`);
  }

  // Penalize if score is driven mostly by generic terms (subtract up to 4 pts)
  if (exactMatches.length === 0 && specificityRatio < 0.3 && score > 3) {
    score = Math.max(0, score - 3);
    reasons.push("Reduced: overlap dominated by generic terms");
  }

  const reason = reasons.length > 0 ? reasons.join("; ") : "No significant concept overlap";

  return {
    score: Math.min(28, score),
    exactPhraseMatches: exactMatches,
    highValueConcepts: [...new Set([...exactMatches, ...domainOverlap])],
    genericTermsMatched: genericMatched.slice(0, 10),
    specificityRatio,
    reason,
  };
}

// ─── Genericity Penalty ───────────────────────────────────────────────────────

export function computeGenericityPenalty(
  exactPhraseMatches: string[],
  specificityRatio: number,
  baseScore: number,
): { penalty: number; reason: string } {
  // No penalty if strong exact matches exist
  if (exactPhraseMatches.length >= 2) return { penalty: 0, reason: "" };

  // No penalty if specificity is high
  if (specificityRatio >= 0.5) return { penalty: 0, reason: "" };

  // Calculate how much of the base score is likely from generic overlap
  const genericWeight = 1 - specificityRatio;

  if (exactPhraseMatches.length === 0 && specificityRatio < 0.2 && baseScore > 30) {
    const penalty = Math.min(15, Math.round(baseScore * genericWeight * 0.35));
    return {
      penalty,
      reason: `Score driven by generic terms (specificity ratio ${(specificityRatio * 100).toFixed(0)}%)`,
    };
  }

  if (exactPhraseMatches.length === 0 && specificityRatio < 0.35) {
    const penalty = Math.min(8, Math.round(baseScore * genericWeight * 0.15));
    return penalty > 0
      ? { penalty, reason: "Mostly generic overlap — weak specificity signal" }
      : { penalty: 0, reason: "" };
  }

  return { penalty: 0, reason: "" };
}

// ─── Concept Centrality ───────────────────────────────────────────────────────
// Rewards opportunities where the org's core concepts appear in the title,
// the opening text, or are repeated — indicating centrality, not adjacency.

export function computeConceptCentrality(
  org: V2OrgProfile,
  opp: V2OppProfile,
  orgRaw: { mission: string; keywords: string[] },
  oppRaw: { title: string; description: string },
): {
  score: number;
  titleMatchBonus: number;
  repeatedConceptBonus: number;
  reason: string;
} {
  const titleNorm = normText(oppRaw.title);
  const orgPhrases = extractHighValuePhrases([orgRaw.mission, ...orgRaw.keywords].join(" "));
  const titlePhrases = extractHighValuePhrases(oppRaw.title);
  const descriptionNorm = normText(oppRaw.description);

  let titleMatchBonus = 0;
  let repeatedConceptBonus = 0;
  const reasons: string[] = [];

  // Title-level phrase match (strongest centrality signal)
  const titleMatches = detectExactConceptMatches(orgPhrases, titlePhrases);
  if (titleMatches.length >= 2) {
    titleMatchBonus = 6;
    reasons.push(`Core concepts in title: ${titleMatches.slice(0, 2).join(", ")}`);
  } else if (titleMatches.length === 1) {
    titleMatchBonus = 4;
    reasons.push(`Core concept in title: "${titleMatches[0]}"`);
  } else {
    // Check if any of the org's domain tags appear in the title
    const orgDomainInTitle = org.sectorTags.some(t => titleNorm.includes(t));
    if (orgDomainInTitle) {
      titleMatchBonus = 2;
      reasons.push("Org domain appears in opportunity title");
    }
  }

  // Repeated concept presence in description (top 300 chars = opening text)
  const openingText = normText(oppRaw.description.slice(0, 350));
  const openingPhrases = extractHighValuePhrases(openingText);
  const openingMatches = detectExactConceptMatches(orgPhrases, openingPhrases);
  if (openingMatches.length >= 2) {
    repeatedConceptBonus = 4;
    reasons.push(`Concept repeated in opening text: ${openingMatches.slice(0, 2).join(", ")}`);
  } else if (openingMatches.length === 1) {
    repeatedConceptBonus = 2;
  }

  // Check repetition count of core terms in full description
  if (orgPhrases.length > 0) {
    const phrase = orgPhrases[0];
    const count = (descriptionNorm.match(new RegExp(phrase, "g")) ?? []).length;
    if (count >= 3) {
      repeatedConceptBonus = Math.max(repeatedConceptBonus, 3);
      reasons.push(`Core concept "${phrase}" appears ${count}× in description`);
    }
  }

  const score = Math.min(12, titleMatchBonus + repeatedConceptBonus);
  const reason = reasons.length > 0 ? reasons.join("; ") : "Core concepts not centrally featured in opportunity";

  return { score, titleMatchBonus, repeatedConceptBonus, reason };
}

// ─── Weak Specificity Penalty ────────────────────────────────────────────────

export function computeWeakSpecificityPenalty(
  conceptFit: number,
  conceptCentrality: number,
  specificityRatio: number,
  exactPhraseMatches: string[],
): { penalty: number; reason: string } {
  // No penalty if the match is genuinely strong
  if (exactPhraseMatches.length >= 1 && conceptCentrality >= 4) return { penalty: 0, reason: "" };
  if (conceptFit >= 18) return { penalty: 0, reason: "" };

  // Penalise if concept fit is weak AND centrality is low
  if (conceptFit < 8 && conceptCentrality < 4) {
    return {
      penalty: 8,
      reason: "Weak concept fit and low centrality — opportunity not centrally relevant to org mission",
    };
  }
  if (conceptFit < 12 && conceptCentrality === 0) {
    return { penalty: 4, reason: "No central concept connection found" };
  }
  return { penalty: 0, reason: "" };
}
