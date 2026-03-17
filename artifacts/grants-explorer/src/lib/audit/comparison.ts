import type { OrgProfile, NormalizedOpportunity } from "@/lib/algorithm/types";
import type { AlgorithmVariant } from "./types";
import { ALGORITHM_VARIANTS } from "./types";
import { runVariantScoring } from "./scoreTrace";
import { getTopMatchesHybrid } from "@/lib/v2/matcherHybrid";
import type { HybridScoreTrace } from "@/lib/v2/types";

export interface VariantResult {
  variant: AlgorithmVariant;
  results: { opp_id: string; title: string; source: string; score: number; rank: number }[];
  hybridTraces?: HybridScoreTrace[];
}

export interface ComparisonRow {
  opp_id: string;
  title: string;
  source: string;
  scores: Record<string, number>;
  ranks: Record<string, number>;
  rank_delta_min_max: number;
  flag: "rises" | "falls" | "stable" | "new";
}

// ─── V2 vs V1 Comparison Row ──────────────────────────────────────────────────

export interface V1V2CompRow {
  opp_id: string;
  title: string;
  source: string;
  v1Score: number | null;
  v2Score: number | null;
  rankV1: number | null;
  rankV2: number | null;
  rankDelta: number | null;
  scoreDelta: number | null;
  flag: "rose" | "fell" | "stable" | "new" | "dropped";
  hybridTrace?: HybridScoreTrace;
}

export function runV1vsV2Comparison(
  org: OrgProfile,
  pool: NormalizedOpportunity[],
  limit = 20,
): { v1Rows: VariantResult; hybridRows: VariantResult; table: V1V2CompRow[] } {
  // Run V1 with default weights
  const v1Variant = ALGORITHM_VARIANTS.find(v => v.key === "v1_current")!;
  const v1Scored = runVariantScoring(org, pool, v1Variant.weights, false, limit);
  const v1Results = v1Scored.map(s => ({
    opp_id: s.trace.opp.id,
    title: s.trace.opp.title,
    source: s.trace.opp.source,
    score: s.trace.scores.total,
    rank: s.rank,
  }));

  // Run Hybrid V2
  const hybridTraces = getTopMatchesHybrid(org, pool, limit);
  const hybridResults = hybridTraces.map((t, i) => ({
    opp_id: t.opp.id,
    title: t.opp.title,
    source: t.opp.source,
    score: t.finalScore,
    rank: i + 1,
  }));

  const v1Map = new Map(v1Results.map(r => [r.opp_id, r]));
  const hybridMap = new Map(hybridResults.map((r, i) => [r.opp_id, { ...r, trace: hybridTraces[i] }]));
  const allIds = new Set([...v1Map.keys(), ...hybridMap.keys()]);

  const table: V1V2CompRow[] = [];
  for (const id of allIds) {
    const v1 = v1Map.get(id) ?? null;
    const v2 = hybridMap.get(id) ?? null;
    const opp = v1 ?? v2;
    if (!opp) continue;

    const rankDelta = v1 && v2 ? v1.rank - v2.rank : null;
    const scoreDelta = v1 && v2 ? v2.score - v1.score : null;

    const flag: V1V2CompRow["flag"] =
      !v1 ? "new"
      : !v2 ? "dropped"
      : rankDelta != null && rankDelta >= 3 ? "rose"
      : rankDelta != null && rankDelta <= -3 ? "fell"
      : "stable";

    table.push({
      opp_id: id,
      title: opp.title,
      source: opp.source,
      v1Score: v1?.score ?? null,
      v2Score: v2?.score ?? null,
      rankV1: v1?.rank ?? null,
      rankV2: v2?.rank ?? null,
      rankDelta,
      scoreDelta,
      flag,
      hybridTrace: hybridMap.get(id)?.trace,
    });
  }

  table.sort((a, b) => {
    const aR = a.rankV2 ?? a.rankV1 ?? 999;
    const bR = b.rankV2 ?? b.rankV1 ?? 999;
    return aR - bR;
  });

  return {
    v1Rows: { variant: v1Variant, results: v1Results },
    hybridRows: { variant: ALGORITHM_VARIANTS.find(v => v.key === "v2_current")!, results: hybridResults, hybridTraces },
    table,
  };
}

// ─── Multi-Variant V1 Comparison ──────────────────────────────────────────────

export function runComparison(
  org: OrgProfile,
  pool: NormalizedOpportunity[],
  variantKeys: string[] = ["v1_current", "v1_mission_heavy", "v1_synonyms"]
): { variantResults: VariantResult[]; table: ComparisonRow[] } {
  const variants = ALGORITHM_VARIANTS.filter(v => variantKeys.includes(v.key));
  const variantResults: VariantResult[] = [];

  for (const variant of variants) {
    if (variant.isV2) {
      // V2 Hybrid variant — use hybrid scoring engine
      const hybridTraces = getTopMatchesHybrid(org, pool, 20);
      variantResults.push({
        variant,
        results: hybridTraces.map((t, i) => ({
          opp_id: t.opp.id,
          title: t.opp.title,
          source: t.opp.source,
          score: t.finalScore,
          rank: i + 1,
        })),
        hybridTraces,
      });
    } else {
      // V1 variant — use keyword scoring
      const scored = runVariantScoring(org, pool, variant.weights, variant.useSynonymExpansion, 20);
      variantResults.push({
        variant,
        results: scored.map(s => ({
          opp_id: s.trace.opp.id,
          title: s.trace.opp.title,
          source: s.trace.opp.source,
          score: s.trace.scores.total,
          rank: s.rank,
        })),
      });
    }
  }

  // Build union table
  const allIds = new Set<string>();
  for (const vr of variantResults) vr.results.forEach(r => allIds.add(r.opp_id));

  const table: ComparisonRow[] = [];
  for (const id of allIds) {
    const scores: Record<string, number> = {};
    const ranks: Record<string, number> = {};
    let title = id;
    let source = "";

    for (const vr of variantResults) {
      const r = vr.results.find(x => x.opp_id === id);
      scores[vr.variant.key] = r?.score ?? 0;
      ranks[vr.variant.key] = r?.rank ?? 999;
      if (r) { title = r.title; source = r.source; }
    }

    const rankValues = Object.values(ranks).filter(r => r < 999);
    const delta = rankValues.length > 1 ? Math.max(...rankValues) - Math.min(...rankValues) : 0;

    const baseRank = ranks[variantResults[0]?.variant.key ?? ""] ?? 999;
    const adjustedRank = ranks[variantResults[1]?.variant.key ?? ""] ?? 999;

    let flag: ComparisonRow["flag"] = "stable";
    if (baseRank === 999 && adjustedRank < 999) flag = "new";
    else if (adjustedRank < baseRank - 2) flag = "rises";
    else if (adjustedRank > baseRank + 2) flag = "falls";

    table.push({ opp_id: id, title, source, scores, ranks, rank_delta_min_max: delta, flag });
  }

  table.sort((a, b) =>
    (a.ranks[variantResults[0]?.variant.key ?? ""] ?? 999) -
    (b.ranks[variantResults[0]?.variant.key ?? ""] ?? 999)
  );

  return { variantResults, table };
}
