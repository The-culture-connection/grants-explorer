/**
 * AlgorithmPlayground — Upload org profiles + opportunity JSON, run any
 * algorithm version (V1–V4) with full verbose logging, and export results.
 */
import React, { useState, useRef, useCallback } from "react";
import { Link } from "wouter";
import {
  ArrowLeft, Upload, Play, Download, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, AlertTriangle, Terminal, BarChart3,
  FileJson, Database, Zap, RefreshCw, Copy, Check,
  ThumbsUp, ThumbsDown, HelpCircle, GitCompare, Sliders,
  Save, FolderOpen, Trash2, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

import type { OrgProfile, NormalizedOpportunity } from "@/lib/algorithm/types";
import { useAuth } from "@/context/AuthContext";
import { loadFullOpportunityPool, coerceOrgProfile, dbRecordToOpportunity } from "@/lib/poolLoader";
import type { PoolDiagnostics } from "@/lib/poolLoader";
import { buildScoreTrace } from "@/lib/audit/scoreTrace";
import { DEFAULT_WEIGHTS } from "@/lib/audit/types";
import { scoreMatchHybrid } from "@/lib/v2/matcherHybrid";
import { scoreMatchV3 } from "@/lib/v3/matcherV3";
import { scoreMatchV4 } from "@/lib/v4/matcherV4";
import { scoreMatchV5, DEFAULT_V5_CONFIG } from "@/lib/v5/matcherV5";
import type { V5Config } from "@/lib/v5/matcherV5";
import { getInterpretedOpportunityForMatcher } from "@/lib/v5/opportunityInterpreter";
import type { InterpretedOpportunityProfile } from "@/lib/v5/opportunityInterpreter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

type AlgoVersion = "v1" | "v2" | "v3" | "v4" | "v5" | "compare";
type OppSource = "live" | "upload";
type OrgSource = "user" | "upload";
type LabelValue = "good" | "bad" | "unsure";

const LABEL_STORE_KEY = "pg_labels_v2";
const PRESET_STORE_KEY = "pg_v5_presets";

function loadLabels(): Record<string, LabelValue> {
  try { return JSON.parse(localStorage.getItem(LABEL_STORE_KEY) ?? "{}"); } catch { return {}; }
}
function saveLabels(labels: Record<string, LabelValue>) {
  localStorage.setItem(LABEL_STORE_KEY, JSON.stringify(labels));
}
function loadPresets(): Record<string, V5Config> {
  try { return JSON.parse(localStorage.getItem(PRESET_STORE_KEY) ?? "{}"); } catch { return {}; }
}
function savePresets(presets: Record<string, V5Config>) {
  localStorage.setItem(PRESET_STORE_KEY, JSON.stringify(presets));
}
function labelKey(version: string, orgId: string, oppId: string) {
  return `${version}_${orgId}_${oppId}`;
}

// ─── Normalised result shape (common across all algo versions) ────────────────
interface PlaygroundResult {
  rank: number;
  score: number;
  confidence: string;
  opp: NormalizedOpportunity;
  passes_eligibility: boolean;
  eligibility_reason: string;
  reasons: string[];
  risks: string[];
  dimensions: Record<string, number>;
  dimensionMaxes: Record<string, number>;
  audit_trace: string[];
  extra: Record<string, unknown>; // version-specific extras
  raw: unknown;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const V1_MAXES: Record<string, number> = {
  mission_topic_fit: 60, eligibility_fit: 20, geography_fit: 10,
  funding_size_fit: 5, maturity_fit: 5,
};
const V2_MAXES: Record<string, number> = {
  missionDomain: 30, eligibility: 20, orgTypeFit: 15, activityFit: 10,
  geographyFit: 10, capacityFit: 8, fundingFit: 5, populationFit: 2,
};
const V3_MAXES: Record<string, number> = {
  conceptFit: 26, conceptCentrality: 10, activityFit: 10, populationFit: 8,
  targetApplicantFit: 12, eligibility: 10, geographyFit: 8, capacityFit: 7,
  fundingFit: 6, sourceRelevance: 3,
};
const V4_MAXES = V3_MAXES;
const V5_MAXES: Record<string, number> = {
  titleMissionFit: 60, orgTypeFit: 25, populationTitleFit: 10,
  geographySanity: 5, genericPenalty: 20,
};

function scoreColor(n: number) {
  if (n >= 70) return "text-emerald-600";
  if (n >= 50) return "text-amber-500";
  return "text-red-500";
}
function scoreBg(n: number) {
  if (n >= 70) return "bg-emerald-50 border-emerald-200";
  if (n >= 50) return "bg-amber-50 border-amber-200";
  return "bg-slate-50 border-slate-200";
}
function confidenceBadge(c: string) {
  if (c === "excellent") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (c === "strong")    return "bg-blue-100 text-blue-700 border-blue-200";
  if (c === "moderate")  return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

// ─── Score normalisation across versions ──────────────────────────────────────
function normaliseTrace(raw: unknown, rank: number, version: AlgoVersion): PlaygroundResult {
  const t = raw as any;
  if (version === "v1") {
    const s = t.scores ?? {};
    const dims: Record<string, number> = {
      mission_topic_fit: s.mission_topic_fit ?? 0,
      eligibility_fit:   s.eligibility_fit   ?? 0,
      geography_fit:     s.geography_fit      ?? 0,
      funding_size_fit:  s.funding_size_fit   ?? 0,
      maturity_fit:      s.maturity_fit       ?? 0,
    };
    const score = s.total ?? 0;
    return {
      rank, score,
      confidence: score >= 70 ? "excellent" : score >= 50 ? "strong" : score >= 30 ? "moderate" : "weak",
      opp: t.opp,
      passes_eligibility: t.passes_eligibility,
      eligibility_reason: t.eligibility_reason ?? "",
      reasons: t.matched_tokens?.length > 0
        ? [`Keyword matches: ${t.matched_tokens.slice(0, 6).join(", ")}`] : [],
      risks: t.passes_eligibility ? [] : [t.eligibility_reason],
      dimensions: dims,
      dimensionMaxes: V1_MAXES,
      audit_trace: t.audit_trace ?? [],
      extra: { matched_tokens: t.matched_tokens ?? [] },
      raw,
    };
  }
  if (version === "v2") {
    const dims: Record<string, number> = { ...(t.dimensions ?? {}) };
    const score = t.finalScore ?? 0;
    return {
      rank, score,
      confidence: score >= 70 ? "excellent" : score >= 50 ? "strong" : score >= 30 ? "moderate" : "weak",
      opp: t.opp,
      passes_eligibility: t.passes_eligibility,
      eligibility_reason: t.eligibility_reason ?? "",
      reasons: t.reasons ?? [],
      risks: t.risks ?? [],
      dimensions: dims,
      dimensionMaxes: V2_MAXES,
      audit_trace: t.audit_trace ?? [],
      extra: { semanticBoost: t.semanticBoost, maturityBoost: t.maturityBoost, penaltyTotal: t.penaltyTotal },
      raw,
    };
  }
  if (version === "v3") {
    const dims: Record<string, number> = { ...(t.dimensions ?? {}) };
    const score = t.finalScore ?? 0;
    return {
      rank, score,
      confidence: score >= 70 ? "excellent" : score >= 55 ? "strong" : score >= 38 ? "moderate" : "weak",
      opp: t.opp,
      passes_eligibility: t.passes_eligibility,
      eligibility_reason: t.eligibility_reason ?? "",
      reasons: t.reasons ?? [],
      risks: t.risks ?? [],
      dimensions: dims,
      dimensionMaxes: V3_MAXES,
      audit_trace: t.audit_trace ?? [],
      extra: { subSignals: t.subSignals, semanticBoost: t.semanticBoost, penaltyTotal: t.penaltyTotal },
      raw,
    };
  }
  if (version === "v5") {
    const score = t.finalScore ?? 0;
    return {
      rank, score,
      confidence: score >= 70 ? "excellent" : score >= 50 ? "strong" : score >= 30 ? "moderate" : "weak",
      opp: t.opp,
      passes_eligibility: true, // V5 doesn't gate eligibility
      eligibility_reason: "",
      reasons: t.reasons ?? [],
      risks: t.risks ?? [],
      dimensions: { ...(t.dimensions ?? {}) },
      dimensionMaxes: V5_MAXES,
      audit_trace: t.audit_trace ?? [],
      extra: {
        titleHits: [
          ...((t.titleTrace as any)?.exactPhraseMatches ?? []),
          ...((t.titleTrace as any)?.nearPhraseMatches ?? []),
          ...((t.titleTrace as any)?.conceptMatches ?? []),
        ],
        orgTypeInferred: (t.orgTypeTrace as any)?.userOrgType ?? "",
        oppTargetInferred: (t.orgTypeTrace as any)?.oppTargetType ?? "",
        rawFitScore: (t.orgTypeTrace as any)?.score ?? 0,
        genericPenalty: t.dimensions?.genericPenalty ?? 0,
        config: t.config,
        interpreted: (t.interpretedProfile as InterpretedOpportunityProfile | null | undefined) ?? null,
      },
      raw,
    };
  }
  // v4 / compare (compare uses V4 shape)
  const score = t.finalScore ?? 0;
  return {
    rank, score,
    confidence: t.confidence ?? (score >= 70 ? "excellent" : score >= 55 ? "strong" : score >= 38 ? "moderate" : "weak"),
    opp: t.opp,
    passes_eligibility: t.passes_eligibility,
    eligibility_reason: t.eligibility_reason ?? "",
    reasons: t.reasons ?? [],
    risks: t.risks ?? [],
    dimensions: { ...(t.dimensions ?? {}) },
    dimensionMaxes: V4_MAXES,
    audit_trace: t.audit_trace ?? [],
    extra: {
      exactPhraseMatches: t.exactPhraseMatches ?? [],
      highValueConcepts: t.highValueConcepts ?? [],
      specificityRatio: t.specificityRatio ?? 0,
      semanticBoost: t.semanticBoost, recencyBoost: t.recencyBoost,
      penaltyTotal: t.penaltyTotal, penalties: t.penalties ?? [],
    },
    raw,
  };
}

// ─── JSON/CSV export helpers ───────────────────────────────────────────────────
function exportJSON(results: PlaygroundResult[], org: OrgProfile, version: AlgoVersion) {
  const data = {
    exported_at: new Date().toISOString(),
    algorithm: version.toUpperCase(),
    org_name: org.name,
    total_results: results.length,
    results: results.map((r) => ({
      rank: r.rank,
      score: r.score,
      confidence: r.confidence,
      title: r.opp.title,
      source: r.opp.source,
      agency: r.opp.agency,
      close_date: r.opp.close_date,
      max_award: r.opp.max_award,
      url: r.opp.url,
      passes_eligibility: r.passes_eligibility,
      eligibility_reason: r.eligibility_reason,
      reasons: r.reasons,
      risks: r.risks,
      dimensions: r.dimensions,
      audit_trace: r.audit_trace,
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `playground_${version}_${Date.now()}.json`;
  a.click(); URL.revokeObjectURL(url);
}

function exportCSV(results: PlaygroundResult[], org: OrgProfile, version: AlgoVersion) {
  const headers = ["Rank","Score","Confidence","Title","Source","Agency","Deadline","MaxAward","URL","Eligible","EligibilityReason","Reasons","Risks"];
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = results.map((r) => [
    r.rank, r.score, r.confidence,
    escape(r.opp.title), escape(r.opp.source), escape(r.opp.agency),
    escape(r.opp.close_date ?? ""), escape(r.opp.max_award ?? ""),
    escape(r.opp.url ?? ""),
    r.passes_eligibility ? "Yes" : "No",
    escape(r.eligibility_reason),
    escape(r.reasons.join(" | ")),
    escape(r.risks.join(" | ")),
  ].join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `playground_${version}_${Date.now()}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ─── Result card ──────────────────────────────────────────────────────────────
function ResultCard({
  result, version, currentLabel, onLabel,
}: {
  result: PlaygroundResult;
  version: AlgoVersion;
  currentLabel?: LabelValue | null;
  onLabel?: (oppId: string, value: LabelValue | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const r = result;
  const ex = r.extra as any;

  const copyTrace = () => {
    navigator.clipboard.writeText(r.audit_trace.join("\n"));
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`rounded-xl border ${scoreBg(r.score)} transition-all`}>
      {/* Summary row */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left p-4 flex items-start gap-3"
      >
        <span className="text-xs font-mono bg-white/70 border rounded px-1.5 py-0.5 mt-0.5 shrink-0">
          #{r.rank}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm leading-snug line-clamp-2">{r.opp.title}</div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="outline" className="text-[10px] font-mono">{r.opp.source}</Badge>
            {r.opp.agency && <span className="text-xs text-muted-foreground truncate max-w-[180px]">{r.opp.agency}</span>}
            {r.opp.close_date && (
              <span className="text-xs text-muted-foreground">due {r.opp.close_date}</span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0 flex flex-col items-end gap-1">
          <span className={`text-2xl font-black ${scoreColor(r.score)}`}>{r.score}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${confidenceBadge(r.confidence)}`}>
            {r.confidence}
          </span>
          {onLabel && (
            <div className="flex gap-0.5 mt-0.5" onClick={(e) => e.stopPropagation()}>
              <button
                title="Good match"
                onClick={() => onLabel(r.opp.id, currentLabel === "good" ? null : "good")}
                className={`p-1 rounded transition-colors ${currentLabel === "good" ? "bg-emerald-100 text-emerald-600" : "text-muted-foreground hover:text-emerald-500"}`}
              ><ThumbsUp className="h-3 w-3" /></button>
              <button
                title="Bad match"
                onClick={() => onLabel(r.opp.id, currentLabel === "bad" ? null : "bad")}
                className={`p-1 rounded transition-colors ${currentLabel === "bad" ? "bg-red-100 text-red-600" : "text-muted-foreground hover:text-red-500"}`}
              ><ThumbsDown className="h-3 w-3" /></button>
              <button
                title="Unsure"
                onClick={() => onLabel(r.opp.id, currentLabel === "unsure" ? null : "unsure")}
                className={`p-1 rounded transition-colors ${currentLabel === "unsure" ? "bg-amber-100 text-amber-600" : "text-muted-foreground hover:text-amber-500"}`}
              ><HelpCircle className="h-3 w-3" /></button>
            </div>
          )}
          {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground mt-1" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground mt-1" />}
        </div>
      </button>

      {/* Eligibility indicator */}
      {!r.passes_eligibility && (
        <div className="px-4 pb-2">
          <span className="inline-flex items-center gap-1 text-xs text-red-600 font-medium">
            <XCircle className="h-3.5 w-3.5" /> Ineligible — {r.eligibility_reason}
          </span>
        </div>
      )}

      {/* Expanded verbose panel */}
      {open && (
        <div className="border-t border-inherit px-4 pb-4 pt-3 space-y-4">

          {/* Score boosts summary row */}
          <div className="flex gap-4 text-xs text-muted-foreground font-mono bg-white/60 rounded px-3 py-2 flex-wrap">
            <span>base <strong>{(r.score + (ex.penaltyTotal ?? 0) - (ex.semanticBoost ?? 0) - (ex.recencyBoost ?? 0))}</strong></span>
            {ex.semanticBoost != null && <span>+{ex.semanticBoost} boost</span>}
            {ex.recencyBoost != null && ex.recencyBoost > 0 && <span>+{ex.recencyBoost} recency</span>}
            {ex.penaltyTotal != null && <span>−{ex.penaltyTotal} penalties</span>}
            <span className={`font-bold ${scoreColor(r.score)}`}>= {r.score}</span>
          </div>

          {/* Version-specific signals */}
          {version === "v4" && (ex.exactPhraseMatches?.length > 0 || ex.highValueConcepts?.length > 0) && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-xs space-y-1">
              <div className="font-semibold text-indigo-700 text-[10px] uppercase tracking-wider mb-1.5">Concept Signals</div>
              {ex.exactPhraseMatches?.length > 0 && (
                <div><span className="text-muted-foreground">Exact phrases: </span>
                  <span className="font-medium text-indigo-800">{ex.exactPhraseMatches.join(", ")}</span></div>
              )}
              {ex.highValueConcepts?.length > 0 && (
                <div><span className="text-muted-foreground">High-value concepts: </span>
                  <span className="font-medium text-indigo-800">{ex.highValueConcepts.join(", ")}</span></div>
              )}
              {ex.specificityRatio != null && (
                <div><span className="text-muted-foreground">Specificity ratio: </span>
                  <span className="font-mono">{(ex.specificityRatio * 100).toFixed(0)}%</span></div>
              )}
            </div>
          )}

          {version === "v5" && (
            <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 text-xs space-y-1.5">
              <div className="font-semibold text-teal-700 text-[10px] uppercase tracking-wider mb-1.5">V5 Signals</div>
              {ex.orgTypeInferred && (
                <div><span className="text-muted-foreground">Org type: </span>
                  <span className="font-medium text-teal-800">{ex.orgTypeInferred}</span>
                  {ex.oppTargetInferred && <span className="text-muted-foreground"> → opp targets: <span className="font-medium text-teal-800">{ex.oppTargetInferred}</span></span>}
                </div>
              )}
              {ex.titleHits?.length > 0 && (
                <div><span className="text-muted-foreground">Title concept hits: </span>
                  <span className="font-medium text-teal-800">{(ex.titleHits as string[]).join(", ")}</span></div>
              )}
              {ex.genericPenalty > 0 && (
                <div className="text-red-600"><span>Generic title penalty: </span><span className="font-mono">−{ex.genericPenalty}</span></div>
              )}
            </div>
          )}

          {/* Interpretation panel — V5 only, when interpreter data is available */}
          {version === "v5" && ex.interpreted && (() => {
            const interp = ex.interpreted as InterpretedOpportunityProfile;
            return (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1.5">
                <div className="font-semibold text-slate-700 text-[10px] uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  <Info className="h-3 w-3" /> Interpretation Layer
                </div>
                {interp.normalizedTitle !== interp.rawTitle && (
                  <div><span className="text-muted-foreground">Cleaned title: </span>
                    <span className="font-medium text-slate-800 italic">"{interp.normalizedTitle}"</span>
                  </div>
                )}
                {interp.opportunityType && (
                  <div><span className="text-muted-foreground">Type: </span>
                    <span className="font-mono text-slate-700">{interp.opportunityType}</span>
                  </div>
                )}
                {interp.domainTags.length > 0 && (
                  <div className="flex items-start gap-1 flex-wrap">
                    <span className="text-muted-foreground shrink-0">Domains: </span>
                    {interp.domainTags.map((d) => (
                      <span key={d} className="bg-blue-100 text-blue-700 px-1 rounded text-[9px]">{d}</span>
                    ))}
                    {interp.subdomainTags.map((d) => (
                      <span key={d} className="bg-blue-50 text-blue-500 px-1 rounded text-[9px]">{d}</span>
                    ))}
                  </div>
                )}
                {interp.activityTags.length > 0 && (
                  <div className="flex items-start gap-1 flex-wrap">
                    <span className="text-muted-foreground shrink-0">Activities: </span>
                    {interp.activityTags.map((a) => (
                      <span key={a} className="bg-violet-100 text-violet-700 px-1 rounded text-[9px]">{a}</span>
                    ))}
                  </div>
                )}
                {interp.populationTags.length > 0 && (
                  <div className="flex items-start gap-1 flex-wrap">
                    <span className="text-muted-foreground shrink-0">Populations: </span>
                    {interp.populationTags.map((p) => (
                      <span key={p} className="bg-emerald-100 text-emerald-700 px-1 rounded text-[9px]">{p}</span>
                    ))}
                  </div>
                )}
                {interp.intendedOrgTypes.length > 0 && (
                  <div><span className="text-muted-foreground">Intended applicants: </span>
                    <span className="font-medium text-slate-700">{interp.intendedOrgTypes.join(", ")}</span>
                    <span className="text-muted-foreground"> (conf: {(interp.confidence.orgType * 100).toFixed(0)}%)</span>
                  </div>
                )}
                {interp.inferredHighValuePhrases.length > 0 && (
                  <div className="flex items-start gap-1 flex-wrap">
                    <span className="text-muted-foreground shrink-0">Key phrases: </span>
                    {interp.inferredHighValuePhrases.slice(0, 6).map((p) => (
                      <span key={p} className="bg-amber-100 text-amber-700 px-1 rounded text-[9px]">{p}</span>
                    ))}
                  </div>
                )}
                {interp.geographyScope && (
                  <div><span className="text-muted-foreground">Geography scope: </span>
                    <span className="font-mono text-slate-700">{interp.geographyScope}</span>
                  </div>
                )}
              </div>
            );
          })()}

          {version === "v3" && ex.subSignals && (
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-xs space-y-1">
              <div className="font-semibold text-violet-700 text-[10px] uppercase tracking-wider mb-1.5">V3 Specificity Signals</div>
              {ex.subSignals.exactPhraseMatches?.length > 0 && (
                <div><span className="text-muted-foreground">Exact phrases: </span>
                  <span className="font-medium">{ex.subSignals.exactPhraseMatches.join(", ")}</span></div>
              )}
              <div><span className="text-muted-foreground">Specificity ratio: </span>
                <span className="font-mono">{((ex.subSignals.specificityRatio ?? 0) * 100).toFixed(0)}%</span></div>
              <div><span className="text-muted-foreground">Target applicant: </span>
                <span className="font-mono">{ex.subSignals.targetApplicantInferred ?? "—"}</span></div>
            </div>
          )}

          {version === "v1" && ex.matched_tokens?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {ex.matched_tokens.map((t: string) => (
                <span key={t} className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">{t}</span>
              ))}
            </div>
          )}

          {/* Dimension bars */}
          {Object.keys(r.dimensions).length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Dimension Scores</div>
              <div className="space-y-1.5">
                {Object.entries(r.dimensions).map(([dim, val]) => {
                  const max = r.dimensionMaxes[dim] ?? 10;
                  const pct = max > 0 ? Math.min(100, (val / max) * 100) : 0;
                  return (
                    <div key={dim} className="flex items-center gap-2">
                      <div className="w-36 text-xs text-muted-foreground truncate">
                        {dim.replace(/([A-Z])/g, " $1").replace(/_/g, " ").toLowerCase().trim()}
                      </div>
                      <div className="flex-1 bg-muted rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full ${pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-400"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="text-xs font-mono w-12 text-right text-muted-foreground">{val}/{max}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Penalties (V2/V3/V4) */}
          {version !== "v1" && ex.penalties?.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="text-[10px] font-semibold text-red-700 uppercase tracking-wider mb-1.5">Penalties (−{ex.penaltyTotal})</div>
              {ex.penalties.map((p: any, i: number) => (
                <div key={i} className="text-xs flex gap-1.5 items-start">
                  <span className="font-mono text-red-600 shrink-0">−{p.value}</span>
                  <span className="text-muted-foreground">{p.reason}</span>
                </div>
              ))}
            </div>
          )}

          {/* Reasons */}
          {r.reasons.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <div className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider mb-1.5">Why This Matches</div>
              <ul className="space-y-1">
                {r.reasons.map((reason, i) => (
                  <li key={i} className="text-xs flex gap-1.5 items-start">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Risks */}
          {r.risks.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider mb-1.5">Risks & Concerns</div>
              <ul className="space-y-1">
                {r.risks.map((risk, i) => (
                  <li key={i} className="text-xs flex gap-1.5 items-start">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                    {risk}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Audit trace terminal */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                <Terminal className="h-3 w-3" /> Audit Trace ({r.audit_trace.length} steps)
              </div>
              <Button size="sm" variant="ghost" className="h-5 px-2 text-[10px] gap-1" onClick={copyTrace}>
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="bg-zinc-900 rounded-lg p-3 font-mono text-[10px] text-green-400 space-y-0.5 max-h-56 overflow-y-auto">
              {r.audit_trace.length > 0
                ? r.audit_trace.map((line, i) => <div key={i}>{line}</div>)
                : <div className="text-zinc-500 italic">No trace output for this algorithm version.</div>}
            </div>
          </div>

          {/* Links + eligibility */}
          <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-3">
            <span className={r.passes_eligibility ? "text-emerald-600 font-medium" : "text-red-600 font-medium"}>
              {r.passes_eligibility ? "✓ Eligible" : "✗ Ineligible"} — {r.eligibility_reason}
            </span>
            {r.opp.url && (
              <a href={r.opp.url} target="_blank" rel="noopener noreferrer"
                className="text-primary hover:underline flex items-center gap-1">
                View ↗
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Upload button helper ─────────────────────────────────────────────────────
function UploadButton({
  label, accept, onLoad,
}: { label: string; accept: string; onLoad: (text: string, name: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref} type="file" accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => onLoad(reader.result as string, file.name);
          reader.readAsText(file);
          e.target.value = "";
        }}
      />
      <Button
        size="sm" variant="outline"
        className="gap-1.5 text-xs h-8 w-full"
        onClick={() => ref.current?.click()}
      >
        <Upload className="h-3.5 w-3.5" /> {label}
      </Button>
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AlgorithmPlayground() {
  const { user } = useAuth();

  // ── Org state ──────────────────────────────────────────────────────────────
  const [orgSource, setOrgSource] = useState<OrgSource>("user");
  const [uploadedOrgs, setUploadedOrgs] = useState<OrgProfile[]>([]);
  const [selectedOrgIdx, setSelectedOrgIdx] = useState(0);
  const [orgFileName, setOrgFileName] = useState("");
  const [orgError, setOrgError] = useState("");

  // ── Opportunities state ────────────────────────────────────────────────────
  const [oppSource, setOppSource] = useState<OppSource>("live");
  const [uploadedOpps, setUploadedOpps] = useState<NormalizedOpportunity[]>([]);
  const [oppFileName, setOppFileName] = useState("");
  const [oppError, setOppError] = useState("");

  // ── Algorithm state ────────────────────────────────────────────────────────
  const [version, setVersion] = useState<AlgoVersion>("v4");
  const [minScore, setMinScore] = useState(0);
  const [maxPerSource, setMaxPerSource] = useState(50);
  const [v5Config, setV5Config] = useState<V5Config>({ ...DEFAULT_V5_CONFIG });
  const [presets, setPresets] = useState<Record<string, V5Config>>(loadPresets);
  const [newPresetName, setNewPresetName] = useState("");
  const [presetMsg, setPresetMsg] = useState("");

  // ── Labels state ───────────────────────────────────────────────────────────
  const [labels, setLabels] = useState<Record<string, LabelValue>>(loadLabels);

  // ── Comparison state ───────────────────────────────────────────────────────
  const [compareV4Results, setCompareV4Results] = useState<PlaygroundResult[]>([]);
  const [compareV5Results, setCompareV5Results] = useState<PlaygroundResult[]>([]);

  // ── Diagnostics state ──────────────────────────────────────────────────────
  const [diagnostics, setDiagnostics] = useState<PoolDiagnostics | null>(null);

  // ── Run state ──────────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [results, setResults] = useState<PlaygroundResult[]>([]);
  const [ranOrg, setRanOrg] = useState<OrgProfile | null>(null);
  const [ranVersion, setRanVersion] = useState<AlgoVersion>("v4");
  const [poolSize, setPoolSize] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [filterMode, setFilterMode] = useState<"all" | "eligible">("all");

  // ── Derived ────────────────────────────────────────────────────────────────
  const activeOrg: OrgProfile | null = (() => {
    if (orgSource === "user") {
      if (!user?.org_profile) return null;
      return coerceOrgProfile(user.org_profile, user.id);
    }
    return uploadedOrgs[selectedOrgIdx] ?? null;
  })();

  const canRun = !!activeOrg && (oppSource === "live" || uploadedOpps.length > 0) && !running;

  // ── Label helpers ──────────────────────────────────────────────────────────
  const setLabel = useCallback((oppId: string, ver: string, value: LabelValue | null) => {
    const orgId = activeOrg?.id ?? "unknown";
    const key = labelKey(ver, orgId, oppId);
    setLabels((prev) => {
      const next = { ...prev };
      if (value == null) delete next[key]; else next[key] = value;
      saveLabels(next);
      return next;
    });
  }, [activeOrg]);

  const getLabel = useCallback((oppId: string, ver: string): LabelValue | null => {
    const orgId = activeOrg?.id ?? "unknown";
    return labels[labelKey(ver, orgId, oppId)] ?? null;
  }, [labels, activeOrg]);

  // ── Preset helpers ─────────────────────────────────────────────────────────
  const savePreset = useCallback((name: string) => {
    if (!name.trim()) return;
    const next = { ...presets, [name.trim()]: { ...v5Config } };
    setPresets(next); savePresets(next);
    setPresetMsg(`Saved "${name.trim()}"`);
    setTimeout(() => setPresetMsg(""), 2000);
    setNewPresetName("");
  }, [presets, v5Config]);

  const loadPreset = useCallback((name: string) => {
    if (presets[name]) { setV5Config({ ...presets[name] }); setPresetMsg(`Loaded "${name}"`); setTimeout(() => setPresetMsg(""), 2000); }
  }, [presets]);

  const deletePreset = useCallback((name: string) => {
    const next = { ...presets }; delete next[name];
    setPresets(next); savePresets(next);
  }, [presets]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleOrgUpload = useCallback((text: string, name: string) => {
    setOrgError("");
    try {
      const parsed = JSON.parse(text);
      const arr: OrgProfile[] = Array.isArray(parsed) ? parsed : [parsed];
      if (arr.length === 0) throw new Error("No org profiles found");
      // coerce each to valid OrgProfile
      const coerced = arr.map((o, i) => coerceOrgProfile(o, (o as any).id ?? `upload_${i}`));
      setUploadedOrgs(coerced);
      setSelectedOrgIdx(0);
      setOrgFileName(name);
      setOrgSource("upload");
    } catch (e: any) {
      setOrgError(e.message ?? "Invalid JSON");
    }
  }, []);

  const handleOppUpload = useCallback((text: string, name: string) => {
    setOppError("");
    try {
      const parsed = JSON.parse(text);
      const arr: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      if (arr.length === 0) throw new Error("No opportunities found");
      const opps = arr.map((r: any, i) => {
        // Try to use dbRecordToOpportunity for DB-style records,
        // or build a minimal NormalizedOpportunity from whatever shape we get
        try { return dbRecordToOpportunity(r); } catch {
          return {
            id: String(r.id ?? i),
            source: r.source ?? "upload",
            source_raw: r.source ?? "upload",
            title: r.title ?? "Untitled",
            description: r.description ?? "",
            agency: r.agency ?? "",
            funding_type: (r.funding_type ?? "grant") as any,
            status: (r.status ?? "active") as any,
            open_date: r.open_date,
            close_date: r.close_date ?? r.deadline,
            min_award: r.min_award,
            max_award: r.max_award,
            eligibility: Array.isArray(r.eligibility) ? r.eligibility : [],
            categories: Array.isArray(r.categories) ? r.categories : [],
            keywords: Array.isArray(r.keywords) ? r.keywords : [],
            geography: Array.isArray(r.geography) ? r.geography : [],
            url: r.url ?? "",
          } as any;
        }
      });
      setUploadedOpps(opps);
      setOppFileName(name);
      setOppSource("upload");
    } catch (e: any) {
      setOppError(e.message ?? "Invalid JSON");
    }
  }, []);

  const runAlgorithm = useCallback(async () => {
    if (!activeOrg) return;
    setRunning(true); setRunError(""); setResults([]);
    setCompareV4Results([]); setCompareV5Results([]);
    setDiagnostics(null);
    const t0 = performance.now();

    try {
      // 1. Build opportunity pool
      let pool: NormalizedOpportunity[];
      if (oppSource === "live") {
        const { pool: livePool, diagnostics: diag } = await loadFullOpportunityPool(API);
        pool = livePool;
        setDiagnostics(diag);
      } else {
        pool = uploadedOpps;
      }
      setPoolSize(pool.length);

      const effectiveVersion = version === "compare" ? "v4" : version;

      function scorePool(ver: AlgoVersion, cfg?: V5Config): PlaygroundResult[] {
        const rawTraces: unknown[] = pool.map((opp) => {
          if (ver === "v1") return buildScoreTrace(activeOrg!, opp, DEFAULT_WEIGHTS, false);
          if (ver === "v2") return scoreMatchHybrid(activeOrg!, opp);
          if (ver === "v3") return scoreMatchV3(activeOrg!, opp);
          if (ver === "v5") {
            const interp = getInterpretedOpportunityForMatcher(opp);
            return scoreMatchV5(activeOrg!, opp, cfg ?? v5Config, interp);
          }
          return scoreMatchV4(activeOrg!, opp);
        });

        const getScore = (t: unknown) => {
          const a = t as any;
          return ver === "v1" ? (a.scores?.total ?? 0) : (a.finalScore ?? 0);
        };
        rawTraces.sort((a, b) => getScore(b) - getScore(a));

        let normalised = rawTraces
          .map((t, i) => normaliseTrace(t, i + 1, ver))
          .filter((r) => r.score >= minScore);

        if ((ver === "v4") && maxPerSource < 999) {
          const sourceCounts: Record<string, number> = {};
          normalised = normalised.filter((r) => {
            const c = sourceCounts[r.opp.source] ?? 0;
            if (c >= maxPerSource) return false;
            sourceCounts[r.opp.source] = c + 1;
            return true;
          });
        }
        normalised.forEach((r, i) => { r.rank = i + 1; });
        return normalised;
      }

      if (version === "compare") {
        const v4 = scorePool("v4");
        const v5 = scorePool("v5");
        setCompareV4Results(v4);
        setCompareV5Results(v5);
        setResults(v4); // primary for stats
      } else {
        const normalised = scorePool(effectiveVersion as AlgoVersion);
        setResults(normalised);
      }

      setRanOrg(activeOrg);
      setRanVersion(effectiveVersion as AlgoVersion);
      setElapsedMs(Math.round(performance.now() - t0));
    } catch (e: any) {
      setRunError(e.message ?? "Run failed");
    } finally {
      setRunning(false);
    }
  }, [activeOrg, oppSource, uploadedOpps, version, minScore, maxPerSource, v5Config]);

  // ── Filtered results ───────────────────────────────────────────────────────
  const displayed = filterMode === "eligible"
    ? results.filter((r) => r.passes_eligibility)
    : results;

  const stats = results.length > 0 ? {
    total: results.length,
    eligible: results.filter((r) => r.passes_eligibility).length,
    above70: results.filter((r) => r.score >= 70).length,
    above50: results.filter((r) => r.score >= 50).length,
    avgScore: Math.round(results.reduce((s, r) => s + r.score, 0) / results.length),
    topScore: results[0]?.score ?? 0,
    bySrc: results.reduce((acc, r) => {
      acc[r.opp.source] = (acc[r.opp.source] ?? 0) + 1; return acc;
    }, {} as Record<string, number>),
  } : null;

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b bg-background/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-8">
                <ArrowLeft className="h-3.5 w-3.5" /> Home
              </Button>
            </Link>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <span className="font-bold text-sm">Algorithm Playground</span>
              <Badge variant="secondary" className="text-xs font-mono">
                {version.toUpperCase()}
              </Badge>
            </div>
          </div>

          {results.length > 0 && ranOrg && (
            <div className="flex items-center gap-2">
              <Button
                size="sm" variant="outline"
                className="gap-1.5 text-xs h-8"
                onClick={() => exportCSV(results, ranOrg, ranVersion)}
              >
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
              <Button
                size="sm" variant="outline"
                className="gap-1.5 text-xs h-8"
                onClick={() => exportJSON(results, ranOrg, ranVersion)}
              >
                <FileJson className="h-3.5 w-3.5" /> JSON
              </Button>
            </div>
          )}
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-6 flex gap-6 items-start">

        {/* ── Left sidebar ────────────────────────────────────────────────── */}
        <div className="w-80 shrink-0 space-y-4">

          {/* Org Profile */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Database className="h-4 w-4 text-primary" /> Org Profile
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              <Tabs value={orgSource} onValueChange={(v) => setOrgSource(v as OrgSource)}>
                <TabsList className="w-full h-8">
                  <TabsTrigger value="user" className="flex-1 text-xs">My Profile</TabsTrigger>
                  <TabsTrigger value="upload" className="flex-1 text-xs">Upload JSON</TabsTrigger>
                </TabsList>
              </Tabs>

              {orgSource === "user" && (
                activeOrg
                  ? <div className="text-xs bg-muted rounded p-2 space-y-0.5">
                      <div className="font-semibold">{activeOrg.name}</div>
                      <div className="text-muted-foreground capitalize">{activeOrg.org_type} · {activeOrg.years_in_operation}yr</div>
                      <div className="text-muted-foreground line-clamp-2 mt-1">{activeOrg.mission}</div>
                    </div>
                  : <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
                      No org profile found. Log in and complete your profile, or upload a JSON file.
                    </div>
              )}

              {orgSource === "upload" && (
                <div className="space-y-2">
                  <UploadButton
                    label={orgFileName ? `✓ ${orgFileName}` : "Upload org JSON"}
                    accept=".json"
                    onLoad={handleOrgUpload}
                  />
                  {orgError && <p className="text-xs text-red-500">{orgError}</p>}
                  {uploadedOrgs.length > 1 && (
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Select org ({uploadedOrgs.length} found)</Label>
                      <Select
                        value={String(selectedOrgIdx)}
                        onValueChange={(v) => setSelectedOrgIdx(Number(v))}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {uploadedOrgs.map((o, i) => (
                            <SelectItem key={i} value={String(i)} className="text-xs">
                              {o.name} ({o.org_type})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {uploadedOrgs.length === 1 && uploadedOrgs[0] && (
                    <div className="text-xs bg-muted rounded p-2 space-y-0.5">
                      <div className="font-semibold">{uploadedOrgs[0].name}</div>
                      <div className="text-muted-foreground capitalize">{uploadedOrgs[0].org_type}</div>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    Accepts a single org object or an array (e.g. testprofiles.json).
                    Fields: name, org_type, mission, program_areas, etc.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Opportunities */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" /> Opportunities
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              <Tabs value={oppSource} onValueChange={(v) => setOppSource(v as OppSource)}>
                <TabsList className="w-full h-8">
                  <TabsTrigger value="live" className="flex-1 text-xs">Live Pool</TabsTrigger>
                  <TabsTrigger value="upload" className="flex-1 text-xs">Upload JSON</TabsTrigger>
                </TabsList>
              </Tabs>

              {oppSource === "live" && (
                <div className="text-xs text-muted-foreground bg-muted rounded p-2 space-y-1">
                  <div className="font-medium text-foreground">Fetch from all 8 live sources</div>
                  <div>Simpler Grants · Grants.gov · SAM.gov · SBIR · 360Giving · CA Grants · World Bank · TED EU</div>
                  <div className="text-[10px] mt-1">~200–500 opportunities across 6 keywords. Fetched fresh on each run.</div>
                </div>
              )}

              {oppSource === "upload" && (
                <div className="space-y-2">
                  <UploadButton
                    label={oppFileName ? `✓ ${oppFileName} (${uploadedOpps.length})` : "Upload opportunities JSON"}
                    accept=".json"
                    onLoad={handleOppUpload}
                  />
                  {oppError && <p className="text-xs text-red-500">{oppError}</p>}
                  {uploadedOpps.length > 0 && (
                    <p className="text-xs text-emerald-600">{uploadedOpps.length} opportunities loaded</p>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    Accepts an array of opportunity objects with fields: id, title, description, source, agency, close_date, eligibility, keywords, geography, etc.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Algorithm Settings */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" /> Algorithm
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-4">
              {/* Version picker */}
              <div className="grid grid-cols-3 gap-1">
                {(["v1", "v2", "v3"] as AlgoVersion[]).map((v) => (
                  <button key={v} onClick={() => setVersion(v)}
                    className={`h-8 text-xs rounded font-semibold border transition-all ${
                      version === v ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:border-foreground"
                    }`}>{v.toUpperCase()}</button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(["v4", "v5", "compare"] as AlgoVersion[]).map((v) => (
                  <button key={v} onClick={() => setVersion(v)}
                    className={`h-8 text-xs rounded font-semibold border transition-all ${
                      version === v
                        ? v === "v4" ? "bg-indigo-600 text-white border-indigo-600"
                          : v === "v5" ? "bg-teal-600 text-white border-teal-600"
                          : "bg-slate-700 text-white border-slate-700"
                        : "border-border text-muted-foreground hover:border-foreground"
                    }`}>
                    {v === "compare" ? <span className="flex items-center justify-center gap-1"><GitCompare className="h-3 w-3" />CMP</span> : v.toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Version descriptions */}
              <div className="text-[10px] text-muted-foreground bg-muted rounded p-2 leading-relaxed">
                {version === "v1" && "Keyword overlap scoring with configurable weights across 5 dimensions."}
                {version === "v2" && "Hybrid V2: 8-dimension scoring with semantic boost, complexity bands, and risk signals."}
                {version === "v3" && "V3 RankFix: Specificity-first, phrase-priority scoring with 9 dimensions and strict eligibility gate."}
                {version === "v4" && "V4 Consolidated: Source-aware, 10-dimension engine with 140+ concept phrases, recency boost, and source diversity cap."}
                {version === "v5" && "V5 Title-First: Title mission fit dominates (0–60). Org-type fit second (0–25). Generic title penalty reduces noise."}
                {version === "compare" && "Compare Mode: Run V4 and V5 side-by-side. See score delta and where they disagree."}
              </div>

              {/* V5 pillar sliders */}
              {(version === "v5" || version === "compare") && (
                <div className="space-y-3 border-t pt-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-teal-700">
                    <Sliders className="h-3.5 w-3.5" /> V5 Pillar Weights
                  </div>
                  {([
                    { key: "titleMissionFitMax", label: "Title Mission Fit", max: 80, color: "accent-teal-500" },
                    { key: "orgTypeFitMax", label: "Org Type Fit", max: 40, color: "accent-teal-500" },
                    { key: "populationTitleMax", label: "Population in Title", max: 20, color: "accent-teal-500" },
                    { key: "geographyMax", label: "Geography Sanity", max: 15, color: "accent-teal-500" },
                    { key: "genericPenaltyMax", label: "Generic Penalty (max)", max: 30, color: "accent-red-400" },
                  ] as { key: keyof V5Config; label: string; max: number; color: string }[]).map(({ key, label, max }) => (
                    <div key={key} className="space-y-1">
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>{label}</span>
                        <span className="font-mono font-semibold text-foreground">{v5Config[key]}</span>
                      </div>
                      <input
                        type="range" min={0} max={max} step={1} value={v5Config[key]}
                        onChange={(e) => setV5Config((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                        className="w-full h-1.5 accent-teal-500"
                      />
                    </div>
                  ))}

                  {/* Preset save/load */}
                  <div className="border-t pt-2 space-y-2">
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Presets</div>
                    {Object.keys(presets).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {Object.keys(presets).map((name) => (
                          <div key={name} className="flex items-center gap-0.5">
                            <button
                              onClick={() => loadPreset(name)}
                              className="text-[10px] bg-teal-50 border border-teal-200 text-teal-700 rounded px-1.5 py-0.5 hover:bg-teal-100"
                            >
                              <FolderOpen className="h-2.5 w-2.5 inline mr-0.5" />{name}
                            </button>
                            <button onClick={() => deletePreset(name)} className="text-red-400 hover:text-red-600 p-0.5">
                              <Trash2 className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-1">
                      <input
                        type="text" placeholder="Preset name…"
                        value={newPresetName}
                        onChange={(e) => setNewPresetName(e.target.value)}
                        className="flex-1 h-7 text-[10px] border rounded px-2 bg-background"
                      />
                      <button
                        onClick={() => savePreset(newPresetName)}
                        disabled={!newPresetName.trim()}
                        className="h-7 px-2 text-[10px] bg-teal-600 text-white rounded disabled:opacity-40 hover:bg-teal-700"
                      >
                        <Save className="h-2.5 w-2.5" />
                      </button>
                    </div>
                    {presetMsg && <p className="text-[10px] text-teal-600">{presetMsg}</p>}
                    <button
                      onClick={() => setV5Config({ ...DEFAULT_V5_CONFIG })}
                      className="text-[10px] text-muted-foreground hover:text-foreground underline"
                    >
                      Reset to defaults
                    </button>
                  </div>
                </div>
              )}

              {/* V4 / V3 options */}
              {(version === "v4" || version === "v3" || version === "compare") && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Min score threshold: <strong>{minScore}</strong></Label>
                    <input
                      type="range" min={0} max={60} step={5} value={minScore}
                      onChange={(e) => setMinScore(Number(e.target.value))}
                      className="w-full h-1.5 accent-primary"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0 (show all)</span><span>60</span>
                    </div>
                  </div>
                  {version === "v4" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Max per source: <strong>{maxPerSource >= 50 ? "unlimited" : maxPerSource}</strong></Label>
                      <input
                        type="range" min={1} max={50} step={1} value={maxPerSource}
                        onChange={(e) => setMaxPerSource(Number(e.target.value))}
                        className="w-full h-1.5 accent-indigo-500"
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>1 (strict diversity)</span><span>50 (none)</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Run button */}
              <Button
                className="w-full gap-2"
                disabled={!canRun}
                onClick={runAlgorithm}
              >
                {running
                  ? <><RefreshCw className="h-4 w-4 animate-spin" /> Running…</>
                  : <><Play className="h-4 w-4" /> Run {version.toUpperCase()}</>
                }
              </Button>

              {!activeOrg && (
                <p className="text-[10px] text-amber-600 text-center">
                  Set up an org profile above to enable the run button.
                </p>
              )}
              {runError && <p className="text-xs text-red-500">{runError}</p>}
            </CardContent>
          </Card>
        </div>

        {/* ── Main results area ──────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Empty / loading state */}
          {!running && results.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed border-border bg-muted/20 flex flex-col items-center justify-center py-20 text-center px-6">
              <Zap className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <h3 className="font-semibold text-base mb-1">Ready to test</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Configure an org profile and opportunities on the left, then click <strong>Run</strong> to score all opportunities and see full verbose reasoning.
              </p>
            </div>
          )}

          {running && (
            <div className="rounded-2xl border bg-muted/20 flex flex-col items-center justify-center py-20 text-center">
              <RefreshCw className="h-8 w-8 text-primary animate-spin mb-3" />
              <p className="font-medium">Running {version.toUpperCase()} algorithm…</p>
              <p className="text-sm text-muted-foreground mt-1">
                {oppSource === "live" ? "Fetching live pool from all sources, then scoring…" : `Scoring ${uploadedOpps.length} uploaded opportunities…`}
              </p>
            </div>
          )}

          {/* Stats bar */}
          {stats && !running && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: "Total scored", value: stats.total, color: "text-foreground" },
                  { label: "Eligible", value: stats.eligible, color: "text-foreground" },
                  { label: "Score ≥ 70", value: stats.above70, color: "text-emerald-600" },
                  { label: "Score ≥ 50", value: stats.above50, color: "text-amber-500" },
                  { label: "Top score", value: stats.topScore, color: scoreColor(stats.topScore) },
                  { label: "Avg score", value: stats.avgScore, color: scoreColor(stats.avgScore) },
                ].map(({ label, value, color }) => (
                  <Card key={label} className="text-center py-3 px-2">
                    <div className={`text-2xl font-black ${color}`}>{value}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
                  </Card>
                ))}
              </div>

              {/* Corpus diagnostics (live pool only) */}
              {diagnostics && (
                <Card className="p-4 border-slate-200">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    <Info className="h-3 w-3" /> Full Corpus Diagnostics
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    {[
                      { label: "Raw fetched", value: diagnostics.totalFetched },
                      { label: "Unique indexed", value: diagnostics.totalUnique },
                      { label: "Fetch errors", value: diagnostics.fetchErrors },
                      { label: "Fetch time", value: `${(diagnostics.durationMs / 1000).toFixed(1)}s` },
                    ].map(({ label, value }) => (
                      <div key={label} className="text-center bg-muted rounded p-2">
                        <div className="font-bold text-sm">{value}</div>
                        <div className="text-[10px] text-muted-foreground">{label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] font-semibold text-muted-foreground mb-1.5">Unique per source</div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(diagnostics.perSource).sort((a, b) => b[1] - a[1]).map(([src, cnt]) => (
                      <span key={src} className="text-[10px] bg-white border rounded px-2 py-0.5 font-mono">
                        {src} <strong>{cnt}</strong>
                      </span>
                    ))}
                  </div>
                </Card>
              )}

              {/* Source breakdown */}
              <Card className="p-4">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Scored results by source · {poolSize} in pool · {ranVersion.toUpperCase()} · {elapsedMs}ms
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(stats.bySrc)
                    .sort((a, b) => b[1] - a[1])
                    .map(([src, cnt]) => (
                      <span key={src} className="text-xs bg-muted border rounded px-2 py-0.5 font-mono">
                        {src} <strong>{cnt}</strong>
                      </span>
                    ))}
                </div>
              </Card>

              {/* Compare mode table */}
              {ranVersion === "v4" && compareV5Results.length > 0 && (
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <GitCompare className="h-4 w-4 text-slate-600" />
                    <span className="text-sm font-semibold">V4 vs V5 Comparison</span>
                    <span className="text-[10px] text-muted-foreground">Top 20 by V4 rank</span>
                  </div>
                  <div className="space-y-1.5">
                    {compareV4Results.slice(0, 20).map((v4r) => {
                      const v5r = compareV5Results.find((r) => r.opp.id === v4r.opp.id);
                      const delta = v5r ? v5r.score - v4r.score : null;
                      return (
                        <div key={v4r.opp.id} className="flex items-center gap-2 text-xs bg-muted/40 rounded px-3 py-2">
                          <span className="font-mono text-muted-foreground w-5 shrink-0">#{v4r.rank}</span>
                          <span className="flex-1 min-w-0 truncate font-medium">{v4r.opp.title}</span>
                          <span className={`font-mono w-8 text-right shrink-0 ${scoreColor(v4r.score)}`}>{v4r.score}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className={`font-mono w-8 text-right shrink-0 ${v5r ? scoreColor(v5r.score) : "text-muted-foreground"}`}>
                            {v5r ? v5r.score : "—"}
                          </span>
                          {delta != null && (
                            <span className={`font-mono font-bold w-10 text-right shrink-0 text-[10px] ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                              {delta > 0 ? `+${delta}` : delta}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}

              {/* Filter toggle + result count */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{displayed.length} results</span>
                  {ranOrg && <span className="text-xs text-muted-foreground">for {ranOrg.name}</span>}
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm" variant={filterMode === "all" ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => setFilterMode("all")}
                  >All</Button>
                  <Button
                    size="sm" variant={filterMode === "eligible" ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => setFilterMode("eligible")}
                  >Eligible only</Button>
                </div>
              </div>

              {/* Results list */}
              <div className="space-y-3">
                {displayed.map((r) => (
                  <ResultCard
                    key={`${r.opp.id}_${r.rank}`}
                    result={r}
                    version={ranVersion}
                    currentLabel={getLabel(r.opp.id, ranVersion)}
                    onLabel={(oppId, val) => setLabel(oppId, ranVersion, val)}
                  />
                ))}
                {displayed.length === 0 && (
                  <div className="text-center text-muted-foreground text-sm py-8">
                    No results match the current filter.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
