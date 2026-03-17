/**
 * sweep.ts — Full-database sweep analytics
 *
 * Runs the Hybrid V2 scorer over every active opportunity in the pool and
 * aggregates statistics about how the algorithm behaves at scale.  Only the
 * top-N traces are retained in memory; everything else is counted and then
 * discarded so the heap stays manageable.
 */

import type { OrgProfile, NormalizedOpportunity } from "@/lib/algorithm/types";
import { filterToActiveOpportunities } from "@/lib/algorithm/matcher";
import { scoreMatchHybrid } from "@/lib/v2/matcherHybrid";
import type { HybridScoreTrace } from "@/lib/v2/types";
import type { ScoreTrace } from "./types";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface SourceStats {
  total: number;
  eligible: number;
  scored: number;
  avgScore: number;
  topScore: number;
}

export interface SweepStats {
  // ── Pool ──────────────────────────────────────────────────────────────────
  totalPool: number;
  activeOpps: number;
  inactiveFiltered: number;

  // ── Elimination funnel ────────────────────────────────────────────────────
  // "ineligible" = passes_eligibility is false (fast-fail gate)
  ineligibleCount: number;
  // eligible but finalScore === 0
  eligibleZeroCount: number;
  // finalScore > 0
  scoredCount: number;
  above30: number;
  above50: number;
  above70: number;
  above85: number;

  // ── Score histogram ───────────────────────────────────────────────────────
  // 10 buckets: [1-10, 11-20, 21-30, ..., 91-100] (index 0 = 1-10)
  // Scores of 0 are NOT included in the histogram (they are in eligibleZeroCount)
  histogram: number[];

  // ── Source breakdown ──────────────────────────────────────────────────────
  bySource: Record<string, SourceStats>;

  // ── Hybrid-only analytics ─────────────────────────────────────────────────
  // Opportunity type distribution across all scored opps
  oppTypeCounts: Record<string, number>;
  // Complexity band distribution
  complexityCounts: Record<string, number>;
  // Capacity band match distribution (org capacity vs opp complexity)
  capacityMatchCounts: Record<string, number>;
  // Average value of each of the 8 hybrid dimensions across scored opps
  dimensionSums: Record<string, number>;
  dimensionAvgs: Record<string, number>;
  // Risk pattern frequency (top cited risks)
  riskCounts: Record<string, number>;
  // Boost statistics
  semanticBoostTotal: number;
  maturityBoostTotal: number;
  penaltyTotal: number;
}

// ─── Hybrid Sweep ─────────────────────────────────────────────────────────────

export interface HybridSweepResult {
  stats: SweepStats;
  topTraces: HybridScoreTrace[];
}

export function runHybridSweep(
  org: OrgProfile,
  pool: NormalizedOpportunity[],
  topN = 50,
): HybridSweepResult {
  const { active, excluded } = filterToActiveOpportunities(pool);

  const stats: SweepStats = {
    totalPool: pool.length,
    activeOpps: active.length,
    inactiveFiltered: excluded.length,
    ineligibleCount: 0,
    eligibleZeroCount: 0,
    scoredCount: 0,
    above30: 0,
    above50: 0,
    above70: 0,
    above85: 0,
    histogram: new Array(10).fill(0),
    bySource: {},
    oppTypeCounts: {},
    complexityCounts: {},
    capacityMatchCounts: {},
    dimensionSums: {
      missionDomain: 0, eligibility: 0, orgTypeFit: 0, activityFit: 0,
      geographyFit: 0, capacityFit: 0, fundingFit: 0, populationFit: 0,
    },
    dimensionAvgs: {},
    riskCounts: {},
    semanticBoostTotal: 0,
    maturityBoostTotal: 0,
    penaltyTotal: 0,
  };

  // Min-heap of top-N traces (sorted ascending so we can evict the lowest)
  const topTraces: HybridScoreTrace[] = [];

  for (const opp of active) {
    const src = opp.source;
    if (!stats.bySource[src]) {
      stats.bySource[src] = { total: 0, eligible: 0, scored: 0, avgScore: 0, topScore: 0 };
    }
    stats.bySource[src].total++;

    const trace = scoreMatchHybrid(org, opp);

    if (!trace.passes_eligibility) {
      stats.ineligibleCount++;
      continue;
    }

    stats.bySource[src].eligible++;

    const score = trace.finalScore;

    if (score === 0) {
      stats.eligibleZeroCount++;
      continue;
    }

    // Scored > 0 ─────────────────────────────────────────────────────────────
    stats.scoredCount++;
    stats.bySource[src].scored++;
    stats.bySource[src].topScore = Math.max(stats.bySource[src].topScore, score);
    // Running average update
    const n = stats.bySource[src].scored;
    stats.bySource[src].avgScore = stats.bySource[src].avgScore + (score - stats.bySource[src].avgScore) / n;

    // Threshold bands
    if (score > 30)  stats.above30++;
    if (score > 50)  stats.above50++;
    if (score > 70)  stats.above70++;
    if (score > 85)  stats.above85++;

    // Histogram (bucket = Math.floor((score - 1) / 10), capped at 9)
    const bucket = Math.min(9, Math.floor((score - 1) / 10));
    stats.histogram[bucket]++;

    // Opportunity type
    const oppType = trace.oppProfile.opportunityType;
    stats.oppTypeCounts[oppType] = (stats.oppTypeCounts[oppType] ?? 0) + 1;

    // Complexity band
    const cplx = trace.oppProfile.complexityBand;
    stats.complexityCounts[cplx] = (stats.complexityCounts[cplx] ?? 0) + 1;

    // Capacity match label
    const capMatch = `${trace.orgProfile.capacityBand} org → ${cplx} opp`;
    stats.capacityMatchCounts[capMatch] = (stats.capacityMatchCounts[capMatch] ?? 0) + 1;

    // Dimension sums
    for (const [k, v] of Object.entries(trace.dimensions)) {
      stats.dimensionSums[k] = (stats.dimensionSums[k] ?? 0) + v;
    }

    // Boosts / penalties
    stats.semanticBoostTotal += trace.semanticBoost;
    stats.maturityBoostTotal += trace.maturityBoost;
    stats.penaltyTotal       += trace.penaltyTotal;

    // Risk pattern counts
    for (const r of trace.risks) {
      // Normalise to a short key (trim after first em-dash or parenthesis)
      const key = r.replace(/\s*[—(].*$/, "").trim();
      stats.riskCounts[key] = (stats.riskCounts[key] ?? 0) + 1;
    }

    // Keep top-N traces (insertion into sorted array)
    topTraces.push(trace);
    topTraces.sort((a, b) => b.finalScore - a.finalScore);
    if (topTraces.length > topN) topTraces.pop();
  }

  // Compute dimension averages
  if (stats.scoredCount > 0) {
    for (const [k, sum] of Object.entries(stats.dimensionSums)) {
      stats.dimensionAvgs[k] = Math.round((sum / stats.scoredCount) * 10) / 10;
    }
  }

  return { stats, topTraces };
}

// ─── V1 Sweep Stats (derived from existing allTraces) ─────────────────────────

export function computeV1SweepStats(
  allTraces: ScoreTrace[],
  totalPool: number,
  activeCount: number,
): SweepStats {
  const stats: SweepStats = {
    totalPool,
    activeOpps: activeCount,
    inactiveFiltered: totalPool - activeCount,
    ineligibleCount: 0,
    eligibleZeroCount: 0,
    scoredCount: 0,
    above30: 0,
    above50: 0,
    above70: 0,
    above85: 0,
    histogram: new Array(10).fill(0),
    bySource: {},
    oppTypeCounts: {},
    complexityCounts: {},
    capacityMatchCounts: {},
    dimensionSums: {},
    dimensionAvgs: {},
    riskCounts: {},
    semanticBoostTotal: 0,
    maturityBoostTotal: 0,
    penaltyTotal: 0,
  };

  for (const t of allTraces) {
    const src = t.opp.source ?? "unknown";
    if (!stats.bySource[src]) {
      stats.bySource[src] = { total: 0, eligible: 0, scored: 0, avgScore: 0, topScore: 0 };
    }
    stats.bySource[src].total++;

    if (!t.passes_eligibility) {
      stats.ineligibleCount++;
      continue;
    }

    stats.bySource[src].eligible++;
    const score = t.scores.total;

    if (score === 0) {
      stats.eligibleZeroCount++;
      continue;
    }

    stats.scoredCount++;
    stats.bySource[src].scored++;
    stats.bySource[src].topScore = Math.max(stats.bySource[src].topScore, score);
    const n = stats.bySource[src].scored;
    stats.bySource[src].avgScore = stats.bySource[src].avgScore + (score - stats.bySource[src].avgScore) / n;

    if (score > 30)  stats.above30++;
    if (score > 50)  stats.above50++;
    if (score > 70)  stats.above70++;
    if (score > 85)  stats.above85++;

    const bucket = Math.min(9, Math.floor((score - 1) / 10));
    stats.histogram[bucket]++;

    const ft = t.opp.funding_type ?? "unknown";
    stats.oppTypeCounts[ft] = (stats.oppTypeCounts[ft] ?? 0) + 1;
  }

  return stats;
}
