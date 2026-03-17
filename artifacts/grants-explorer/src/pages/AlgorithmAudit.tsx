import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  FlaskConical, Database, Building2, BarChart3, Target, AlertTriangle,
  CheckCircle2, XCircle, RefreshCw, ChevronRight, Eye, EyeOff,
  TrendingUp, TrendingDown, Minus, Info, Zap, Search, Code, Star, BookOpen,
  Download, ChevronLeft,
} from "lucide-react";

import { MOCK_ORGANIZATIONS } from "@/lib/algorithm/mockData";
import type { OrgProfile, NormalizedOpportunity } from "@/lib/algorithm/types";
import { buildScoreTrace, runVariantScoring } from "@/lib/audit/scoreTrace";
import { computeAuditMetrics } from "@/lib/audit/metrics";
import { extractKeywordAudit } from "@/lib/audit/keywords";
import { runComparison, runV1vsV2Comparison } from "@/lib/audit/comparison";
import type { V1V2CompRow } from "@/lib/audit/comparison";
import { generateRecommendations, classifyFailureCases } from "@/lib/audit/recommendations";
import { SYNONYM_GROUPS, STOPWORDS } from "@/lib/audit/keywords";
import { ALGORITHM_VARIANTS, DEFAULT_WEIGHTS } from "@/lib/audit/types";
import type {
  WeightConfig, FeedbackLabel, EvalLabel, EvalEntry, AuditFeedback, ScoreTrace,
} from "@/lib/audit/types";
import type { HybridScoreTrace } from "@/lib/v2/types";
import { runHybridSweep, computeV1SweepStats, runV3Sweep } from "@/lib/audit/sweep";
import type { SweepStats } from "@/lib/audit/sweep";
import { HYBRID_DIMENSION_MAXES } from "@/lib/v2/types";
import type { V3ScoreTrace } from "@/lib/v3/types";
import { V3_DIMENSION_MAXES } from "@/lib/v3/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

const ACTIVE_SOURCES = new Set([
  "simpler_grants", "grants_gov", "sam_gov", "sbir",
  "threesixtygiving", "california_grants", "world_bank", "ted_eu",
]);

const LS_FEEDBACK_KEY = "audit_feedback_v1";
const LS_EVAL_KEY = "audit_eval_v1";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n?: number) => n != null ? `$${n.toLocaleString()}` : "—";

function scoreColor(n: number) {
  if (n >= 70) return "text-emerald-600";
  if (n >= 50) return "text-amber-600";
  return "text-red-500";
}

function scoreBg(n: number) {
  if (n >= 70) return "bg-emerald-50 border-emerald-200";
  if (n >= 50) return "bg-amber-50 border-amber-200";
  return "bg-red-50 border-red-200";
}

function priorityColor(p: string) {
  return p === "high" ? "bg-red-100 text-red-700 border-red-200"
    : p === "medium" ? "bg-amber-100 text-amber-700 border-amber-200"
    : "bg-blue-100 text-blue-700 border-blue-200";
}

function dbRecordToOpportunity(rec: any): NormalizedOpportunity {
  let geoRaw: any[] = [];
  if (Array.isArray(rec.geography)) geoRaw = rec.geography;
  else if (typeof rec.geography === "string" && rec.geography) {
    try { geoRaw = JSON.parse(rec.geography); } catch { geoRaw = [rec.geography]; }
  }
  const geo: string[] = geoRaw.filter((g: any) => g != null).map((g: any) => String(g));
  return {
    id: rec.id,
    source: rec.source,
    source_raw: rec.source,
    title: rec.title ?? "Untitled",
    description: rec.description ?? "",
    agency: rec.agency ?? "",
    funding_type: (rec.funding_type ?? "grant") as any,
    status: (rec.status ?? "active") as any,
    open_date: rec.open_date ?? undefined,
    close_date: rec.close_date ?? undefined,
    min_award: rec.min_award ?? undefined,
    max_award: rec.max_award ?? undefined,
    eligibility: Array.isArray(rec.eligibility) ? rec.eligibility : [],
    categories: Array.isArray(rec.categories) ? rec.categories : [],
    keywords: Array.isArray(rec.keywords) ? rec.keywords : [],
    geography: geo,
    url: rec.url ?? "",
  };
}

const EMPTY_ORG: OrgProfile = {
  id: "custom",
  name: "",
  org_type: "nonprofit",
  mission: "",
  program_areas: [],
  population_served: [],
  geography: [],
  annual_budget: 0,
  years_in_operation: 0,
  has_501c3: false,
  is_small_business: false,
  keywords: [],
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function FeedbackButtons({
  oppId, feedback, onLabel,
}: { oppId: string; feedback: Record<string, AuditFeedback>; onLabel: (id: string, l: FeedbackLabel) => void }) {
  const current = feedback[oppId]?.label;
  const btn = (label: FeedbackLabel, icon: React.ReactNode, cls: string) => (
    <button
      key={label}
      onClick={() => onLabel(oppId, label)}
      className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-all ${
        current === label ? cls : "border-border text-muted-foreground hover:border-foreground"
      }`}
    >
      {icon} {label}
    </button>
  );
  return (
    <div className="flex gap-1.5 flex-wrap mt-2">
      {btn("good", <CheckCircle2 className="h-3 w-3" />, "border-emerald-400 bg-emerald-50 text-emerald-700")}
      {btn("weak", <Minus className="h-3 w-3" />, "border-amber-400 bg-amber-50 text-amber-700")}
      {btn("bad", <XCircle className="h-3 w-3" />, "border-red-400 bg-red-50 text-red-700")}
      {btn("unsure", <Info className="h-3 w-3" />, "border-blue-400 bg-blue-50 text-blue-700")}
    </div>
  );
}

function TraceCard({ trace, index, feedback, onLabel, showJson = false }: {
  trace: ScoreTrace; index: number;
  feedback: Record<string, AuditFeedback>;
  onLabel: (id: string, l: FeedbackLabel) => void;
  showJson?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const s = trace.scores;
  const fb = feedback[trace.opp.id]?.label;
  const fbColors: Record<FeedbackLabel, string> = {
    good: "border-emerald-400", weak: "border-amber-400", bad: "border-red-400", unsure: "border-blue-400",
  };
  return (
    <Card className={`border ${fb ? fbColors[fb] : scoreBg(s.total)} transition-all`}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">#{index + 1}</span>
              <Badge variant="outline" className="text-xs">{trace.opp.source_raw}</Badge>
              <Badge variant="secondary" className="text-xs capitalize">{trace.opp.funding_type.replace("_", " ")}</Badge>
              {!trace.passes_eligibility && <Badge className="text-xs bg-red-100 text-red-700 border-red-200">INELIGIBLE</Badge>}
              {fb && <Badge className={`text-xs ${fbColors[fb]} bg-transparent capitalize`}>{fb}</Badge>}
            </div>
            <div className="font-medium text-sm line-clamp-2">{trace.opp.title}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{trace.opp.agency}</div>
          </div>
          <div className="text-right shrink-0">
            <div className={`text-2xl font-bold ${scoreColor(s.total)}`}>{s.total}</div>
            <div className="text-xs text-muted-foreground">/100</div>
          </div>
        </div>

        {/* Score bars */}
        <div className="mt-2 grid grid-cols-5 gap-1.5 text-xs">
          {[
            { label: "Mission", val: s.mission_topic_fit, max: trace.weights.mission_topic_fit },
            { label: "Eligib.", val: s.eligibility_fit, max: trace.weights.eligibility_fit },
            { label: "Geo", val: s.geography_fit, max: trace.weights.geography_fit },
            { label: "Funding", val: s.funding_size_fit, max: trace.weights.funding_size_fit },
            { label: "Maturity", val: s.maturity_fit, max: trace.weights.maturity_fit },
          ].map(({ label, val, max }) => (
            <div key={label}>
              <div className="text-muted-foreground mb-0.5 text-center">{label}</div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full"
                  style={{ width: `${max > 0 ? Math.round((val / max) * 100) : 0}%` }}
                />
              </div>
              <div className="text-center font-mono mt-0.5">{val}/{max}</div>
            </div>
          ))}
        </div>

        {/* Matched tokens */}
        {trace.matched_tokens.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {trace.matched_tokens.slice(0, 8).map((t) => (
              <span key={t} className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">{t}</span>
            ))}
            {trace.matched_tokens.length > 8 && (
              <span className="text-xs text-muted-foreground">+{trace.matched_tokens.length - 8} more</span>
            )}
          </div>
        )}
        {trace.matched_tokens.length === 0 && trace.passes_eligibility && (
          <div className="mt-2 text-xs text-red-500 font-mono">⚠ No keyword overlap — possible false positive</div>
        )}

        {/* Feedback */}
        <FeedbackButtons oppId={trace.opp.id} feedback={feedback} onLabel={onLabel} />

        {/* Expandable trace */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {expanded ? "Hide" : "Show"} audit trace
        </button>
        {expanded && (
          <div className="mt-2 space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">Eligibility:</div>
            <div className={`text-xs px-2 py-1 rounded font-mono ${trace.passes_eligibility ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
              {trace.eligibility_reason}
            </div>
            <div className="text-xs font-medium text-muted-foreground mt-2">Scoring Trace:</div>
            {trace.audit_trace.map((line, i) => (
              <div key={i} className="text-xs font-mono bg-muted/50 px-2 py-1 rounded leading-relaxed">{line}</div>
            ))}
            {trace.opp.url && (
              <a href={trace.opp.url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary mt-1 hover:underline">
                View opportunity ↗
              </a>
            )}
            <button onClick={() => setRawOpen((v) => !v)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1">
              <Code className="h-3 w-3" /> {rawOpen ? "Hide" : "Show"} raw JSON
            </button>
            {rawOpen && (
              <pre className="text-xs bg-background border border-border/50 rounded p-2 overflow-auto max-h-48 leading-relaxed">
                {JSON.stringify(trace.opp, null, 2)}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AlgorithmAuditPage() {
  // ── Pool loading ──────────────────────────────────────────────────────────
  const [pool, setPool] = useState<NormalizedOpportunity[]>([]);
  const [poolLoading, setPoolLoading] = useState(true);
  const [poolStats, setPoolStats] = useState<{ total: number; active: number; bySource: Record<string, number> } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [sr, rr] = await Promise.all([
          fetch(`${API}/indexing/stats`),
          fetch(`${API}/indexing/records/for-algorithm`),
        ]);
        const stats = await sr.json();
        const data = await rr.json();
        setPoolStats(stats);
        setPool((data.records ?? []).map(dbRecordToOpportunity).filter((o: NormalizedOpportunity) => ACTIVE_SOURCES.has(o.source)));
      } catch {}
      setPoolLoading(false);
    }
    load();
  }, []);

  // ── Org selection ─────────────────────────────────────────────────────────
  const [selectedOrgId, setSelectedOrgId] = useState(MOCK_ORGANIZATIONS[0].id);
  const [customOrg, setCustomOrg] = useState<OrgProfile>(EMPTY_ORG);
  const [orgMode, setOrgMode] = useState<"sample" | "custom">("sample");

  const activeOrg: OrgProfile = orgMode === "sample"
    ? (MOCK_ORGANIZATIONS.find((o) => o.id === selectedOrgId) ?? MOCK_ORGANIZATIONS[0])
    : customOrg;

  // ── Scoring ───────────────────────────────────────────────────────────────
  const [scorerMode, setScorerMode] = useState<"v1" | "hybrid" | "v3">("v1");
  const [weights, setWeights] = useState<WeightConfig>({ ...DEFAULT_WEIGHTS });
  const [useSynonyms, setUseSynonyms] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [allTraces, setAllTraces] = useState<ScoreTrace[]>([]);
  const [rankedResults, setRankedResults] = useState<ScoreTrace[]>([]);
  const [hybridAuditResults, setHybridAuditResults] = useState<HybridScoreTrace[]>([]);
  const [v3AuditResults, setV3AuditResults] = useState<V3ScoreTrace[]>([]);
  const [sweepStats, setSweepStats] = useState<SweepStats | null>(null);

  const runAudit = useCallback(() => {
    setRunning(true);
    setTimeout(() => {
      if (scorerMode === "hybrid") {
        const { stats, topTraces } = runHybridSweep(activeOrg, pool, 50);
        setHybridAuditResults(topTraces);
        setV3AuditResults([]);
        setSweepStats(stats);
        setAllTraces([]);
        setRankedResults([]);
      } else if (scorerMode === "v3") {
        const { stats, topTraces } = runV3Sweep(activeOrg, pool, 50);
        setV3AuditResults(topTraces);
        setHybridAuditResults([]);
        setSweepStats(stats);
        setAllTraces([]);
        setRankedResults([]);
      } else {
        const all = pool.map((opp) => buildScoreTrace(activeOrg, opp, weights, useSynonyms));
        const ranked = all
          .filter((t) => t.passes_eligibility && t.scores.total > 0)
          .sort((a, b) => b.scores.total - a.scores.total);
        setAllTraces(all);
        setRankedResults(ranked);
        setHybridAuditResults([]);
        setV3AuditResults([]);
        setSweepStats(computeV1SweepStats(all, pool.length, all.length));
      }
      setHasRun(true);
      setRunning(false);
    }, 100);
  }, [pool, activeOrg, weights, useSynonyms, scorerMode]);

  // ── Feedback & Eval ───────────────────────────────────────────────────────
  const [feedback, setFeedback] = useState<Record<string, AuditFeedback>>(() => {
    try { return JSON.parse(localStorage.getItem(LS_FEEDBACK_KEY) ?? "{}"); } catch { return {}; }
  });
  const [evalSet, setEvalSet] = useState<EvalEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem(LS_EVAL_KEY) ?? "[]"); } catch { return []; }
  });

  const labelFeedback = (oppId: string, label: FeedbackLabel) => {
    const updated = {
      ...feedback,
      [oppId]: { opp_id: oppId, label, org_id: activeOrg.id, note: "" },
    };
    setFeedback(updated);
    localStorage.setItem(LS_FEEDBACK_KEY, JSON.stringify(updated));
  };

  const labelEval = (oppId: string, label: EvalLabel) => {
    const filtered = evalSet.filter((e) => !(e.opp_id === oppId && e.org_id === activeOrg.id));
    const updated = [...filtered, { opp_id: oppId, org_id: activeOrg.id, label }];
    setEvalSet(updated);
    localStorage.setItem(LS_EVAL_KEY, JSON.stringify(updated));
  };

  // ── Derived data ──────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    if (!hasRun || rankedResults.length === 0) return null;
    return computeAuditMetrics(rankedResults, allTraces, evalSet, feedback, activeOrg.id);
  }, [hasRun, rankedResults, allTraces, evalSet, feedback, activeOrg.id]);

  const failures = useMemo(() => {
    if (!hasRun) return null;
    return classifyFailureCases(allTraces, rankedResults, feedback);
  }, [hasRun, allTraces, rankedResults, feedback]);

  const recommendations = useMemo(() => {
    if (!hasRun || !metrics) return [];
    return generateRecommendations(rankedResults, allTraces, metrics, feedback);
  }, [hasRun, rankedResults, allTraces, metrics, feedback]);

  // ── Raw Results tab ───────────────────────────────────────────────────────
  const [rawSearch, setRawSearch] = useState("");
  const [rawSrcFilter, setRawSrcFilter] = useState("all");
  const [rawSortKey, setRawSortKey] = useState<"total" | "mission" | "elig" | "geo" | "funding" | "maturity">("total");
  const [rawSortDir, setRawSortDir] = useState<"desc" | "asc">("desc");
  const [rawPage, setRawPage] = useState(0);
  const RAW_PAGE_SIZE = 200;

  const rawSources = useMemo(() => {
    const srcs = new Set(allTraces.map((t) => t.opp.source));
    return Array.from(srcs).sort();
  }, [allTraces]);

  const filteredRawResults = useMemo(() => {
    let results = allTraces;
    if (rawSrcFilter !== "all") results = results.filter((t) => t.opp.source === rawSrcFilter);
    if (rawSearch.trim()) {
      const q = rawSearch.toLowerCase();
      results = results.filter((t) =>
        t.opp.title.toLowerCase().includes(q) ||
        (t.opp.agency ?? "").toLowerCase().includes(q)
      );
    }
    const key = rawSortKey;
    const dir = rawSortDir === "desc" ? -1 : 1;
    return [...results].sort((a, b) => {
      const av = key === "total" ? a.scores.total
        : key === "mission" ? a.scores.mission_topic_fit
        : key === "elig" ? a.scores.eligibility_fit
        : key === "geo" ? a.scores.geography_fit
        : key === "funding" ? a.scores.funding_size_fit
        : a.scores.maturity_fit;
      const bv = key === "total" ? b.scores.total
        : key === "mission" ? b.scores.mission_topic_fit
        : key === "elig" ? b.scores.eligibility_fit
        : key === "geo" ? b.scores.geography_fit
        : key === "funding" ? b.scores.funding_size_fit
        : b.scores.maturity_fit;
      return (bv - av) * dir;
    });
  }, [allTraces, rawSearch, rawSrcFilter, rawSortKey, rawSortDir]);

  const rawTotalPages = Math.ceil(filteredRawResults.length / RAW_PAGE_SIZE);
  const rawPageSlice = filteredRawResults.slice(rawPage * RAW_PAGE_SIZE, (rawPage + 1) * RAW_PAGE_SIZE);

  function downloadRawCsv() {
    const headers = ["Rank", "Title", "Source", "Agency", "Total", "Mission(60)", "Eligibility(20)", "Geo(10)", "Funding(5)", "Maturity(5)", "Eligible", "URL"];
    const rows = filteredRawResults.map((t, i) => [
      i + 1,
      `"${(t.opp.title ?? "").replace(/"/g, "'")}"`,
      t.opp.source,
      `"${(t.opp.agency ?? "").replace(/"/g, "'")}"`,
      t.scores.total,
      t.scores.mission_topic_fit,
      t.scores.eligibility_fit,
      t.scores.geography_fit,
      t.scores.funding_size_fit,
      t.scores.maturity_fit,
      t.passes_eligibility ? "yes" : "no",
      t.opp.url ?? "",
    ].join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `algorithm_raw_results_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Comparison ────────────────────────────────────────────────────────────
  const [compVariants, setCompVariants] = useState(["v1_current", "v1_mission_heavy", "v1_synonyms"]);
  const [compResults, setCompResults] = useState<ReturnType<typeof runComparison> | null>(null);
  const [compRunning, setCompRunning] = useState(false);

  const runCompare = () => {
    setCompRunning(true);
    setTimeout(() => {
      setCompResults(runComparison(activeOrg, pool, compVariants));
      setCompRunning(false);
    }, 200);
  };

  // ── V1 vs V2 Comparison ───────────────────────────────────────────────────
  const [v1v2CompResult, setV1v2CompResult] = useState<ReturnType<typeof runV1vsV2Comparison> | null>(null);
  const [v1v2Running, setV1v2Running] = useState(false);
  const [expandedV2Row, setExpandedV2Row] = useState<string | null>(null);

  const runV1V2Compare = () => {
    if (pool.length === 0) return;
    setV1v2Running(true);
    setTimeout(() => {
      try {
        setV1v2CompResult(runV1vsV2Comparison(activeOrg, pool, 20));
      } catch (e) {
        console.error("V1 vs V2 comparison error:", e);
      }
      setV1v2Running(false);
    }, 400);
  };

  // ── Keyword audit ─────────────────────────────────────────────────────────
  const [kwText, setKwText] = useState("");
  const kwAudit = useMemo(() => kwText.length > 3 ? extractKeywordAudit(kwText) : null, [kwText]);
  const [customSynonyms, setCustomSynonyms] = useState(
    Object.entries(SYNONYM_GROUPS).map(([k, v]) => `${k} = ${v.join(" = ")}`).join("\n")
  );

  // ─── Eligibility audit ────────────────────────────────────────────────────
  const [eligOppId, setEligOppId] = useState("");
  const eligOpp = pool.find((o) => o.id === eligOppId);
  const eligTrace = eligOpp ? buildScoreTrace(activeOrg, eligOpp, weights) : null;

  // ── Verbose Log ───────────────────────────────────────────────────────────
  const [verboseSearch, setVerboseSearch] = useState("");
  const [verboseSelectedId, setVerboseSelectedId] = useState<string | null>(null);

  const verboseList = useMemo(() => {
    const list = scorerMode === "hybrid"
      ? hybridAuditResults.map(t => ({ id: t.opp.id, title: t.opp.title, source: t.opp.source, score: t.finalScore }))
      : scorerMode === "v3"
      ? v3AuditResults.map(t => ({ id: t.opp.id, title: t.opp.title, source: t.opp.source, score: t.finalScore }))
      : allTraces.map(t => ({ id: t.opp.id, title: t.opp.title, source: t.opp.source_raw, score: t.scores.total }))
          .sort((a, b) => b.score - a.score);
    if (!verboseSearch.trim()) return list;
    const q = verboseSearch.toLowerCase();
    return list.filter(r => r.title.toLowerCase().includes(q) || r.source.toLowerCase().includes(q));
  }, [scorerMode, hybridAuditResults, v3AuditResults, allTraces, verboseSearch]);

  const verboseHybridTrace = useMemo(() =>
    verboseSelectedId ? hybridAuditResults.find(t => t.opp.id === verboseSelectedId) ?? null : null,
    [verboseSelectedId, hybridAuditResults]);

  const verboseV3Trace = useMemo(() =>
    verboseSelectedId ? v3AuditResults.find(t => t.opp.id === verboseSelectedId) ?? null : null,
    [verboseSelectedId, v3AuditResults]);

  const verboseV1Trace = useMemo(() =>
    verboseSelectedId ? allTraces.find(t => t.opp.id === verboseSelectedId) ?? null : null,
    [verboseSelectedId, allTraces]);

  // ── Org JSON quick build ──────────────────────────────────────────────────
  const [showOrgJson, setShowOrgJson] = useState(false);

  const totalWeightSum = weights.mission_topic_fit + weights.eligibility_fit +
    weights.geography_fit + weights.funding_size_fit + weights.maturity_fit;

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-xs font-medium text-muted-foreground hover:text-foreground">← Explorer</Link>
            <span className="text-border text-xs">|</span>
            <Link href="/algorithm" className="text-xs font-medium text-muted-foreground hover:text-foreground">Algorithm V2</Link>
            <span className="text-border text-xs">|</span>
            <Link href="/indexing" className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1">
              <Database className="h-3.5 w-3.5" /> Indexing
            </Link>
          </div>
          <div className="flex items-center gap-2 font-semibold text-sm">
            <BookOpen className="h-4 w-4 text-primary" />
            Algorithm Audit
            <Badge variant="secondary" className="text-xs font-mono">{scorerMode === "hybrid" ? "Hybrid V2" : scorerMode === "v3" ? "V3 RankFix" : "V1 Keyword"}</Badge>
          </div>
        </div>
      </nav>

      {/* Header */}
      <div className="border-b border-border/60 bg-muted/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold mb-1">Algorithm Audit — Internal Debug Tool</h1>
            <p className="text-sm text-muted-foreground">
              Evaluate match quality · Inspect scoring traces · Compare algorithm variants · Build gold-standard labels
            </p>
          </div>
          <div className="flex items-center gap-3">
            {poolLoading ? (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <RefreshCw className="h-3 w-3 animate-spin" /> Loading pool…
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                {pool.length.toLocaleString()} active opportunities · {MOCK_ORGANIZATIONS.length} sample orgs
              </span>
            )}
            <Button onClick={runAudit} disabled={running || poolLoading || pool.length === 0} className="gap-2">
              <Zap className={`h-4 w-4 ${running ? "animate-pulse" : ""}`} />
              {running ? "Running…" : hasRun ? "Re-run Audit" : "Run Audit"}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

        {/* Org + Settings Bar */}
        <Card className="mb-6 border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <Label className="text-xs mb-1.5 block">Organization Mode</Label>
                <div className="flex gap-2">
                  <Button size="sm" variant={orgMode === "sample" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setOrgMode("sample")}>Sample</Button>
                  <Button size="sm" variant={orgMode === "custom" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setOrgMode("custom")}>Custom</Button>
                </div>
              </div>
              {orgMode === "sample" && (
                <div className="flex-1 min-w-48 max-w-xs">
                  <Label className="text-xs mb-1.5 block">Select Organization</Label>
                  <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MOCK_ORGANIZATIONS.map((o) => (
                        <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {orgMode === "custom" && (
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { key: "name", label: "Name" },
                    { key: "mission", label: "Mission" },
                    { key: "annual_budget", label: "Budget ($)", num: true },
                    { key: "years_in_operation", label: "Years", num: true },
                  ].map(({ key, label, num }) => (
                    <div key={key}>
                      <Label className="text-xs mb-1 block">{label}</Label>
                      <Input className="h-8 text-xs" type={num ? "number" : "text"}
                        value={String((customOrg as any)[key])}
                        onChange={(e) => setCustomOrg((p) => ({ ...p, [key]: num ? Number(e.target.value) : e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              )}
              <div>
                <Label className="text-xs mb-1.5 block">Scorer</Label>
                <div className="flex gap-1">
                  <Button size="sm" variant={scorerMode === "v1" ? "default" : "outline"} className="h-8 text-xs"
                    onClick={() => setScorerMode("v1")}>V1 Keyword</Button>
                  <Button size="sm" variant={scorerMode === "hybrid" ? "default" : "outline"} className={`h-8 text-xs ${scorerMode === "hybrid" ? "" : "border-primary/40 text-primary/70"}`}
                    onClick={() => setScorerMode("hybrid")}>V2 Hybrid</Button>
                  <Button size="sm" variant={scorerMode === "v3" ? "default" : "outline"} className={`h-8 text-xs ${scorerMode === "v3" ? "bg-violet-600 text-white border-violet-600" : "border-violet-400 text-violet-600"}`}
                    onClick={() => setScorerMode("v3")}>V3 RankFix</Button>
                </div>
              </div>
              {scorerMode === "v1" && (
                <div>
                  <Label className="text-xs mb-1.5 block">Synonyms</Label>
                  <Button size="sm" variant={useSynonyms ? "default" : "outline"} className="h-8 text-xs"
                    onClick={() => setUseSynonyms((v) => !v)}>
                    {useSynonyms ? "Synonyms ON" : "Synonyms OFF"}
                  </Button>
                </div>
              )}
              <button onClick={() => setShowOrgJson((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 self-end pb-1">
                <Code className="h-3 w-3" /> {showOrgJson ? "Hide" : "Show"} org JSON
              </button>
            </div>
            {showOrgJson && (
              <pre className="mt-3 text-xs bg-background border border-border/50 p-3 rounded-lg overflow-auto max-h-40">
                {JSON.stringify(activeOrg, null, 2)}
              </pre>
            )}
            <div className="mt-2 text-xs text-muted-foreground">
              Active org: <strong>{activeOrg.name}</strong> · {activeOrg.org_type} · Budget {fmt(activeOrg.annual_budget)} · {activeOrg.years_in_operation} yrs
              {activeOrg.has_501c3 && " · 501(c)(3)"}
              {activeOrg.is_small_business && " · Small Business"}
            </div>
          </CardContent>
        </Card>

        {!hasRun && !running && (
          <div className="text-center py-16 text-muted-foreground">
            <FlaskConical className="h-16 w-16 mx-auto mb-4 opacity-20" />
            <p className="text-base mb-1">Select an organization and click <strong>Run Audit</strong> to begin.</p>
            <p className="text-sm">All {pool.length.toLocaleString()} indexed opportunities will be scored and analyzed.</p>
          </div>
        )}

        {running && (
          <div className="text-center py-16 text-muted-foreground">
            <RefreshCw className="h-10 w-10 mx-auto mb-3 animate-spin opacity-40" />
            <p className="text-sm font-medium">Scoring {pool.length.toLocaleString()} opportunities…</p>
          </div>
        )}

        {hasRun && !running && (
          <Tabs defaultValue="overview">
            <TabsList className="flex flex-wrap h-auto gap-1 mb-6">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="matches">Top Matches</TabsTrigger>
              <TabsTrigger value="failures">Failure Analysis</TabsTrigger>
              <TabsTrigger value="rules">Rules Audit</TabsTrigger>
              <TabsTrigger value="comparison">Comparison Lab</TabsTrigger>
              <TabsTrigger value="keywords">Keyword Audit</TabsTrigger>
              <TabsTrigger value="eligibility">Eligibility Audit</TabsTrigger>
              <TabsTrigger value="evaluation">Eval Set</TabsTrigger>
              <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
              <TabsTrigger value="raw_results">Raw Results</TabsTrigger>
              <TabsTrigger value="verbose" className="border border-primary/30 text-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Verbose Log</TabsTrigger>
            </TabsList>

            {/* ── 1. Overview ──────────────────────────────────────────────────── */}
            <TabsContent value="overview">
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Active Opportunities", value: pool.length.toLocaleString(), color: "text-foreground" },
                    { label: "Ranked Results", value: rankedResults.length.toLocaleString(), color: "text-primary" },
                    { label: "Ineligible Filtered", value: (allTraces.length - (metrics?.eligible_count ?? 0)).toLocaleString(), color: "text-red-500" },
                    { label: "Avg Score", value: metrics ? `${metrics.avg_score}/100` : "—", color: "text-amber-600" },
                  ].map(({ label, value, color }) => (
                    <Card key={label} className="border-border/50">
                      <CardContent className="p-4 text-center">
                        <div className={`text-2xl font-bold ${color}`}>{value}</div>
                        <div className="text-xs text-muted-foreground mt-1 leading-tight">{label}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {metrics && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Score Distribution</CardTitle></CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {metrics.score_distribution.map(({ bucket, count }) => {
                            const pct = metrics.eligible_count > 0 ? Math.round((count / metrics.eligible_count) * 100) : 0;
                            return (
                              <div key={bucket} className="flex items-center gap-2 text-xs">
                                <span className="font-mono w-16 text-right text-muted-foreground">{bucket}</span>
                                <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                                  <div className="h-full bg-primary/60 rounded" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="w-10 text-right font-mono">{count}</span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-3 text-xs text-muted-foreground">
                          Median: <strong>{metrics.median_score}</strong> · Eligibility gate removed <strong>{metrics.filtered_by_eligibility_pct}%</strong>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Matches by Source</CardTitle></CardHeader>
                      <CardContent>
                        <div className="space-y-1.5">
                          {Object.entries(metrics.by_source).sort((a, b) => b[1] - a[1]).map(([src, n]) => (
                            <div key={src} className="flex items-center justify-between text-xs">
                              <span className="font-mono text-muted-foreground">{src}</span>
                              <div className="flex items-center gap-2">
                                <div className="w-24 h-2 bg-muted rounded overflow-hidden">
                                  <div className="h-full bg-emerald-500 rounded"
                                    style={{ width: `${Math.round((n / rankedResults.length) * 100)}%` }} />
                                </div>
                                <span className="font-mono w-6 text-right">{n}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        <Separator className="my-3" />
                        <div className="space-y-1.5">
                          <div className="text-xs font-medium text-muted-foreground mb-1">By Funding Type</div>
                          {Object.entries(metrics.by_funding_type).sort((a, b) => b[1] - a[1]).map(([ft, n]) => (
                            <div key={ft} className="flex items-center justify-between text-xs">
                              <span className="capitalize text-muted-foreground">{ft.replace("_", " ")}</span>
                              <span className="font-mono">{n}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    {(metrics.precision_at_5 !== null || metrics.precision_at_10 !== null) && (
                      <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-sm">Evaluation Metrics</CardTitle></CardHeader>
                        <CardContent>
                          <div className="space-y-2 text-sm">
                            {metrics.precision_at_5 !== null && (
                              <div className="flex justify-between"><span>Precision@5</span><strong>{metrics.precision_at_5}%</strong></div>
                            )}
                            {metrics.precision_at_10 !== null && (
                              <div className="flex justify-between"><span>Precision@10</span><strong>{metrics.precision_at_10}%</strong></div>
                            )}
                            {metrics.recall_on_labeled !== null && (
                              <div className="flex justify-between"><span>Recall (labeled)</span><strong>{metrics.recall_on_labeled}%</strong></div>
                            )}
                            <div className="flex justify-between"><span>Bad matches in top 10</span>
                              <strong className={metrics.bad_in_top_10 > 0 ? "text-red-500" : "text-emerald-600"}>{metrics.bad_in_top_10}</strong>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ── 2. Top Matches ────────────────────────────────────────────────── */}
            <TabsContent value="matches">
              {scorerMode === "hybrid" ? (
                <div>
                  <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
                    <ChevronRight className="h-3 w-3" />
                    Top {hybridAuditResults.length} matches for <strong>{activeOrg.name}</strong> — Hybrid V2 (8-dimension scorer)
                  </div>
                  {hybridAuditResults.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      <XCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No eligible matches found for this organization.</p>
                    </div>
                  )}
                  <div className="space-y-3">
                    {hybridAuditResults.slice(0, 30).map((t, i) => (
                      <Card key={t.opp.id} className={`border ${t.finalScore >= 70 ? "bg-emerald-50 border-emerald-200" : t.finalScore >= 50 ? "bg-amber-50 border-amber-200" : "bg-muted/20 border-border/50"}`}>
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">#{i + 1}</span>
                                <Badge variant="outline" className="text-xs">{t.opp.source}</Badge>
                                <Badge variant="secondary" className="text-xs">{t.oppProfile.opportunityType.replace(/_/g, " ")}</Badge>
                                <Badge className="text-xs bg-primary/10 text-primary border-primary/20">{t.orgProfile.orgClass}</Badge>
                              </div>
                              <div className="font-medium text-sm line-clamp-2">{t.opp.title}</div>
                              <div className="text-xs text-muted-foreground mt-0.5">{t.opp.agency}</div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className={`text-2xl font-bold ${t.finalScore >= 70 ? "text-emerald-600" : t.finalScore >= 50 ? "text-amber-600" : "text-red-500"}`}>{t.finalScore}</div>
                              <div className="text-xs text-muted-foreground">/100</div>
                            </div>
                          </div>
                          <div className="mt-2 grid grid-cols-4 gap-1 text-xs">
                            {(Object.entries(HYBRID_DIMENSION_MAXES) as [keyof typeof HYBRID_DIMENSION_MAXES, number][]).map(([key, max]) => {
                              const val = t.dimensions[key] ?? 0;
                              const label = key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()).slice(0, 9);
                              return (
                                <div key={key}>
                                  <div className="text-muted-foreground mb-0.5 text-center text-[10px] truncate">{label}</div>
                                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                    <div className="h-full bg-primary rounded-full" style={{ width: `${max > 0 ? Math.round((val / max) * 100) : 0}%` }} />
                                  </div>
                                  <div className="text-center font-mono mt-0.5">{val}/{max}</div>
                                </div>
                              );
                            })}
                          </div>
                          <div className="mt-2 flex items-center gap-2 text-xs font-mono text-muted-foreground flex-wrap">
                            <span>Base {t.baseScore}</span>
                            {t.semanticBoost > 0 && <span className="text-emerald-600">+{t.semanticBoost}</span>}
                            {t.maturityBoost > 0 && <span className="text-blue-600">+{t.maturityBoost}</span>}
                            {t.penaltyTotal > 0 && <span className="text-red-500">−{t.penaltyTotal}</span>}
                            <span className="font-bold text-foreground">= {t.finalScore}</span>
                          </div>
                          {t.reasons.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {t.reasons.slice(0, 3).map((r, ri) => (
                                <span key={ri} className="text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-700 px-1.5 py-0.5 rounded">✓ {r}</span>
                              ))}
                            </div>
                          )}
                          {t.opp.url && (
                            <a href={t.opp.url} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary mt-2 hover:underline">
                              View opportunity ↗
                            </a>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
                    <ChevronRight className="h-3 w-3" />
                    Top {Math.min(20, rankedResults.length)} matches for <strong>{activeOrg.name}</strong> · Use feedback buttons to label each result
                  </div>
                  {rankedResults.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      <XCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No eligible matches found for this organization.</p>
                    </div>
                  )}
                  <div className="space-y-3">
                    {rankedResults.slice(0, 20).map((trace, i) => (
                      <TraceCard key={trace.opp.id} trace={trace} index={i} feedback={feedback} onLabel={labelFeedback} />
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            {/* ── 3. Failure Analysis ───────────────────────────────────────────── */}
            <TabsContent value="failures">
              {!failures ? null : (
                <div className="space-y-6">
                  {[
                    {
                      key: "false_positives", label: "False Positives", icon: <AlertTriangle className="h-4 w-4 text-red-500" />,
                      desc: "High-ranked results with zero keyword overlap or labeled 'bad' — these are likely irrelevant matches scoring high on eligibility/funding alone.",
                      items: failures.false_positives,
                    },
                    {
                      key: "false_negatives", label: "False Negatives", icon: <TrendingDown className="h-4 w-4 text-amber-500" />,
                      desc: "Opportunities labeled 'good' by you but scored below 30 or not ranked in top 20 — relevance being missed.",
                      items: failures.false_negatives,
                    },
                    {
                      key: "generic_keyword_hits", label: "Generic Keyword Inflation", icon: <Search className="h-4 w-4 text-blue-500" />,
                      desc: `Matches that only share generic terms like "community", "support", "innovation" — inflating scores without real relevance.`,
                      items: failures.generic_keyword_hits,
                    },
                    {
                      key: "geo_mismatches", label: "Geography Mismatches in Top 20", icon: <Minus className="h-4 w-4 text-muted-foreground" />,
                      desc: "High-ranked results with zero geography score — these may be geographically irrelevant.",
                      items: failures.geo_mismatches,
                    },
                    {
                      key: "eligibility_edge_cases", label: "Eligibility Edge Cases", icon: <XCircle className="h-4 w-4 text-red-400" />,
                      desc: "Opportunities that failed the eligibility gate — inspect whether the ruling was correct.",
                      items: failures.eligibility_edge_cases,
                    },
                  ].map(({ key, label, icon, desc, items }) => (
                    <Card key={key}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">{icon}{label}
                          <Badge variant="outline" className="text-xs ml-2">{items.length}</Badge>
                        </CardTitle>
                        <CardDescription className="text-xs">{desc}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        {items.length === 0 ? (
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> No cases detected
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {items.map((trace, i) => (
                              <div key={trace.opp.id} className={`text-xs p-2 rounded border ${scoreBg(trace.scores.total)}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <div>
                                    <span className="font-mono text-muted-foreground mr-2">#{i + 1}</span>
                                    <span className="font-medium">{trace.opp.title}</span>
                                    <Badge variant="outline" className="text-xs ml-2">{trace.opp.source_raw}</Badge>
                                  </div>
                                  <span className={`font-bold ${scoreColor(trace.scores.total)}`}>{trace.scores.total}</span>
                                </div>
                                <div className="mt-1 font-mono text-muted-foreground">
                                  matched: [{trace.matched_tokens.slice(0, 5).join(", ")}] ·
                                  geo: {trace.scores.geography_fit}/{trace.weights.geography_fit} ·
                                  eligib: {trace.eligibility_reason.slice(0, 60)}…
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── 4. Rules Audit (Weight Editor) ───────────────────────────────── */}
            <TabsContent value="rules">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Active Scoring Model</CardTitle>
                    <CardDescription className="text-xs">
                      Adjust weights and re-run to test different configurations. Total must sum to 100.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {(Object.keys(weights) as (keyof WeightConfig)[]).map((key) => (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-1">
                          <Label className="text-xs capitalize">{key.replace(/_/g, " ")}</Label>
                          <span className="text-xs font-mono font-bold">{weights[key]}</span>
                        </div>
                        <input
                          type="range" min={0} max={60} step={1}
                          value={weights[key]}
                          onChange={(e) => setWeights((p) => ({ ...p, [key]: Number(e.target.value) }))}
                          className="w-full"
                        />
                      </div>
                    ))}
                    <div className={`text-xs font-mono font-bold ${totalWeightSum !== 100 ? "text-red-500" : "text-emerald-600"}`}>
                      Total: {totalWeightSum}/100 {totalWeightSum !== 100 ? "⚠ must equal 100" : "✓"}
                    </div>
                    <Button onClick={runAudit} disabled={running || totalWeightSum !== 100} className="w-full gap-2" size="sm">
                      <Zap className="h-3.5 w-3.5" /> Re-run with these weights
                    </Button>
                    <Button variant="outline" size="sm" className="w-full" onClick={() => setWeights({ ...DEFAULT_WEIGHTS })}>
                      Reset to V1 Defaults
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Predefined Variants</CardTitle>
                    <CardDescription className="text-xs">Click a variant to load its weights</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {ALGORITHM_VARIANTS.map((v) => (
                        <div key={v.key} className="flex items-start justify-between gap-2 text-xs p-2 rounded border border-border/50">
                          <div>
                            <div className="font-medium">{v.label}</div>
                            <div className="text-muted-foreground mt-0.5">{v.description}</div>
                          </div>
                          <Button size="sm" variant="outline" className="h-7 text-xs shrink-0"
                            onClick={() => { setWeights({ ...v.weights }); if (v.useSynonymExpansion) setUseSynonyms(true); }}>
                            Load
                          </Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ── 5. Comparison Lab ─────────────────────────────────────────────── */}
            <TabsContent value="comparison">
              <Tabs defaultValue="v1v2">
                <TabsList className="mb-4">
                  <TabsTrigger value="v1v2">V1 vs Hybrid V2</TabsTrigger>
                  <TabsTrigger value="variants">V1 Variant Lab</TabsTrigger>
                </TabsList>

                {/* ── V1 vs Hybrid V2 ── */}
                <TabsContent value="v1v2">
                  <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">V1 (Keyword Only) vs V2 (Hybrid) Comparison</div>
                      <div className="text-xs text-muted-foreground">
                        Run both engines against the live pool and compare rank changes, score deltas, and which opportunities rose or fell.
                        V2 uses the Hybrid engine — keyword overlap + 8-dimension profile matching.
                      </div>
                    </div>
                    <Button size="sm" onClick={runV1V2Compare} disabled={v1v2Running || pool.length === 0} className="gap-1.5 shrink-0">
                      <BarChart3 className="h-3.5 w-3.5" />
                      {v1v2Running ? "Comparing…" : "Run V1 vs Hybrid V2"}
                    </Button>
                  </div>

                  {!v1v2CompResult && !v1v2Running && (
                    <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-lg">
                      <BarChart3 className="h-10 w-10 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">Click <strong>Run V1 vs Hybrid V2</strong> to compare scoring engines</p>
                      <p className="text-xs mt-1">Requires an organization selected and opportunities loaded</p>
                    </div>
                  )}

                  {v1v2Running && (
                    <div className="text-center py-12 text-muted-foreground">
                      <div className="inline-flex items-center gap-2 animate-pulse">
                        <Zap className="h-5 w-5 text-primary" />
                        <span className="text-sm font-medium">Scoring {pool.length.toLocaleString()} opportunities with V1 and Hybrid V2…</span>
                      </div>
                    </div>
                  )}

                  {v1v2CompResult && !v1v2Running && (
                    <div className="space-y-4">
                      {/* Summary stats */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: "Rose in V2", value: v1v2CompResult.table.filter(r => r.flag === "rose").length, color: "text-emerald-600" },
                          { label: "Fell in V2", value: v1v2CompResult.table.filter(r => r.flag === "fell").length, color: "text-red-500" },
                          { label: "New in V2", value: v1v2CompResult.table.filter(r => r.flag === "new").length, color: "text-blue-600" },
                          { label: "Stable", value: v1v2CompResult.table.filter(r => r.flag === "stable").length, color: "text-muted-foreground" },
                        ].map(({ label, value, color }) => (
                          <Card key={label} className="border-border/50">
                            <CardContent className="p-3 text-center">
                              <div className={`text-2xl font-bold ${color}`}>{value}</div>
                              <div className="text-xs text-muted-foreground">{label}</div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>

                      {/* Comparison table */}
                      <div className="overflow-x-auto rounded-lg border border-border/60">
                        <table className="w-full text-xs border-collapse min-w-[700px]">
                          <thead>
                            <tr className="bg-muted/60 text-left border-b border-border">
                              <th className="px-3 py-2 font-medium">Opportunity</th>
                              <th className="px-3 py-2 font-medium w-24">Source</th>
                              <th className="px-3 py-2 font-medium w-20 text-center">V1 Score</th>
                              <th className="px-3 py-2 font-medium w-20 text-center">Hybrid V2</th>
                              <th className="px-3 py-2 font-medium w-20 text-center">Score Δ</th>
                              <th className="px-3 py-2 font-medium w-20 text-center">Rank Δ</th>
                              <th className="px-3 py-2 font-medium w-20 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {v1v2CompResult.table.map((row: V1V2CompRow, i) => (
                              <React.Fragment key={row.opp_id}>
                                <tr
                                  className={`border-b border-border/40 cursor-pointer hover:bg-muted/30 ${
                                    i % 2 === 0 ? "bg-background" : "bg-muted/10"
                                  } ${
                                    row.flag === "rose" ? "border-l-2 border-l-emerald-400"
                                    : row.flag === "fell" ? "border-l-2 border-l-red-400"
                                    : row.flag === "new" ? "border-l-2 border-l-blue-400"
                                    : ""
                                  }`}
                                  onClick={() => setExpandedV2Row(expandedV2Row === row.opp_id ? null : row.opp_id)}
                                >
                                  <td className="px-3 py-2 max-w-0">
                                    <div className="truncate font-medium" title={row.title}>{row.title}</div>
                                  </td>
                                  <td className="px-3 py-2">
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 font-mono">{row.source}</Badge>
                                  </td>
                                  <td className="px-3 py-2 text-center font-mono tabular-nums">
                                    {row.v1Score != null ? <span className={scoreColor(row.v1Score)}>{row.v1Score}</span> : <span className="text-muted-foreground">—</span>}
                                  </td>
                                  <td className="px-3 py-2 text-center font-mono tabular-nums">
                                    {row.v2Score != null ? <span className={scoreColor(row.v2Score)}>{row.v2Score}</span> : <span className="text-muted-foreground">—</span>}
                                  </td>
                                  <td className="px-3 py-2 text-center font-mono tabular-nums">
                                    {row.scoreDelta == null ? "—"
                                      : row.scoreDelta > 0 ? <span className="text-emerald-600">+{row.scoreDelta}</span>
                                      : row.scoreDelta < 0 ? <span className="text-red-500">{row.scoreDelta}</span>
                                      : <span className="text-muted-foreground">0</span>}
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    {row.rankDelta == null ? <Minus className="h-3 w-3 mx-auto text-muted-foreground" />
                                      : row.rankDelta > 0 ? <span className="text-emerald-600 flex items-center justify-center gap-0.5"><TrendingUp className="h-3 w-3" />+{row.rankDelta}</span>
                                      : row.rankDelta < 0 ? <span className="text-red-500 flex items-center justify-center gap-0.5"><TrendingDown className="h-3 w-3" />{row.rankDelta}</span>
                                      : <Minus className="h-3 w-3 mx-auto text-muted-foreground" />}
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <Badge className={`text-[10px] px-1.5 py-0 ${
                                      row.flag === "rose" ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                      : row.flag === "fell" ? "bg-red-100 text-red-700 border-red-200"
                                      : row.flag === "new" ? "bg-blue-100 text-blue-700 border-blue-200"
                                      : row.flag === "dropped" ? "bg-gray-100 text-gray-600 border-gray-200"
                                      : "bg-muted text-muted-foreground"}`}>{row.flag}</Badge>
                                  </td>
                                </tr>
                                {/* Expandable V2 trace row */}
                                {expandedV2Row === row.opp_id && row.hybridTrace && (
                                  <tr className="bg-muted/30 border-b border-border/30">
                                    <td colSpan={7} className="px-4 py-3">
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                                        <div>
                                          <div className="font-semibold mb-2">Hybrid V2 Dimension Scores</div>
                                          <div className="space-y-1">
                                            {(Object.entries(HYBRID_DIMENSION_MAXES) as [keyof typeof HYBRID_DIMENSION_MAXES, number][]).map(([key, max]) => {
                                              const val = row.hybridTrace!.dimensions[key] ?? 0;
                                              const pct = Math.round((val / max) * 100);
                                              const label = key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase());
                                              return (
                                                <div key={key} className="flex items-center gap-2">
                                                  <span className="w-28 text-muted-foreground shrink-0">{label}</span>
                                                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                                    <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                                                  </div>
                                                  <span className="font-mono w-10 text-right">{val}/{max}</span>
                                                </div>
                                              );
                                            })}
                                          </div>
                                          <div className="mt-2 flex items-center gap-2 font-mono text-xs">
                                            <span className="text-muted-foreground">Base {row.hybridTrace.baseScore}</span>
                                            {row.hybridTrace.semanticBoost > 0 && <span className="text-emerald-600">+{row.hybridTrace.semanticBoost}</span>}
                                            {row.hybridTrace.maturityBoost > 0 && <span className="text-blue-600">+{row.hybridTrace.maturityBoost}</span>}
                                            {row.hybridTrace.penaltyTotal > 0 && <span className="text-red-500">−{row.hybridTrace.penaltyTotal}</span>}
                                            <span className="font-bold">= {row.hybridTrace.finalScore}</span>
                                          </div>
                                        </div>
                                        <div>
                                          <div className="font-semibold mb-2">Profile Classification</div>
                                          <div className="space-y-1 text-muted-foreground">
                                            <div><span className="font-medium text-foreground">Org class:</span> {row.hybridTrace.orgProfile.orgClass}</div>
                                            <div><span className="font-medium text-foreground">Capacity band:</span> {row.hybridTrace.orgProfile.capacityBand}</div>
                                            <div><span className="font-medium text-foreground">Opp type:</span> {row.hybridTrace.oppProfile.opportunityType.replace(/_/g, " ")}</div>
                                            <div><span className="font-medium text-foreground">Complexity:</span> {row.hybridTrace.oppProfile.complexityBand}</div>
                                            <div><span className="font-medium text-foreground">Geo scope:</span> {row.hybridTrace.oppProfile.geographyScope}</div>
                                          </div>
                                          {row.hybridTrace.penalties.length > 0 && (
                                            <div className="mt-2">
                                              <div className="font-semibold mb-1 text-red-600">Penalties</div>
                                              {row.hybridTrace.penalties.map((p, pi) => (
                                                <div key={pi} className="text-red-600 text-[11px]">−{p.value} {p.type.replace(/_/g, " ")}: {p.reason}</div>
                                              ))}
                                            </div>
                                          )}
                                          {row.hybridTrace.reasons.length > 0 && (
                                            <div className="mt-2">
                                              <div className="font-semibold mb-1 text-emerald-700">Why it ranked</div>
                                              {row.hybridTrace.reasons.map((r, ri) => (
                                                <div key={ri} className="text-emerald-700 text-[11px]">✓ {r}</div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="text-xs text-muted-foreground">Click any row to expand the V2 scoring trace</div>
                    </div>
                  )}
                </TabsContent>

                {/* ── V1 Variant Lab ── */}
                <TabsContent value="variants">
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <div className="text-sm font-medium">Select V1 variants to compare:</div>
                    {ALGORITHM_VARIANTS.filter(v => !v.isV2).map((v) => (
                      <label key={v.key} className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input type="checkbox" checked={compVariants.includes(v.key)}
                          onChange={(e) => setCompVariants((prev) =>
                            e.target.checked ? [...prev, v.key] : prev.filter((k) => k !== v.key)
                          )}
                        />
                        {v.label}
                      </label>
                    ))}
                    <Button size="sm" onClick={runCompare} disabled={compRunning || compVariants.length < 2} className="gap-1 ml-auto">
                      <BarChart3 className="h-3.5 w-3.5" /> {compRunning ? "Running…" : "Compare Variants"}
                    </Button>
                  </div>

                  {compResults && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-border bg-muted/50">
                            <th className="text-left p-2 font-medium">Opportunity</th>
                            <th className="text-left p-2 font-medium">Source</th>
                            {compResults.variantResults.map((vr) => (
                              <th key={vr.variant.key} className="text-center p-2 font-medium min-w-24">
                                {vr.variant.label}
                              </th>
                            ))}
                            <th className="text-center p-2 font-medium">Δ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {compResults.table.slice(0, 20).map((row) => (
                            <tr key={row.opp_id} className={`border-b border-border/40 ${
                              row.flag === "rises" ? "bg-emerald-50/50" :
                              row.flag === "falls" ? "bg-red-50/50" :
                              row.flag === "new" ? "bg-blue-50/50" : ""
                            }`}>
                              <td className="p-2 max-w-xs">
                                <div className="line-clamp-1 font-medium">{row.title}</div>
                              </td>
                              <td className="p-2 text-muted-foreground font-mono">{row.source}</td>
                              {compResults.variantResults.map((vr) => (
                                <td key={vr.variant.key} className="p-2 text-center">
                                  <div className={`font-bold ${scoreColor(row.scores[vr.variant.key] ?? 0)}`}>
                                    {row.scores[vr.variant.key] ?? "—"}
                                  </div>
                                  <div className="text-muted-foreground text-xs">#{row.ranks[vr.variant.key] ?? "—"}</div>
                                </td>
                              ))}
                              <td className="p-2 text-center">
                                {row.flag === "rises" && <TrendingUp className="h-3.5 w-3.5 text-emerald-600 mx-auto" />}
                                {row.flag === "falls" && <TrendingDown className="h-3.5 w-3.5 text-red-500 mx-auto" />}
                                {row.flag === "new" && <Star className="h-3.5 w-3.5 text-blue-500 mx-auto" />}
                                {row.flag === "stable" && <Minus className="h-3.5 w-3.5 text-muted-foreground mx-auto" />}
                                <div className="text-muted-foreground">{row.rank_delta_min_max > 0 ? `±${row.rank_delta_min_max}` : ""}</div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </TabsContent>

            {/* ── 6. Keyword Audit ─────────────────────────────────────────────── */}
            <TabsContent value="keywords">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Org Keyword Extraction</CardTitle></CardHeader>
                    <CardContent>
                      {(() => {
                        const orgText = [activeOrg.mission, ...activeOrg.keywords, ...activeOrg.program_areas, ...activeOrg.population_served].join(" ");
                        const a = extractKeywordAudit(orgText);
                        return (
                          <div className="space-y-3 text-xs">
                            <div>
                              <div className="font-medium mb-1 text-muted-foreground">Top Terms ({a.tokens_after_stopword_removal.length} total)</div>
                              <div className="flex flex-wrap gap-1">
                                {a.top_terms.map((t) => <span key={t} className="bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">{t}</span>)}
                              </div>
                            </div>
                            {a.synonym_groups_matched.length > 0 && (
                              <div>
                                <div className="font-medium mb-1 text-muted-foreground">Synonym Groups Matched</div>
                                {a.synonym_groups_matched.map((g) => (
                                  <div key={g} className="bg-amber-50 border border-amber-200 text-amber-800 px-2 py-1 rounded mb-1">{g}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Custom Text Analyzer</CardTitle></CardHeader>
                    <CardContent>
                      <textarea
                        className="w-full text-xs border border-border rounded p-2 h-24 resize-none font-mono"
                        placeholder="Paste any text to audit its keywords…"
                        value={kwText}
                        onChange={(e) => setKwText(e.target.value)}
                      />
                      {kwAudit && (
                        <div className="mt-3 space-y-2 text-xs">
                          <div className="flex flex-wrap gap-1">
                            {kwAudit.top_terms.map((t) => <span key={t} className="bg-muted px-1.5 py-0.5 rounded font-mono">{t}</span>)}
                          </div>
                          <div className="text-muted-foreground">
                            {kwAudit.tokens.length} raw tokens → {kwAudit.tokens_after_stopword_removal.length} after stopwords → {kwAudit.expanded_tokens.length} after synonym expansion
                          </div>
                          {kwAudit.synonym_groups_matched.length > 0 && (
                            <div className="text-amber-700 bg-amber-50 px-2 py-1 rounded">
                              Synonym groups: {kwAudit.synonym_groups_matched.join(", ")}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Synonym Dictionary</CardTitle>
                    <CardDescription className="text-xs">Each line: canonical = variant1 = variant2</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <textarea
                      className="w-full text-xs border border-border rounded p-2 h-96 resize-none font-mono"
                      value={customSynonyms}
                      onChange={(e) => setCustomSynonyms(e.target.value)}
                    />
                    <div className="text-xs text-muted-foreground mt-2">
                      {Object.keys(SYNONYM_GROUPS).length} synonym groups active
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ── 7. Eligibility Audit ──────────────────────────────────────────── */}
            <TabsContent value="eligibility">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Org Eligibility Profile</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-xs">
                      {[
                        { label: "Org Type", value: activeOrg.org_type },
                        { label: "Has 501(c)(3)", value: activeOrg.has_501c3 ? "Yes" : "No" },
                        { label: "Is Small Business", value: activeOrg.is_small_business ? "Yes" : "No" },
                        { label: "Geography", value: activeOrg.geography.join(", ") || "Not specified" },
                        { label: "Years in Operation", value: String(activeOrg.years_in_operation) },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex justify-between border-b border-border/40 pb-1">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="font-medium">{value}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4">
                      <div className="text-xs font-medium mb-2">Eligibility Outcomes Summary</div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span>Passed eligibility</span>
                          <span className="font-bold text-emerald-600">{allTraces.filter((t) => t.passes_eligibility).length}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Failed eligibility</span>
                          <span className="font-bold text-red-500">{allTraces.filter((t) => !t.passes_eligibility).length}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>No eligibility data</span>
                          <span className="font-mono">{allTraces.filter((t) => t.opp.eligibility.length === 0).length}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Inspect Specific Opportunity</CardTitle>
                    <CardDescription className="text-xs">Enter an opportunity ID to inspect its eligibility parsing</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-2 mb-4">
                      <Input className="h-8 text-xs font-mono flex-1" placeholder="opportunity id…"
                        value={eligOppId} onChange={(e) => setEligOppId(e.target.value)} />
                    </div>
                    {!eligOpp && eligOppId && <div className="text-xs text-red-500">ID not found in current pool</div>}
                    {eligTrace && (
                      <div className="space-y-3 text-xs">
                        <div className="font-medium">{eligTrace.opp.title}</div>
                        <div className={`px-3 py-2 rounded font-mono ${eligTrace.passes_eligibility ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
                          {eligTrace.eligibility_reason}
                        </div>
                        <div>
                          <div className="text-muted-foreground mb-1">Raw eligibility tags:</div>
                          <div className="flex flex-wrap gap-1">
                            {eligTrace.opp.eligibility.length === 0
                              ? <span className="text-muted-foreground italic">none</span>
                              : eligTrace.opp.eligibility.map((e) => (
                                <span key={e} className="bg-muted px-1.5 py-0.5 rounded font-mono">{e}</span>
                              ))}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground mb-1">Geography:</div>
                          <div className="flex flex-wrap gap-1">
                            {eligTrace.opp.geography.map((g) => <span key={g} className="bg-muted px-1.5 py-0.5 rounded font-mono">{g}</span>)}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground mb-1">Funding type:</div>
                          <Badge variant="secondary" className="capitalize">{eligTrace.opp.funding_type.replace("_", " ")}</Badge>
                        </div>
                        <div>
                          <div className="text-muted-foreground mb-1">Award range:</div>
                          <span>{fmt(eligTrace.opp.min_award)} – {fmt(eligTrace.opp.max_award)}</span>
                        </div>
                      </div>
                    )}

                    <Separator className="my-4" />
                    <div className="text-xs font-medium mb-2">Ineligible Opportunities Sample</div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {allTraces.filter((t) => !t.passes_eligibility).slice(0, 10).map((t) => (
                        <button key={t.opp.id} className="w-full text-left text-xs p-1.5 rounded hover:bg-muted/50"
                          onClick={() => setEligOppId(t.opp.id)}>
                          <div className="font-medium line-clamp-1">{t.opp.title}</div>
                          <div className="text-muted-foreground font-mono">{t.eligibility_reason.slice(0, 60)}</div>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ── 8. Evaluation Set Builder ─────────────────────────────────────── */}
            <TabsContent value="evaluation">
              <div className="mb-4 flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-sm">Gold-Standard Evaluation Set</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Label opportunities to build a benchmark. Stored in browser. {evalSet.filter((e) => e.org_id === activeOrg.id).length} labeled for this org.
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => {
                  const blob = new Blob([JSON.stringify(evalSet, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = "eval_set.json"; a.click();
                }}>Export JSON</Button>
              </div>
              <div className="space-y-2">
                {rankedResults.slice(0, 20).map((trace, i) => {
                  const entry = evalSet.find((e) => e.opp_id === trace.opp.id && e.org_id === activeOrg.id);
                  const labelColors: Record<EvalLabel, string> = {
                    strong_fit: "border-emerald-400 bg-emerald-50 text-emerald-700",
                    possible_fit: "border-blue-400 bg-blue-50 text-blue-700",
                    weak_fit: "border-amber-400 bg-amber-50 text-amber-700",
                    not_a_fit: "border-red-400 bg-red-50 text-red-700",
                  };
                  return (
                    <Card key={trace.opp.id} className={`border ${entry ? labelColors[entry.label].split(" ")[0] : "border-border/50"}`}>
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-xs font-mono">#{i + 1}</span>
                              <Badge variant="outline" className="text-xs">{trace.opp.source_raw}</Badge>
                              <span className={`font-bold text-sm ${scoreColor(trace.scores.total)}`}>{trace.scores.total}</span>
                            </div>
                            <div className="font-medium text-sm line-clamp-1">{trace.opp.title}</div>
                            <div className="text-xs text-muted-foreground">{trace.opp.agency}</div>
                          </div>
                          <div className="flex flex-wrap gap-1 shrink-0">
                            {(["strong_fit", "possible_fit", "weak_fit", "not_a_fit"] as EvalLabel[]).map((lbl) => (
                              <button key={lbl}
                                onClick={() => labelEval(trace.opp.id, lbl)}
                                className={`text-xs px-2 py-1 rounded border transition-all ${entry?.label === lbl ? labelColors[lbl] : "border-border text-muted-foreground hover:border-foreground"}`}>
                                {lbl.replace("_", " ")}
                              </button>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>

            {/* ── 9. Recommendations ────────────────────────────────────────────── */}
            <TabsContent value="recommendations">
              {recommendations.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-30 text-emerald-500" />
                  <p className="text-sm">No major issues detected — add feedback labels to generate more specific recommendations.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recommendations.map((rec, i) => (
                    <Card key={i} className={`border ${priorityColor(rec.priority).split(" ")[0]}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <Badge className={`text-xs shrink-0 ${priorityColor(rec.priority)}`}>{rec.priority}</Badge>
                          <div className="flex-1">
                            <div className="text-xs text-muted-foreground font-mono mb-0.5">{rec.category}</div>
                            <div className="font-semibold text-sm">{rec.title}</div>
                            <div className="text-xs text-muted-foreground mt-1">{rec.detail}</div>
                            <div className="mt-2 text-xs bg-muted/50 border border-border/50 px-2 py-1.5 rounded">
                              <span className="font-medium">Action: </span>{rec.action}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── 10. Raw Results ───────────────────────────────────────────────── */}
            <TabsContent value="raw_results">
              <div className="space-y-4">
                {/* Controls */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative flex-1 min-w-48">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      className="h-8 text-xs pl-8"
                      placeholder="Filter by title or agency…"
                      value={rawSearch}
                      onChange={(e) => { setRawSearch(e.target.value); setRawPage(0); }}
                    />
                  </div>
                  <Select value={rawSrcFilter} onValueChange={(v) => { setRawSrcFilter(v); setRawPage(0); }}>
                    <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder="All sources" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sources</SelectItem>
                      {rawSources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={rawSortKey} onValueChange={(v) => setRawSortKey(v as typeof rawSortKey)}>
                    <SelectTrigger className="h-8 text-xs w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="total">Sort: Total</SelectItem>
                      <SelectItem value="mission">Sort: Mission</SelectItem>
                      <SelectItem value="elig">Sort: Eligibility</SelectItem>
                      <SelectItem value="geo">Sort: Geo</SelectItem>
                      <SelectItem value="funding">Sort: Funding</SelectItem>
                      <SelectItem value="maturity">Sort: Maturity</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1"
                    onClick={() => setRawSortDir((d) => d === "desc" ? "asc" : "desc")}>
                    {rawSortDir === "desc" ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                    {rawSortDir === "desc" ? "Desc" : "Asc"}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={downloadRawCsv}>
                    <Download className="h-3 w-3" /> CSV
                  </Button>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {filteredRawResults.length.toLocaleString()} results · page {rawPage + 1}/{Math.max(1, rawTotalPages)}
                  </span>
                </div>

                {/* Stats row */}
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span className="text-emerald-600 font-medium">{filteredRawResults.filter(t => t.passes_eligibility && t.scores.total > 0).length.toLocaleString()} scored</span>
                  <span className="text-red-500 font-medium">{filteredRawResults.filter(t => !t.passes_eligibility).length.toLocaleString()} ineligible</span>
                  <span>{filteredRawResults.filter(t => t.passes_eligibility && t.scores.total === 0).length.toLocaleString()} zero-score</span>
                </div>

                {/* Table */}
                <div className="overflow-auto rounded-lg border border-border/60">
                  <table className="w-full text-xs border-collapse min-w-[900px]">
                    <thead>
                      <tr className="bg-muted/60 text-left">
                        <th className="px-3 py-2 font-medium text-muted-foreground w-10">#</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground">Title</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground w-28">Source</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground w-16 text-center">Total</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground w-16 text-center">Miss</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground w-14 text-center">Elig</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground w-12 text-center">Geo</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground w-12 text-center">Fund</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground w-12 text-center">Mat</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground w-16 text-center">OK?</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rawPageSlice.map((t, i) => {
                        const globalRank = rawPage * RAW_PAGE_SIZE + i + 1;
                        const rowClass = i % 2 === 0 ? "bg-background" : "bg-muted/20";
                        return (
                          <tr key={t.opp.id} className={`${rowClass} hover:bg-primary/5`}>
                            <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{globalRank}</td>
                            <td className="px-3 py-1.5 max-w-0">
                              <div className="truncate font-medium" title={t.opp.title}>{t.opp.title}</div>
                              {t.opp.agency && <div className="truncate text-muted-foreground text-[10px]">{t.opp.agency}</div>}
                            </td>
                            <td className="px-3 py-1.5">
                              <Badge variant="outline" className="text-[10px] font-mono px-1 py-0">{t.opp.source}</Badge>
                            </td>
                            <td className={`px-3 py-1.5 text-center font-bold tabular-nums ${scoreColor(t.scores.total)}`}>{t.scores.total}</td>
                            <td className="px-3 py-1.5 text-center tabular-nums text-muted-foreground">{t.scores.mission_topic_fit}</td>
                            <td className="px-3 py-1.5 text-center tabular-nums text-muted-foreground">{t.scores.eligibility_fit}</td>
                            <td className="px-3 py-1.5 text-center tabular-nums text-muted-foreground">{t.scores.geography_fit}</td>
                            <td className="px-3 py-1.5 text-center tabular-nums text-muted-foreground">{t.scores.funding_size_fit}</td>
                            <td className="px-3 py-1.5 text-center tabular-nums text-muted-foreground">{t.scores.maturity_fit}</td>
                            <td className="px-3 py-1.5 text-center">
                              {t.passes_eligibility
                                ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mx-auto" />
                                : <XCircle className="h-3.5 w-3.5 text-red-400 mx-auto" />}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {rawTotalPages > 1 && (
                  <div className="flex items-center justify-center gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                      disabled={rawPage === 0} onClick={() => setRawPage((p) => p - 1)}>
                      <ChevronLeft className="h-3 w-3" /> Prev
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Page {rawPage + 1} of {rawTotalPages}
                    </span>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                      disabled={rawPage >= rawTotalPages - 1} onClick={() => setRawPage((p) => p + 1)}>
                      Next <ChevronRight className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ── Verbose Log ──────────────────────────────────────────────────── */}
            <TabsContent value="verbose">

              {/* ── Sweep Analytics (full-database sweep) ── */}
              {sweepStats && (() => {
                const s = sweepStats;
                const histMax = Math.max(...s.histogram, 1);
                const BUCKET_LABELS = ["1–10","11–20","21–30","31–40","41–50","51–60","61–70","71–80","81–90","91–100"];
                const topRisks = Object.entries(s.riskCounts).sort((a,b)=>b[1]-a[1]).slice(0,8);
                const topOppTypes = Object.entries(s.oppTypeCounts).sort((a,b)=>b[1]-a[1]).slice(0,8);
                const dimMaxes: Record<string,number> = { missionDomain:25,eligibility:20,orgTypeFit:12,activityFit:10,geographyFit:10,capacityFit:10,fundingFit:8,populationFit:5 };
                const dimLabels: Record<string,string> = { missionDomain:"Mission/Domain",eligibility:"Eligibility",orgTypeFit:"Org Type Fit",activityFit:"Activity Fit",geographyFit:"Geography Fit",capacityFit:"Capacity Fit",fundingFit:"Funding Fit",populationFit:"Population Fit" };
                return (
                  <div className="mb-6 space-y-4 border border-border/60 rounded-xl p-4 bg-muted/20">
                    <div className="flex items-center gap-2 mb-1">
                      <Database className="h-4 w-4 text-primary" />
                      <span className="font-semibold text-sm">Database Sweep — {scorerMode === "hybrid" ? "Hybrid V2" : scorerMode === "v3" ? "V3 RankFix" : "V1 Keyword"} · {s.activeOpps.toLocaleString()} active opportunities scored</span>
                    </div>

                    {/* Elimination Funnel */}
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Elimination Funnel</div>
                      <div className="flex flex-col gap-1">
                        {[
                          { label: "Total pool", count: s.totalPool, color: "bg-gray-400", pct: 100 },
                          { label: "Active (status-filtered)", count: s.activeOpps, color: "bg-blue-400", pct: Math.round((s.activeOpps/s.totalPool)*100) },
                          { label: "Passed eligibility gate", count: s.activeOpps - s.ineligibleCount, color: "bg-violet-400", pct: Math.round(((s.activeOpps-s.ineligibleCount)/s.totalPool)*100) },
                          { label: "Scored > 0", count: s.scoredCount, color: "bg-amber-400", pct: Math.round((s.scoredCount/s.totalPool)*100) },
                          { label: "Score > 30", count: s.above30, color: "bg-orange-400", pct: Math.round((s.above30/s.totalPool)*100) },
                          { label: "Score > 50", count: s.above50, color: "bg-emerald-400", pct: Math.round((s.above50/s.totalPool)*100) },
                          { label: "Score > 70", count: s.above70, color: "bg-emerald-600", pct: Math.round((s.above70/s.totalPool)*100) },
                          { label: "Score > 85 (top tier)", count: s.above85, color: "bg-green-700", pct: Math.round((s.above85/s.totalPool)*100) },
                        ].map(({ label, count, color, pct }) => (
                          <div key={label} className="flex items-center gap-3 text-xs">
                            <div className="w-44 shrink-0 text-muted-foreground truncate">{label}</div>
                            <div className="flex-1 h-4 bg-muted rounded-sm overflow-hidden relative">
                              <div className={`h-full ${color} rounded-sm transition-all`} style={{ width: `${pct}%` }} />
                              <span className="absolute inset-0 flex items-center pl-1.5 text-white font-mono text-[10px] font-semibold drop-shadow">{count.toLocaleString()}</span>
                            </div>
                            <div className="w-8 text-right font-mono tabular-nums text-muted-foreground">{pct}%</div>
                          </div>
                        ))}
                        {s.ineligibleCount > 0 && (
                          <div className="text-[10px] text-muted-foreground pl-44 pl-[11.5rem] mt-0.5">
                            ⤷ {s.ineligibleCount.toLocaleString()} eliminated at eligibility gate · {s.eligibleZeroCount.toLocaleString()} eligible but zero-scored
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Score histogram + dimension averages */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Histogram */}
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Score Distribution (scored &gt; 0 only)</div>
                        <div className="flex items-end gap-1 h-24">
                          {s.histogram.map((count, i) => {
                            const h = histMax > 0 ? Math.round((count / histMax) * 96) : 0;
                            const isHigh = i >= 7;
                            const isMid  = i >= 5;
                            return (
                              <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${BUCKET_LABELS[i]}: ${count}`}>
                                <span className="text-[9px] text-muted-foreground tabular-nums">{count > 0 ? count : ""}</span>
                                <div
                                  className={`w-full rounded-t-sm ${isHigh ? "bg-emerald-500" : isMid ? "bg-amber-400" : "bg-blue-400"}`}
                                  style={{ height: `${h}px` }}
                                />
                                <span className="text-[8px] text-muted-foreground rotate-0 leading-tight text-center">{BUCKET_LABELS[i].split("–")[0]}</span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-1 text-center">Score range</div>
                      </div>

                      {/* Dimension averages (hybrid only) */}
                      {scorerMode === "hybrid" && Object.keys(s.dimensionAvgs).length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Avg Dimension Score (across {s.scoredCount.toLocaleString()} scored)</div>
                          <div className="space-y-1">
                            {Object.entries(s.dimensionAvgs).map(([dim, avg]) => {
                              const max = dimMaxes[dim] ?? 10;
                              const pct = Math.round((avg / max) * 100);
                              return (
                                <div key={dim} className="flex items-center gap-2 text-xs">
                                  <div className="w-28 shrink-0 text-muted-foreground truncate">{dimLabels[dim] ?? dim}</div>
                                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                    <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="font-mono tabular-nums w-12 text-right">{avg}/{max}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Source breakdown + opportunity type distribution */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Source table */}
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Source Breakdown</div>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border/40">
                              <th className="text-left pb-1 text-muted-foreground font-medium">Source</th>
                              <th className="text-right pb-1 text-muted-foreground font-medium w-14">Active</th>
                              <th className="text-right pb-1 text-muted-foreground font-medium w-14">Elig.</th>
                              <th className="text-right pb-1 text-muted-foreground font-medium w-14">Scored</th>
                              <th className="text-right pb-1 text-muted-foreground font-medium w-16">Avg</th>
                              <th className="text-right pb-1 text-muted-foreground font-medium w-12">Top</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(s.bySource).sort((a,b)=>b[1].scored-a[1].scored).map(([src, ss]) => (
                              <tr key={src} className="border-b border-border/20 hover:bg-muted/30">
                                <td className="py-0.5 font-mono">{src}</td>
                                <td className="py-0.5 text-right tabular-nums text-muted-foreground">{ss.total.toLocaleString()}</td>
                                <td className="py-0.5 text-right tabular-nums text-muted-foreground">{ss.eligible.toLocaleString()}</td>
                                <td className="py-0.5 text-right tabular-nums text-muted-foreground">{ss.scored.toLocaleString()}</td>
                                <td className="py-0.5 text-right tabular-nums">{ss.avgScore.toFixed(1)}</td>
                                <td className={`py-0.5 text-right tabular-nums font-bold ${ss.topScore >= 70 ? "text-emerald-600" : ss.topScore >= 50 ? "text-amber-600" : "text-muted-foreground"}`}>{ss.topScore}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Opp type + top risks */}
                      <div className="space-y-3">
                        {topOppTypes.length > 0 && (
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Opportunity Types (scored &gt; 0)</div>
                            <div className="space-y-1">
                              {topOppTypes.map(([type, count]) => {
                                const pct = Math.round((count / s.scoredCount) * 100);
                                return (
                                  <div key={type} className="flex items-center gap-2 text-xs">
                                    <div className="w-32 shrink-0 text-muted-foreground truncate capitalize">{type.replace(/_/g," ")}</div>
                                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                      <div className="h-full bg-violet-400 rounded-full" style={{ width: `${pct}%` }} />
                                    </div>
                                    <span className="font-mono tabular-nums w-8 text-right">{count}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {topRisks.length > 0 && (
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Top Risk Patterns (across scored)</div>
                            <div className="space-y-1">
                              {topRisks.map(([risk, count]) => (
                                <div key={risk} className="flex items-start justify-between gap-2 text-xs">
                                  <span className="text-amber-700 truncate flex-1">{risk}</span>
                                  <Badge variant="outline" className="text-[9px] shrink-0">{count}×</Badge>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Boost / penalty summary (hybrid only) */}
                    {scorerMode === "hybrid" && s.scoredCount > 0 && (
                      <div className="flex flex-wrap gap-4 pt-2 border-t border-border/40 text-xs">
                        <div><span className="text-muted-foreground">Total semantic boosts: </span><span className="font-mono font-semibold text-blue-600">+{s.semanticBoostTotal}</span><span className="text-muted-foreground ml-1">(avg +{(s.semanticBoostTotal/s.scoredCount).toFixed(1)} per scored opp)</span></div>
                        <div><span className="text-muted-foreground">Total maturity boosts: </span><span className="font-mono font-semibold text-blue-600">+{s.maturityBoostTotal}</span><span className="text-muted-foreground ml-1">(avg +{(s.maturityBoostTotal/s.scoredCount).toFixed(1)})</span></div>
                        <div><span className="text-muted-foreground">Total penalties applied: </span><span className="font-mono font-semibold text-red-500">−{s.penaltyTotal}</span><span className="text-muted-foreground ml-1">(avg −{(s.penaltyTotal/s.scoredCount).toFixed(1)})</span></div>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="flex gap-4 h-[calc(100vh-280px)] min-h-[600px]">

                {/* Left panel — opportunity picker */}
                <div className="w-72 shrink-0 flex flex-col border border-border/60 rounded-lg overflow-hidden">
                  <div className="p-2 border-b border-border/60 bg-muted/40">
                    <Input
                      className="h-7 text-xs"
                      placeholder="Filter opportunities…"
                      value={verboseSearch}
                      onChange={e => { setVerboseSearch(e.target.value); }}
                    />
                    <div className="text-[10px] text-muted-foreground mt-1 px-0.5">
                      {verboseList.length} opportunities · {scorerMode === "hybrid" ? "Hybrid V2" : scorerMode === "v3" ? "V3 RankFix" : "V1 Keyword"} mode
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {verboseList.length === 0 && (
                      <div className="p-4 text-xs text-muted-foreground text-center">No results to inspect</div>
                    )}
                    {verboseList.map(r => (
                      <button
                        key={r.id}
                        onClick={() => setVerboseSelectedId(r.id)}
                        className={`w-full text-left px-3 py-2 border-b border-border/30 hover:bg-muted/40 transition-colors ${verboseSelectedId === r.id ? "bg-primary/10 border-l-2 border-l-primary" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <span className={`text-xs font-bold tabular-nums ${r.score >= 70 ? "text-emerald-600" : r.score >= 50 ? "text-amber-600" : "text-red-500"}`}>{r.score}</span>
                          <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono">{r.source}</Badge>
                        </div>
                        <div className="text-xs line-clamp-2 font-medium leading-tight">{r.title}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Right panel — verbose trace */}
                <div className="flex-1 overflow-y-auto">
                  {!verboseSelectedId && (
                    <div className="h-full flex items-center justify-center text-muted-foreground">
                      <div className="text-center">
                        <Code className="h-10 w-10 mx-auto mb-3 opacity-20" />
                        <p className="text-sm">Select an opportunity from the list to inspect its full scoring trace</p>
                        <p className="text-xs mt-1 opacity-70">Every step of the {scorerMode === "hybrid" ? "Hybrid V2" : scorerMode === "v3" ? "V3 RankFix" : "V1 Keyword"} algorithm will be shown here</p>
                      </div>
                    </div>
                  )}

                  {/* ─── HYBRID V2 VERBOSE TRACE ─── */}
                  {verboseSelectedId && scorerMode === "hybrid" && verboseHybridTrace && (() => {
                    const t = verboseHybridTrace;
                    const s = t.subSignals;
                    const copyLog = () => {
                      const text = [
                        `=== HYBRID V2 VERBOSE LOG ===`,
                        `Opportunity: ${t.opp.title}`,
                        `Source: ${t.opp.source}`,
                        `Organization: ${t.org.name}`,
                        `Final Score: ${t.finalScore}/100`,
                        ``,
                        `--- RAW SUB-SIGNALS ---`,
                        `V1 Keyword:     ${s.v1KeywordScore}/60`,
                        `V1 Eligibility: ${s.v1EligibilityScore}/20`,
                        `V1 Geography:   ${s.v1GeoScore}/10`,
                        `V1 Funding:     ${s.v1FundingScore}/5`,
                        `V1 Maturity:    ${s.v1MaturityScore}/5`,
                        `V2 Domain:      ${s.v2DomainScore}/20`,
                        `V2 Eligibility: ${s.v2EligibilityScore}/20`,
                        `V2 Geography:   ${s.v2GeoScore}/10`,
                        `V2 Funding:     ${s.v2FundingScore}/5`,
                        ``,
                        `--- COMPUTATION TRACE ---`,
                        ...t.audit_trace,
                        ``,
                        `--- REASONS ---`,
                        ...t.reasons.map(r => `✓ ${r}`),
                        ``,
                        `--- RISKS ---`,
                        ...t.risks.map(r => `⚠ ${r}`),
                      ].join("\n");
                      navigator.clipboard.writeText(text);
                    };
                    return (
                      <div className="space-y-5 pr-2">
                        {/* Header */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <Badge variant="outline" className="text-xs font-mono">{t.opp.source}</Badge>
                              <Badge variant="secondary" className="text-xs">{t.oppProfile.opportunityType.replace(/_/g, " ")}</Badge>
                              <Badge className="text-xs bg-primary/10 text-primary border-primary/20">{t.orgProfile.orgClass}</Badge>
                              <Badge className={`text-xs ${t.passes_eligibility ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-red-100 text-red-700 border-red-200"}`}>
                                {t.passes_eligibility ? "ELIGIBLE" : "INELIGIBLE"}
                              </Badge>
                            </div>
                            <h2 className="font-semibold text-base leading-snug">{t.opp.title}</h2>
                            {t.opp.agency && <p className="text-xs text-muted-foreground mt-0.5">{t.opp.agency}</p>}
                          </div>
                          <div className="text-right shrink-0 flex flex-col items-end gap-2">
                            <div>
                              <div className={`text-4xl font-bold tabular-nums ${t.finalScore >= 70 ? "text-emerald-600" : t.finalScore >= 50 ? "text-amber-600" : "text-red-500"}`}>{t.finalScore}</div>
                              <div className="text-xs text-muted-foreground">/ 100</div>
                            </div>
                            <button onClick={copyLog} className="text-[10px] text-muted-foreground hover:text-foreground border border-border/50 rounded px-2 py-0.5 flex items-center gap-1">
                              <Download className="h-2.5 w-2.5" /> Copy log
                            </button>
                          </div>
                        </div>

                        {/* Section 1 — Raw Sub-Signals */}
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                            <span className="bg-muted px-2 py-0.5 rounded font-mono">STEP 1</span> Raw Input Signals (9 sub-scores)
                          </div>
                          <div className="grid grid-cols-2 gap-3 p-3 bg-muted/30 rounded-lg border border-border/40">
                            <div>
                              <div className="text-[10px] font-semibold text-blue-700 uppercase tracking-wider mb-1.5">V1 Keyword Engine</div>
                              <div className="space-y-1 font-mono text-xs">
                                {[
                                  { label: "Mission / Keyword overlap", val: s.v1KeywordScore, max: 60 },
                                  { label: "Eligibility gate",          val: s.v1EligibilityScore, max: 20 },
                                  { label: "Geography text match",      val: s.v1GeoScore, max: 10 },
                                  { label: "Funding realism",           val: s.v1FundingScore, max: 5 },
                                  { label: "Maturity (years in op.)",   val: s.v1MaturityScore, max: 5 },
                                ].map(({ label, val, max }) => (
                                  <div key={label} className="flex items-center gap-2">
                                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                      <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.round((val/max)*100)}%` }} />
                                    </div>
                                    <span className="w-10 text-right tabular-nums">{val}/{max}</span>
                                    <span className="text-muted-foreground text-[10px] w-40 truncate">{label}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] font-semibold text-violet-700 uppercase tracking-wider mb-1.5">V2 Profile Engine</div>
                              <div className="space-y-1 font-mono text-xs">
                                {[
                                  { label: "Taxonomy domain tags",  val: s.v2DomainScore, max: 20 },
                                  { label: "Eligibility (profile)", val: s.v2EligibilityScore, max: 20 },
                                  { label: "Geography scope",       val: s.v2GeoScore, max: 10 },
                                  { label: "Funding band fit",      val: s.v2FundingScore, max: 5 },
                                ].map(({ label, val, max }) => (
                                  <div key={label} className="flex items-center gap-2">
                                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                      <div className="h-full bg-violet-400 rounded-full" style={{ width: `${Math.round((val/max)*100)}%` }} />
                                    </div>
                                    <span className="w-10 text-right tabular-nums">{val}/{max}</span>
                                    <span className="text-muted-foreground text-[10px] w-40 truncate">{label}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Section 2 — Dimension Blending */}
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                            <span className="bg-muted px-2 py-0.5 rounded font-mono">STEP 2</span> Dimension Blending (8 hybrid dimensions → base score)
                          </div>
                          <div className="space-y-2">
                            {[
                              {
                                key: "missionDomain" as const, label: "Mission / Domain", max: 25,
                                formula: `60%×(V1kw ${s.v1KeywordScore}/60)×25 + 40%×(V2domain ${s.v2DomainScore}/20)×25`,
                                contrib: `= ${(0.6*(s.v1KeywordScore/60)*25).toFixed(1)} + ${(0.4*(s.v2DomainScore/20)*25).toFixed(1)}`,
                              },
                              {
                                key: "eligibility" as const, label: "Eligibility", max: 20,
                                formula: `max(V1elig ${s.v1EligibilityScore}, V2elig ${s.v2EligibilityScore})`,
                                contrib: `= ${Math.max(s.v1EligibilityScore, s.v2EligibilityScore)}`,
                              },
                              {
                                key: "orgTypeFit" as const, label: "Org Type Fit", max: 12,
                                formula: `(V2orgType/10)×12 — V2 only`,
                                contrib: `org: ${t.orgProfile.orgClass} → opp type: ${t.oppProfile.opportunityType.replace(/_/g, " ")}`,
                              },
                              {
                                key: "activityFit" as const, label: "Activity Fit", max: 10,
                                formula: `(V2activity/15)×10 — V2 only`,
                                contrib: `${t.orgProfile.activityTags.slice(0,3).join(", ") || "no activity tags"} ↔ ${t.oppProfile.activityTags.slice(0,3).join(", ") || "no activity tags"}`,
                              },
                              {
                                key: "geographyFit" as const, label: "Geography Fit", max: 10,
                                formula: `50%×V1geo ${s.v1GeoScore} + 50%×V2geo ${s.v2GeoScore}`,
                                contrib: `= ${(0.5*s.v1GeoScore + 0.5*s.v2GeoScore).toFixed(1)} → rounded ${t.dimensions.geographyFit}`,
                              },
                              {
                                key: "capacityFit" as const, label: "Capacity Fit", max: 10,
                                formula: `V2 only — org capacity vs opp complexity`,
                                contrib: `org: ${t.orgProfile.capacityBand} ↔ opp: ${t.oppProfile.complexityBand}`,
                              },
                              {
                                key: "fundingFit" as const, label: "Funding Fit", max: 8,
                                formula: `50%×(V1fund ${s.v1FundingScore}/5)×8 + 50%×(V2fund ${s.v2FundingScore}/5)×8`,
                                contrib: `= ${(0.5*(s.v1FundingScore/5)*8).toFixed(1)} + ${(0.5*(s.v2FundingScore/5)*8).toFixed(1)}`,
                              },
                              {
                                key: "populationFit" as const, label: "Population Fit", max: 5,
                                formula: `(V2population/10)×5 — V2 only`,
                                contrib: `${t.orgProfile.populationTags.slice(0,3).join(", ") || "no population tags"} ↔ ${t.oppProfile.populationTags.slice(0,3).join(", ") || "no population tags"}`,
                              },
                            ].map(({ key, label, max, formula, contrib }) => {
                              const val = t.dimensions[key];
                              const pct = Math.round((val/max)*100);
                              return (
                                <div key={key} className="p-2.5 bg-background rounded-lg border border-border/40">
                                  <div className="flex items-center gap-3 mb-1.5">
                                    <span className="text-xs font-semibold w-28 shrink-0">{label}</span>
                                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                      <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                                    </div>
                                    <span className="font-mono text-sm font-bold tabular-nums w-12 text-right">{val}/{max}</span>
                                  </div>
                                  <div className="ml-28 space-y-0.5">
                                    <div className="text-[10px] font-mono text-muted-foreground">{formula}</div>
                                    <div className="text-[10px] text-muted-foreground italic">{contrib}</div>
                                  </div>
                                </div>
                              );
                            })}
                            <div className="p-2 bg-primary/5 border border-primary/20 rounded-lg flex items-center justify-between font-mono text-sm">
                              <span className="text-muted-foreground">Base score (sum of 8 dimensions)</span>
                              <span className="font-bold text-primary">{t.baseScore}/100</span>
                            </div>
                          </div>
                        </div>

                        {/* Section 3 — Boosts & Penalties */}
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                            <span className="bg-muted px-2 py-0.5 rounded font-mono">STEP 3</span> Boosts & Penalties
                          </div>
                          <div className="space-y-1.5 p-3 bg-muted/30 rounded-lg border border-border/40 font-mono text-xs">
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Base score</span>
                              <span>{t.baseScore}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Semantic boost (V2 multi-signal alignment, max +10)</span>
                              <span className={t.semanticBoost > 0 ? "text-emerald-600" : "text-muted-foreground"}>
                                {t.semanticBoost > 0 ? `+${t.semanticBoost}` : "±0"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Maturity boost (V1 years-in-operation, max +4) — {t.orgProfile.yearsInOperation ?? "?"} yrs → {s.v1MaturityScore}/5 × 4</span>
                              <span className={t.maturityBoost > 0 ? "text-blue-600" : "text-muted-foreground"}>
                                {t.maturityBoost > 0 ? `+${t.maturityBoost}` : "±0"}
                              </span>
                            </div>
                            {t.penalties.length === 0 && (
                              <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Penalties</span>
                                <span className="text-muted-foreground">none</span>
                              </div>
                            )}
                            {t.penalties.map((p, pi) => (
                              <div key={pi} className="flex items-start justify-between gap-4">
                                <span className="text-red-600">{p.type.replace(/_/g, " ")}: {p.reason}</span>
                                <span className="text-red-600 shrink-0">−{p.value}</span>
                              </div>
                            ))}
                            <div className="border-t border-border/60 pt-1.5 flex items-center justify-between font-bold">
                              <span>{t.baseScore} base + {t.semanticBoost} + {t.maturityBoost} − {t.penaltyTotal} = capped(0–100)</span>
                              <span className={`text-base ${t.finalScore >= 70 ? "text-emerald-600" : t.finalScore >= 50 ? "text-amber-600" : "text-red-500"}`}>{t.finalScore}</span>
                            </div>
                          </div>
                        </div>

                        {/* Section 4 — Raw computation log */}
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                            <span className="bg-muted px-2 py-0.5 rounded font-mono">STEP 4</span> Raw Computation Log
                          </div>
                          <div className="bg-gray-950 rounded-lg border border-gray-800 p-3 space-y-0.5 font-mono text-xs overflow-x-auto">
                            {t.audit_trace.map((line, i) => {
                              const isSignal   = line.startsWith("[V1") || line.startsWith("[V2");
                              const isDim      = line.startsWith("[Mission") || line.startsWith("[Elig") || line.startsWith("[Org") || line.startsWith("[Activity") || line.startsWith("[Geography") || line.startsWith("[Capacity") || line.startsWith("[Funding") || line.startsWith("[Population");
                              const isBoost    = line.startsWith("[Semantic") || line.startsWith("[Maturity");
                              const isPenalty  = line.startsWith("[Penalties");
                              const isFinal    = line.startsWith("[Final") || line.startsWith("[Base");
                              const isFail     = line.includes("FAILED");
                              return (
                                <div key={i} className={`leading-relaxed whitespace-pre-wrap ${
                                  isFail    ? "text-red-400" :
                                  isFinal   ? "text-yellow-300 font-bold" :
                                  isPenalty ? "text-red-400" :
                                  isBoost   ? "text-blue-300" :
                                  isDim     ? "text-emerald-300" :
                                  isSignal  ? "text-violet-300" :
                                  "text-gray-300"}`}>
                                  <span className="text-gray-600 select-none mr-2">{String(i+1).padStart(2,"0")}</span>{line}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Section 5 — All Reasons & Risks */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                              <span className="bg-muted px-2 py-0.5 rounded font-mono">WHY</span> All Reasons ({t.reasons.length})
                            </div>
                            {t.reasons.length === 0
                              ? <div className="text-xs text-muted-foreground italic p-2">No positive signals flagged</div>
                              : <ul className="space-y-1.5">
                                  {t.reasons.map((r, i) => (
                                    <li key={i} className="flex items-start gap-2 text-xs p-2 bg-emerald-50 border border-emerald-100 rounded">
                                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                                      <span className="text-emerald-800">{r}</span>
                                    </li>
                                  ))}
                                </ul>}
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                              <span className="bg-muted px-2 py-0.5 rounded font-mono">RISK</span> All Risks ({t.risks.length})
                            </div>
                            {t.risks.length === 0
                              ? <div className="text-xs text-muted-foreground italic p-2">No caution flags raised</div>
                              : <ul className="space-y-1.5">
                                  {t.risks.map((r, i) => (
                                    <li key={i} className="flex items-start gap-2 text-xs p-2 bg-amber-50 border border-amber-100 rounded">
                                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                                      <span className="text-amber-800">{r}</span>
                                    </li>
                                  ))}
                                </ul>}
                          </div>
                        </div>

                        {/* Section 6 — Profile inference */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="p-3 bg-muted/30 rounded-lg border border-border/40 space-y-2 text-xs">
                            <div className="font-semibold mb-1 flex items-center gap-1.5">
                              <Building2 className="h-3.5 w-3.5 text-primary" /> Inferred Org Profile
                            </div>
                            {[
                              ["Org Class",      t.orgProfile.orgClass],
                              ["Capacity Band",  t.orgProfile.capacityBand],
                              ["Geo Scope",      t.orgProfile.geographyScope],
                              ["Budget",         t.orgProfile.annualBudget != null ? `$${t.orgProfile.annualBudget.toLocaleString()}` : "unknown"],
                              ["Years in Op.",   t.orgProfile.yearsInOperation != null ? `${t.orgProfile.yearsInOperation} yrs` : "unknown"],
                              ["501(c)(3)",      t.orgProfile.has501c3 ? "Yes" : "No"],
                              ["Small Biz",      t.orgProfile.isSmallBusiness ? "Yes" : "No"],
                              ["Fund Readiness", t.orgProfile.fundingReadiness],
                              ["Research Ready", t.orgProfile.researchReadiness],
                              ["Procurement",    t.orgProfile.procurementReadiness],
                            ].map(([k, v]) => (
                              <div key={k} className="flex items-center justify-between border-b border-border/30 pb-1 last:border-0 last:pb-0">
                                <span className="text-muted-foreground">{k}</span>
                                <span className="font-mono font-medium">{v}</span>
                              </div>
                            ))}
                            {t.orgProfile.sectorTags.length > 0 && (
                              <div><span className="text-muted-foreground">Sector tags: </span>
                                <span className="font-mono">{t.orgProfile.sectorTags.join(", ")}</span></div>
                            )}
                            {t.orgProfile.activityTags.length > 0 && (
                              <div><span className="text-muted-foreground">Activity tags: </span>
                                <span className="font-mono">{t.orgProfile.activityTags.join(", ")}</span></div>
                            )}
                            {t.orgProfile.populationTags.length > 0 && (
                              <div><span className="text-muted-foreground">Population tags: </span>
                                <span className="font-mono">{t.orgProfile.populationTags.join(", ")}</span></div>
                            )}
                            {t.orgProfile.geographyTags.length > 0 && (
                              <div><span className="text-muted-foreground">Geo tags: </span>
                                <span className="font-mono">{t.orgProfile.geographyTags.join(", ")}</span></div>
                            )}
                          </div>
                          <div className="p-3 bg-muted/30 rounded-lg border border-border/40 space-y-2 text-xs">
                            <div className="font-semibold mb-1 flex items-center gap-1.5">
                              <Target className="h-3.5 w-3.5 text-primary" /> Inferred Opportunity Profile
                            </div>
                            {[
                              ["Opp Type",       t.oppProfile.opportunityType.replace(/_/g, " ")],
                              ["Complexity",     t.oppProfile.complexityBand],
                              ["Funding Band",   t.oppProfile.fundingBand],
                              ["Funding Min",    t.oppProfile.fundingMin != null ? `$${t.oppProfile.fundingMin.toLocaleString()}` : "unknown"],
                              ["Funding Max",    t.oppProfile.fundingMax != null ? `$${t.oppProfile.fundingMax.toLocaleString()}` : "unknown"],
                              ["Geo Scope",      t.oppProfile.geographyScope],
                              ["Status",         t.oppProfile.status],
                              ["Close Date",     t.oppProfile.closeDate ?? "not specified"],
                            ].map(([k, v]) => (
                              <div key={k} className="flex items-center justify-between border-b border-border/30 pb-1 last:border-0 last:pb-0">
                                <span className="text-muted-foreground">{k}</span>
                                <span className="font-mono font-medium capitalize">{v}</span>
                              </div>
                            ))}
                            {t.oppProfile.domainTags.length > 0 && (
                              <div><span className="text-muted-foreground">Domain tags: </span>
                                <span className="font-mono">{t.oppProfile.domainTags.join(", ")}</span></div>
                            )}
                            {t.oppProfile.activityTags.length > 0 && (
                              <div><span className="text-muted-foreground">Activity tags: </span>
                                <span className="font-mono">{t.oppProfile.activityTags.join(", ")}</span></div>
                            )}
                            {t.oppProfile.populationTags.length > 0 && (
                              <div><span className="text-muted-foreground">Population tags: </span>
                                <span className="font-mono">{t.oppProfile.populationTags.join(", ")}</span></div>
                            )}
                            {t.oppProfile.applicantTypes.length > 0 && (
                              <div><span className="text-muted-foreground">Applicant types: </span>
                                <span className="font-mono">{t.oppProfile.applicantTypes.join(", ")}</span></div>
                            )}
                            {t.oppProfile.geographyRestrictions.length > 0 && (
                              <div><span className="text-muted-foreground">Geo restrictions: </span>
                                <span className="font-mono">{t.oppProfile.geographyRestrictions.join(", ")}</span></div>
                            )}
                            {t.oppProfile.rawEligibilityText && (
                              <div className="mt-1">
                                <div className="text-muted-foreground mb-0.5">Raw eligibility text:</div>
                                <div className="bg-background border border-border/50 rounded p-1.5 font-mono text-[10px] leading-relaxed">{t.oppProfile.rawEligibilityText}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ─── V1 VERBOSE TRACE ─── */}
                  {verboseSelectedId && scorerMode === "v1" && verboseV1Trace && (() => {
                    const t = verboseV1Trace;
                    const s = t.scores;
                    const copyLog = () => {
                      const text = [
                        `=== V1 KEYWORD VERBOSE LOG ===`,
                        `Opportunity: ${t.opp.title}`,
                        `Source: ${t.opp.source_raw}`,
                        `Organization: ${t.org.name}`,
                        `Final Score: ${s.total}/100`,
                        ``,
                        `--- SCORES ---`,
                        `Mission/Topic: ${s.mission_topic_fit}/${t.weights.mission_topic_fit}`,
                        `Eligibility:   ${s.eligibility_fit}/${t.weights.eligibility_fit}`,
                        `Geography:     ${s.geography_fit}/${t.weights.geography_fit}`,
                        `Funding:       ${s.funding_size_fit}/${t.weights.funding_size_fit}`,
                        `Maturity:      ${s.maturity_fit}/${t.weights.maturity_fit}`,
                        ``,
                        `--- MATCHED TOKENS ---`,
                        t.matched_tokens.join(", "),
                        ``,
                        `--- COMPUTATION TRACE ---`,
                        ...t.audit_trace,
                      ].join("\n");
                      navigator.clipboard.writeText(text);
                    };
                    return (
                      <div className="space-y-5 pr-2">
                        {/* Header */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <Badge variant="outline" className="text-xs font-mono">{t.opp.source_raw}</Badge>
                              <Badge variant="secondary" className="text-xs capitalize">{t.opp.funding_type.replace("_"," ")}</Badge>
                              <Badge className={`text-xs ${t.passes_eligibility ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-red-100 text-red-700 border-red-200"}`}>
                                {t.passes_eligibility ? "ELIGIBLE" : "INELIGIBLE"}
                              </Badge>
                            </div>
                            <h2 className="font-semibold text-base leading-snug">{t.opp.title}</h2>
                            {t.opp.agency && <p className="text-xs text-muted-foreground mt-0.5">{t.opp.agency}</p>}
                          </div>
                          <div className="text-right shrink-0 flex flex-col items-end gap-2">
                            <div>
                              <div className={`text-4xl font-bold tabular-nums ${s.total >= 70 ? "text-emerald-600" : s.total >= 50 ? "text-amber-600" : "text-red-500"}`}>{s.total}</div>
                              <div className="text-xs text-muted-foreground">/ 100</div>
                            </div>
                            <button onClick={copyLog} className="text-[10px] text-muted-foreground hover:text-foreground border border-border/50 rounded px-2 py-0.5 flex items-center gap-1">
                              <Download className="h-2.5 w-2.5" /> Copy log
                            </button>
                          </div>
                        </div>

                        {/* V1 Score Breakdown */}
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                            <span className="bg-muted px-2 py-0.5 rounded font-mono">SCORES</span> V1 Keyword Dimension Breakdown
                          </div>
                          <div className="space-y-2 p-3 bg-muted/30 rounded-lg border border-border/40">
                            {[
                              { label: "Mission / Topic Fit", val: s.mission_topic_fit, max: t.weights.mission_topic_fit, note: "keyword overlap between org mission/keywords and opp title/description/categories" },
                              { label: "Eligibility Fit",     val: s.eligibility_fit,   max: t.weights.eligibility_fit,   note: "org type vs opp eligibility tags" },
                              { label: "Geography Fit",       val: s.geography_fit,     max: t.weights.geography_fit,     note: "org geography vs opp geography restrictions" },
                              { label: "Funding Size Fit",    val: s.funding_size_fit,  max: t.weights.funding_size_fit,  note: "org budget vs opp award range realism" },
                              { label: "Maturity Fit",        val: s.maturity_fit,      max: t.weights.maturity_fit,      note: "org years in operation vs opp requirements" },
                            ].map(({ label, val, max, note }) => (
                              <div key={label} className="space-y-0.5">
                                <div className="flex items-center gap-3">
                                  <span className="text-xs font-medium w-36 shrink-0">{label}</span>
                                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                    <div className="h-full bg-primary rounded-full" style={{ width: `${max > 0 ? Math.round((val/max)*100) : 0}%` }} />
                                  </div>
                                  <span className="font-mono text-sm font-bold tabular-nums w-12 text-right">{val}/{max}</span>
                                </div>
                                <div className="ml-36 text-[10px] text-muted-foreground italic pl-3">{note}</div>
                              </div>
                            ))}
                            <div className="border-t border-border/60 pt-2 flex items-center justify-between font-bold text-sm">
                              <span className="text-muted-foreground font-mono">Total</span>
                              <span className={s.total >= 70 ? "text-emerald-600" : s.total >= 50 ? "text-amber-600" : "text-red-500"}>{s.total}/100</span>
                            </div>
                          </div>
                        </div>

                        {/* Matched tokens */}
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                            <span className="bg-muted px-2 py-0.5 rounded font-mono">TOKENS</span> Matched Keyword Tokens ({t.matched_tokens.length})
                          </div>
                          {t.matched_tokens.length === 0
                            ? <div className="text-xs text-red-500 bg-red-50 border border-red-100 p-2 rounded">⚠ No keyword overlap found — score driven entirely by eligibility/funding/maturity signals</div>
                            : <div className="flex flex-wrap gap-1.5">
                                {t.matched_tokens.map(tok => (
                                  <span key={tok} className="text-xs bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded font-mono">{tok}</span>
                                ))}
                              </div>}
                        </div>

                        {/* Eligibility reason */}
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                            <span className="bg-muted px-2 py-0.5 rounded font-mono">ELIGIB.</span> Eligibility Ruling
                          </div>
                          <div className={`text-xs font-mono p-3 rounded-lg border ${t.passes_eligibility ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"}`}>
                            {t.eligibility_reason}
                          </div>
                          {t.opp.eligibility.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              <span className="text-[10px] text-muted-foreground mr-1">Raw tags:</span>
                              {t.opp.eligibility.map(e => <span key={e} className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">{e}</span>)}
                            </div>
                          )}
                        </div>

                        {/* Raw computation log */}
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                            <span className="bg-muted px-2 py-0.5 rounded font-mono">LOG</span> Raw Computation Trace
                          </div>
                          <div className="bg-gray-950 rounded-lg border border-gray-800 p-3 space-y-0.5 font-mono text-xs overflow-x-auto">
                            {t.audit_trace.map((line, i) => {
                              const isElig   = line.toLowerCase().startsWith("eligib");
                              const isFail   = line.toLowerCase().includes("failed");
                              const isPass   = line.toLowerCase().includes("passed");
                              const isMission = line.toLowerCase().includes("mission") || line.toLowerCase().includes("keyword") || line.toLowerCase().includes("token");
                              return (
                                <div key={i} className={`leading-relaxed whitespace-pre-wrap ${
                                  isFail   ? "text-red-400" :
                                  isPass   ? "text-emerald-400" :
                                  isElig   ? "text-violet-300" :
                                  isMission ? "text-blue-300" :
                                  "text-gray-300"}`}>
                                  <span className="text-gray-600 select-none mr-2">{String(i+1).padStart(2,"0")}</span>{line}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Raw opp data */}
                        <div className="p-3 bg-muted/30 rounded-lg border border-border/40 text-xs space-y-2">
                          <div className="font-semibold flex items-center gap-1.5"><Target className="h-3.5 w-3.5 text-primary" /> Raw Opportunity Data</div>
                          {[
                            ["Funding Type", t.opp.funding_type.replace("_"," ")],
                            ["Status",       t.opp.status],
                            ["Open Date",    t.opp.open_date ?? "—"],
                            ["Close Date",   t.opp.close_date ?? "—"],
                            ["Min Award",    t.opp.min_award != null ? `$${t.opp.min_award.toLocaleString()}` : "—"],
                            ["Max Award",    t.opp.max_award != null ? `$${t.opp.max_award.toLocaleString()}` : "—"],
                          ].map(([k, v]) => (
                            <div key={k} className="flex justify-between border-b border-border/30 pb-1 last:border-0">
                              <span className="text-muted-foreground">{k}</span>
                              <span className="font-mono capitalize">{v}</span>
                            </div>
                          ))}
                          {t.opp.eligibility.length > 0 && (
                            <div><span className="text-muted-foreground">Eligibility: </span>
                              <span className="font-mono">{t.opp.eligibility.join(", ")}</span></div>
                          )}
                          {t.opp.categories.length > 0 && (
                            <div><span className="text-muted-foreground">Categories: </span>
                              <span className="font-mono">{t.opp.categories.join(", ")}</span></div>
                          )}
                          {t.opp.keywords.length > 0 && (
                            <div><span className="text-muted-foreground">Keywords: </span>
                              <span className="font-mono">{t.opp.keywords.join(", ")}</span></div>
                          )}
                          {t.opp.geography.length > 0 && (
                            <div><span className="text-muted-foreground">Geography: </span>
                              <span className="font-mono">{t.opp.geography.join(", ")}</span></div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {verboseSelectedId && scorerMode === "hybrid" && !verboseHybridTrace && (
                    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                      Opportunity not found in scored results
                    </div>
                  )}
                  {verboseSelectedId && scorerMode === "v1" && !verboseV1Trace && (
                    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                      Opportunity not found in scored results
                    </div>
                  )}

                  {/* ─── V3 RANKFIX VERBOSE TRACE ─── */}
                  {verboseSelectedId && scorerMode === "v3" && verboseV3Trace && (() => {
                    const t = verboseV3Trace;
                    const sub = t.subSignals;
                    const copyLog = () => {
                      navigator.clipboard.writeText(t.audit_trace.join("\n"));
                    };
                    return (
                      <div key={t.opp.id} className="h-full overflow-y-auto p-4 space-y-4">
                        {/* Header */}
                        <div className={`rounded-xl p-4 border ${scoreBg(t.finalScore)}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-semibold text-sm leading-snug">{t.opp.title}</div>
                              <div className="text-xs text-muted-foreground mt-0.5">{t.opp.agency} · {t.opp.source}</div>
                            </div>
                            <div className={`text-3xl font-black ${scoreColor(t.finalScore)}`}>{t.finalScore}</div>
                          </div>
                          <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
                            <span>base {t.baseScore}</span>
                            <span>+{t.semanticBoost} boost</span>
                            <span>−{t.penaltyTotal} penalties</span>
                          </div>
                        </div>

                        {/* Sub-signals (specificity signals) */}
                        <div className="border border-violet-200 bg-violet-50 rounded-lg p-3">
                          <div className="text-[10px] font-semibold text-violet-700 uppercase tracking-wider mb-2">V3 Specificity Signals</div>
                          <div className="grid grid-cols-2 gap-1.5 text-xs">
                            <div>
                              <span className="text-muted-foreground">Exact phrase matches: </span>
                              <span className="font-mono font-medium">{sub.exactPhraseMatches.length > 0 ? sub.exactPhraseMatches.join(", ") : "none"}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Specificity ratio: </span>
                              <span className="font-mono font-medium">{(sub.specificityRatio * 100).toFixed(0)}%</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Concept centrality: </span>
                              <span className="font-mono">title+{sub.titleMatchBonus} · repeat+{sub.repeatedConceptBonus}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Target applicant: </span>
                              <span className="font-mono font-medium">{sub.targetApplicantInferred}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Population specificity: </span>
                              <span className="font-mono">{(sub.populationSpecificity * 100).toFixed(0)}%</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Generic terms matched: </span>
                              <span className="font-mono text-amber-600">{sub.genericTermsMatched.slice(0, 5).join(", ") || "none"}</span>
                            </div>
                          </div>
                          {sub.highValueConcepts.length > 0 && (
                            <div className="mt-2 text-xs">
                              <span className="text-muted-foreground">High-value concepts: </span>
                              <span className="font-semibold text-violet-700">{sub.highValueConcepts.join(", ")}</span>
                            </div>
                          )}
                        </div>

                        {/* V3 Dimension Breakdown */}
                        <div>
                          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">V3 Dimension Scores</div>
                          <div className="space-y-1.5">
                            {(Object.entries(t.dimensions) as [string, number][]).map(([dim, score]) => {
                              const max = V3_DIMENSION_MAXES[dim as keyof typeof V3_DIMENSION_MAXES] ?? 10;
                              const pct = max > 0 ? (score / max) * 100 : 0;
                              const isNew = ["conceptFit", "conceptCentrality", "targetApplicantFit"].includes(dim);
                              return (
                                <div key={dim} className="flex items-center gap-2">
                                  <div className="w-36 text-xs text-muted-foreground flex items-center gap-1">
                                    {isNew && <span className="text-[9px] bg-violet-100 text-violet-600 rounded px-0.5 font-bold">NEW</span>}
                                    {dim.replace(/([A-Z])/g, " $1").toLowerCase().trim()}
                                  </div>
                                  <div className="flex-1 bg-muted rounded-full h-1.5">
                                    <div
                                      className={`h-1.5 rounded-full ${pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-400"}`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                  <div className="text-xs font-mono w-12 text-right text-muted-foreground">{score}/{max}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Penalties */}
                        {t.penalties.length > 0 && (
                          <div className="border border-red-200 bg-red-50 rounded-lg p-3">
                            <div className="text-[10px] font-semibold text-red-700 uppercase tracking-wider mb-2">Penalties Applied (−{t.penaltyTotal})</div>
                            <div className="space-y-1">
                              {t.penalties.map((p, i) => (
                                <div key={i} className="text-xs flex items-start gap-1.5">
                                  <span className="font-mono text-red-600 shrink-0">−{p.value}</span>
                                  <span className="text-muted-foreground">{p.reason}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Reasons */}
                        {t.reasons.length > 0 && (
                          <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-3">
                            <div className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider mb-2">Why This Matches</div>
                            <ul className="space-y-1">
                              {t.reasons.map((r, i) => <li key={i} className="text-xs flex items-start gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />{r}</li>)}
                            </ul>
                          </div>
                        )}

                        {/* Risks */}
                        {t.risks.length > 0 && (
                          <div className="border border-amber-200 bg-amber-50 rounded-lg p-3">
                            <div className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider mb-2">Risks & Concerns</div>
                            <ul className="space-y-1">
                              {t.risks.map((r, i) => <li key={i} className="text-xs flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />{r}</li>)}
                            </ul>
                          </div>
                        )}

                        {/* Audit Trace Terminal */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Audit Trace</div>
                            <Button size="sm" variant="ghost" className="h-5 px-2 text-[10px]" onClick={copyLog}>Copy</Button>
                          </div>
                          <div className="bg-zinc-900 rounded-lg p-3 font-mono text-[10px] text-green-400 space-y-0.5 max-h-48 overflow-y-auto">
                            {t.audit_trace.map((line, i) => <div key={i}>{line}</div>)}
                          </div>
                        </div>

                        {/* Eligibility */}
                        <div className="text-xs text-muted-foreground border-t pt-3">
                          <span className={t.passes_eligibility ? "text-emerald-600 font-medium" : "text-red-600 font-medium"}>
                            {t.passes_eligibility ? "✓ Eligible" : "✗ Ineligible"}
                          </span>
                          {" — "}{t.eligibility_reason}
                        </div>
                      </div>
                    );
                  })()}

                  {verboseSelectedId && scorerMode === "v3" && !verboseV3Trace && (
                    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                      Opportunity not found in scored results
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

          </Tabs>
        )}
      </div>
    </div>
  );
}
