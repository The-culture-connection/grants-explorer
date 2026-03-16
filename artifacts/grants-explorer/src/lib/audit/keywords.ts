export const SYNONYM_GROUPS: Record<string, string[]> = {
  "maternal health": ["pregnancy care", "birth outcomes", "birth equity", "prenatal", "maternal mortality", "obstetric"],
  "workforce development": ["job training", "career readiness", "employment training", "vocational", "job placement", "workforce"],
  "small business": ["entrepreneurship", "founder support", "startup", "entrepreneur", "sme", "micro-enterprise"],
  "community development": ["neighborhood revitalization", "community revitalization", "place-based", "community organizing"],
  "public health": ["health equity", "health education", "population health", "community health", "preventive health"],
  "climate": ["climate change", "sustainability", "environmental justice", "clean energy", "greenhouse", "renewable"],
  "education": ["literacy", "learning", "academic", "stem", "tutoring", "school", "student"],
  "housing": ["affordable housing", "shelter", "homelessness", "housing stability", "home ownership"],
  "food security": ["hunger", "nutrition", "food access", "food insecurity", "food bank"],
  "mental health": ["behavioral health", "substance abuse", "addiction", "counseling", "therapy"],
  "research": ["study", "investigation", "analysis", "evaluation", "assessment", "science"],
  "technology": ["digital", "innovation", "software", "data", "ai", "artificial intelligence"],
};

export const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "will",
  "can", "has", "have", "been", "not", "but", "all", "any", "its", "our",
  "their", "they", "who", "what", "when", "where", "how", "via", "per",
  "new", "use", "may", "also", "such", "than", "more", "into", "about",
  "both", "each", "would", "could", "should", "through", "which",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export function expandWithSynonyms(tokens: string[], synonyms = SYNONYM_GROUPS): string[] {
  const expanded = [...tokens];
  const joinedText = tokens.join(" ");
  for (const [canonical, variants] of Object.entries(synonyms)) {
    const canonTokens = tokenize(canonical);
    const hit = canonTokens.every((ct) => tokens.includes(ct)) ||
      variants.some((v) => tokenize(v).every((vt) => tokens.includes(vt)));
    if (hit) {
      const allTerms = [canonical, ...variants].flatMap(tokenize);
      for (const t of allTerms) {
        if (!expanded.includes(t)) expanded.push(t);
      }
    }
  }
  return [...new Set(expanded)];
}

export interface KeywordAudit {
  raw_text: string;
  tokens: string[];
  tokens_after_stopword_removal: string[];
  expanded_tokens: string[];
  synonym_groups_matched: string[];
  top_terms: string[];
}

export function extractKeywordAudit(text: string): KeywordAudit {
  const raw_tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const tokens_after_stopword_removal = raw_tokens.filter((t) => t.length > 2 && !STOPWORDS.has(t));
  const expanded = expandWithSynonyms(tokens_after_stopword_removal);
  const groups_matched: string[] = [];
  for (const [canonical, variants] of Object.entries(SYNONYM_GROUPS)) {
    if ([canonical, ...variants].some((v) => tokenize(v).every((vt) => tokens_after_stopword_removal.includes(vt)))) {
      groups_matched.push(canonical);
    }
  }
  const freq: Record<string, number> = {};
  for (const t of tokens_after_stopword_removal) freq[t] = (freq[t] ?? 0) + 1;
  const top_terms = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t]) => t);
  return {
    raw_text: text,
    tokens: raw_tokens,
    tokens_after_stopword_removal,
    expanded_tokens: expanded,
    synonym_groups_matched: groups_matched,
    top_terms,
  };
}
