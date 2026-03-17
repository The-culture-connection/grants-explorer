/**
 * population.ts — Specificity-weighted population matching for V3
 *
 * More specific population alignment should beat broad umbrella matches.
 * "Black women" > "minorities" > "community members"
 */

import type { V2OrgProfile, V2OppProfile } from "@/lib/v2/types";

// ─── Specificity Tiers ────────────────────────────────────────────────────────
// Higher tier = more specific (1 = very broad, 4 = highly specific)

const POPULATION_SPECIFICITY: Record<string, number> = {
  // Tier 4 — highly specific, exact demographic
  "black women": 4,
  "black maternal": 4,
  "pregnant people": 4,
  "pregnant women": 4,
  "pregnant individuals": 4,
  "black youth": 4,
  "black men": 4,
  "black girls": 4,
  "black boys": 4,
  "indigenous women": 4,
  "native women": 4,
  "latina women": 4,
  "undocumented immigrants": 4,
  "asylum seekers": 4,
  "trafficking survivors": 4,
  "domestic violence survivors": 4,
  "formerly incarcerated": 4,
  "returning citizens": 4,
  "people with disabilities": 4,
  "people with hiv": 4,
  "people who use drugs": 4,
  "transgender women": 4,
  "lgbtq youth": 4,
  "queer youth": 4,
  "infants and toddlers": 4,
  "newborns": 4,

  // Tier 3 — specific sub-group
  "black communities": 3,
  "african american": 3,
  "indigenous peoples": 3,
  "native american": 3,
  "latino communities": 3,
  "hispanic communities": 3,
  "asian american": 3,
  "pacific islander": 3,
  "refugee": 3,
  "immigrants": 3,
  "veterans": 3,
  "justice involved": 3,
  "homeless individuals": 3,
  "houseless": 3,
  "rural communities": 3,
  "tribal members": 3,
  "elderly": 3,
  "older adults": 3,
  "children": 3,
  "youth": 3,
  "adolescents": 3,
  "young people": 3,
  "survivors": 3,
  "caregivers": 3,
  "single parents": 3,
  "foster youth": 3,

  // Tier 2 — umbrella but meaningful
  "women": 2,
  "men": 2,
  "families": 2,
  "low income": 2,
  "low-income": 2,
  "marginalized communities": 2,
  "vulnerable populations": 2,
  "underserved communities": 2,
  "underserved populations": 2,
  "disadvantaged": 2,
  "minority": 2,
  "minorities": 2,
  "people of color": 2,
  "bipoc": 2,
  "general public": 1,
  "community members": 1,
  "community": 1,
  "residents": 1,
  "individuals": 1,
  "all": 1,
};

// ─── Normalize population text to tags ───────────────────────────────────────

export function normalizePopulationTags(text: string): string[] {
  const norm = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const found: string[] = [];
  for (const tag of Object.keys(POPULATION_SPECIFICITY)) {
    if (norm.includes(tag)) found.push(tag);
  }
  // Remove tags that are substrings of more specific matched tags
  return found.filter(t =>
    !found.some(other => other !== t && other.includes(t) && other.length > t.length)
  );
}

// ─── Population Specificity Score ────────────────────────────────────────────

export function computePopulationSpecificity(
  org: V2OrgProfile,
  opp: V2OppProfile,
  orgRaw: { mission: string; population_served: string[] },
  oppRaw: { title: string; description: string },
): {
  score: number;
  specificity: number;  // 0–1
  matches: string[];
  reason: string;
} {
  const orgPopText = [orgRaw.mission, ...orgRaw.population_served].join(" ");
  const oppPopText = [oppRaw.title, oppRaw.description.slice(0, 500)].join(" ");

  const orgPops = normalizePopulationTags(orgPopText);
  const oppPops = normalizePopulationTags(oppPopText);

  if (orgPops.length === 0 || oppPops.length === 0) {
    // Fall back to V2 tag overlap
    const orgV2Set = new Set(org.populationTags);
    const oppV2Set = new Set(opp.populationTags);
    const fallbackMatches = [...orgV2Set].filter(p => oppV2Set.has(p));
    if (fallbackMatches.length > 0) {
      return {
        score: 4,
        specificity: 0.3,
        matches: fallbackMatches,
        reason: `Population tag overlap (V2): ${fallbackMatches.join(", ")}`,
      };
    }
    return { score: 2, specificity: 0, matches: [], reason: "Insufficient population data" };
  }

  // Find matching populations between org and opp
  const orgSet = new Set(orgPops);
  const matches = oppPops.filter(p => orgSet.has(p));

  if (matches.length === 0) {
    // Check if opp targets any org's populations broadly
    const hasPartialOverlap = orgPops.some(op =>
      oppPops.some(pp => op.includes(pp) || pp.includes(op))
    );
    if (hasPartialOverlap) {
      return { score: 3, specificity: 0.2, matches: [], reason: "Broad population overlap" };
    }
    return {
      score: 1,
      specificity: 0,
      matches: [],
      reason: `Population mismatch: org targets ${orgPops[0] ?? "unknown"}, opp targets ${oppPops[0] ?? "unknown"}`,
    };
  }

  // Score based on the specificity of matching populations
  const maxSpecificity = Math.max(...matches.map(m => POPULATION_SPECIFICITY[m] ?? 1));
  const avgSpecificity = matches.reduce((s, m) => s + (POPULATION_SPECIFICITY[m] ?? 1), 0) / matches.length;
  const normalizedSpecificity = avgSpecificity / 4;

  let score = 0;
  if (maxSpecificity === 4) {
    // Highly specific match (e.g. "Black women", "pregnant people")
    score = matches.length >= 2 ? 8 : 7;
  } else if (maxSpecificity === 3) {
    score = matches.length >= 2 ? 6 : 5;
  } else if (maxSpecificity === 2) {
    score = matches.length >= 2 ? 4 : 3;
  } else {
    score = 2; // Only generic "community" / "all" matches
  }

  const reason = `Population match${matches.length > 1 ? "es" : ""}: ${matches.slice(0, 3).join(", ")} (specificity ${maxSpecificity}/4)`;

  return {
    score: Math.min(8, score),
    specificity: normalizedSpecificity,
    matches,
    reason,
  };
}

// ─── Population Mismatch Penalty ─────────────────────────────────────────────

export function computePopulationMismatchPenalty(
  orgPops: string[],
  oppPops: string[],
  matches: string[],
): { penalty: number; reason: string } {
  if (orgPops.length === 0 || oppPops.length === 0) return { penalty: 0, reason: "" };
  if (matches.length > 0) return { penalty: 0, reason: "" };

  // Check if opp specifies a highly specific population that is a mismatch
  const oppHighSpec = oppPops.filter(p => (POPULATION_SPECIFICITY[p] ?? 1) >= 3);
  if (oppHighSpec.length > 0) {
    // The opp is targeting a specific group the org doesn't serve
    const orgHighSpec = orgPops.filter(p => (POPULATION_SPECIFICITY[p] ?? 1) >= 3);
    if (orgHighSpec.length > 0) {
      // Both sides have specific groups but they don't match
      return {
        penalty: 6,
        reason: `Population mismatch: org serves ${orgHighSpec[0]}, opp targets ${oppHighSpec[0]}`,
      };
    }
    // Opp is specific, org is broad — mild penalty
    return {
      penalty: 3,
      reason: `Opp targets specific population (${oppHighSpec[0]}) not explicitly served by org`,
    };
  }

  return { penalty: 0, reason: "" };
}
