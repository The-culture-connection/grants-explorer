import type { ScoreTrace } from "./types";
import type { AuditMetrics } from "./metrics";
import type { AuditFeedback } from "./types";

export interface Recommendation {
  priority: "high" | "medium" | "low";
  category: string;
  title: string;
  detail: string;
  action: string;
}

export function generateRecommendations(
  results: ScoreTrace[],
  all: ScoreTrace[],
  metrics: AuditMetrics,
  feedback: Record<string, AuditFeedback>
): Recommendation[] {
  const recs: Recommendation[] = [];
  const top10 = results.slice(0, 10);
  const top20 = results.slice(0, 20);

  // Mission score weakness
  const avgMission = top10.reduce((a, b) => a + b.scores.mission_topic_fit, 0) / (top10.length || 1);
  const maxMission = top10.length > 0 ? top10[0].weights.mission_topic_fit : 35;
  if (avgMission < maxMission * 0.5 && top10.length > 0) {
    recs.push({
      priority: "high",
      category: "Scoring Weights",
      title: "Mission/topic scores are too low across top matches",
      detail: `Average mission fit in top 10 is ${Math.round(avgMission)}/${maxMission}. Relevant opportunities may be missing relevant keywords.`,
      action: "Add synonym expansion, or increase mission_topic_fit weight from 35 to 45.",
    });
  }

  // Lots of zero-token matches
  const zeroMatchCount = top20.filter((r) => r.matched_tokens.length === 0).length;
  if (zeroMatchCount > 3) {
    recs.push({
      priority: "high",
      category: "Keyword Matching",
      title: `${zeroMatchCount} of top 20 matches have zero keyword overlap`,
      detail: "These are false positives scoring high on eligibility/funding alone with no topic relevance.",
      action: "Require at least 1 keyword match for an opportunity to appear in results, or add stopword filtering.",
    });
  }

  // Generic term inflation
  const genericTerms = ["community", "support", "innovation", "development", "program", "services", "public"];
  const genericHeavy = top20.filter((r) =>
    r.matched_tokens.some((t) => genericTerms.includes(t)) && r.matched_tokens.length < 4
  );
  if (genericHeavy.length > 3) {
    recs.push({
      priority: "medium",
      category: "Keyword Quality",
      title: `${genericHeavy.length} high-ranking results match only on generic terms`,
      detail: `Terms like "community", "support", "innovation" are present in most grants and inflate irrelevant scores.`,
      action: "Add these terms to a downweighted or ignored list in the tokenizer.",
    });
  }

  // Geography issues
  const geoZero = top20.filter((r) => r.scores.geography_fit === 0).length;
  if (geoZero > 8) {
    recs.push({
      priority: "medium",
      category: "Geography",
      title: `${geoZero} of top 20 results have zero geography match`,
      detail: "Many opportunities are scoring high despite no geography alignment with the organization.",
      action: "Relax geography logic to award partial credit for national-scope opportunities, or penalize specific-geography mismatches more strongly.",
    });
  }

  // Eligibility gate too broad
  if (metrics.filtered_by_eligibility_pct < 10 && all.length > 50) {
    recs.push({
      priority: "medium",
      category: "Eligibility",
      title: "Eligibility gate filtering fewer than 10% of opportunities",
      detail: `Only ${metrics.filtered_by_eligibility_pct}% of opportunities eliminated by eligibility. This suggests eligibility parsing is too permissive.`,
      action: "Improve eligibility type detection: parse 'small business only' and 'federal agencies only' strings more strictly.",
    });
  }

  // Low average score
  if (metrics.avg_score < 30 && top10.length > 0) {
    recs.push({
      priority: "medium",
      category: "Calibration",
      title: "Average match score is low — threshold may need recalibration",
      detail: `Average score is ${metrics.avg_score}/100. This may indicate scores are compressed or the pool is poorly aligned.`,
      action: "Review scoring scale normalization. Consider a minimum-score floor for display (e.g., hide results below 20).",
    });
  }

  // Funding fit unknown dominating
  const fundingUnknown = top20.filter((r) => !r.opp.max_award).length;
  if (fundingUnknown > 10) {
    recs.push({
      priority: "low",
      category: "Funding Data",
      title: `${fundingUnknown} of top 20 have no award amount data`,
      detail: "Unknown funding size grants 8/15 partial credit, which may be inflating some scores.",
      action: "Reduce partial credit for unknown funding to 5/15, or source funding amounts from additional API fields.",
    });
  }

  // Bad feedback appearing in top 10
  if (metrics.bad_in_top_10 > 0) {
    recs.push({
      priority: "high",
      category: "False Positives",
      title: `${metrics.bad_in_top_10} confirmed bad match(es) still appearing in top 10`,
      detail: "Human-labeled 'bad' results are in the top-ranked positions. These are confirmed false positives.",
      action: "Inspect the scoring trace for these matches. They likely score high on eligibility + funding alone with no topic relevance.",
    });
  }

  // Missing synonym hits
  const noSynonymPotential = top20.filter((r) => r.synonyms_applied.length === 0 && r.matched_tokens.length < 3).length;
  if (noSynonymPotential > 5) {
    recs.push({
      priority: "low",
      category: "Synonym Expansion",
      title: "Synonym expansion could recover missed topic relevance",
      detail: `${noSynonymPotential} of top 20 have fewer than 3 token matches and no synonym expansion. Language mismatches may be hiding relevant grants.`,
      action: "Enable synonym expansion in the V1+Synonyms variant and compare results in the Comparison Lab.",
    });
  }

  return recs.sort((a, b) => {
    const p = { high: 0, medium: 1, low: 2 };
    return p[a.priority] - p[b.priority];
  });
}

export function classifyFailureCases(
  all: ScoreTrace[],
  results: ScoreTrace[],
  feedback: Record<string, AuditFeedback>
): {
  false_positives: ScoreTrace[];
  false_negatives: ScoreTrace[];
  generic_keyword_hits: ScoreTrace[];
  geo_mismatches: ScoreTrace[];
  funding_outliers: ScoreTrace[];
  eligibility_edge_cases: ScoreTrace[];
} {
  const top20ids = new Set(results.slice(0, 20).map((r) => r.opp.id));
  const genericTerms = new Set(["community", "support", "innovation", "development", "program", "services", "public"]);

  const false_positives = results.slice(0, 10).filter((r) => {
    const fb = feedback[r.opp.id];
    return fb?.label === "bad" || (r.matched_tokens.length === 0 && r.scores.total > 20);
  });

  const false_negatives = all.filter((r) => {
    if (top20ids.has(r.opp.id)) return false;
    const fb = feedback[r.opp.id];
    return fb?.label === "good" && r.scores.total < 30;
  }).slice(0, 5);

  const generic_keyword_hits = results.slice(0, 20).filter((r) =>
    r.matched_tokens.length > 0 &&
    r.matched_tokens.every((t) => genericTerms.has(t)) &&
    r.scores.mission_topic_fit > 10
  );

  const geo_mismatches = results.slice(0, 20).filter((r) => r.scores.geography_fit === 0);

  const funding_outliers = all.filter((r) => {
    if (!r.opp.max_award) return false;
    return r.scores.funding_size_fit <= 3;
  }).slice(0, 5);

  const eligibility_edge_cases = all.filter((r) => !r.passes_eligibility).slice(0, 5);

  return {
    false_positives,
    false_negatives,
    generic_keyword_hits,
    geo_mismatches,
    funding_outliers,
    eligibility_edge_cases,
  };
}
