/**
 * test-v4-algorithm.ts
 *
 * Fetches real opportunities from all 8 active grant databases,
 * runs the V4 consolidated matching algorithm against all 21 test profiles,
 * and writes a full results report.
 *
 * Usage:  pnpm --filter @workspace/api-server exec tsx scripts/test-v4-algorithm.ts
 *   OR:   npx tsx scripts/test-v4-algorithm.ts  (from repo root)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ─── Inline V4 Logic (standalone, no @/ alias) ───────────────────────────────
// We duplicate the core scoring here so this script runs without the Vite alias resolver.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// ─── Load test profiles ───────────────────────────────────────────────────────

interface OrgProfile {
  id: string;
  name: string;
  org_type: string;
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

interface NormalizedOpportunity {
  id: string;
  source: string;
  source_raw: string;
  title: string;
  description: string;
  agency: string;
  funding_type: string;
  status: string;
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

const profilesPath = path.join(REPO_ROOT, "testprofiles.json");
const profiles: OrgProfile[] = JSON.parse(fs.readFileSync(profilesPath, "utf-8"));
console.log(`✓ Loaded ${profiles.length} test profiles`);

// ─── API Base ─────────────────────────────────────────────────────────────────

const API_BASE = process.env.API_BASE ?? "http://localhost:5000/api";

// ─── Fetch all sources ────────────────────────────────────────────────────────

async function fetchSource(name: string, url: string, timeoutMs = 20000): Promise<any[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      console.warn(`  ⚠ ${name}: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json() as any;
    const items = data.items ?? data.records ?? data.opportunities ?? [];
    console.log(`  ✓ ${name}: ${items.length} opportunities`);
    return items.map((item: any) => ({ ...item, source: name }));
  } catch (err: any) {
    console.warn(`  ✗ ${name}: ${err.message}`);
    return [];
  }
}

async function fetchAllOpportunities(): Promise<NormalizedOpportunity[]> {
  console.log("\nFetching opportunities from all 8 active sources (multi-keyword)...");

  // Multi-keyword fetch to get broader, more relevant coverage
  const SIMPLER_KEYWORDS = ["workforce", "health", "housing", "education", "climate", "community"];
  const GRANTSGOV_KEYWORDS = ["workforce development", "mental health", "affordable housing", "clean energy", "education", "legal aid"];
  const SBIR_KEYWORDS = ["technology", "small business", "energy", "agriculture", "software"];

  const fetched = await Promise.all([
    // Simpler Grants — multiple keywords
    ...SIMPLER_KEYWORDS.map(kw => fetchSource("simpler_grants", `${API_BASE}/grants/simplergrants?keyword=${encodeURIComponent(kw)}&rows=25`)),
    // Grants.gov — multiple keywords
    ...GRANTSGOV_KEYWORDS.map(kw => fetchSource("grants_gov", `${API_BASE}/grants/grantsgov?keyword=${encodeURIComponent(kw)}&rows=25`)),
    // SBIR (via USASpending historical + SBA programs)
    ...SBIR_KEYWORDS.map(kw => fetchSource("sbir", `${API_BASE}/grants/sbir?keyword=${encodeURIComponent(kw)}&rows=25`, 30000)),
    // 360Giving/UKRI
    fetchSource("threesixtygiving", `${API_BASE}/grants/threesixtygiving?keyword=community&rows=25`),
    fetchSource("threesixtygiving", `${API_BASE}/grants/threesixtygiving?keyword=health&rows=25`),
    // World Bank
    fetchSource("world_bank", `${API_BASE}/grants/worldbank?keyword=development&rows=25`),
    fetchSource("world_bank", `${API_BASE}/grants/worldbank?keyword=climate&rows=25`),
    // TED EU
    fetchSource("ted_eu", `${API_BASE}/grants/tedeu?keyword=technology&rows=25`),
    fetchSource("ted_eu", `${API_BASE}/grants/tedeu?keyword=infrastructure&rows=25`),
    // SAM.gov (may be rate limited but try)
    fetchSource("sam_gov", `${API_BASE}/grants/samgov?keyword=technology&rows=25`, 10000),
    // California Grants (may be down)
    fetchSource("california_grants", `${API_BASE}/grants/cagrants?keyword=community&rows=25`, 10000),
  ]);

  // Also try the indexed pool if available
  let indexedPool: any[] = [];
  try {
    const poolRes = await fetch(`${API_BASE}/indexing/records/for-algorithm`, { signal: AbortSignal.timeout(10000) });
    if (poolRes.ok) {
      const poolData = await poolRes.json() as any;
      indexedPool = (poolData.records ?? []).slice(0, 500);
      console.log(`  ✓ indexed_pool: ${indexedPool.length} records`);
    }
  } catch {
    console.log("  ℹ indexed_pool: not available (no DB configured)");
  }

  const rawAll = [...fetched.flat(), ...indexedPool];
  console.log(`\n  Total raw records: ${rawAll.length}`);

  // Normalize
  return normalizePool(rawAll);
}

function normalizePool(raw: any[]): NormalizedOpportunity[] {
  const seen = new Set<string>();
  const out: NormalizedOpportunity[] = [];

  for (const rec of raw) {
    // Dedup by title+source
    const dedup = `${rec.source}::${(rec.title ?? "").slice(0, 80)}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    let geoRaw: any[] = [];
    if (Array.isArray(rec.geography)) geoRaw = rec.geography;
    else if (typeof rec.geography === "string" && rec.geography) {
      try { geoRaw = JSON.parse(rec.geography); } catch { geoRaw = [rec.geography]; }
    }

    out.push({
      id: String(rec.id ?? rec.noticeId ?? Math.random()),
      source: rec.source ?? "unknown",
      source_raw: rec.source ?? "unknown",
      title: rec.title ?? "Untitled",
      description: (rec.description ?? "").slice(0, 2000),
      agency: rec.agency ?? "",
      funding_type: (rec.funding_type ?? rec.fundingType ?? "grant") as any,
      status: (rec.status ?? "active") as any,
      open_date: rec.open_date ?? rec.openDate ?? undefined,
      close_date: rec.close_date ?? rec.closeDate ?? rec.deadline ?? undefined,
      min_award: rec.min_award ?? rec.minAward ?? undefined,
      max_award: rec.max_award ?? rec.maxAward ?? parseAmount(rec.amount),
      eligibility: Array.isArray(rec.eligibility) ? rec.eligibility : [],
      categories: Array.isArray(rec.categories) ? rec.categories : [],
      keywords: Array.isArray(rec.keywords) ? rec.keywords : [],
      geography: geoRaw.filter((g: any) => g != null).map((g: any) => String(g)),
      url: rec.url ?? "",
    });
  }
  return out;
}

function parseAmount(amount: any): number | undefined {
  if (!amount) return undefined;
  const n = Number(String(amount).replace(/[^0-9.]/g, ""));
  return isNaN(n) || n === 0 ? undefined : n;
}

// ─── Simplified V4 Scorer (standalone, no Vite alias) ────────────────────────
// Full V4 logic is in artifacts/grants-explorer/src/lib/v4/matcherV4.ts
// This version is a self-contained replica for test execution.

const HIGH_VALUE_PHRASES = [
  "black maternal health", "maternal mortality", "maternal health", "birth equity",
  "reproductive health", "prenatal care", "postpartum care", "maternal morbidity",
  "racial equity", "racial justice", "health disparities", "health inequities",
  "social determinants", "black women", "black youth", "black communities",
  "indigenous peoples", "native communities", "tribal nations", "hbcu",
  "mental health", "behavioral health", "substance use disorder", "opioid crisis",
  "violence prevention", "domestic violence", "gun violence", "community violence",
  "chronic disease", "diabetes prevention", "hiv prevention", "oral health",
  "food insecurity", "food security", "disability services", "veteran health",
  "veteran services", "veteran housing",
  "workforce development", "job training", "career pathway", "workforce training",
  "job placement", "apprenticeship program", "economic mobility",
  "small business development", "entrepreneurship training", "women owned business",
  "women entrepreneurs", "startup funding", "business incubator",
  "affordable housing", "housing instability", "homelessness prevention",
  "community development", "neighborhood revitalization", "financial literacy",
  "clean energy", "renewable energy", "energy efficiency", "climate resilience",
  "climate justice", "environmental justice", "clean water", "solar energy",
  "carbon reduction", "carbon emissions", "sustainable technology",
  "water sanitation", "agricultural technology", "sustainable agriculture",
  "food systems",
  "early childhood education", "early learning", "school readiness",
  "literacy program", "college access", "stem education", "afterschool program",
  "arts education", "digital learning", "coding education",
  "public health workforce", "community health worker", "community health center",
  "rural health", "telehealth", "health equity",
  "digital equity", "digital inclusion", "broadband access",
  "government technology", "civic technology", "data infrastructure",
  "criminal justice reform", "reentry services", "legal aid",
  "civil rights", "immigration services", "refugee resettlement", "asylum seekers",
  "legal services", "access to justice",
  "public transit", "transportation equity", "mobility access",
  "humanitarian aid", "disaster relief", "disaster recovery",
  "international development", "global health",
];

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

const POPULATION_SPECIFICITY: Record<string, number> = {
  "black women": 4, "black maternal": 4, "pregnant people": 4, "pregnant women": 4,
  "black youth": 4, "black men": 4, "indigenous women": 4, "undocumented immigrants": 4,
  "domestic violence survivors": 4, "formerly incarcerated": 4, "returning citizens": 4,
  "people with disabilities": 4, "lgbtq youth": 4, "transgender women": 4,
  "black communities": 3, "african american": 3, "indigenous peoples": 3,
  "native american": 3, "latino communities": 3, "hispanic communities": 3,
  "asian american": 3, "pacific islander": 3, "refugees": 3, "immigrants": 3,
  "veterans": 3, "homeless individuals": 3, "rural communities": 3,
  "elderly": 3, "older adults": 3, "children": 3, "youth": 3,
  "farmers": 3, "small business owners": 3,
  "women": 2, "families": 2, "low income": 2, "low-income": 2,
  "underserved communities": 2, "underserved populations": 2,
  "disadvantaged": 2, "minority": 2, "people of color": 2, "bipoc": 2,
  "entrepreneurs": 2, "students": 2, "girls": 2, "businesses": 2,
  "community members": 1, "residents": 1, "individuals": 1, "all": 1,
  "public agencies": 1, "urban communities": 1,
};

const SOURCE_SBIR_PENALTY = new Set(["nonprofit", "university", "government", "international_ngo"]);
const SOURCE_SAM_PENALTY = new Set(["nonprofit", "university", "international_ngo"]);
const SOURCE_EU_PENALTY = new Set(["nonprofit", "government", "tribal"]);

function normText(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function extractPhrases(text: string): string[] {
  const n = normText(text);
  return HIGH_VALUE_PHRASES.filter(p => n.includes(p));
}

function inferOrgClass(org: OrgProfile): string {
  const t = org.org_type;
  const txt = normText([org.mission, ...org.keywords, ...org.program_areas].join(" "));
  if (t === "small_business") return "small_business";
  if (t === "university") return "university";
  if (t === "government") return txt.includes("tribal") ? "tribal" : "government";
  if (t === "nonprofit") {
    if (txt.includes("tribal") || txt.includes("native american")) return "tribal";
    if (txt.includes("research") || txt.includes("laboratory")) return "research_institution";
    if (txt.includes("international") || txt.includes("global")) return "international_ngo";
    return "nonprofit";
  }
  return "other";
}

function inferOppType(opp: NormalizedOpportunity): string {
  const src = (opp.source ?? "").toLowerCase();
  const txt = normText([opp.title, opp.description].join(" "));
  if (src === "sam_gov" || src === "ted_eu") return "procurement_contract";
  if (src === "sbir") return "research_grant";
  if (txt.includes("research") || txt.includes("clinical study")) return "research_grant";
  if (txt.includes("procurement") || txt.includes("solicitation") || txt.includes("rfp")) return "procurement_contract";
  return "program_service_grant";
}

function checkElig(orgClass: string, has501c3: boolean, isSB: boolean, types: string[]): { passes: boolean; score: number; reason: string } {
  if (types.length === 0) return { passes: true, score: 6, reason: "No constraints" };

  if (types.includes("501c3") && !has501c3) {
    if (!["government", "university", "tribal"].includes(orgClass)) {
      return { passes: false, score: 0, reason: "501(c)(3) required" };
    }
  }

  const sbOnly = types.every(t => ["small_business", "for_profit", "8a_certified", "hubzone"].includes(t));
  if (sbOnly && !isSB && !["small_business", "contractor"].includes(orgClass)) {
    return { passes: false, score: 0, reason: "Small-business-only" };
  }

  const npOnly = types.some(t => ["nonprofit", "501c3", "community_based_org"].includes(t));
  const noFP = !types.some(t => ["for_profit", "small_business", "all"].includes(t));
  if (npOnly && noFP && !["nonprofit", "tribal", "research_institution", "university", "international_ngo"].includes(orgClass)) {
    return { passes: false, score: 0, reason: `Nonprofit-only; org is ${orgClass}` };
  }

  const govOnly = types.every(t => ["government", "public_agency", "state_government", "local_government"].includes(t));
  if (govOnly && !["government", "tribal"].includes(orgClass)) {
    return { passes: false, score: 0, reason: "Government-only" };
  }

  const SATISFIES: Record<string, string[]> = {
    nonprofit: ["nonprofit", "501c3", "community_based_org", "ngo", "charity", "foundation"],
    small_business: ["small_business", "for_profit", "8a_certified", "minority_owned", "woman_owned"],
    university: ["university", "higher_education", "nonprofit", "educational_institution", "hbcu"],
    government: ["government", "public_agency", "local_government", "state_government"],
    tribal: ["tribal", "tribal_government", "native_american", "nonprofit", "government"],
    research_institution: ["nonprofit", "university", "research_institution"],
    contractor: ["small_business", "for_profit", "8a_certified"],
    international_ngo: ["nonprofit", "international", "ngo"],
    other: ["all"],
  };

  if (types.includes("all")) return { passes: true, score: 8, reason: "Open to all" };
  const allowed = SATISFIES[orgClass] ?? [];
  const exact = allowed.some(a => types.includes(a));
  if (exact) {
    let s = 8;
    if (has501c3 && types.includes("501c3")) s = 10;
    else if (isSB && types.some(t => ["small_business", "for_profit"].includes(t))) s = 9;
    return { passes: true, score: Math.min(10, s), reason: `${orgClass} eligible` };
  }
  return { passes: true, score: 5, reason: "Partial eligibility" };
}

interface ScoreResult {
  opp: NormalizedOpportunity;
  score: number;
  confidence: string;
  exactPhraseMatches: string[];
  targetApplicant: string;
  reasons: string[];
  risks: string[];
}

function scoreV4(org: OrgProfile, opp: NormalizedOpportunity): ScoreResult {
  const orgClass = inferOrgClass(org);
  const oppType = inferOppType(opp);
  const sourceKey = opp.source.toLowerCase().replace(/[^a-z0-9]/g, "_");

  // Eligibility gate
  const elig = checkElig(orgClass, org.has_501c3, org.is_small_business, opp.eligibility);
  if (!elig.passes) {
    return { opp, score: 0, confidence: "ineligible", exactPhraseMatches: [], targetApplicant: "unknown", reasons: [], risks: [elig.reason] };
  }

  // Concept fit
  const oppFullText = [opp.title, opp.description, ...opp.keywords, ...opp.categories].join(" ");
  const orgFullText = [org.mission, ...org.keywords, ...org.program_areas].join(" ");
  const oppPhrases = extractPhrases(oppFullText);
  const orgPhrases = extractPhrases(orgFullText);
  const exactMatches = orgPhrases.filter(p => oppPhrases.includes(p));

  const oppTokens = normText(opp.title + " " + opp.description).split(" ").filter(t => t.length > 2);
  const orgTokenSet = new Set(normText(orgFullText).split(" "));
  const matched = oppTokens.filter(t => orgTokenSet.has(t));
  const specific = matched.filter(t => !GENERIC_TERMS.has(t) && t.length > 3);
  const specRatio = matched.length > 0 ? specific.length / matched.length : 0;

  let conceptFit = 0;
  if (exactMatches.length >= 3) conceptFit = 18;
  else if (exactMatches.length === 2) conceptFit = 14;
  else if (exactMatches.length === 1) conceptFit = 9;
  else if (orgPhrases.length > 0 && oppPhrases.length > 0) conceptFit = 3;

  // Domain overlap (simple tag match)
  const orgDomains = new Set(normText(orgFullText).split(" ").filter(t => t.length > 4 && !GENERIC_TERMS.has(t)));
  const oppDomains = normText(oppFullText).split(" ").filter(t => t.length > 4 && !GENERIC_TERMS.has(t) && orgDomains.has(t));
  const domainBonus = Math.min(8, oppDomains.length >= 5 ? 8 : oppDomains.length >= 3 ? 5 : oppDomains.length >= 1 ? 3 : 0);
  conceptFit = Math.min(26, conceptFit + domainBonus);

  if (exactMatches.length === 0 && specRatio < 0.3 && conceptFit > 3) conceptFit = Math.max(0, conceptFit - 3);

  // Concept centrality
  const titleMatches = exactMatches.filter(p => normText(opp.title).includes(p));
  let centrality = titleMatches.length >= 2 ? 5 : titleMatches.length === 1 ? 4 : 0;
  const openingMatches = exactMatches.filter(p => normText(opp.description.slice(0, 350)).includes(p));
  if (openingMatches.length >= 2) centrality = Math.min(10, centrality + 4);
  else if (openingMatches.length === 1) centrality = Math.min(10, centrality + 2);
  centrality = Math.min(10, centrality);

  // Activity fit (keyword-based)
  const orgActivity = normText([...org.keywords, ...org.program_areas].join(" "));
  const oppActivity = normText([opp.title, opp.description.slice(0, 500)].join(" "));
  const actTokens = orgActivity.split(" ").filter(t => t.length > 4 && !GENERIC_TERMS.has(t));
  const actHits = actTokens.filter(t => oppActivity.includes(t));
  const activityFit = Math.min(10, actHits.length >= 5 ? 10 : actHits.length >= 3 ? 7 : actHits.length >= 1 ? 4 : 1);

  // Population fit
  const orgPopText = [org.mission, ...org.population_served].join(" ");
  const oppPopText = [opp.title, opp.description.slice(0, 500)].join(" ");
  const orgPops = normalizePopV4(orgPopText);
  const oppPops = normalizePopV4(oppPopText);
  let populationFit = 2;
  let populationMatches: string[] = [];
  if (orgPops.length > 0 && oppPops.length > 0) {
    const orgSet = new Set(orgPops);
    const ms = oppPops.filter(p => orgSet.has(p));
    populationMatches = ms;
    if (ms.length > 0) {
      const maxS = Math.max(...ms.map(m => POPULATION_SPECIFICITY[m] ?? 1));
      if (maxS === 4) populationFit = ms.length >= 2 ? 8 : 7;
      else if (maxS === 3) populationFit = ms.length >= 2 ? 6 : 5;
      else if (maxS === 2) populationFit = ms.length >= 2 ? 4 : 3;
      else populationFit = 2;
    } else {
      populationFit = 1;
    }
  }

  // Target applicant
  const targetText = [opp.title, opp.description, ...opp.eligibility].join(" ").toLowerCase();
  let targetApplicant = "open";
  let targetScore = 8;
  let targetMismatch = 0;
  let targetMismatchReason = "";

  if (targetText.includes("hbcu") || targetText.includes("historically black college")) targetApplicant = "hbcu_institution";
  else if (targetText.includes("small business") || targetText.includes("startup") || targetText.includes("entrepreneur")) targetApplicant = "small_business";
  else if (oppType === "procurement_contract" || targetText.includes("vendor") || targetText.includes("solicitation")) targetApplicant = "contractor";
  else if (targetText.includes("university") || targetText.includes("college") || oppType === "research_grant") targetApplicant = "research_university";
  else if (targetText.includes("community nonprofit") || targetText.includes("community-based") || targetText.includes("501(c)(3)")) targetApplicant = "community_nonprofit";
  else if (targetText.includes("nonprofit") || targetText.includes("ngo")) targetApplicant = "nonprofit";

  if (oppType === "procurement_contract" && !["small_business", "contractor", "government"].includes(orgClass)) {
    targetScore = 3; targetMismatch = 10;
    targetMismatchReason = "Procurement requires SAM registration and past-performance documentation";
  } else if (oppType === "research_grant" && !["university", "research_institution"].includes(orgClass)) {
    targetScore = orgClass === "nonprofit" ? 5 : 3;
    targetMismatch = orgClass === "nonprofit" ? 5 : 8;
    targetMismatchReason = "Research grants typically require PI credentials and academic infrastructure";
  } else {
    const COMPAT: Record<string, string[]> = {
      small_business: ["small_business", "contractor"],
      community_nonprofit: ["nonprofit", "tribal"],
      nonprofit: ["nonprofit", "tribal", "research_institution", "university"],
      contractor: ["contractor", "small_business"],
      research_university: ["university", "research_institution"],
      government: ["government", "tribal"],
      open: ["nonprofit", "small_business", "university", "government", "tribal", "research_institution", "contractor"],
    };
    const compat = COMPAT[targetApplicant] ?? COMPAT["open"];
    if (compat.includes(orgClass)) {
      targetScore = targetApplicant === "community_nonprofit" && orgClass === "nonprofit" ? 12 : 10;
    } else {
      targetScore = 6;
    }
  }
  const targetApplicantFit = Math.min(12, targetScore);

  // Geography
  const orgGeoNorm = org.geography.map(g => normText(g));
  const oppGeoNorm = opp.geography.map(g => normText(g));
  let geographyFit = 4;
  if (oppGeoNorm.length === 0) geographyFit = 5;
  else {
    const oppGeoStr = oppGeoNorm.join(" ");
    if (oppGeoStr.includes("global") || oppGeoStr.includes("international")) geographyFit = 5;
    else if (oppGeoStr.includes("united states") || oppGeoStr.includes("national") || oppGeoStr.includes("nationwide")) {
      const orgUS = orgGeoNorm.some(g => g.includes("united states") || g === "us" || g === "usa" || g === "national");
      const orgHasState = orgGeoNorm.some(g => g.length > 2 && !["us", "usa"].includes(g));
      geographyFit = (orgUS || orgHasState) ? 8 : 2;
    } else {
      let match = false;
      for (const og of orgGeoNorm) {
        for (const op of oppGeoNorm) {
          if (og.includes(op) || op.includes(og)) { match = true; break; }
        }
        if (match) break;
      }
      geographyFit = match ? 8 : 0;
    }
  }

  // Capacity fit
  const budget = org.annual_budget;
  const years = org.years_in_operation;
  const capBand = budget < 100000 ? "early" : budget < 500000 ? "growing" : budget < 5000000 ? "established" : "enterprise";
  const oppText2 = normText([opp.title, opp.description].join(" "));
  const complexity = oppText2.includes("federal") || oppText2.includes("multi-year") || oppText2.includes("competitive") ? "high" : "medium";
  const capacityFit = capBand === "enterprise" ? 7 : capBand === "established" ? 6 : capBand === "growing" ? 5 : 3;

  // Funding fit
  let fundingFit = 3;
  if (opp.max_award != null && budget > 0) {
    const max = opp.max_award;
    const min = opp.min_award ?? 0;
    if (max >= budget * 0.10 && min <= budget * 3.0) fundingFit = 6;
    else if (max >= budget * 0.05 && min <= budget * 5.0) fundingFit = 4;
    else if (max < budget * 0.05) fundingFit = 2;
    else fundingFit = 3;
  }

  // Source relevance
  let sourceRelevance = 1;
  if (sourceKey === "sbir" && ["small_business", "contractor"].includes(orgClass)) sourceRelevance = 3;
  else if (sourceKey === "grants_gov" && ["nonprofit", "university", "government"].includes(orgClass)) sourceRelevance = 3;
  else if (sourceKey === "simpler_grants" && ["nonprofit", "university", "government"].includes(orgClass)) sourceRelevance = 3;
  else if (sourceKey === "world_bank" && ["international_ngo", "university"].includes(orgClass)) sourceRelevance = 3;

  const baseScore = conceptFit + centrality + activityFit + populationFit +
    targetApplicantFit + elig.score + geographyFit + capacityFit + fundingFit + sourceRelevance;

  // Semantic boost
  const hasPhraseSig = exactMatches.length >= 2;
  const hasPopSig = populationMatches.length > 0;
  const hasGeoSig = geographyFit >= 7;
  const semanticBoost = Math.min(8, (hasPhraseSig ? 3 : 0) + (hasPopSig ? 2 : 0) + (hasGeoSig ? 3 : 0));

  // Recency boost
  let recencyBoost = 0;
  if (opp.open_date) {
    const daysAgo = (Date.now() - new Date(opp.open_date).getTime()) / (1000 * 60 * 60 * 24);
    if (daysAgo <= 14) recencyBoost = 3;
    else if (daysAgo <= 30) recencyBoost = 2;
    else if (daysAgo <= 60) recencyBoost = 1;
  }

  // Penalties
  let penalties = 0;
  const risks: string[] = [];

  // Genericity penalty
  if (exactMatches.length === 0 && specRatio < 0.2 && baseScore > 30) {
    const p = Math.min(15, Math.round(baseScore * (1 - specRatio) * 0.35));
    penalties += p;
    if (p > 0) risks.push("Score driven largely by generic terms");
  } else if (exactMatches.length === 0 && specRatio < 0.35) {
    const p = Math.min(8, Math.round(baseScore * (1 - specRatio) * 0.15));
    penalties += p;
  }

  // Weak specificity
  if (exactMatches.length === 0 && centrality < 4) {
    if (conceptFit < 8) { penalties += 8; risks.push("Weak concept fit and low centrality"); }
    else if (conceptFit < 12) { penalties += 4; risks.push("No central concept connection"); }
  }

  // Target mismatch
  if (targetMismatch > 0) { penalties += targetMismatch; risks.push(targetMismatchReason); }

  // Population mismatch
  if (populationMatches.length === 0 && orgPops.length > 0 && oppPops.length > 0) {
    const oppHS = oppPops.filter(p => (POPULATION_SPECIFICITY[p] ?? 1) >= 3);
    if (oppHS.length > 0) {
      const orgHS = orgPops.filter(p => (POPULATION_SPECIFICITY[p] ?? 1) >= 3);
      const p = orgHS.length > 0 ? 6 : 3;
      penalties += p;
      risks.push(`Pop mismatch: opp targets ${oppHS[0]}`);
    }
  }

  // Source barrier
  if (sourceKey === "sbir" && SOURCE_SBIR_PENALTY.has(orgClass)) {
    penalties += 12;
    risks.push("SBIR/STTR is exclusively for small businesses");
  }
  if (sourceKey === "sam_gov" && SOURCE_SAM_PENALTY.has(orgClass)) {
    penalties += 8;
    risks.push("SAM.gov procurement requires past-performance documentation");
  }
  if (sourceKey === "ted_eu" && SOURCE_EU_PENALTY.has(orgClass)) {
    penalties += 10;
    risks.push("EU procurement requires EU business registration or local partner");
  }

  // Funding capacity
  if (budget > 0 && opp.min_award != null && opp.min_award > budget * 5) {
    penalties += 5;
    risks.push(`Min award ($${opp.min_award.toLocaleString()}) may exceed org management capacity`);
  }

  const finalScore = Math.max(0, Math.min(100, baseScore + semanticBoost + recencyBoost - penalties));

  const confidence =
    finalScore >= 70 ? "excellent" :
    finalScore >= 55 ? "strong" :
    finalScore >= 38 ? "moderate" : "weak";

  const reasons: string[] = [];
  if (exactMatches.length >= 2) reasons.push(`${exactMatches.length} exact concept phrases: ${exactMatches.slice(0, 2).join(", ")}`);
  else if (exactMatches.length === 1) reasons.push(`Exact match: "${exactMatches[0]}"`);
  if (centrality >= 4) reasons.push("Core concept in opportunity title");
  if (targetApplicantFit >= 10) reasons.push(`"${orgClass}" is the intended applicant type`);
  if (populationMatches.length > 0) reasons.push(`Population: ${populationMatches.slice(0, 2).join(", ")}`);
  if (geographyFit >= 7) reasons.push("Geographic alignment confirmed");

  return { opp, score: finalScore, confidence, exactPhraseMatches: exactMatches, targetApplicant, reasons, risks };
}

function normalizePopV4(text: string): string[] {
  const n = normText(text);
  const found = Object.keys(POPULATION_SPECIFICITY).filter(t => n.includes(t));
  return found.filter(t => !found.some(o => o !== t && o.includes(t) && o.length > t.length));
}

// ─── Run Tests ────────────────────────────────────────────────────────────────

interface ProfileResult {
  profile: OrgProfile;
  total_opportunities_scored: number;
  eligible_count: number;
  top_matches: Array<{
    rank: number;
    title: string;
    source: string;
    agency: string;
    score: number;
    confidence: string;
    exact_phrases: string[];
    target_applicant: string;
    reasons: string[];
    risks: string[];
    url: string;
  }>;
  score_distribution: Record<string, number>;
  source_coverage: Record<string, number>;
}

function runV4ForProfile(org: OrgProfile, pool: NormalizedOpportunity[]): ProfileResult {
  const ACTIVE = new Set(["simpler_grants", "grants_gov", "sam_gov", "sbir", "threesixtygiving", "california_grants", "world_bank", "ted_eu"]);

  const filtered = pool.filter(o => {
    const src = o.source.toLowerCase().replace(/[^a-z0-9]/g, "_");
    if (!ACTIVE.has(src)) return false;
    if (o.close_date && new Date(o.close_date) < new Date()) return false;
    return true;
  });

  const scored = filtered.map(o => scoreV4(org, o));
  const eligible = scored.filter(r => r.score > 0);

  // Source diversity cap (max 3 per source)
  const sourceCounts: Record<string, number> = {};
  const topMatches: typeof eligible = [];
  const sorted = [...eligible].sort((a, b) => b.score - a.score);

  for (const r of sorted) {
    if (topMatches.length >= 10) break;
    const src = r.opp.source.toLowerCase().replace(/[^a-z0-9]/g, "_");
    if ((sourceCounts[src] ?? 0) >= 3) continue;
    sourceCounts[src] = (sourceCounts[src] ?? 0) + 1;
    topMatches.push(r);
  }

  // Score distribution
  const dist: Record<string, number> = { "70-100 (excellent)": 0, "55-69 (strong)": 0, "38-54 (moderate)": 0, "25-37 (weak)": 0, "<25 or ineligible": 0 };
  for (const r of scored) {
    if (r.score >= 70) dist["70-100 (excellent)"]++;
    else if (r.score >= 55) dist["55-69 (strong)"]++;
    else if (r.score >= 38) dist["38-54 (moderate)"]++;
    else if (r.score >= 25) dist["25-37 (weak)"]++;
    else dist["<25 or ineligible"]++;
  }

  // Source coverage in top matches
  const srcCov: Record<string, number> = {};
  for (const r of topMatches) {
    const src = r.opp.source;
    srcCov[src] = (srcCov[src] ?? 0) + 1;
  }

  return {
    profile: org,
    total_opportunities_scored: filtered.length,
    eligible_count: eligible.length,
    top_matches: topMatches.map((r, i) => ({
      rank: i + 1,
      title: r.opp.title.slice(0, 100),
      source: r.opp.source,
      agency: r.opp.agency,
      score: r.score,
      confidence: r.confidence,
      exact_phrases: r.exactPhraseMatches,
      target_applicant: r.targetApplicant,
      reasons: r.reasons,
      risks: r.risks.slice(0, 3),
      url: r.opp.url,
    })),
    score_distribution: dist,
    source_coverage: srcCov,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  V4 Algorithm Test — All Sources × All Profiles");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // 1. Fetch all opportunities
  const pool = await fetchAllOpportunities();
  const ACTIVE_SOURCES = new Set(["simpler_grants", "grants_gov", "sam_gov", "sbir", "threesixtygiving", "california_grants", "world_bank", "ted_eu"]);
  const activePool = pool.filter(o => ACTIVE_SOURCES.has(o.source.toLowerCase().replace(/[^a-z0-9]/g, "_")));

  if (activePool.length === 0) {
    console.error("\n❌ No opportunities loaded. Is the API server running on port 5000?");
    console.error("   Start it with: pnpm run dev:api\n");
    process.exit(1);
  }

  console.log(`\n  Active pool: ${activePool.length} opportunities from ${new Set(activePool.map(o => o.source)).size} sources`);
  const srcBreakdown: Record<string, number> = {};
  for (const o of activePool) srcBreakdown[o.source] = (srcBreakdown[o.source] ?? 0) + 1;
  for (const [src, cnt] of Object.entries(srcBreakdown)) {
    console.log(`    ${src.padEnd(20)} ${cnt}`);
  }

  // 2. Run V4 for all profiles
  console.log("\n\nRunning V4 algorithm on all profiles...\n");
  const results: ProfileResult[] = [];

  for (const org of profiles) {
    process.stdout.write(`  ${org.name.padEnd(35)}`);
    const result = runV4ForProfile(org, activePool);
    results.push(result);
    const top = result.top_matches[0];
    if (top) {
      console.log(`score=${top.score.toString().padStart(3)} (${top.confidence}) ← "${top.title.slice(0, 50)}"`);
    } else {
      console.log("no matches above threshold");
    }
  }

  // 3. Summary report
  console.log("\n\n═══════════════════════════════════════════════════════════════");
  console.log("  TOP RESULTS PER PROFILE");
  console.log("═══════════════════════════════════════════════════════════════\n");

  for (const r of results) {
    console.log(`┌─ ${r.profile.name} (${r.profile.org_type})`);
    console.log(`│  Budget: $${r.profile.annual_budget.toLocaleString()} | Years: ${r.profile.years_in_operation} | Pool scored: ${r.total_opportunities_scored}`);
    if (r.top_matches.length === 0) {
      console.log(`│  ⚠  No matches above threshold\n└─`);
    } else {
      for (const m of r.top_matches.slice(0, 3)) {
        console.log(`│  #${m.rank} [${m.score.toString().padStart(3)}/${m.confidence.toUpperCase().slice(0,3)}] ${m.title.slice(0, 70)}`);
        console.log(`│      📍 ${m.source} | ${m.agency.slice(0, 50)}`);
        if (m.reasons.length > 0) console.log(`│      ✓ ${m.reasons[0]}`);
        if (m.risks.length > 0 && m.risks[0]) console.log(`│      ⚠ ${m.risks[0]}`);
      }
      console.log(`└─`);
    }
    console.log();
  }

  // 4. Algorithm quality metrics
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  ALGORITHM QUALITY METRICS");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const allTopScores = results.map(r => r.top_matches[0]?.score ?? 0);
  const withMatches = results.filter(r => r.top_matches.length > 0);
  const avgTopScore = withMatches.length > 0 ? Math.round(withMatches.reduce((s, r) => s + (r.top_matches[0]?.score ?? 0), 0) / withMatches.length) : 0;
  const excellent = withMatches.filter(r => (r.top_matches[0]?.score ?? 0) >= 70).length;
  const strong = withMatches.filter(r => (r.top_matches[0]?.score ?? 0) >= 55).length;
  const noMatch = results.filter(r => r.top_matches.length === 0).length;

  console.log(`  Profiles tested:          ${results.length}`);
  console.log(`  Profiles with matches:    ${withMatches.length}`);
  console.log(`  Profiles with no match:   ${noMatch}`);
  console.log(`  Avg top-match score:      ${avgTopScore}`);
  console.log(`  Excellent (≥70) profiles: ${excellent}`);
  console.log(`  Strong (≥55) profiles:    ${strong}`);
  console.log(`  Source diversity:         ${new Set(withMatches.flatMap(r => r.top_matches.map(m => m.source))).size} sources represented in top results`);

  // Score distribution across all profiles
  const totalDist: Record<string, number> = { "70-100": 0, "55-69": 0, "38-54": 0, "25-37": 0, "<25": 0 };
  for (const r of results) {
    for (const m of r.top_matches) {
      if (m.score >= 70) totalDist["70-100"]++;
      else if (m.score >= 55) totalDist["55-69"]++;
      else if (m.score >= 38) totalDist["38-54"]++;
      else if (m.score >= 25) totalDist["25-37"]++;
      else totalDist["<25"]++;
    }
  }
  console.log("\n  Score Distribution (all top-10 results):");
  for (const [band, cnt] of Object.entries(totalDist)) {
    console.log(`    ${band.padEnd(10)} ${cnt.toString().padStart(4)} matches`);
  }

  // 5. Write JSON output
  const outputPath = path.join(REPO_ROOT, "v4-algorithm-results.json");
  const output = {
    generated_at: new Date().toISOString(),
    pool_size: activePool.length,
    sources: Object.keys(srcBreakdown),
    profiles_tested: results.length,
    avg_top_score: avgTopScore,
    results: results.map(r => ({
      profile_id: r.profile.id,
      profile_name: r.profile.name,
      org_type: r.profile.org_type,
      opportunities_scored: r.total_opportunities_scored,
      eligible_count: r.eligible_count,
      score_distribution: r.score_distribution,
      source_coverage: r.source_coverage,
      top_matches: r.top_matches,
    })),
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n\n✓ Full results written to: ${outputPath}`);
  console.log("\n  V4 Algorithm summary:");
  console.log("  • Consolidated single-file engine (artifacts/grants-explorer/src/lib/v4/matcherV4.ts)");
  console.log("  • 140+ high-value concept phrases (vs V3's ~80)");
  console.log("  • Source-specific scoring modifiers for all 8 databases");
  console.log("  • Recency boost for newly posted opportunities");
  console.log("  • Source-diversity cap (max 3 per source in top-K results)");
  console.log("  • Smooth funding fit curve (5 zones vs V3's binary penalty)");
  console.log("  • Improved US state geography matching");
  console.log("  • Confidence tiers: Excellent / Strong / Moderate / Weak\n");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
