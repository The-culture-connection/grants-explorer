import type { OrgProfile, NormalizedOpportunity } from "@/lib/algorithm/types";
import type { AlgorithmVariant } from "./types";
import { ALGORITHM_VARIANTS } from "./types";
import { runVariantScoring } from "./scoreTrace";

export interface VariantResult {
  variant: AlgorithmVariant;
  results: { opp_id: string; title: string; source: string; score: number; rank: number }[];
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

export function runComparison(
  org: OrgProfile,
  pool: NormalizedOpportunity[],
  variantKeys: string[] = ["v1_current", "v1_mission_heavy", "v1_synonyms"]
): { variantResults: VariantResult[]; table: ComparisonRow[] } {
  const variants = ALGORITHM_VARIANTS.filter((v) => variantKeys.includes(v.key));
  const variantResults: VariantResult[] = variants.map((variant) => {
    const scored = runVariantScoring(org, pool, variant.weights, variant.useSynonymExpansion, 20);
    return {
      variant,
      results: scored.map((s) => ({
        opp_id: s.trace.opp.id,
        title: s.trace.opp.title,
        source: s.trace.opp.source,
        score: s.trace.scores.total,
        rank: s.rank,
      })),
    };
  });

  // Build union of all ranked opp_ids
  const allIds = new Set<string>();
  for (const vr of variantResults) vr.results.forEach((r) => allIds.add(r.opp_id));

  const table: ComparisonRow[] = [];
  for (const id of allIds) {
    const scores: Record<string, number> = {};
    const ranks: Record<string, number> = {};
    for (const vr of variantResults) {
      const r = vr.results.find((x) => x.opp_id === id);
      scores[vr.variant.key] = r?.score ?? 0;
      ranks[vr.variant.key] = r?.rank ?? 999;
    }
    const rankValues = Object.values(ranks).filter((r) => r < 999);
    const minRank = rankValues.length > 0 ? Math.min(...rankValues) : 999;
    const maxRank = rankValues.length > 0 ? Math.max(...rankValues) : 999;
    const delta = maxRank - minRank;

    const baseResult = variantResults[0]?.results.find((r) => r.opp_id === id);
    const title = baseResult?.title ?? id;
    const source = baseResult?.source ?? "";

    let flag: ComparisonRow["flag"] = "stable";
    const baseRank = ranks[variantResults[0]?.variant.key ?? ""] ?? 999;
    const adjustedRank = ranks[variantResults[1]?.variant.key ?? ""] ?? 999;
    if (baseRank === 999 && adjustedRank < 999) flag = "new";
    else if (adjustedRank < baseRank - 2) flag = "rises";
    else if (adjustedRank > baseRank + 2) flag = "falls";

    table.push({ opp_id: id, title, source, scores, ranks, rank_delta_min_max: delta, flag });
  }

  table.sort((a, b) => (a.ranks[variantResults[0]?.variant.key ?? ""] ?? 999) - (b.ranks[variantResults[0]?.variant.key ?? ""] ?? 999));

  return { variantResults, table };
}
