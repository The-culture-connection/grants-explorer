// ─── Sector / Domain Families ─────────────────────────────────────────────────
// Each entry maps a sector label to keywords that signal membership in that sector.
// These are intentionally broad so the taxonomy works across many org types.

export const SECTOR_FAMILIES: Record<string, string[]> = {
  health: [
    "health", "medical", "clinical", "wellness", "mental health", "behavioral health",
    "public health", "maternal", "reproductive", "chronic disease", "substance",
    "addiction", "epidemiology", "disease", "nutrition", "biomedical",
    "pharmacy", "nursing", "hospital", "patient", "healthcare", "telehealth",
    "diabetes", "cancer", "hiv", "aids", "vaccine", "disability", "rehabilitation",
    "therapy", "counseling", "prevention", "behavioral", "obesity", "suicide",
    "geriatric", "pediatric", "telemedicine", "health equity",
  ],
  education: [
    "education", "school", "learning", "student", "academic", "literacy", "curriculum",
    "teaching", "stem", "early childhood", "higher education", "vocational",
    "college", "university", "classroom", "teacher", "faculty", "scholarship",
    "tutoring", "afterschool", "adult education", "graduation", "enrollment",
    "childcare", "preschool", "secondary", "elementary", "charter", "dropout",
  ],
  workforce: [
    "workforce", "employment", "job training", "career", "reskilling", "upskilling",
    "apprenticeship", "labor", "occupational", "job", "hiring", "recruitment",
    "professional development", "skills", "certification", "internship", "placement",
    "reemployment", "unemployment", "human resources", "work readiness",
  ],
  housing: [
    "housing", "affordable housing", "homelessness", "shelter", "residential", "rent",
    "foreclosure", "mortgage", "eviction", "homeless", "transitional housing",
    "permanent housing", "homeownership", "multifamily", "tenant", "landlord",
    "housing stability", "affordable", "community land trust",
  ],
  entrepreneurship: [
    "entrepreneurship", "small business", "startup", "commercialization",
    "innovation", "venture", "founder", "business development", "incubator",
    "accelerator", "market access", "product development", "technology transfer",
    "spin-off", "licensing", "scale-up", "sbir", "sttr",
  ],
  environment: [
    "climate", "environment", "clean energy", "renewable", "conservation",
    "sustainability", "carbon", "biodiversity", "water", "air quality",
    "decarbonization", "emissions", "solar", "wind", "energy efficiency",
    "green", "ecological", "wildlife", "forest", "land", "ocean", "marine",
    "pollution", "waste", "recycling", "circular economy", "resilience",
  ],
  arts: [
    "arts", "culture", "creative", "media", "film", "music", "heritage",
    "humanities", "performance", "visual arts", "theater", "dance", "literature",
    "museum", "gallery", "cultural preservation", "indigenous culture", "storytelling",
  ],
  justice: [
    "justice", "safety", "crime", "violence", "law enforcement", "corrections",
    "reentry", "legal", "civil rights", "equity", "police", "prison", "probation",
    "victim", "domestic violence", "sexual assault", "trafficking", "gun violence",
    "violence prevention", "community safety", "criminal", "incarceration",
  ],
  technology: [
    "technology", "data", "digital", "cyber", "ai", "software", "innovation",
    "information", "broadband", "artificial intelligence", "machine learning",
    "cloud", "blockchain", "iot", "internet", "cybersecurity", "privacy",
    "automation", "robotics", "tech", "computer", "algorithm",
  ],
  research: [
    "research", "science", "laboratory", "study", "investigation", "analysis",
    "discovery", "publication", "experiment", "hypothesis", "methodology",
    "scientific", "clinical trial", "basic research", "applied research",
    "principal investigator", "r&d", "r01", "p01",
  ],
  agriculture: [
    "agriculture", "food", "farming", "crop", "livestock", "food security",
    "farm", "harvest", "soil", "irrigation", "agricultural", "aquaculture",
    "fisheries", "forestry", "ranching", "hunger", "food desert",
  ],
  infrastructure: [
    "infrastructure", "transportation", "roads", "bridges", "transit",
    "water systems", "broadband", "construction", "facilities", "utilities",
    "public works", "engineering", "port", "airport", "railway", "highway",
    "capital improvement", "wastewater",
  ],
  government_services: [
    "government", "public administration", "municipal", "civic", "policy",
    "regulation", "public sector", "federal", "state government", "local government",
    "county", "city", "public service", "governance", "intergovernmental",
  ],
  international_development: [
    "international", "global", "development", "humanitarian", "foreign",
    "diplomacy", "overseas", "bilateral", "multilateral", "developing countries",
    "emerging markets", "aid", "relief", "refugee", "migration", "usaid",
    "oda", "fdi",
  ],
  economic_development: [
    "economic development", "community development", "poverty", "inequality",
    "finance", "microfinance", "wealth", "income", "asset building",
    "financial literacy", "community investment", "cdfi", "revitalization",
  ],
};

// ─── Activity Tags ─────────────────────────────────────────────────────────────
// What the organization or opportunity primarily *does*.

export const ACTIVITY_KEYWORDS: Record<string, string[]> = {
  research: [
    "research", "study", "analysis", "investigation", "experiment",
    "evaluation", "assessment", "survey", "data collection", "clinical trial",
    "r&d", "discovery",
  ],
  service_delivery: [
    "service delivery", "direct service", "provide services", "support",
    "assist", "help", "serve", "care", "intervention", "program delivery",
  ],
  implementation: [
    "implement", "deploy", "execute", "launch", "establish", "create",
    "build", "pilot", "demonstration", "operation", "rollout",
  ],
  advocacy: [
    "advocacy", "policy change", "awareness", "campaign", "engage",
    "mobilize", "coalition", "public education", "community organizing",
  ],
  planning: [
    "planning", "strategy", "design", "feasibility", "framework",
    "roadmap", "needs assessment", "strategic plan", "master plan",
  ],
  capacity_building: [
    "capacity building", "strengthen", "organizational development",
    "leadership development", "governance", "systems building",
    "organizational capacity",
  ],
  technical_assistance: [
    "technical assistance", "consulting", "advisory", "coaching",
    "mentoring", "expertise", "guidance", "TA",
  ],
  training: [
    "training", "workshop", "curriculum development", "professional development",
    "skills training", "certification", "learning", "instruction",
  ],
  procurement: [
    "procurement", "purchase", "acquisition", "contract", "supply",
    "vendor", "solicitation", "rfp", "rfq", "bid",
  ],
  infrastructure_build: [
    "construction", "facility", "capital project", "equipment purchase",
    "renovation", "installation", "build-out",
  ],
  commercialization: [
    "commercialization", "market", "commercialize", "license", "transfer",
    "venture", "product launch", "scale", "go-to-market",
  ],
  outreach: [
    "outreach", "community engagement", "awareness", "dissemination",
    "communication", "marketing", "stakeholder engagement", "public",
  ],
};

// ─── Population Tags ──────────────────────────────────────────────────────────
// Who the opportunity or organization primarily serves.

export const POPULATION_KEYWORDS: Record<string, string[]> = {
  youth: ["youth", "young people", "children", "child", "adolescent", "teen", "juvenile", "minors", "k-12", "after school"],
  women: ["women", "female", "girls", "gender equity", "maternal", "women-owned", "gender-based"],
  families: ["families", "family", "parent", "household", "children and families", "caregiver"],
  seniors: ["seniors", "elderly", "aging", "older adults", "age 65", "geriatric", "long-term care"],
  veterans: ["veterans", "military", "service member", "armed forces", "veteran-owned"],
  students: ["students", "learners", "scholarship", "fellowship", "undergraduate", "graduate"],
  small_businesses: ["small business", "small businesses", "entrepreneurs", "startups", "sme", "women-owned business"],
  low_income: ["low income", "low-income", "poverty", "economically disadvantaged", "underresourced", "200% federal poverty"],
  underserved: ["underserved", "disadvantaged", "marginalized", "vulnerable", "at-risk", "equity", "disparities"],
  rural: ["rural", "frontier", "remote", "non-urban", "agricultural community", "rural community"],
  tribal: ["tribal", "indigenous", "native american", "alaska native", "tribal nation", "reservation", "first nations"],
  public_agencies: ["public agency", "government agency", "municipality", "county government", "state agency", "local government"],
  immigrants: ["immigrants", "immigrant", "refugee", "asylum seeker", "migrant", "undocumented"],
  disabled: ["disability", "disabled", "accessibility", "ada", "special needs", "differently abled"],
  minorities: ["minority", "bipoc", "black", "hispanic", "latino", "latina", "asian", "pacific islander", "racial equity"],
  lgbtq: ["lgbtq", "lgbt", "gender identity", "sexual orientation", "transgender", "queer"],
};

// ─── Synonym Groups ───────────────────────────────────────────────────────────
// Phrase-level synonyms for concept expansion. More comprehensive than V1.

export const V2_SYNONYM_GROUPS: Record<string, string[]> = {
  workforce_development: [
    "workforce development", "job training", "career readiness", "reskilling",
    "upskilling", "employment training", "career pathways", "work skills",
  ],
  entrepreneurship: [
    "entrepreneurship", "small business support", "founder support",
    "commercialization", "startup", "business development", "sbir",
  ],
  public_health: [
    "public health", "community health", "health education", "population health",
    "wellness", "preventive health", "health promotion",
  ],
  affordable_housing: [
    "affordable housing", "housing stability", "homelessness prevention",
    "shelter", "transitional housing", "permanent supportive housing",
  ],
  clean_energy: [
    "clean energy", "energy transition", "decarbonization", "renewable energy",
    "energy efficiency", "solar", "wind power", "green infrastructure",
  ],
  violence_prevention: [
    "violence prevention", "community safety", "public safety intervention",
    "crime reduction", "safe communities", "conflict resolution",
  ],
  economic_development: [
    "economic development", "community economic development", "financial inclusion",
    "wealth building", "asset building", "poverty reduction",
  ],
  education_access: [
    "education access", "educational equity", "college access",
    "student success", "academic support", "academic achievement",
  ],
  food_security: [
    "food security", "food access", "nutrition", "hunger relief",
    "food desert", "food insecurity", "healthy food",
  ],
  climate_resilience: [
    "climate resilience", "disaster preparedness", "climate adaptation",
    "disaster recovery", "resilience", "emergency management",
  ],
  digital_equity: [
    "digital equity", "broadband access", "digital literacy",
    "technology access", "internet access", "digital divide",
  ],
  mental_health: [
    "mental health", "behavioral health", "counseling", "therapy",
    "psychological services", "mental wellness", "psychiatric",
  ],
  capacity_building: [
    "capacity building", "organizational development", "technical assistance",
    "organizational strengthening", "nonprofit capacity",
  ],
  research_development: [
    "research", "r&d", "scientific research", "innovation", "discovery",
    "investigation", "basic research", "applied research",
  ],
  indigenous_services: [
    "tribal", "indigenous", "native american", "alaska native",
    "tribal sovereignty", "tribal nation", "first nations",
  ],
};

// ─── Extraction Utilities ─────────────────────────────────────────────────────

/**
 * Extract sector tags from free text by checking for keyword membership.
 * Returns deduplicated sector labels found in the text.
 */
export function extractSectorTags(text: string): string[] {
  const lower = text.toLowerCase();
  const hits = new Set<string>();
  for (const [sector, keywords] of Object.entries(SECTOR_FAMILIES)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) { hits.add(sector); break; }
    }
  }
  return [...hits];
}

/**
 * Extract activity tags from free text.
 */
export function extractActivityTags(text: string): string[] {
  const lower = text.toLowerCase();
  const hits = new Set<string>();
  for (const [activity, keywords] of Object.entries(ACTIVITY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) { hits.add(activity); break; }
    }
  }
  return [...hits];
}

/**
 * Extract population tags from free text.
 */
export function extractPopulationTags(text: string): string[] {
  const lower = text.toLowerCase();
  const hits = new Set<string>();
  for (const [pop, keywords] of Object.entries(POPULATION_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) { hits.add(pop); break; }
    }
  }
  return [...hits];
}

/**
 * Expand a set of tokens with their synonyms from the V2 synonym groups.
 * Returns augmented token list.
 */
export function expandWithV2Synonyms(tokens: string[]): string[] {
  const tokenSet = new Set(tokens.map(t => t.toLowerCase()));
  const expanded = new Set<string>(tokenSet);
  for (const synonymList of Object.values(V2_SYNONYM_GROUPS)) {
    const hasAny = synonymList.some(s => tokenSet.has(s.toLowerCase()));
    if (hasAny) {
      for (const s of synonymList) {
        s.toLowerCase().split(/\s+/).forEach(w => expanded.add(w));
      }
    }
  }
  return [...expanded];
}
