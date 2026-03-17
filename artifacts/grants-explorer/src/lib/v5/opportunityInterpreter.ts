/**
 * opportunityInterpreter.ts — Data Normalization + Opportunity Interpreter Layer
 *
 * PURPOSE
 * ───────
 * Real API opportunities are messy: bureaucratic titles, buried eligibility,
 * inconsistent source schemas, and purpose hidden in descriptions.
 * This layer converts raw NormalizedOpportunity records into clean
 * InterpretedOpportunityProfile objects that the V5 matcher can score
 * more accurately, closing the gap between clean mock data and real API data.
 *
 * PIPELINE
 * ────────
 *   raw NormalizedOpportunity
 *   → normalizeRawOpportunity()        source-aware field cleaning
 *   → interpretOpportunityTitle()      title phrase / domain / population signals
 *   → interpretOpportunityDescription() description domain / activity / population signals
 *   → extractDomainTags()              domain taxonomy matching
 *   → extractActivityTags()            activity model inference
 *   → extractPopulationTags()          target population inference
 *   → inferIntendedOrgTypes()          applicant type inference (source + text + eligibility)
 *   → extractHighValuePhrases()        mission-bearing multi-word phrases
 *   → classifyOpportunityType()        grant / contract / procurement / etc.
 *   → inferGeographyScope()            local / state / national / international
 *   → InterpretedOpportunityProfile
 *   → scoreMatchV5() (consumes interpreted profile for enhanced accuracy)
 */

import type { NormalizedOpportunity } from "@/lib/algorithm/types";
import { MISSION_PHRASES } from "@/lib/v5/matcherV5";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TitleSignals {
  strongPhrases:   string[];  // multi-word phrases with high domain confidence
  weakPhrases:     string[];  // single keyword hits
  exactConcepts:   string[];  // domain/subdomain tags from strong phrase matches
  nearConcepts:    string[];  // domain/subdomain tags from keyword matches
}

export interface InterpretedOpportunityProfile {
  id:                   string;
  source:               string;
  rawTitle:             string;
  normalizedTitle:      string;     // cleaned of prefixes, codes, jargon
  rawDescription:       string | null;
  normalizedDescription: string | null;

  // Taxonomy-derived tags
  opportunityType:   string | null;
  domainTags:        string[];      // top-level: "workforce", "health", "housing"…
  subdomainTags:     string[];      // specific: "youth_workforce", "maternal_health"…
  activityTags:      string[];      // "training", "research", "procurement"…
  populationTags:    string[];      // "youth", "low_income", "veterans"…
  intendedOrgTypes:  string[];      // "nonprofit", "small_business", "contractor"…
  geographyTags:     string[];
  geographyScope:    "local" | "state" | "national" | "international" | "unknown";

  // Signal extraction
  inferredMissionPhrases:    string[];  // top phrases from title (for matcher pass 3)
  inferredDescPhrases:       string[];  // high-value phrases from description ONLY
  inferredHighValuePhrases:  string[];  // combined: title + description phrases
  genericTerms:              string[];  // vague title words

  titleSignals:       TitleSignals;
  descriptionSignals: TitleSignals;

  // Confidence (0–1 per dimension)
  confidence: {
    domain:     number;
    activity:   number;
    population: number;
    orgType:    number;
  };

  fundingMin:  number | null;
  fundingMax:  number | null;
  status:      string | null;
  closeDate:   string | null;

  interpretationTrace: string[];
  rawSourceFields:     NormalizedOpportunity;
}

// ─── Generic title words ──────────────────────────────────────────────────────
const GENERIC_WORDS = new Set([
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

// ─── Domain taxonomy ──────────────────────────────────────────────────────────
interface DomainEntry {
  domain:    string;
  subdomain: string;
  weight:    number;           // 10-20: higher = more distinctive
  phrases:   string[];         // multi-word (checked as substrings, lowercase)
  keywords:  string[];         // single meaningful words (checked as whole words)
}

const DOMAIN_TAXONOMY: DomainEntry[] = [
  // ── Health ──────────────────────────────────────────────────────────────────
  { domain: "health", subdomain: "maternal_health", weight: 20,
    phrases: ["maternal health equity", "maternal health", "birth equity", "maternal mortality",
               "prenatal care", "prenatal health", "postpartum", "birth outcomes", "obstetric",
               "maternal care", "pregnancy outcomes", "prenatal and postnatal",
               "black maternal", "reproductive health"],
    keywords: ["maternal", "prenatal", "postpartum", "obstetric", "perinatal"] },

  { domain: "health", subdomain: "mental_health", weight: 20,
    phrases: ["mental health equity", "mental health", "behavioral health", "substance use disorder",
               "substance use", "substance abuse", "addiction treatment", "suicide prevention",
               "crisis intervention", "mental wellness", "opioid", "psychiatric services",
               "peer support services", "recovery services"],
    keywords: ["mental", "behavioral", "psychiatric", "counseling", "addiction", "opioid", "overdose"] },

  { domain: "health", subdomain: "health_equity", weight: 18,
    phrases: ["health equity", "health disparities", "health inequity", "health access",
               "health outcomes equity", "social determinants of health", "sdoh"],
    keywords: ["disparities", "inequity"] },

  { domain: "health", subdomain: "public_health", weight: 14,
    phrases: ["public health", "community health", "population health", "preventive care",
               "health promotion", "disease prevention", "epidemiology", "infectious disease",
               "immunization", "vaccination"],
    keywords: ["epidemiology", "immunization", "vaccination", "pandemic"] },

  { domain: "health", subdomain: "chronic_disease", weight: 16,
    phrases: ["chronic disease", "diabetes prevention", "cardiovascular health", "cancer screening",
               "obesity prevention", "diabetes management"],
    keywords: ["diabetes", "cardiovascular", "cancer", "hypertension", "obesity", "chronic"] },

  { domain: "health", subdomain: "sexual_health", weight: 16,
    phrases: ["sexual health", "hiv prevention", "hiv/aids", "hiv aids",
               "sexually transmitted infections", "reproductive health"],
    keywords: ["hiv", "aids"] },

  // ── Workforce ────────────────────────────────────────────────────────────────
  { domain: "workforce", subdomain: "workforce_development", weight: 20,
    phrases: ["workforce development", "workforce readiness", "workforce training",
               "workforce program", "workforce initiative", "job training",
               "career development", "vocational training", "employment services",
               "skills training", "career readiness", "job skills", "career pathways",
               "career preparation", "employment training", "occupational training",
               "workforce innovation", "wioa"],
    keywords: ["workforce", "vocational", "apprenticeship", "upskilling", "reskilling"] },

  { domain: "workforce", subdomain: "youth_workforce", weight: 20,
    phrases: ["youth workforce", "youth employment", "youth career", "young adult employment",
               "youth job training", "youth work experience", "youth apprenticeship",
               "youth internship", "opportunity youth", "disconnected youth"],
    keywords: [] },

  // ── Education ────────────────────────────────────────────────────────────────
  { domain: "education", subdomain: "early_childhood", weight: 20,
    phrases: ["early childhood education", "early childhood development", "preschool education",
               "early learning", "head start", "early head start", "child care",
               "childcare", "early care", "infant toddler"],
    keywords: ["preschool", "kindergarten", "toddler", "daycare", "pre-k"] },

  { domain: "education", subdomain: "k12", weight: 16,
    phrases: ["k-12 education", "k12 education", "elementary education", "secondary education",
               "school-based", "after-school", "afterschool", "summer learning",
               "dropout prevention", "alternative education", "out-of-school"],
    keywords: ["elementary", "middle school", "high school", "dropout", "truancy"] },

  { domain: "education", subdomain: "stem", weight: 18,
    phrases: ["stem education", "stem learning", "stem program", "science education",
               "technology education", "math education", "computer science education",
               "coding education", "science technology engineering", "stem pipeline"],
    keywords: ["stem", "coding"] },

  { domain: "education", subdomain: "higher_education", weight: 14,
    phrases: ["higher education", "college access", "college readiness", "college persistence",
               "postsecondary education", "community college", "college completion"],
    keywords: ["postsecondary", "hbcu", "msi"] },

  { domain: "education", subdomain: "literacy", weight: 16,
    phrases: ["adult literacy", "reading literacy", "digital literacy", "financial literacy",
               "health literacy", "basic literacy", "adult education"],
    keywords: ["literacy", "numeracy"] },

  { domain: "education", subdomain: "arts_education", weight: 16,
    phrases: ["arts education", "arts in education", "arts integration", "music education",
               "creative arts education", "arts and education"],
    keywords: [] },

  // ── Housing ──────────────────────────────────────────────────────────────────
  { domain: "housing", subdomain: "affordable_housing", weight: 20,
    phrases: ["affordable housing", "housing affordability", "affordable homes",
               "affordable rental", "low income housing", "subsidized housing",
               "workforce housing", "affordable homeownership"],
    keywords: [] },

  { domain: "housing", subdomain: "homelessness", weight: 20,
    phrases: ["homelessness prevention", "homeless services", "emergency shelter",
               "transitional housing", "permanent supportive housing", "housing first",
               "rapid rehousing", "housing insecurity", "housing instability",
               "people experiencing homelessness", "unhoused", "shelter services",
               "street outreach"],
    keywords: ["homeless", "unhoused", "shelter"] },

  { domain: "housing", subdomain: "housing_assistance", weight: 16,
    phrases: ["housing assistance", "rental assistance", "mortgage assistance",
               "down payment assistance", "housing voucher", "housing subsidy",
               "section 8", "housing choice voucher"],
    keywords: [] },

  // ── Community Development ────────────────────────────────────────────────────
  { domain: "community_development", subdomain: "neighborhood", weight: 14,
    phrases: ["neighborhood revitalization", "community revitalization",
               "neighborhood development", "place-based development",
               "community investment", "community resilience",
               "distressed communities", "disinvested communities"],
    keywords: ["revitalization", "disinvested"] },

  { domain: "community_development", subdomain: "block_grant", weight: 16,
    phrases: ["community development block grant", "cdbg", "community services block grant",
               "csbg", "community action", "community action agency",
               "community benefit", "community action plan"],
    keywords: ["cdbg", "csbg"] },

  { domain: "community_development", subdomain: "economic_development", weight: 14,
    phrases: ["economic development", "economic opportunity", "economic mobility",
               "economic empowerment", "wealth building", "asset building",
               "financial inclusion", "financial capability", "financial coaching",
               "poverty reduction", "anti-poverty"],
    keywords: ["poverty", "financial"] },

  // ── Climate / Energy ─────────────────────────────────────────────────────────
  { domain: "climate", subdomain: "clean_energy", weight: 20,
    phrases: ["clean energy", "renewable energy", "solar energy", "wind energy",
               "energy efficiency", "clean power", "solar power", "wind power",
               "geothermal energy", "energy storage", "battery storage",
               "clean electricity", "zero emission", "electric vehicle"],
    keywords: ["solar", "wind", "renewable", "geothermal", "photovoltaic"] },

  { domain: "climate", subdomain: "decarbonization", weight: 20,
    phrases: ["carbon reduction", "greenhouse gas", "carbon emissions", "decarbonization",
               "net zero", "climate change", "climate action", "climate resilience",
               "climate adaptation", "carbon neutrality", "carbon capture",
               "emissions reduction", "net-zero"],
    keywords: ["carbon", "decarbonization", "emissions", "greenhouse", "net-zero"] },

  { domain: "climate", subdomain: "environmental_justice", weight: 18,
    phrases: ["environmental justice", "environmental equity", "climate justice",
               "environmental health", "environmental protection", "brownfields",
               "clean water", "water quality", "air quality", "clean air",
               "pollution reduction"],
    keywords: ["brownfield", "superfund", "pollution", "contamination"] },

  { domain: "climate", subdomain: "sustainable_agriculture", weight: 16,
    phrases: ["sustainable agriculture", "agricultural technology", "agritech",
               "precision agriculture", "regenerative agriculture", "soil health",
               "food systems", "conservation agriculture", "sustainable farming"],
    keywords: ["agritech", "agtech", "agroforestry"] },

  // ── Food Security ────────────────────────────────────────────────────────────
  { domain: "food", subdomain: "food_security", weight: 20,
    phrases: ["food security", "food access", "food insecurity", "food assistance",
               "nutrition assistance", "food bank", "food pantry", "emergency food",
               "nutrition services", "food desert", "food justice",
               "snap outreach", "wic services"],
    keywords: ["hunger", "snap", "wic", "pantry"] },

  // ── Public Safety ────────────────────────────────────────────────────────────
  { domain: "public_safety", subdomain: "violence_prevention", weight: 20,
    phrases: ["violence prevention", "community violence intervention",
               "gun violence prevention", "gun violence", "domestic violence",
               "intimate partner violence", "sexual assault", "violence reduction",
               "anti-violence", "trauma-informed", "community safety"],
    keywords: ["violence", "victimization"] },

  { domain: "public_safety", subdomain: "justice", weight: 18,
    phrases: ["criminal justice reform", "justice reform", "reentry", "reentry services",
               "formerly incarcerated", "incarceration reduction", "recidivism",
               "legal aid", "access to justice", "public defender",
               "restorative justice", "diversion program"],
    keywords: ["reentry", "recidivism", "parole", "probation"] },

  // ── Small Business / Innovation ──────────────────────────────────────────────
  { domain: "small_business", subdomain: "sbir_sttr", weight: 20,
    phrases: ["sbir", "sttr", "sbir phase i", "sbir phase ii",
               "small business innovation research", "small business technology transfer"],
    keywords: ["sbir", "sttr"] },

  { domain: "small_business", subdomain: "entrepreneurship", weight: 18,
    phrases: ["small business development", "small business support",
               "entrepreneurship", "business incubator", "business accelerator",
               "commercialization", "technology transfer", "startup ecosystem",
               "business formation", "entrepreneur support",
               "minority business", "women-owned business", "microloan"],
    keywords: ["startup", "entrepreneur", "incubator", "accelerator", "commercialization"] },

  // ── Technology ───────────────────────────────────────────────────────────────
  { domain: "technology", subdomain: "digital_equity", weight: 18,
    phrases: ["digital equity", "digital inclusion", "broadband access",
               "internet access", "digital divide", "technology access",
               "connectivity", "digital skills", "tech access"],
    keywords: ["broadband", "connectivity"] },

  { domain: "technology", subdomain: "innovation", weight: 14,
    phrases: ["technology innovation", "research and development", "r&d",
               "technology commercialization", "innovation hub",
               "advanced manufacturing", "emerging technology"],
    keywords: [] },

  // ── Veterans ─────────────────────────────────────────────────────────────────
  { domain: "veterans", subdomain: "veteran_services", weight: 20,
    phrases: ["veteran services", "veteran housing", "veteran mental health",
               "veteran employment", "veteran care", "veteran support",
               "military veterans", "service members", "military families",
               "veteran outreach", "va services"],
    keywords: ["veteran", "veterans", "military"] },

  // ── Disability ───────────────────────────────────────────────────────────────
  { domain: "disability", subdomain: "disability_services", weight: 18,
    phrases: ["disability services", "people with disabilities", "accessibility",
               "assistive technology", "independent living", "disability inclusion",
               "supported employment", "vocational rehabilitation"],
    keywords: ["disability", "disabled", "accessibility", "adaptive"] },

  // ── Arts / Culture ───────────────────────────────────────────────────────────
  { domain: "arts_culture", subdomain: "arts", weight: 16,
    phrases: ["arts and culture", "creative arts", "performing arts", "visual arts",
               "public art", "cultural arts", "arts programming",
               "arts organization", "community arts", "arts access",
               "arts in health"],
    keywords: ["arts", "culture", "creative", "theater", "museum", "gallery", "dance", "music"] },

  // ── Research ─────────────────────────────────────────────────────────────────
  { domain: "research", subdomain: "applied_research", weight: 14,
    phrases: ["research and development", "applied research", "basic research",
               "demonstration project", "clinical trial", "scientific research",
               "academic research", "research grant", "investigator-initiated"],
    keywords: ["research", "trial", "investigation", "demonstration"] },

  // ── International ────────────────────────────────────────────────────────────
  { domain: "international", subdomain: "global_development", weight: 14,
    phrases: ["international development", "global health", "foreign assistance",
               "developing countries", "global poverty", "overseas development",
               "humanitarian assistance", "global education"],
    keywords: ["international", "overseas", "foreign", "developing"] },

  // ── Transportation ───────────────────────────────────────────────────────────
  { domain: "transportation", subdomain: "transit", weight: 14,
    phrases: ["public transportation", "mass transit", "transit services",
               "transportation access", "mobility services", "public transit",
               "transportation infrastructure"],
    keywords: ["transit", "mobility"] },
];

// ─── Activity taxonomy ────────────────────────────────────────────────────────
interface ActivityEntry { tag: string; phrases: string[]; keywords: string[] }

const ACTIVITY_TAXONOMY: ActivityEntry[] = [
  { tag: "service_delivery",    phrases: ["direct services", "service delivery", "program delivery", "direct program", "client services"], keywords: [] },
  { tag: "capacity_building",   phrases: ["capacity building", "organizational capacity", "capacity development", "strengthen organizations", "institutional strengthening", "organizational strengthening"], keywords: ["capacity"] },
  { tag: "technical_assistance", phrases: ["technical assistance", "technical support", "training and technical assistance", "ta services", "consulting services", "coaching and mentoring"], keywords: ["technical assistance"] },
  { tag: "research",            phrases: ["research and development", "applied research", "basic research", "demonstration research", "evidence generation", "research project", "evaluation research", "randomized controlled"], keywords: ["research", "study", "investigation"] },
  { tag: "training",            phrases: ["job training", "workforce training", "skills training", "professional development", "training program", "job readiness training", "occupational training", "job skills training"], keywords: ["training", "instruction", "learning"] },
  { tag: "pilot",               phrases: ["pilot program", "pilot project", "demonstration project", "proof of concept", "innovation pilot", "pilot initiative", "test and learn"], keywords: ["pilot", "prototype", "demonstration"] },
  { tag: "planning",            phrases: ["strategic planning", "community planning", "project planning", "feasibility study", "needs assessment", "comprehensive plan", "action plan"], keywords: ["planning", "assessment", "feasibility"] },
  { tag: "implementation",      phrases: ["program implementation", "project implementation", "scale up", "scale-up", "full implementation"], keywords: ["implement", "execute", "deploy"] },
  { tag: "commercialization",   phrases: ["commercialization", "technology transfer", "market entry", "market development", "product development", "business development", "go-to-market"], keywords: ["commercialization", "licensing"] },
  { tag: "procurement",         phrases: ["procurement", "acquisition", "solicitation", "sources sought", "request for proposal", "request for information", "contract award", "indefinite delivery"], keywords: ["procurement", "solicitation", "acquisition", "rfp", "rfi"] },
  { tag: "outreach",            phrases: ["community outreach", "outreach and engagement", "community engagement", "public awareness", "stakeholder engagement", "public education campaign"], keywords: ["outreach", "awareness", "engagement"] },
  { tag: "infrastructure",      phrases: ["infrastructure development", "capital improvement", "facilities development", "construction", "renovation", "capital project", "physical infrastructure"], keywords: ["infrastructure", "capital", "construction", "renovation"] },
  { tag: "advocacy",            phrases: ["policy advocacy", "systems change", "policy reform", "legislative advocacy", "systems advocacy"], keywords: ["advocacy", "systemic", "reform"] },
];

// ─── Population taxonomy ──────────────────────────────────────────────────────
interface PopEntry { tag: string; phrases: string[]; keywords: string[] }

const POPULATION_TAXONOMY: PopEntry[] = [
  { tag: "youth",                phrases: ["youth", "young people", "young adults", "teenagers", "adolescents", "children and youth", "at-risk youth", "disconnected youth", "opportunity youth", "youth ages", "children ages"], keywords: ["youth", "teen", "adolescent"] },
  { tag: "low_income",           phrases: ["low income", "low-income", "economically disadvantaged", "below poverty", "poverty level", "underserved communities", "under-resourced", "low income individuals", "low income families"], keywords: ["poverty"] },
  { tag: "women",                phrases: ["women", "women and girls", "girls", "female", "gender equity", "women-led", "women-owned", "women of color", "gender-based"], keywords: [] },
  { tag: "veterans",             phrases: ["veterans", "veteran", "military veterans", "service members", "military families", "armed forces"], keywords: ["veteran", "military"] },
  { tag: "seniors",              phrases: ["seniors", "older adults", "elderly", "aging adults", "senior citizens", "aging population", "older persons"], keywords: ["senior", "elderly", "aging"] },
  { tag: "immigrants",           phrases: ["immigrants", "immigrant communities", "refugees", "newcomers", "foreign-born", "asylum seekers", "undocumented", "limited english proficiency"], keywords: ["immigrant", "refugee", "newcomer", "asylum"] },
  { tag: "people_with_disabilities", phrases: ["people with disabilities", "disability", "disabled", "special needs", "differently abled", "disability community"], keywords: ["disability", "disabled"] },
  { tag: "rural_communities",    phrases: ["rural communities", "rural populations", "rural areas", "frontier areas", "rural residents", "underserved rural", "rural and remote"], keywords: ["rural", "frontier"] },
  { tag: "homeless",             phrases: ["people experiencing homelessness", "homeless", "homelessness", "housing insecure", "unhoused", "street homeless"], keywords: ["homeless", "unhoused"] },
  { tag: "black_community",      phrases: ["black community", "african american", "african-american", "black residents", "black families", "black youth", "people of african descent", "historically black"], keywords: [] },
  { tag: "latino_community",     phrases: ["latino", "hispanic", "latinx", "latina", "hispanic community", "spanish-speaking"], keywords: [] },
  { tag: "indigenous",           phrases: ["native american", "indigenous", "tribal", "first nations", "alaska native", "american indian", "native hawaiian"], keywords: ["indigenous", "tribal", "native american"] },
  { tag: "children",             phrases: ["children", "kids", "minors", "infants", "toddlers", "young children", "children under"], keywords: ["children", "infant", "toddler"] },
  { tag: "families",             phrases: ["families", "family services", "family support", "low-income families", "at-risk families", "family strengthening", "family stability"], keywords: ["families", "family"] },
  { tag: "pregnant_people",      phrases: ["pregnant women", "pregnant people", "pregnant individuals", "expectant mothers", "new mothers", "postpartum women", "maternal"], keywords: ["pregnant", "expectant"] },
  { tag: "students",             phrases: ["students", "college students", "high school students", "student population", "k-12 students"], keywords: ["students", "scholars"] },
  { tag: "public_agencies",      phrases: ["public agencies", "local governments", "municipalities", "government entities", "state agencies", "units of government"], keywords: ["municipalities"] },
  { tag: "small_businesses",     phrases: ["small businesses", "small business owners", "entrepreneurs", "startups", "small firms", "minority-owned businesses", "women-owned businesses", "microenterprises"], keywords: [] },
];

// ─── Org-type signals ─────────────────────────────────────────────────────────
interface OrgTypeEntry {
  orgType:           string;
  eligPhrases:       string[];   // eligibility text
  titlePhrases:      string[];   // title text
  descPhrases:       string[];   // description text
  sourceBias:        string[];   // sources that strongly bias toward this type
}

const ORG_TYPE_ENTRIES: OrgTypeEntry[] = [
  { orgType: "nonprofit",
    eligPhrases:  ["nonprofit", "non-profit", "501(c)(3)", "501c3", "cbo", "community-based organization", "charitable", "tax-exempt", "charitable organization"],
    titlePhrases: ["community organization", "nonprofit organization"],
    descPhrases:  ["community organizations", "nonprofit organizations", "community-based organizations", "cbos"],
    sourceBias:   ["simpler_grants", "threesixtygiving"] },

  { orgType: "small_business",
    eligPhrases:  ["small business", "small disadvantaged business", "8(a)", "woman-owned small business", "hubzone", "service-disabled", "wosb", "sdvosb"],
    titlePhrases: ["small business", "sbir", "sttr", "startup", "entrepreneur"],
    descPhrases:  ["small businesses", "small firms", "startup companies", "commercial entities"],
    sourceBias:   ["sbir", "sam_gov"] },

  { orgType: "university",
    eligPhrases:  ["university", "college", "institution of higher education", "ihe", "hbcu", "minority serving institution", "msi", "tribal college", "academic institution"],
    titlePhrases: ["research university", "higher education", "hbcu", "academic"],
    descPhrases:  ["universities", "colleges", "academic institutions", "research universities"],
    sourceBias:   [] },

  { orgType: "local_government",
    eligPhrases:  ["local government", "municipality", "city government", "county government", "units of local government", "general purpose local government", "public body"],
    titlePhrases: ["local government", "municipal", "county", "city of"],
    descPhrases:  ["local governments", "municipalities", "cities and counties", "units of government"],
    sourceBias:   ["california_grants"] },

  { orgType: "state_government",
    eligPhrases:  ["state government", "state agency", "state department", "state workforce agency", "state health department"],
    titlePhrases: ["state agency", "state government", "state department"],
    descPhrases:  ["state agencies", "state governments", "state departments"],
    sourceBias:   [] },

  { orgType: "tribal",
    eligPhrases:  ["tribal", "tribe", "federally recognized tribe", "indian tribe", "alaska native", "native american", "tribal organization"],
    titlePhrases: ["tribal organization", "tribal nation", "native american"],
    descPhrases:  ["tribal nations", "tribal organizations", "native communities"],
    sourceBias:   [] },

  { orgType: "healthcare_provider",
    eligPhrases:  ["hospital", "clinic", "federally qualified health center", "fqhc", "rural health clinic", "community health center", "healthcare provider", "health system"],
    titlePhrases: ["health center", "fqhc", "rural health center"],
    descPhrases:  ["health centers", "fqhcs", "healthcare providers", "hospitals", "clinics"],
    sourceBias:   [] },

  { orgType: "contractor",
    eligPhrases:  ["contractor", "prime contractor", "all responsible sources", "sources sought", "offeror", "vendor"],
    titlePhrases: ["contract", "procurement", "acquisition", "solicitation"],
    descPhrases:  ["contractors", "vendors", "offerors"],
    sourceBias:   ["sam_gov", "ted_eu"] },

  { orgType: "research_institution",
    eligPhrases:  ["research institution", "research organization", "not-for-profit research organization", "research center"],
    titlePhrases: ["research institution", "research center"],
    descPhrases:  ["research institutions", "research organizations"],
    sourceBias:   [] },
];

// Source → geography scope
const SOURCE_GEOGRAPHY: Record<string, "local" | "state" | "national" | "international"> = {
  world_bank:       "international",
  ted_eu:           "international",
  threesixtygiving: "national",   // UK-focused but national
  sbir:             "national",
  sam_gov:          "national",
  grants_gov:       "national",
  simpler_grants:   "national",
  california_grants: "state",
};

// Bureaucratic title prefix patterns to strip
const TITLE_PREFIX_PATTERNS: RegExp[] = [
  /^fy\s*\d{2,4}[-–:\s]+/i,
  /^fiscal\s+year\s+\d{4}[-–:\s]+/i,
  /^(nofo|noa|nosi|foa|baa)[-–:\s]+/i,
  /^(rfp|rfi|rfa|rfq)\s*#?\s*[\w-]*[-–:\s]+/i,
  /^cfda\s*[\d.]+[-–:\s]+/i,
  /^(solicitation|announcement|notice)\s*(of\s+funding\s+(opportunity|availability))?[-–:\s]+/i,
  /^funding\s+opportunity\s+announcement[-–:\s]+/i,
  /^broad\s+agency\s+announcement[-–:\s]+/i,
  /^sources\s+sought[-–:\s]+/i,
  /^\d{4}-\d{3,6}[-–:\s]+/,
  /^[A-Z]{1,4}\d{2}[-–]\w{1,8}[-–:\s]+/,   // SAM.gov-style codes like "N24A-T024"
  /^(opportunity|program)\s+(number|no\.?)\s*[\w-]+[-–:\s]+/i,
];

// In-memory cache keyed by opportunity id
const INTERPRETATION_CACHE = new Map<string, InterpretedOpportunityProfile>();

// ─── Source-aware normalization ───────────────────────────────────────────────

interface NormalizedRaw {
  title:       string;
  description: string | null;
  eligibility: string;
  agency:      string;
}

function normalizeRawOpportunity(raw: NormalizedOpportunity): NormalizedRaw {
  // Clean title: strip bureaucratic prefixes + normalize whitespace
  let title = (raw.title ?? "").trim();
  for (const pattern of TITLE_PREFIX_PATTERNS) {
    const cleaned = title.replace(pattern, "").trim();
    if (cleaned.length > 10) title = cleaned; // only use if something meaningful remains
  }
  // Strip trailing identifiers like " - W50S0Y24C9003" or " (93.568)"
  title = title.replace(/\s*[-–(]\s*[A-Z0-9]{4,}\s*\)?\s*$/, "").trim();
  title = title.replace(/\s{2,}/g, " ").trim();

  // Normalize description: handle sources that put summary in different fields
  const descRaw = (raw.description ?? "").trim();
  const description = descRaw.length > 20 ? descRaw : null;

  // Eligibility as combined string
  const eligibility = (raw.eligibility ?? []).join(" ").toLowerCase();

  const agency = (raw.agency ?? "").trim();

  return { title, description, eligibility, agency };
}

// ─── Domain tag extraction ────────────────────────────────────────────────────

function matchDomainTaxonomy(text: string): {
  domainTags:    string[];
  subdomainTags: string[];
  matchedPhrases: string[];
  confidence:    number;
} {
  const tl = text.toLowerCase();
  const domainScores = new Map<string, number>();
  const subdomainScores = new Map<string, number>();
  const matchedPhrases: string[] = [];

  for (const entry of DOMAIN_TAXONOMY) {
    let entryScore = 0;

    for (const phrase of entry.phrases) {
      if (tl.includes(phrase)) {
        entryScore += entry.weight;
        matchedPhrases.push(phrase);
      }
    }
    // Whole-word keyword check (only if no phrase match yet for this entry)
    if (entryScore === 0) {
      for (const kw of entry.keywords) {
        const re = new RegExp(`\\b${kw}\\b`, "i");
        if (re.test(tl)) {
          entryScore += Math.round(entry.weight * 0.4);
          break;
        }
      }
    }

    if (entryScore > 0) {
      domainScores.set(entry.domain, (domainScores.get(entry.domain) ?? 0) + entryScore);
      subdomainScores.set(entry.subdomain, (subdomainScores.get(entry.subdomain) ?? 0) + entryScore);
    }
  }

  // Keep tags where score > threshold
  const domainTags    = [...domainScores.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const subdomainTags = [...subdomainScores.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([k]) => k);

  const maxPossible   = DOMAIN_TAXONOMY.reduce((a, e) => a + e.weight, 0);
  const totalScore    = [...domainScores.values()].reduce((a, b) => a + b, 0);
  const confidence    = Math.min(1, totalScore / Math.max(1, maxPossible * 0.05));

  return { domainTags, subdomainTags, matchedPhrases: [...new Set(matchedPhrases)], confidence };
}

// ─── Activity tag extraction ──────────────────────────────────────────────────

function extractActivityTags(titleNorm: string, description: string | null): string[] {
  const combined = `${titleNorm} ${description ?? ""}`.toLowerCase();
  const tags: string[] = [];

  for (const entry of ACTIVITY_TAXONOMY) {
    for (const phrase of entry.phrases) {
      if (combined.includes(phrase)) { tags.push(entry.tag); break; }
    }
    if (tags.includes(entry.tag)) continue;
    for (const kw of entry.keywords) {
      if (combined.includes(kw)) { tags.push(entry.tag); break; }
    }
  }
  return [...new Set(tags)];
}

// ─── Population tag extraction ────────────────────────────────────────────────

function extractPopulationTags(text: string): string[] {
  const tl = text.toLowerCase();
  const tags: string[] = [];

  for (const entry of POPULATION_TAXONOMY) {
    for (const phrase of entry.phrases) {
      if (tl.includes(phrase)) { tags.push(entry.tag); break; }
    }
    if (tags.includes(entry.tag)) continue;
    for (const kw of entry.keywords) {
      const re = new RegExp(`\\b${kw}\\b`, "i");
      if (re.test(tl)) { tags.push(entry.tag); break; }
    }
  }
  return [...new Set(tags)];
}

// ─── Intended org-type inference ──────────────────────────────────────────────

function inferIntendedOrgTypes(
  raw: NormalizedOpportunity,
  normalized: NormalizedRaw,
  trace: string[],
): string[] {
  const votes = new Map<string, number>();
  const addVote = (type: string, pts: number, reason: string) => {
    votes.set(type, (votes.get(type) ?? 0) + pts);
    trace.push(`  [OrgType] +${pts} "${type}" — ${reason}`);
  };

  // Source bias (highest confidence)
  const sourceBiasEntry = ORG_TYPE_ENTRIES.find(e => e.sourceBias.includes(raw.source));
  if (sourceBiasEntry) {
    addVote(sourceBiasEntry.orgType, 30, `source bias: ${raw.source}`);
  }
  // Multiple sources can bias
  for (const entry of ORG_TYPE_ENTRIES) {
    if (entry.sourceBias.includes(raw.source) && entry.orgType !== (sourceBiasEntry?.orgType ?? "")) {
      addVote(entry.orgType, 15, `secondary source bias: ${raw.source}`);
    }
  }

  const eligText = normalized.eligibility;
  const titleText = normalized.title.toLowerCase();
  const descText = (normalized.description ?? "").toLowerCase();

  for (const entry of ORG_TYPE_ENTRIES) {
    // Eligibility text (high confidence)
    for (const phrase of entry.eligPhrases) {
      if (eligText.includes(phrase)) {
        addVote(entry.orgType, 20, `eligibility: "${phrase}"`);
        break;
      }
    }
    // Title text (medium confidence)
    for (const phrase of entry.titlePhrases) {
      if (titleText.includes(phrase)) {
        addVote(entry.orgType, 10, `title: "${phrase}"`);
        break;
      }
    }
    // Description text (lower confidence)
    for (const phrase of entry.descPhrases) {
      if (descText.includes(phrase)) {
        addVote(entry.orgType, 6, `description: "${phrase}"`);
        break;
      }
    }
  }

  // Sort by votes, return types with >8 votes
  const ranked = [...votes.entries()]
    .filter(([, v]) => v > 8)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  // If no strong signals, fall back to "any"
  return ranked.length > 0 ? ranked.slice(0, 3) : ["any"];
}

// ─── Title signal extraction ──────────────────────────────────────────────────

function interpretOpportunityTitle(titleNorm: string, trace: string[]): TitleSignals {
  const domainResult = matchDomainTaxonomy(titleNorm);
  const popTags = extractPopulationTags(titleNorm);
  const actTags = extractActivityTags(titleNorm, null);

  if (domainResult.matchedPhrases.length > 0)
    trace.push(`[Title] domain phrases: [${domainResult.matchedPhrases.slice(0, 5).join(", ")}]`);
  if (popTags.length > 0)
    trace.push(`[Title] populations: [${popTags.join(", ")}]`);
  if (actTags.length > 0)
    trace.push(`[Title] activities: [${actTags.join(", ")}]`);

  const tl = titleNorm.toLowerCase();
  const weakPhrases = tl.split(/\s+/)
    .filter(w => w.length > 3 && !GENERIC_WORDS.has(w) && !domainResult.matchedPhrases.some(p => p.includes(w)));

  return {
    strongPhrases:  domainResult.matchedPhrases.slice(0, 8),
    weakPhrases:    [...new Set(weakPhrases)].slice(0, 8),
    exactConcepts:  domainResult.subdomainTags.slice(0, 5),
    nearConcepts:   domainResult.domainTags.slice(0, 5),
  };
}

// ─── Description signal extraction ───────────────────────────────────────────

function interpretOpportunityDescription(desc: string | null, trace: string[]): TitleSignals {
  if (!desc || desc.length < 20) {
    return { strongPhrases: [], weakPhrases: [], exactConcepts: [], nearConcepts: [] };
  }
  // Use first 2000 chars for efficiency
  const text = desc.slice(0, 2000);
  const domainResult = matchDomainTaxonomy(text);
  const popTags = extractPopulationTags(text);

  if (domainResult.matchedPhrases.length > 0)
    trace.push(`[Desc] domain phrases: [${domainResult.matchedPhrases.slice(0, 5).join(", ")}]`);
  if (popTags.length > 0)
    trace.push(`[Desc] populations: [${popTags.join(", ")}]`);

  const tl = text.toLowerCase();
  const weakPhrases = tl.split(/\s+/)
    .filter(w => w.length > 4 && !GENERIC_WORDS.has(w))
    .slice(0, 20);

  return {
    strongPhrases: domainResult.matchedPhrases.slice(0, 8),
    weakPhrases:   [...new Set(weakPhrases)].slice(0, 8),
    exactConcepts: domainResult.subdomainTags.slice(0, 5),
    nearConcepts:  domainResult.domainTags.slice(0, 5),
  };
}

// ─── High-value phrase extraction ────────────────────────────────────────────

function extractHighValuePhrases(text: string): string[] {
  const tl = text.toLowerCase();
  return MISSION_PHRASES
    .filter(p => tl.includes(p.phrase.toLowerCase()))
    .sort((a, b) => b.weight - a.weight)
    .map(p => p.phrase)
    .slice(0, 15);
}

// ─── Generic term detection ───────────────────────────────────────────────────

function extractGenericTerms(title: string): string[] {
  return title.toLowerCase()
    .split(/[\s\-\/,()]+/)
    .filter(w => w.length > 1 && GENERIC_WORDS.has(w));
}

// ─── Opportunity type classification ─────────────────────────────────────────

function classifyOpportunityType(
  raw: NormalizedOpportunity,
  normalized: NormalizedRaw,
): string {
  const src = raw.source;
  const title = normalized.title.toLowerCase();
  const elig = normalized.eligibility;

  if (src === "sbir") return "research_grant";
  if (src === "sam_gov" || src === "ted_eu") {
    if (elig.includes("contractor") || elig.includes("solicitation") || title.includes("contract"))
      return "procurement";
    return "contract";
  }
  if (src === "world_bank") return "international_funding";
  if (title.includes("fellowship") || title.includes("scholarship")) return "fellowship";
  if (title.includes("loan") || title.includes("revolving fund")) return "loan";
  if (title.includes("challenge") || title.includes("prize")) return "challenge";
  if (title.includes("technical assistance") || elig.includes("technical assistance")) return "technical_assistance";
  if (raw.funding_type === "contract") return "contract";
  return "grant";
}

// ─── Geography scope inference ────────────────────────────────────────────────

function inferGeographyScope(
  raw: NormalizedOpportunity,
  normalized: NormalizedRaw,
): { geographyTags: string[]; geographyScope: InterpretedOpportunityProfile["geographyScope"] } {
  // Source-based scope
  const sourceScope = SOURCE_GEOGRAPHY[raw.source];
  if (sourceScope) {
    const tags = raw.geography?.length ? raw.geography : [sourceScope];
    return { geographyTags: tags, geographyScope: sourceScope };
  }

  // Geography field
  if (raw.geography?.length) {
    const geo = raw.geography.map(g => g.toLowerCase());
    const isIntl = geo.some(g => ["international", "global", "world", "overseas"].some(k => g.includes(k)));
    const isState = geo.some(g => g.length < 15 && !["national", "federal"].includes(g));
    const scope: InterpretedOpportunityProfile["geographyScope"] =
      isIntl ? "international" : isState ? "state" : "national";
    return { geographyTags: raw.geography, geographyScope: scope };
  }

  // Title cues
  const title = normalized.title.toLowerCase();
  if (title.includes("national") || title.includes("federal") || title.includes("nationwide"))
    return { geographyTags: ["national"], geographyScope: "national" };
  if (title.includes("state") || title.includes("statewide"))
    return { geographyTags: ["state"], geographyScope: "state" };
  if (title.includes("local") || title.includes("community") || title.includes("city") || title.includes("county"))
    return { geographyTags: ["local"], geographyScope: "local" };

  return { geographyTags: [], geographyScope: "unknown" };
}

// ─── Confidence computation ───────────────────────────────────────────────────

function computeConfidence(
  domainTags: string[], activityTags: string[], populationTags: string[], orgTypes: string[],
): InterpretedOpportunityProfile["confidence"] {
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return {
    domain:     clamp(domainTags.length / 2),
    activity:   clamp(activityTags.length / 2),
    population: clamp(populationTags.length / 2),
    orgType:    orgTypes[0] === "any" ? 0.2 : clamp(orgTypes.length / 2),
  };
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildInterpretedOpportunityProfile(
  raw: NormalizedOpportunity,
): InterpretedOpportunityProfile {
  const trace: string[] = [`[Interpret] "${raw.title?.slice(0, 60)}" (source: ${raw.source})`];

  // 1. Source-aware normalization
  const normalized = normalizeRawOpportunity(raw);
  if (normalized.title !== raw.title)
    trace.push(`[Normalize] title cleaned: "${normalized.title}"`);

  // 2. Title signals
  const titleSignals = interpretOpportunityTitle(normalized.title, trace);

  // 3. Description signals
  const descriptionSignals = interpretOpportunityDescription(normalized.description, trace);

  // 4. Combined domain extraction (title + description, title weighted higher)
  const titleText = normalized.title;
  const descText  = normalized.description ?? "";
  const combinedText = `${titleText} ${titleText} ${descText}`;  // title repeated for emphasis
  const domainResult = matchDomainTaxonomy(combinedText);

  // 5. Activity tags
  const activityTags = extractActivityTags(normalized.title, normalized.description);
  if (activityTags.length > 0) trace.push(`[Activity] tags: [${activityTags.join(", ")}]`);

  // 6. Population tags (title first, then description)
  const titlePopTags = extractPopulationTags(titleText);
  const descPopTags  = extractPopulationTags(descText);
  const populationTags = [...new Set([...titlePopTags, ...descPopTags])];
  if (populationTags.length > 0) trace.push(`[Population] tags: [${populationTags.join(", ")}]`);

  // 7. Intended org types
  trace.push(`[OrgType] inference for source=${raw.source}:`);
  const intendedOrgTypes = inferIntendedOrgTypes(raw, normalized, trace);
  trace.push(`[OrgType] result: [${intendedOrgTypes.join(", ")}]`);

  // 8. High-value phrases — title only vs description only
  const titleHighValue = extractHighValuePhrases(titleText);
  const descHighValue  = extractHighValuePhrases(descText);
  const allHighValue   = [...new Set([...titleHighValue, ...descHighValue])];

  // Description-only phrases (not already in title)
  const titleHighValueSet = new Set(titleHighValue.map(p => p.toLowerCase()));
  const inferredDescPhrases = descHighValue.filter(p => !titleHighValueSet.has(p.toLowerCase()));

  if (titleHighValue.length > 0)  trace.push(`[HighValue] title: [${titleHighValue.slice(0, 4).join(", ")}]`);
  if (inferredDescPhrases.length > 0) trace.push(`[HighValue] desc-only: [${inferredDescPhrases.slice(0, 4).join(", ")}]`);

  // 9. Generic terms
  const genericTerms = extractGenericTerms(normalized.title);
  if (genericTerms.length > 3) trace.push(`[Generic] title generic terms: [${genericTerms.join(", ")}]`);

  // 10. Domain tags
  if (domainResult.domainTags.length > 0)
    trace.push(`[Domain] tags: [${domainResult.domainTags.slice(0, 5).join(", ")}] subdomains: [${domainResult.subdomainTags.slice(0, 5).join(", ")}]`);

  // 11. Opportunity type + geography
  const opportunityType = classifyOpportunityType(raw, normalized);
  trace.push(`[Type] ${opportunityType}`);

  const { geographyTags, geographyScope } = inferGeographyScope(raw, normalized);
  trace.push(`[Geo] scope=${geographyScope} tags=[${geographyTags.join(", ")}]`);

  // 12. Confidence
  const confidence = computeConfidence(
    domainResult.domainTags, activityTags, populationTags, intendedOrgTypes,
  );

  // 13. Inferred mission phrases from domain + high-value phrases
  const inferredMissionPhrases = [
    ...titleHighValue,
    ...domainResult.subdomainTags.map(s => s.replace(/_/g, " ")),
  ].slice(0, 12);

  return {
    id:                   raw.id,
    source:               raw.source,
    rawTitle:             raw.title ?? "",
    normalizedTitle:      normalized.title,
    rawDescription:       raw.description ?? null,
    normalizedDescription: normalized.description,

    opportunityType,
    domainTags:        domainResult.domainTags.slice(0, 8),
    subdomainTags:     domainResult.subdomainTags.slice(0, 8),
    activityTags:      activityTags.slice(0, 6),
    populationTags:    populationTags.slice(0, 8),
    intendedOrgTypes,
    geographyTags,
    geographyScope,

    inferredMissionPhrases:   inferredMissionPhrases,
    inferredDescPhrases:      inferredDescPhrases.slice(0, 8),
    inferredHighValuePhrases: allHighValue.slice(0, 12),
    genericTerms,

    titleSignals,
    descriptionSignals,

    confidence,

    fundingMin:  raw.min_award ?? null,
    fundingMax:  raw.max_award ?? null,
    status:      raw.status ?? null,
    closeDate:   raw.close_date ?? null,

    interpretationTrace: trace,
    rawSourceFields:     raw,
  };
}

// ─── Cache-backed public API ──────────────────────────────────────────────────

/**
 * Returns an interpreted profile for the given opportunity.
 * Results are cached in memory for the session lifetime.
 * Call clearInterpretationCache() to force reinterpretation.
 */
export function getInterpretedOpportunityForMatcher(
  raw: NormalizedOpportunity,
): InterpretedOpportunityProfile {
  const cached = INTERPRETATION_CACHE.get(raw.id);
  if (cached) return cached;
  const profile = buildInterpretedOpportunityProfile(raw);
  INTERPRETATION_CACHE.set(raw.id, profile);
  return profile;
}

export function clearInterpretationCache(): void {
  INTERPRETATION_CACHE.clear();
}

export function getInterpretationCacheSize(): number {
  return INTERPRETATION_CACHE.size;
}

/**
 * Batch-interpret an array of opportunities.
 * Skips already-cached entries; processes only new ones.
 * Returns a Map<id, profile> for fast lookup.
 */
export function batchInterpretOpportunities(
  opps: NormalizedOpportunity[],
): Map<string, InterpretedOpportunityProfile> {
  const result = new Map<string, InterpretedOpportunityProfile>();
  for (const opp of opps) {
    result.set(opp.id, getInterpretedOpportunityForMatcher(opp));
  }
  return result;
}
