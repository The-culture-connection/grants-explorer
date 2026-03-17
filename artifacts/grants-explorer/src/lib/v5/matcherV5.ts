/**
 * matcherV5.ts — Title-Focused + Org-Type-Focused Matching Engine (v5.1)
 *
 * V5.1 CHANGES FROM v5.0
 * ───────────────────────
 * • Org JSON drives scoring: keywords/program_areas/mission phrases are weighted
 *   and matched first, before the global MISSION_PHRASES fallback.
 * • SCORE_TIERS give exact org-keyword matches 45 raw pts vs 14 for global fallback.
 * • Near-exact matching uses synonym groups + normalized word overlap (stricter).
 * • Generic penalty is multiplied down when strong exact matches exist, amplified
 *   when no match found at all.
 * • FIT_MATRIX `any` reduced from 13 → 7 so neutral org-type no longer inflates.
 * • Population fit uses POPULATION_VARIANTS for common expression equivalences.
 * • dimensions now includes genericPenalty for playground display.
 *
 * SCORING MODEL  (sum → clamp 0-100)
 * ────────────────────────────────────────────────────────────────────────
 *  titleMissionFit      0–60   org-derived + global phrase matches in title
 *  orgTypeFit           0–25   does this opp appear built for this org type?
 *  populationTitleFit   0–10   org's served population mentioned in title
 *  geographySanity      0–5    basic geographic compatibility
 *  genericPenalty       0–20   deducted for vague, low-info titles
 * ────────────────────────────────────────────────────────────────────────
 */

import type { OrgProfile, NormalizedOpportunity } from "@/lib/algorithm/types";
import type { InterpretedOpportunityProfile } from "@/lib/v5/opportunityInterpreter";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface V5Config {
  titleMissionFitMax:   number; // default 60
  orgTypeFitMax:        number; // default 25
  populationTitleMax:   number; // default 10
  geographyMax:         number; // default  5
  genericPenaltyMax:    number; // default 20
}

export const DEFAULT_V5_CONFIG: V5Config = {
  titleMissionFitMax:  60,
  orgTypeFitMax:       25,
  populationTitleMax:  10,
  geographyMax:         5,
  genericPenaltyMax:   20,
};

export type OppTargetType =
  | "nonprofit" | "small_business" | "university" | "government"
  | "tribal" | "contractor" | "healthcare" | "individual" | "any";

/** Extended title trace — includes org-derived breakdown + legacy aliases */
export interface V5TitleTrace {
  // Primary: org-derived phrase matches
  orgDerivedExactMatches: string[];
  orgDerivedNearMatches:  string[];
  // Secondary: global MISSION_PHRASES fallback (org-concept-overlapping)
  globalExactMatches:     string[];
  globalNearMatches:      string[];
  // Tertiary: individual concept words
  conceptMatches:         string[];
  // Legacy aliases used by AlgorithmPlayground
  exactPhraseMatches:     string[];  // orgDerivedExact + globalExact
  nearPhraseMatches:      string[];  // orgDerivedNear + globalNear
  genericWordsInTitle:    string[];  // alias for genericTermsDetected
  // Genericity analysis
  genericTermsDetected:   string[];
  specificTermsDetected:  string[];
  specificityRatio:       number;
  // Per-tier raw contributions
  orgDerivedExactScore:   number;
  orgDerivedNearScore:    number;
  globalFallbackScore:    number;
  conceptWordScore:       number;
  rawScore:               number;   // sum before cap (60)
  finalScore:             number;   // after scaling to titleMissionFitMax
}

export interface V5OrgTypeTrace {
  userOrgType:   string;
  oppTargetType: OppTargetType;
  cuesFound:     string[];
  fitCategory:   "exact" | "compatible" | "neutral" | "mismatch" | "strong_mismatch";
  score:         number;
  mismatchReason?: string;
}

export interface V5ScoreTrace {
  org:  OrgProfile;
  opp:  NormalizedOpportunity;

  passes_eligibility: boolean;
  eligibility_reason: string;

  titleMissionFit:    number;
  orgTypeFit:         number;
  populationTitleFit: number;
  geographySanity:    number;
  genericPenalty:     number;
  finalScore:         number;

  confidence: "excellent" | "strong" | "moderate" | "weak";
  reasons:    string[];
  risks:      string[];
  audit_trace: string[];

  titleTrace:   V5TitleTrace;
  orgTypeTrace: V5OrgTypeTrace;

  dimensions:     Record<string, number>;
  dimensionMaxes: Record<string, number>;
  config: V5Config;
  interpretedProfile?: InterpretedOpportunityProfile | null;
}

// ─── Global mission phrase fallback library ───────────────────────────────────
// Used ONLY as fallback/augmentation. Org-derived phrases take priority.

export const MISSION_PHRASES: Array<{ phrase: string; weight: number }> = [
  { phrase: "maternal health equity",              weight: 20 },
  { phrase: "maternal health",                     weight: 18 },
  { phrase: "birth equity",                        weight: 18 },
  { phrase: "maternal mortality",                  weight: 18 },
  { phrase: "prenatal care",                       weight: 18 },
  { phrase: "postpartum care",                     weight: 18 },
  { phrase: "reproductive health",                 weight: 16 },
  { phrase: "birth outcomes",                      weight: 16 },
  { phrase: "obstetric care",                      weight: 16 },
  { phrase: "mental health equity",                weight: 18 },
  { phrase: "mental health",                       weight: 16 },
  { phrase: "behavioral health",                   weight: 16 },
  { phrase: "substance use disorder",              weight: 16 },
  { phrase: "substance abuse",                     weight: 16 },
  { phrase: "addiction treatment",                 weight: 16 },
  { phrase: "suicide prevention",                  weight: 18 },
  { phrase: "crisis intervention",                 weight: 16 },
  { phrase: "workforce development",               weight: 16 },
  { phrase: "job training",                        weight: 16 },
  { phrase: "career development",                  weight: 14 },
  { phrase: "employment services",                 weight: 14 },
  { phrase: "vocational training",                 weight: 16 },
  { phrase: "youth mentorship",                    weight: 16 },
  { phrase: "youth development",                   weight: 14 },
  { phrase: "after-school",                        weight: 14 },
  { phrase: "affordable housing",                  weight: 16 },
  { phrase: "homelessness prevention",             weight: 16 },
  { phrase: "housing assistance",                  weight: 14 },
  { phrase: "permanent supportive housing",        weight: 18 },
  { phrase: "housing instability",                 weight: 16 },
  { phrase: "clean energy",                        weight: 16 },
  { phrase: "renewable energy",                    weight: 16 },
  { phrase: "solar energy",                        weight: 16 },
  { phrase: "wind energy",                         weight: 16 },
  { phrase: "climate change",                      weight: 14 },
  { phrase: "carbon reduction",                    weight: 16 },
  { phrase: "greenhouse gas",                      weight: 16 },
  { phrase: "sustainable technology",              weight: 16 },
  { phrase: "carbon emissions",                    weight: 16 },
  { phrase: "decarbonization",                     weight: 18 },
  { phrase: "clean technology",                    weight: 16 },
  { phrase: "climate resilience",                  weight: 16 },
  { phrase: "violence prevention",                 weight: 16 },
  { phrase: "gun violence",                        weight: 18 },
  { phrase: "domestic violence",                   weight: 16 },
  { phrase: "community violence intervention",     weight: 20 },
  { phrase: "public safety",                       weight: 12 },
  { phrase: "crime prevention",                    weight: 16 },
  { phrase: "small business development",          weight: 18 },
  { phrase: "small business",                      weight: 14 },
  { phrase: "entrepreneurship",                    weight: 14 },
  { phrase: "commercialization",                   weight: 16 },
  { phrase: "technology transfer",                 weight: 16 },
  { phrase: "startup",                             weight: 12 },
  { phrase: "sbir",                                weight: 18 },
  { phrase: "sttr",                                weight: 18 },
  { phrase: "stem education",                      weight: 16 },
  { phrase: "early childhood education",           weight: 18 },
  { phrase: "k-12 education",                      weight: 14 },
  { phrase: "higher education",                    weight: 12 },
  { phrase: "arts education",                      weight: 16 },
  { phrase: "coding education",                    weight: 16 },
  { phrase: "literacy",                            weight: 12 },
  { phrase: "health equity",                       weight: 16 },
  { phrase: "public health",                       weight: 12 },
  { phrase: "community health",                    weight: 12 },
  { phrase: "health disparities",                  weight: 16 },
  { phrase: "food security",                       weight: 16 },
  { phrase: "food access",                         weight: 16 },
  { phrase: "clean water",                         weight: 16 },
  { phrase: "water quality",                       weight: 16 },
  { phrase: "environmental justice",               weight: 16 },
  { phrase: "environmental health",                weight: 14 },
  { phrase: "veteran services",                    weight: 16 },
  { phrase: "veteran housing",                     weight: 18 },
  { phrase: "veteran mental health",               weight: 18 },
  { phrase: "immigrant services",                  weight: 16 },
  { phrase: "refugee services",                    weight: 16 },
  { phrase: "disability services",                 weight: 14 },
  { phrase: "aging in place",                      weight: 16 },
  { phrase: "senior services",                     weight: 14 },
  { phrase: "legal aid",                           weight: 16 },
  { phrase: "access to justice",                   weight: 16 },
  { phrase: "criminal justice reform",             weight: 18 },
  { phrase: "digital equity",                      weight: 16 },
  { phrase: "broadband access",                    weight: 16 },
  { phrase: "agricultural technology",             weight: 16 },
  { phrase: "agritech",                            weight: 16 },
  { phrase: "precision agriculture",               weight: 18 },
  { phrase: "economic development",                weight: 12 },
  { phrase: "community development",               weight: 10 },
  { phrase: "neighborhood revitalization",         weight: 16 },
  { phrase: "disaster relief",                     weight: 14 },
  { phrase: "arts and culture",                    weight: 14 },
  { phrase: "creative arts",                       weight: 14 },
  { phrase: "performing arts",                     weight: 14 },
];

// Pre-built lookup: phrase → weight
const MISSION_PHRASE_MAP = new Map<string, number>(
  MISSION_PHRASES.map(p => [p.phrase.toLowerCase(), p.weight])
);

// ─── Generic title words (low information value for scoring) ──────────────────
const GENERIC_TITLE_WORDS = new Set([
  "community", "support", "services", "innovation", "outcomes",
  "development", "improvement", "program", "initiative", "opportunity",
  "project", "grant", "award", "fund", "funding", "assistance",
  "advance", "enhance", "strengthen", "build", "improve", "increase",
  "promote", "provide", "access", "capacity", "impact", "new",
  "comprehensive", "integrated", "collaborative", "partnership",
  "national", "general", "based", "related", "special", "action",
  "activities", "solutions", "strategy", "approach", "effort", "focus",
  "delivery", "implementation", "planning", "coordination", "management",
  "local", "regional", "federal", "state", "public", "private",
]);

// ─── Stop words for mission n-gram extraction ─────────────────────────────────
// More comprehensive than GENERIC_TITLE_WORDS — includes connectors/verbs.
const NGRAM_STOP_WORDS = new Set([
  "a", "an", "the", "this", "that", "these", "those", "each", "all",
  "both", "some", "many", "most", "more", "very", "also",
  "of", "in", "on", "to", "by", "at", "as", "for", "with", "from",
  "into", "through", "within", "across", "about", "over", "under",
  "around", "between", "among", "against", "toward",
  "and", "or", "but", "nor", "so", "yet", "while", "although",
  "because", "since", "if", "when", "than", "such",
  "we", "our", "they", "their", "it", "its", "he", "she", "us",
  "who", "which", "what", "where", "that",
  "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "will", "can", "do", "does", "did",
  "provide", "provides", "providing",
  "serve", "serves", "serving",
  "help", "helps", "helping",
  "support", "supports", "supporting",
  "ensure", "ensures", "ensuring",
  "work", "works", "working",
  "focus", "focuses", "focusing",
  "promote", "promotes", "promoting",
  "advance", "advances", "advancing",
  "create", "creates", "creating",
  "enable", "enables", "enabling",
  "make", "makes", "making",
  "improve", "improves", "improving",
  "increase", "increases", "increasing",
  "including", "via", "using", "based",
]);

// ─── Raw score tiers (per phrase category) ────────────────────────────────────
// These are pre-scaling raw points (scale: 0–60 cap).
const SCORE_TIERS = {
  keyword_exact:      45, // org JSON keywords, exact title match
  program_area_exact: 40, // org JSON program_areas, exact title match
  mission_exact:      28, // org mission-extracted phrase, exact title match
  population_exact:   12, // org population_served phrase, exact title match
  keyword_near:       28, // near/variant match on keyword phrase
  program_area_near:  24, // near/variant match on program_area phrase
  mission_near:       17, // near/variant match on mission phrase
  population_near:     7, // near/variant match on population phrase
  global_exact:       14, // global MISSION_PHRASES exact (org-overlapping only)
  global_near:         7, // global MISSION_PHRASES near (org-overlapping only)
  concept_word:        3, // individual concept word from org (max 3 words capped)
  interp_desc_phrase: 18, // high-value phrase from interpreter's description analysis
  interp_subdomain:   12, // description subdomain tag overlap with org concepts
} as const;

// ─── Phrase synonym groups ─────────────────────────────────────────────────────
// Bidirectional: if org has phrase A and title has phrase B in same group → near match.
const PHRASE_SYNONYM_GROUPS: string[][] = [
  ["workforce development", "workforce training", "workforce readiness", "workforce program", "workforce initiative"],
  ["job training", "career training", "skills training", "vocational training", "employment training", "job skills training"],
  ["youth workforce", "youth employment", "youth career", "youth careers", "young adult employment", "youth job"],
  ["youth development", "youth programs", "youth services", "youth opportunities", "youth engagement", "youth empowerment"],
  ["maternal health", "maternal care", "prenatal health", "maternal wellness", "maternal support"],
  ["mental health", "behavioral health", "mental wellness", "psychological health"],
  ["affordable housing", "housing affordability", "affordable homes", "low income housing", "low-income housing"],
  ["housing assistance", "housing support", "rental assistance", "housing services"],
  ["food security", "food access", "food insecurity", "food assistance", "food support"],
  ["clean energy", "renewable energy", "green energy", "sustainable energy"],
  ["renewable energy", "clean energy", "green energy", "solar energy", "wind energy"],
  ["climate change", "climate action", "climate resilience", "climate crisis", "climate adaptation"],
  ["stem education", "science education", "technology education", "stem learning", "stem program"],
  ["early childhood education", "early learning", "preschool education", "early childhood development"],
  ["digital equity", "digital access", "broadband access", "internet access", "technology access"],
  ["community health", "public health", "population health"],
  ["violence prevention", "violence reduction", "anti-violence"],
  ["criminal justice reform", "justice reform", "reentry programs", "criminal justice"],
  ["small business development", "business development", "entrepreneur support"],
  ["environmental justice", "environmental equity", "climate justice"],
  ["health equity", "health disparities", "health inequity"],
];

// Pre-built bidirectional lookup: phrase → sibling phrases in same group
const SYNONYM_LOOKUP = new Map<string, string[]>();
for (const group of PHRASE_SYNONYM_GROUPS) {
  for (const phrase of group) {
    const norm = phrase.toLowerCase();
    SYNONYM_LOOKUP.set(norm, group.map(p => p.toLowerCase()).filter(p => p !== norm));
  }
}

// ─── Population normalization variants ───────────────────────────────────────
const POPULATION_VARIANTS: Array<[string, string[]]> = [
  ["youth",           ["young people", "young adults", "teens", "teenagers", "adolescents", "children and youth", "at-risk youth", "at risk youth"]],
  ["young people",    ["youth", "young adults", "teens", "adolescents"]],
  ["low income",      ["low-income", "economically disadvantaged", "underserved", "under-resourced", "low-wealth", "low income families"]],
  ["low-income",      ["low income", "economically disadvantaged", "underserved", "under-resourced"]],
  ["underserved",     ["under-resourced", "low income", "marginalized", "disadvantaged", "disinvested"]],
  ["women",           ["female", "women and girls", "girls", "womens"]],
  ["veterans",        ["veteran", "military veterans", "service members", "military families"]],
  ["seniors",         ["older adults", "elderly", "aging adults", "older people", "senior citizens", "aging population"]],
  ["seniors",         ["older adults", "elderly", "aging", "elders"]],
  ["immigrants",      ["immigrant", "refugee", "newcomers", "foreign-born", "refugees"]],
  ["refugees",        ["refugee", "immigrant", "asylum seekers", "displaced"]],
  ["disabilities",    ["disability", "people with disabilities", "disabled", "differently abled", "special needs"]],
  ["rural",           ["rural communities", "rural populations", "rural areas", "frontier"]],
  ["homeless",        ["homelessness", "housing insecure", "unhoused", "people experiencing homelessness"]],
  ["black",           ["african american", "black community", "black residents", "african-american"]],
  ["latino",          ["hispanic", "latinx", "latina", "latino", "hispanic community"]],
  ["indigenous",      ["native american", "tribal", "first nations", "alaska native", "american indian"]],
  ["children",        ["kids", "youth", "minors", "young children", "early childhood"]],
];

// ─── Weighted org phrase type ─────────────────────────────────────────────────

interface WeightedOrgPhrase {
  phrase:  string;  // lowercase, normalized
  weight:  number;  // 8–18
  source:  "keyword" | "program_area" | "mission" | "population";
}

// ─── Helper: normalize phrase (hyphens, punctuation, whitespace) ──────────────

function normalizePhrase(s: string): string {
  return s.toLowerCase()
    .replace(/[-–—]/g, " ")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Helper: light stemmer (suffix stripping only) ────────────────────────────

function stemLight(word: string): string {
  if (word.length < 5) return word;
  if (word.endsWith("ies") && word.length > 5) return word.slice(0, -3) + "y";
  if (word.endsWith("ied") && word.length > 5) return word.slice(0, -3) + "y";
  if (word.endsWith("ing") && word.length > 6) return word.slice(0, -3);
  if (word.endsWith("tion") && word.length > 6) return word.slice(0, -4);
  if (word.endsWith("ness") && word.length > 6) return word.slice(0, -4);
  if (word.endsWith("ment") && word.length > 6) return word.slice(0, -4);
  if (word.endsWith("al") && word.length > 5) return word.slice(0, -2);
  if (word.endsWith("ers") && word.length > 5) return word.slice(0, -1); // services→service
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && word.length > 4) return word.slice(0, -1);
  return word;
}

// ─── Helper: true if all words in a phrase are generic ───────────────────────

function isAllGenericPhrase(phrase: string): boolean {
  const words = phrase.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  return words.length > 0 && words.every(w => GENERIC_TITLE_WORDS.has(w));
}

// ─── Helper: extract meaningful bigrams/trigrams from mission text ────────────

function extractMissionNgrams(mission: string): string[] {
  const words = mission
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/['-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 1);

  // Collect positions of non-stop, non-trivial words
  const meaningful: Array<{ w: string; i: number }> = [];
  words.forEach((w, i) => {
    if (!NGRAM_STOP_WORDS.has(w) && w.length > 2) {
      meaningful.push({ w, i });
    }
  });

  const ngrams: string[] = [];

  // Bigrams: pairs of consecutive meaningful words within distance 3
  for (let i = 0; i < meaningful.length - 1; i++) {
    const { w: w1, i: p1 } = meaningful[i];
    const { w: w2, i: p2 } = meaningful[i + 1];
    if (p2 - p1 <= 3 && (w1.length > 3 || w2.length > 3)) {
      ngrams.push(`${w1} ${w2}`);
    }
  }

  // Trigrams: triplets within distance 5 (first to last position)
  for (let i = 0; i < meaningful.length - 2; i++) {
    const { w: w1, i: p1 } = meaningful[i];
    const { w: w2 } = meaningful[i + 1];
    const { w: w3, i: p3 } = meaningful[i + 2];
    const specificEnough = [w1, w2, w3].filter(w => w.length > 3 && !GENERIC_TITLE_WORDS.has(w)).length >= 2;
    if (p3 - p1 <= 5 && specificEnough) {
      ngrams.push(`${w1} ${w2} ${w3}`);
    }
  }

  return [...new Set(ngrams)];
}

// ─── Build weighted org phrase set from org JSON ──────────────────────────────
/**
 * Derives a weighted, deduplicated phrase set from the org's own data.
 * Priority: keywords (18) > program_areas (15) > mission ngrams (13) > population (8)
 * Phrases that consist entirely of generic words are excluded.
 */
function buildWeightedOrgPhrases(org: OrgProfile): WeightedOrgPhrase[] {
  const all: WeightedOrgPhrase[] = [];

  // 1. Keywords (highest weight — org's own stated search terms)
  for (const kw of org.keywords ?? []) {
    const phrase = kw.toLowerCase().trim();
    if (phrase.length > 2 && !isAllGenericPhrase(phrase)) {
      all.push({ phrase, weight: 18, source: "keyword" });
    }
  }

  // 2. Program areas (high weight)
  for (const pa of org.program_areas ?? []) {
    const phrase = pa.toLowerCase().trim();
    if (phrase.length > 2 && !isAllGenericPhrase(phrase)) {
      all.push({ phrase, weight: 15, source: "program_area" });
    }
  }

  // 3. Mission text — extract meaningful multi-word phrases
  if (org.mission) {
    const ngrams = extractMissionNgrams(org.mission);
    for (const phrase of ngrams) {
      if (!isAllGenericPhrase(phrase)) {
        all.push({ phrase, weight: 13, source: "mission" });
      }
    }
  }

  // 4. Population served (supportive weight — mainly for population dimension)
  for (const pop of org.population_served ?? []) {
    const phrase = pop.toLowerCase().trim();
    if (phrase.length > 2 && !isAllGenericPhrase(phrase)) {
      all.push({ phrase, weight: 8, source: "population" });
    }
  }

  // Deduplicate: keep highest weight per phrase
  const map = new Map<string, WeightedOrgPhrase>();
  for (const p of all) {
    const norm = normalizePhrase(p.phrase);
    const existing = map.get(norm);
    if (!existing || existing.weight < p.weight) {
      map.set(norm, { ...p, phrase: norm });
    }
  }

  return [...map.values()].sort((a, b) => b.weight - a.weight);
}

// ─── Helper: check near match between org phrase and normalized title ─────────
/**
 * Returns true if the title is a near-equivalent of orgPhrase via:
 *  1. Normalized match (hyphens, plurals, punctuation)
 *  2. Synonym group lookup
 *  3. Word-overlap (stem-based, strict thresholds)
 */
function checkNearMatch(orgPhrase: string, titleNorm: string): boolean {
  const normOrg = normalizePhrase(orgPhrase);

  // 1. Already a substring after normalization
  if (titleNorm.includes(normOrg)) return true;

  // 2. Synonym group lookup (bidirectional)
  const siblings = SYNONYM_LOOKUP.get(normOrg) ?? [];
  for (const sib of siblings) {
    if (titleNorm.includes(normalizePhrase(sib))) return true;
  }

  // 3. Word-overlap with stem normalization
  const orgWords = normOrg
    .split(/\s+/)
    .filter(w => w.length > 2 && !NGRAM_STOP_WORDS.has(w));

  if (orgWords.length < 2) return false; // single words need exact match

  const titleWords = titleNorm.split(/\s+/);
  const matchCount = orgWords.filter(ow => {
    const stemOw = stemLight(ow);
    return titleWords.some(tw => stemLight(tw) === stemOw || tw === ow);
  }).length;

  // For 2-word phrases: require BOTH (100%). For 3+: require ceil(75%).
  const threshold = orgWords.length === 2 ? 2 : Math.ceil(orgWords.length * 0.75);
  return matchCount >= threshold;
}

// ─── Remove sub-phrase duplicates from a list ─────────────────────────────────
function deduplicateSubphrases(phrases: string[]): string[] {
  return phrases.filter(
    (p, i) => !phrases.some(
      (other, j) => i !== j && other.length > p.length && other.includes(p)
    )
  );
}

// ─── Org-type cue words in titles/eligibility ─────────────────────────────────
const ORG_TYPE_TITLE_CUES: Record<OppTargetType, string[]> = {
  nonprofit: [
    "nonprofit", "non-profit", "501(c)(3)", "501c3",
    "community organization", "community-based organization", "cbo",
    "ngo", "charitable organization", "advocacy organization",
    "community service organization",
  ],
  small_business: [
    "small business", "sbir", "sttr", "startup", "commercialization",
    "entrepreneurship", "small disadvantaged business",
    "woman-owned", "minority-owned", "8(a) business",
    "business development", "small firm",
  ],
  university: [
    "university", "college", "academic institution", "higher education",
    "hbcu", "postsecondary", "institution of higher", "research university",
    "community college", "tribal college", "graduate school",
    "undergraduate", "faculty", "research institution",
  ],
  government: [
    "local government", "state agency", "municipal", "county government",
    "city government", "public agency", "government agency",
    "state government", "units of government",
  ],
  tribal: [
    "tribal", "tribe", "indian tribe", "native american", "alaska native",
    "indigenous", "tribal nation", "federally recognized tribe",
    "tribal organization",
  ],
  contractor: [
    "contractor", "procurement", "solicitation", "rfp", "rfi",
    "contract opportunity", "acquisition", "vendor", "offeror",
    "prime contractor", "subcontractor", "sources sought",
  ],
  healthcare: [
    "hospital", "clinic", "health center", "healthcare provider",
    "health system", "medical center", "health care organization",
    "federally qualified health center", "fqhc", "rural health",
    "health care provider",
  ],
  individual: [
    "individual", "fellowship", "scholarship", "investigator",
    "student", "researcher", "doctoral", "postdoctoral", "early career",
  ],
  any: [],
};

// ─── Org-type ↔ Opp-target fit matrix ────────────────────────────────────────
// `any` reduced from 13 → 7: neutral/unknown target no longer inflates score.
const FIT_MATRIX: Record<string, Record<OppTargetType, number>> = {
  nonprofit: {
    nonprofit: 25, any: 7, healthcare: 15, government: 8,
    university: 8, small_business: 4, contractor: 2, tribal: 10, individual: 3,
  },
  small_business: {
    small_business: 25, contractor: 18, any: 7, government: 10,
    nonprofit: 4, university: 8, healthcare: 6, tribal: 8, individual: 3,
  },
  university: {
    university: 25, individual: 14, any: 7, nonprofit: 10,
    government: 8, small_business: 8, healthcare: 8, contractor: 5, tribal: 8,
  },
  government: {
    government: 25, tribal: 20, any: 7, nonprofit: 10,
    university: 10, small_business: 10, healthcare: 10, contractor: 12, individual: 3,
  },
  tribal: {
    tribal: 25, government: 18, nonprofit: 12, any: 7,
    university: 10, small_business: 10, healthcare: 10, contractor: 5, individual: 5,
  },
  healthcare: {
    healthcare: 25, nonprofit: 15, any: 7, government: 10,
    university: 10, small_business: 5, contractor: 5, tribal: 10, individual: 8,
  },
  other: {
    any: 7, nonprofit: 10, small_business: 10, university: 10,
    government: 10, tribal: 10, healthcare: 10, contractor: 8, individual: 5,
  },
};

// ─── OrgConcepts ──────────────────────────────────────────────────────────────

interface OrgConcepts {
  weightedPhrases: WeightedOrgPhrase[];  // all org-derived phrases with weights
  conceptWords:    string[];             // individual non-generic words for tier-4
  populationTags:  string[];             // population_served values
}

function extractOrgConcepts(org: OrgProfile): OrgConcepts {
  const weightedPhrases = buildWeightedOrgPhrases(org);

  // Derive individual concept words from all phrase sources
  const wordSet = new Set<string>();
  for (const { phrase } of weightedPhrases) {
    phrase.split(/\s+/).forEach(w => {
      if (w.length > 3 && !GENERIC_TITLE_WORDS.has(w) && !NGRAM_STOP_WORDS.has(w)) {
        wordSet.add(w);
      }
    });
  }
  // Also pull words directly from mission text
  (org.mission ?? "").toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 4 && !GENERIC_TITLE_WORDS.has(w) && !NGRAM_STOP_WORDS.has(w))
    .forEach(w => wordSet.add(w));

  const populationTags = (org.population_served ?? []).map(t => t.toLowerCase().trim());

  return {
    weightedPhrases,
    conceptWords: [...wordSet],
    populationTags,
  };
}

// ─── Infer user org type ──────────────────────────────────────────────────────

function inferUserOrgType(org: OrgProfile): string {
  const t = (org.org_type ?? "").toLowerCase();
  if (t === "small_business" || org.is_small_business) return "small_business";
  if (t === "university")                               return "university";
  if (t === "government")                               return "government";
  if (t === "tribal")                                   return "tribal";
  if (t === "healthcare")                               return "healthcare";
  if (t === "nonprofit" || org.has_501c3)               return "nonprofit";
  const mission = (org.mission ?? "").toLowerCase();
  if (mission.includes("hospital") || mission.includes("clinic"))    return "healthcare";
  if (mission.includes("university") || mission.includes("college")) return "university";
  return "nonprofit";
}

// ─── Infer opportunity target org type ───────────────────────────────────────

function inferOppTargetOrgType(opp: NormalizedOpportunity): {
  targetType: OppTargetType;
  cuesFound: string[];
} {
  const combined = [opp.title ?? "", ...(opp.eligibility ?? [])].join(" ").toLowerCase();
  const found: Array<{ type: OppTargetType; cues: string[] }> = [];

  for (const [type, cues] of Object.entries(ORG_TYPE_TITLE_CUES) as [OppTargetType, string[]][]) {
    if (type === "any") continue;
    const matched = cues.filter(cue => combined.includes(cue.toLowerCase()));
    if (matched.length > 0) found.push({ type, cues: matched });
  }

  if (found.length === 0) return { targetType: "any", cuesFound: [] };
  found.sort((a, b) => b.cues.length - a.cues.length);
  return { targetType: found[0].type, cuesFound: found[0].cues };
}

// ─── Dimension: title mission fit (v5.1 rewrite) ──────────────────────────────
/**
 * 4-pass scoring:
 *  Pass 1: org-derived exact phrase matches (highest tier)
 *  Pass 2: org-derived near phrase matches (synonym + normalized word overlap)
 *  Pass 3: global MISSION_PHRASES exact (only if org-concept-overlapping)
 *  Pass 4: global MISSION_PHRASES near (same constraint)
 *  +bonus:  individual concept words (capped, low value per word)
 */
function computeTitleMissionFit(
  orgConcepts: OrgConcepts,
  opp: NormalizedOpportunity,
  maxScore: number,
  interpreted?: InterpretedOpportunityProfile | null,
): V5TitleTrace {
  const titleRaw  = (opp.title ?? "").toLowerCase();
  const titleNorm = normalizePhrase(titleRaw);
  const titleWords = titleNorm.split(/\s+/).filter(w => w.length > 1);

  const orgDerivedExactMatches: string[] = [];
  const orgDerivedNearMatches:  string[] = [];
  const globalExactMatches:     string[] = [];
  const globalNearMatches:      string[] = [];
  const conceptMatches:         string[] = [];

  let orgDerivedExactScore = 0;
  let orgDerivedNearScore  = 0;
  let globalFallbackScore  = 0;
  let conceptWordScore     = 0;

  // ── Pass 1 & 2: Org-derived phrase matching ───────────────────────────────
  const matchedOrgPhraseWords = new Set<string>(); // track already-matched title words

  for (const { phrase, weight, source } of orgConcepts.weightedPhrases) {
    const norm = normalizePhrase(phrase);

    // Exact match
    if (titleNorm.includes(norm)) {
      // Dedup: skip if this phrase is a sub-phrase of an already-matched phrase
      const alreadyCoveredByLonger = orgDerivedExactMatches
        .some(m => normalizePhrase(m).includes(norm) && normalizePhrase(m).length > norm.length);
      if (!alreadyCoveredByLonger) {
        orgDerivedExactMatches.push(phrase);
        const tier = source === "keyword" ? SCORE_TIERS.keyword_exact
          : source === "program_area"     ? SCORE_TIERS.program_area_exact
          : source === "population"       ? SCORE_TIERS.population_exact
          : SCORE_TIERS.mission_exact;
        orgDerivedExactScore += tier;
        norm.split(/\s+/).forEach(w => matchedOrgPhraseWords.add(w));
      }
      continue; // don't also near-match
    }

    // Near match (only for phrases not already covered by a longer exact match)
    const alreadyExact = orgDerivedExactMatches.some(m =>
      m.toLowerCase() === phrase.toLowerCase()
    );
    if (!alreadyExact && checkNearMatch(phrase, titleNorm)) {
      orgDerivedNearMatches.push(phrase);
      const tier = source === "keyword" ? SCORE_TIERS.keyword_near
        : source === "program_area"     ? SCORE_TIERS.program_area_near
        : source === "population"       ? SCORE_TIERS.population_near
        : SCORE_TIERS.mission_near;
      orgDerivedNearScore += tier;
    }
  }

  // ── Pass 3 & 4: Global MISSION_PHRASES fallback ───────────────────────────
  // Only credit if: (a) phrase not already credited, (b) it overlaps org concepts
  const alreadyCreditedNorms = new Set([
    ...orgDerivedExactMatches.map(normalizePhrase),
    ...orgDerivedNearMatches.map(normalizePhrase),
  ]);

  for (const { phrase, weight } of MISSION_PHRASES) {
    const pl = phrase.toLowerCase();
    const pn = normalizePhrase(phrase);
    if (alreadyCreditedNorms.has(pn)) continue;

    // Check org-concept overlap: at least one non-stop/non-generic word in phrase
    // must appear in the org's concept word pool
    const phraseWords = pn.split(/\s+/).filter(w => !GENERIC_TITLE_WORDS.has(w) && w.length > 3);
    const hasOrgOverlap = phraseWords.some(pw =>
      orgConcepts.conceptWords.some(cw => stemLight(cw) === stemLight(pw) || cw.includes(pw) || pw.includes(cw))
    );
    if (!hasOrgOverlap) continue;

    const tier_exact = weight >= 16 ? SCORE_TIERS.global_exact : Math.round(SCORE_TIERS.global_exact * 0.7);
    const tier_near  = weight >= 16 ? SCORE_TIERS.global_near  : Math.round(SCORE_TIERS.global_near  * 0.7);

    if (titleNorm.includes(pn)) {
      globalExactMatches.push(phrase);
      globalFallbackScore += tier_exact;
      alreadyCreditedNorms.add(pn);
    } else if (checkNearMatch(phrase, titleNorm)) {
      globalNearMatches.push(phrase);
      globalFallbackScore += tier_near;
      alreadyCreditedNorms.add(pn);
    }
  }

  // ── Pass 4 (bonus): individual concept word matches ───────────────────────
  // Only credit words not already part of a matched phrase
  let conceptWordCount = 0;
  for (const cw of orgConcepts.conceptWords) {
    if (conceptWordCount >= 3) break; // cap at 3 concept word bonuses
    if (matchedOrgPhraseWords.has(cw)) continue; // already credited via phrase match
    if (titleWords.includes(cw) || titleWords.some(tw => stemLight(tw) === stemLight(cw))) {
      conceptMatches.push(cw);
      conceptWordScore += SCORE_TIERS.concept_word;
      conceptWordCount++;
    }
  }

  // ── Pass 5: Interpreter description phrases (if interpreter is available) ──
  // High-value phrases found in the description that overlap org concepts add
  // a modest bonus, rewarding relevant opportunities with generic titles.
  let interpDescScore = 0;
  if (interpreted) {
    const descPhrases = interpreted.inferredDescPhrases ?? [];
    for (const phrase of descPhrases) {
      const pn = normalizePhrase(phrase);
      if (alreadyCreditedNorms.has(pn)) continue;
      // Must overlap org concepts
      const phraseWords = pn.split(/\s+/).filter(w => !GENERIC_TITLE_WORDS.has(w) && w.length > 3);
      const hasOverlap = phraseWords.some(pw =>
        orgConcepts.conceptWords.some(cw => stemLight(cw) === stemLight(pw) || cw.includes(pw) || pw.includes(cw))
      );
      if (!hasOverlap) continue;
      // Only a fraction of the title score: cap contribution
      interpDescScore = Math.min(18, interpDescScore + SCORE_TIERS.interp_desc_phrase);
      alreadyCreditedNorms.add(pn);
      if (interpDescScore >= 18) break; // cap at one phrase bonus
    }
    // Subdomain tag overlap bonus
    const subdomainTags = interpreted.subdomainTags ?? [];
    for (const tag of subdomainTags) {
      const tn = normalizePhrase(tag);
      const hasOrgOverlap = orgConcepts.conceptWords.some(cw => tn.includes(stemLight(cw)) || stemLight(cw) === tn);
      if (hasOrgOverlap) {
        interpDescScore = Math.min(18 + 12, interpDescScore + SCORE_TIERS.interp_subdomain);
        break;
      }
    }
  }

  // ── Genericity analysis ───────────────────────────────────────────────────
  const genericTermsDetected  = titleWords.filter(w => GENERIC_TITLE_WORDS.has(w));
  const specificTermsDetected = titleWords.filter(w => !GENERIC_TITLE_WORDS.has(w) && w.length > 2);
  const specificityRatio = titleWords.length > 0
    ? specificTermsDetected.length / titleWords.length
    : 0;

  // ── Final roll-up ─────────────────────────────────────────────────────────
  const rawScore   = Math.min(60, orgDerivedExactScore + orgDerivedNearScore + globalFallbackScore + conceptWordScore + interpDescScore);
  const finalScore = maxScore > 0 ? Math.round((rawScore / 60) * maxScore) : 0;

  // Deduplicate sub-phrases in match lists
  const orgExactDeduped = deduplicateSubphrases(orgDerivedExactMatches);
  const orgNearDeduped  = deduplicateSubphrases(orgDerivedNearMatches);

  return {
    orgDerivedExactMatches: orgExactDeduped,
    orgDerivedNearMatches:  orgNearDeduped,
    globalExactMatches:     [...new Set(globalExactMatches)],
    globalNearMatches:      [...new Set(globalNearMatches)],
    conceptMatches:         [...new Set(conceptMatches)],
    // Legacy aliases
    exactPhraseMatches: [...new Set([...orgExactDeduped, ...globalExactMatches])],
    nearPhraseMatches:  [...new Set([...orgNearDeduped,  ...globalNearMatches])],
    genericWordsInTitle: genericTermsDetected,
    // Genericity
    genericTermsDetected,
    specificTermsDetected,
    specificityRatio,
    // Score breakdown
    orgDerivedExactScore:  Math.min(60, orgDerivedExactScore),
    orgDerivedNearScore:   Math.min(60, orgDerivedNearScore),
    globalFallbackScore:   Math.min(60, globalFallbackScore),
    conceptWordScore,
    rawScore,
    finalScore,
  };
}

// ─── Dimension: org type fit ──────────────────────────────────────────────────

function computeOrgTypeFit(
  userOrgType: string,
  opp: NormalizedOpportunity,
  maxScore: number,
  interpreted?: InterpretedOpportunityProfile | null,
): V5OrgTypeTrace {
  // Prefer interpreter's org-type inference if confidence is sufficient
  let targetType: OppTargetType;
  let cuesFound: string[];

  if (interpreted && interpreted.intendedOrgTypes.length > 0 &&
      interpreted.confidence.orgType >= 0.4) {
    // Use the top-confidence org type from the interpreter
    const interpType = interpreted.intendedOrgTypes[0] as OppTargetType;
    targetType = (interpType in FIT_MATRIX["nonprofit"]) ? interpType : "any";
    cuesFound = [`interpreter: ${interpreted.intendedOrgTypes.slice(0, 3).join(", ")} (conf=${interpreted.confidence.orgType.toFixed(2)})`];
  } else {
    const inferred = inferOppTargetOrgType(opp);
    targetType = inferred.targetType;
    cuesFound = inferred.cuesFound;
  }

  const row      = FIT_MATRIX[userOrgType] ?? FIT_MATRIX["other"];
  const rawScore = row[targetType] ?? row["any"] ?? 7;
  const score    = maxScore > 0 ? Math.round((rawScore / 25) * maxScore) : 0;

  const fitCategory: V5OrgTypeTrace["fitCategory"] =
    rawScore >= 22 ? "exact" :
    rawScore >= 15 ? "compatible" :
    rawScore >=  8 ? "neutral" :
    rawScore >=  5 ? "mismatch" :
    "strong_mismatch";

  const mismatchReason =
    fitCategory === "mismatch" || fitCategory === "strong_mismatch"
      ? (targetType !== "any"
          ? `Opportunity targets ${targetType}s — org type is ${userOrgType}`
          : `No org-type cues found in title or eligibility`)
      : undefined;

  return { userOrgType, oppTargetType: targetType, cuesFound, fitCategory, score, mismatchReason };
}

// ─── Dimension: population in title (with variant normalization) ──────────────

function computePopulationTitleFit(
  org: OrgProfile,
  opp: NormalizedOpportunity,
  maxScore: number,
  interpreted?: InterpretedOpportunityProfile | null,
): { score: number; matched: string[]; matchedVariants: string[] } {
  // Combine title + interpreter's description population tags for richer matching
  const titleNorm = normalizePhrase(opp.title ?? "");
  const descNorm  = interpreted
    ? normalizePhrase((opp.description ?? "").slice(0, 500))
    : "";
  const searchText = descNorm ? `${titleNorm} ${descNorm}` : titleNorm;
  const popTags   = (org.population_served ?? []).map(t => normalizePhrase(t));

  let raw = 0;
  const matched: string[] = [];
  const matchedVariants: string[] = [];

  for (const pop of popTags) {
    // Title exact match scores highest
    if (titleNorm.includes(pop)) {
      raw = 10; matched.push(pop); break;
    }
    // Description match (via searchText) scores slightly less
    if (searchText !== titleNorm && searchText.includes(pop)) {
      raw = Math.max(raw, 8); matched.push(`${pop} (desc)`);
    }
    // Check known variants in title
    const variants = POPULATION_VARIANTS.find(([key]) => normalizePhrase(key) === pop);
    if (variants) {
      const found = variants[1].find(v => titleNorm.includes(normalizePhrase(v)));
      if (found) { raw = Math.max(raw, 8); matchedVariants.push(`${pop} ≈ "${found}"`); }
      // Also check variants in description
      if (!found && searchText !== titleNorm) {
        const foundDesc = variants[1].find(v => searchText.includes(normalizePhrase(v)));
        if (foundDesc) { raw = Math.max(raw, 6); matchedVariants.push(`${pop} ≈ "${foundDesc}" (desc)`); }
      }
    }
    // Reverse lookup: is this pop's words a variant of a known canonical?
    for (const [canonical, varList] of POPULATION_VARIANTS) {
      if (varList.map(normalizePhrase).includes(pop) && titleNorm.includes(normalizePhrase(canonical))) {
        raw = Math.max(raw, 8);
        matchedVariants.push(`${pop} ≈ "${canonical}"`);
      }
    }
    // Single-word fallback (low value)
    const popWords = pop.split(/\s+/).filter(w => w.length > 3);
    if (popWords.some(w => titleNorm.includes(w))) {
      raw = Math.max(raw, 5);
    }
  }

  const score = maxScore > 0 ? Math.round((Math.min(10, raw) / 10) * maxScore) : 0;
  return { score, matched, matchedVariants };
}

// ─── Dimension: geography sanity ─────────────────────────────────────────────

function computeGeographySanity(
  org: OrgProfile,
  opp: NormalizedOpportunity,
  maxScore: number,
): number {
  const orgGeo     = (org.geography ?? []).map(g => g.toLowerCase());
  const titleLower = (opp.title ?? "").toLowerCase();
  const source     = (opp.source ?? "").toLowerCase();

  const orgIsUS     = orgGeo.some(g => ["united states", "us", "usa", "america"].some(u => g.includes(u)));
  const orgIsGlobal = orgGeo.some(g => g.includes("global") || g.includes("international"));

  if (orgIsUS && !orgIsGlobal) {
    const euSrc = source.includes("ted_eu") || titleLower.includes("european union") ||
                  titleLower.includes("ted eu") || titleLower.includes("ukri");
    if (euSrc) return Math.round(maxScore * 0.2);
  }
  return maxScore > 0 ? Math.round(maxScore * 0.85) : 0;
}

// ─── Dimension: generic title penalty (v5.1 — match-aware) ───────────────────
/**
 * Penalty is multiplied DOWN when strong org-derived exact matches are present,
 * multiplied UP when no matches found at all and the title is mostly generic.
 * This prevents penalizing "Youth Workforce Development Program" while heavily
 * penalizing "Community Innovation Improvement Initiative".
 */
function computeGenericPenalty(
  opp: NormalizedOpportunity,
  hasOrgDerivedExact: boolean,
  hasAnyMatch: boolean,
  maxPenalty: number,
): { penalty: number; genericTermsDetected: string[]; specificTermsDetected: string[]; ratio: number } {
  const words = (opp.title ?? "")
    .toLowerCase()
    .split(/[\s\-\/,()]+/)
    .filter(w => w.length > 1);

  if (words.length === 0) {
    return { penalty: 0, genericTermsDetected: [], specificTermsDetected: [], ratio: 0 };
  }

  const genericTermsDetected  = words.filter(w => GENERIC_TITLE_WORDS.has(w));
  const specificTermsDetected = words.filter(w => !GENERIC_TITLE_WORDS.has(w) && w.length > 2);
  const ratio = genericTermsDetected.length / words.length;

  // Base penalty (kicks in at 20%, full at 70%)
  let basePenalty = 0;
  if (ratio >= 0.20) {
    basePenalty = Math.round(((ratio - 0.20) / 0.50) * maxPenalty);
  }

  // Multiplier: reduce penalty when strong exact phrases present (they signal specificity)
  let multiplier: number;
  if (hasOrgDerivedExact) {
    multiplier = 0.25; // Strong exact match → minimal penalty even if some generic words present
  } else if (hasAnyMatch) {
    multiplier = 0.60; // Near/global match → moderate penalty reduction
  } else if (ratio >= 0.50) {
    multiplier = 1.40; // No match + majority generic → amplify
  } else {
    multiplier = 1.00;
  }

  const penalty = Math.min(maxPenalty, Math.round(basePenalty * multiplier));
  return { penalty, genericTermsDetected, specificTermsDetected, ratio };
}

// ─── Main scorer ──────────────────────────────────────────────────────────────

export function scoreMatchV5(
  org: OrgProfile,
  opp: NormalizedOpportunity,
  config: V5Config = DEFAULT_V5_CONFIG,
  interpreted?: InterpretedOpportunityProfile | null,
): V5ScoreTrace {
  const trace: string[] = [];

  const orgConcepts = extractOrgConcepts(org);
  const userOrgType = inferUserOrgType(org);

  const topOrgPhrases = orgConcepts.weightedPhrases.slice(0, 5).map(p => `"${p.phrase}"(${p.source})`);
  trace.push(`[Org] "${org.name}" | type=${userOrgType}`);
  trace.push(`[Org] top derived phrases=[${topOrgPhrases.join(", ") || "none"}]`);
  trace.push(`[Org] population=[${orgConcepts.populationTags.slice(0, 3).join(", ") || "none"}]`);

  // Eligibility (lightweight)
  let passes_eligibility = true;
  let eligibility_reason = "Open — no explicit eligibility constraints parsed";
  const eligArr = opp.eligibility ?? [];
  if (eligArr.length > 0) {
    eligibility_reason = eligArr.slice(0, 2).join("; ");
  }

  if (interpreted) trace.push(`[Interpreter] domains=[${interpreted.domainTags.slice(0,3).join(", ")}] | orgTypes=[${interpreted.intendedOrgTypes.slice(0,2).join(", ")}] | conf=${interpreted.confidence.orgType.toFixed(2)}`);

  // 1. Title Mission Fit
  const titleTrace = computeTitleMissionFit(orgConcepts, opp, config.titleMissionFitMax, interpreted);

  trace.push(`[Title] "${(opp.title ?? "").slice(0, 70)}"`);
  trace.push(`  specificity=${(titleTrace.specificityRatio * 100).toFixed(0)}% | specific=[${titleTrace.specificTermsDetected.slice(0, 5).join(", ")}]`);
  trace.push(`  generic=[${titleTrace.genericTermsDetected.slice(0, 5).join(", ")}]`);
  trace.push(`  org-exact=[${titleTrace.orgDerivedExactMatches.join(", ") || "none"}] (+${titleTrace.orgDerivedExactScore}pts)`);
  trace.push(`  org-near=[${titleTrace.orgDerivedNearMatches.join(", ") || "none"}] (+${titleTrace.orgDerivedNearScore}pts)`);
  trace.push(`  global-fallback=[${[...titleTrace.globalExactMatches, ...titleTrace.globalNearMatches].join(", ") || "none"}] (+${titleTrace.globalFallbackScore}pts)`);
  trace.push(`  concept-words=[${titleTrace.conceptMatches.join(", ") || "none"}] (+${titleTrace.conceptWordScore}pts)`);
  trace.push(`  raw=${titleTrace.rawScore}/60 → titleFit=${titleTrace.finalScore}/${config.titleMissionFitMax}`);

  // 2. Org Type Fit
  const orgTypeTrace = computeOrgTypeFit(userOrgType, opp, config.orgTypeFitMax, interpreted);
  trace.push(`[OrgType] user=${orgTypeTrace.userOrgType} → opp=${orgTypeTrace.oppTargetType} | fit=${orgTypeTrace.fitCategory} | score=${orgTypeTrace.score}/${config.orgTypeFitMax}`);
  if (orgTypeTrace.cuesFound.length > 0) trace.push(`  cues=[${orgTypeTrace.cuesFound.join(", ")}]`);
  if (orgTypeTrace.mismatchReason) trace.push(`  ⚠ ${orgTypeTrace.mismatchReason}`);

  // 3. Population in Title
  const popResult = computePopulationTitleFit(org, opp, config.populationTitleMax, interpreted);
  const populationTitleFit = popResult.score;
  trace.push(`[Population] score=${populationTitleFit}/${config.populationTitleMax}` +
    (popResult.matched.length > 0 ? ` | exact=[${popResult.matched.join(", ")}]` : "") +
    (popResult.matchedVariants.length > 0 ? ` | variants=[${popResult.matchedVariants.join(", ")}]` : ""));

  // 4. Geography Sanity
  const geographySanity = computeGeographySanity(org, opp, config.geographyMax);
  trace.push(`[Geography] score=${geographySanity}/${config.geographyMax}`);

  // 5. Generic Penalty
  const hasOrgDerivedExact = titleTrace.orgDerivedExactMatches.length > 0;
  const hasAnyMatch = hasOrgDerivedExact
    || titleTrace.orgDerivedNearMatches.length > 0
    || titleTrace.globalExactMatches.length > 0
    || titleTrace.globalNearMatches.length > 0;

  const penaltyResult = computeGenericPenalty(opp, hasOrgDerivedExact, hasAnyMatch, config.genericPenaltyMax);
  const genericPenalty = penaltyResult.penalty;

  trace.push(`[GenericPenalty] -${genericPenalty}/${config.genericPenaltyMax} | ratio=${(penaltyResult.ratio * 100).toFixed(0)}% | multiplier=${
    hasOrgDerivedExact ? "0.25 (has org-exact)" : hasAnyMatch ? "0.60 (has match)" : penaltyResult.ratio >= 0.50 ? "1.40 (no match+generic)" : "1.00"
  }`);

  // Final score
  const positiveSum = titleTrace.finalScore + orgTypeTrace.score + populationTitleFit + geographySanity;
  const finalScore  = Math.max(0, Math.min(100, positiveSum - genericPenalty));
  trace.push(`[Score] ${titleTrace.finalScore}+${orgTypeTrace.score}+${populationTitleFit}+${geographySanity}-${genericPenalty} = ${finalScore}`);

  const confidence =
    finalScore >= 70 ? "excellent" :
    finalScore >= 55 ? "strong" :
    finalScore >= 38 ? "moderate" :
    "weak";

  // Reasons
  const reasons: string[] = [];
  if (titleTrace.orgDerivedExactMatches.length > 0)
    reasons.push(`Org mission phrase in title: ${titleTrace.orgDerivedExactMatches.slice(0, 2).join(", ")}`);
  else if (titleTrace.orgDerivedNearMatches.length > 0)
    reasons.push(`Near-match to org phrase in title: ${titleTrace.orgDerivedNearMatches.slice(0, 2).join(", ")}`);
  else if (titleTrace.globalExactMatches.length > 0)
    reasons.push(`Related domain phrase in title: ${titleTrace.globalExactMatches.slice(0, 2).join(", ")}`);
  if (titleTrace.conceptMatches.length > 0)
    reasons.push(`Org focus area words in title: ${titleTrace.conceptMatches.slice(0, 3).join(", ")}`);
  if (orgTypeTrace.fitCategory === "exact")
    reasons.push(`Strong org-type match: ${orgTypeTrace.userOrgType} = intended applicant`);
  else if (orgTypeTrace.fitCategory === "compatible")
    reasons.push(`Compatible org-type: ${orgTypeTrace.userOrgType} can competitively apply`);
  if (populationTitleFit >= 7)
    reasons.push(`Served population found in title: ${[...popResult.matched, ...popResult.matchedVariants].slice(0, 2).join(", ")}`);

  // Risks
  const risks: string[] = [];
  if (!hasAnyMatch)
    risks.push("No org mission concept found in title — check full description before applying");
  if (genericPenalty >= Math.round(config.genericPenaltyMax * 0.6))
    risks.push(`Title is highly generic (${(titleTrace.specificityRatio * 100).toFixed(0)}% specific) — low ranking signal`);
  if (orgTypeTrace.mismatchReason)
    risks.push(orgTypeTrace.mismatchReason);

  return {
    org, opp,
    passes_eligibility,
    eligibility_reason,
    titleMissionFit:    titleTrace.finalScore,
    orgTypeFit:         orgTypeTrace.score,
    populationTitleFit,
    geographySanity,
    genericPenalty,
    finalScore,
    confidence,
    reasons, risks,
    audit_trace: trace,
    titleTrace,
    orgTypeTrace,
    dimensions: {
      titleMissionFit:    titleTrace.finalScore,
      orgTypeFit:         orgTypeTrace.score,
      populationTitleFit,
      geographySanity,
      genericPenalty,
    },
    dimensionMaxes: {
      titleMissionFit:    config.titleMissionFitMax,
      orgTypeFit:         config.orgTypeFitMax,
      populationTitleFit: config.populationTitleMax,
      geographySanity:    config.geographyMax,
      genericPenalty:     config.genericPenaltyMax,
    },
    config,
    interpretedProfile: interpreted ?? null,
  };
}
