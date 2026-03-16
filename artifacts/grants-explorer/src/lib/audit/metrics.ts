import type { EvalLabel, EvalEntry, FeedbackLabel, AuditFeedback } from "./types";
import type { ScoreTrace } from "./types";

export interface AuditMetrics {
  total_scored: number;
  eligible_count: number;
  ineligible_count: number;
  avg_score: number;
  median_score: number;
  precision_at_5: number | null;
  precision_at_10: number | null;
  recall_on_labeled: number | null;
  bad_in_top_10: number;
  avg_rating_top_10: number | null;
  score_distribution: { bucket: string; count: number }[];
  by_source: Record<string, number>;
  by_funding_type: Record<string, number>;
  filtered_by_eligibility_pct: number;
}

function isRelevant(label: EvalLabel | FeedbackLabel): boolean {
  return label === "strong_fit" || label === "possible_fit" || label === "good";
}

function feedbackRating(label: FeedbackLabel): number {
  return label === "good" ? 3 : label === "weak" ? 2 : label === "bad" ? 1 : 0;
}

export function computeAuditMetrics(
  results: ScoreTrace[],
  all_scored: ScoreTrace[],
  evalSet: EvalEntry[],
  feedback: Record<string, AuditFeedback>,
  orgId: string
): AuditMetrics {
  const total_scored = all_scored.length;
  const eligible = all_scored.filter((r) => r.passes_eligibility);
  const ineligible_count = all_scored.filter((r) => !r.passes_eligibility).length;
  const scores = eligible.map((r) => r.scores.total);

  const avg_score = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const sorted = [...scores].sort((a, b) => a - b);
  const median_score = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;

  const filtered_by_eligibility_pct = total_scored > 0 ? Math.round((ineligible_count / total_scored) * 100) : 0;

  // Score distribution
  const buckets: Record<string, number> = { "0–20": 0, "21–40": 0, "41–60": 0, "61–80": 0, "81–100": 0 };
  for (const s of scores) {
    if (s <= 20) buckets["0–20"]++;
    else if (s <= 40) buckets["21–40"]++;
    else if (s <= 60) buckets["41–60"]++;
    else if (s <= 80) buckets["61–80"]++;
    else buckets["81–100"]++;
  }
  const score_distribution = Object.entries(buckets).map(([bucket, count]) => ({ bucket, count }));

  // By source
  const by_source: Record<string, number> = {};
  for (const r of results) {
    const src = r.opp.source;
    by_source[src] = (by_source[src] ?? 0) + 1;
  }

  // By funding type
  const by_funding_type: Record<string, number> = {};
  for (const r of results) {
    const ft = r.opp.funding_type;
    by_funding_type[ft] = (by_funding_type[ft] ?? 0) + 1;
  }

  // Precision@K
  const orgEval = evalSet.filter((e) => e.org_id === orgId);
  const top5ids = results.slice(0, 5).map((r) => r.opp.id);
  const top10ids = results.slice(0, 10).map((r) => r.opp.id);
  const evalMap = new Map(orgEval.map((e) => [e.opp_id, e.label]));

  let precision_at_5: number | null = null;
  let precision_at_10: number | null = null;
  let recall_on_labeled: number | null = null;

  if (orgEval.length > 0) {
    const relevant = orgEval.filter((e) => isRelevant(e.label)).map((e) => e.opp_id);
    const top5relevant = top5ids.filter((id) => evalMap.has(id) && isRelevant(evalMap.get(id)!)).length;
    const top10relevant = top10ids.filter((id) => evalMap.has(id) && isRelevant(evalMap.get(id)!)).length;
    precision_at_5 = top5ids.length > 0 ? Math.round((top5relevant / Math.min(5, top5ids.length)) * 100) : null;
    precision_at_10 = top10ids.length > 0 ? Math.round((top10relevant / Math.min(10, top10ids.length)) * 100) : null;
    if (relevant.length > 0) {
      const retrieved = relevant.filter((id) => top10ids.includes(id)).length;
      recall_on_labeled = Math.round((retrieved / relevant.length) * 100);
    }
  }

  // Bad matches in top 10 from feedback
  const orgFeedback = Object.values(feedback).filter((f) => f.org_id === orgId);
  const feedbackMap = new Map(orgFeedback.map((f) => [f.opp_id, f.label]));
  const bad_in_top_10 = top10ids.filter((id) => feedbackMap.get(id) === "bad").length;

  const topRated = top10ids.map((id) => feedbackMap.get(id)).filter(Boolean) as FeedbackLabel[];
  const avg_rating_top_10 = topRated.length > 0
    ? Math.round((topRated.map(feedbackRating).reduce((a, b) => a + b, 0) / topRated.length) * 100) / 100
    : null;

  return {
    total_scored,
    eligible_count: eligible.length,
    ineligible_count,
    avg_score,
    median_score,
    precision_at_5,
    precision_at_10,
    recall_on_labeled,
    bad_in_top_10,
    avg_rating_top_10,
    score_distribution,
    by_source,
    by_funding_type,
    filtered_by_eligibility_pct,
  };
}
