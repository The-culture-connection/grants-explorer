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
  const [weights, setWeights] = useState<WeightConfig>({ ...DEFAULT_WEIGHTS });
  const [useSynonyms, setUseSynonyms] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [allTraces, setAllTraces] = useState<ScoreTrace[]>([]);
  const [rankedResults, setRankedResults] = useState<ScoreTrace[]>([]);

  const runAudit = useCallback(() => {
    setRunning(true);
    setTimeout(() => {
      const all = pool.map((opp) => buildScoreTrace(activeOrg, opp, weights, useSynonyms));
      const ranked = all
        .filter((t) => t.passes_eligibility && t.scores.total > 0)
        .sort((a, b) => b.scores.total - a.scores.total);
      setAllTraces(all);
      setRankedResults(ranked);
      setHasRun(true);
      setRunning(false);
    }, 100);
  }, [pool, activeOrg, weights, useSynonyms]);

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
            <Link href="/algorithm" className="text-xs font-medium text-muted-foreground hover:text-foreground">Algorithm V1</Link>
            <span className="text-border text-xs">|</span>
            <Link href="/indexing" className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1">
              <Database className="h-3.5 w-3.5" /> Indexing
            </Link>
          </div>
          <div className="flex items-center gap-2 font-semibold text-sm">
            <BookOpen className="h-4 w-4 text-primary" />
            Algorithm Audit
            <Badge variant="secondary" className="text-xs font-mono">V1 Current</Badge>
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
                <Label className="text-xs mb-1.5 block">Synonyms</Label>
                <Button size="sm" variant={useSynonyms ? "default" : "outline"} className="h-8 text-xs"
                  onClick={() => setUseSynonyms((v) => !v)}>
                  {useSynonyms ? "Synonyms ON" : "Synonyms OFF"}
                </Button>
              </div>
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
                  <TabsTrigger value="v1v2">V1 vs V2 Comparison</TabsTrigger>
                  <TabsTrigger value="variants">V1 Variant Lab</TabsTrigger>
                </TabsList>

                {/* ── V1 vs V2 ── */}
                <TabsContent value="v1v2">
                  <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">Algorithm V1 vs V2 Comparison</div>
                      <div className="text-xs text-muted-foreground">
                        Run both engines against the live pool and compare rank changes, score deltas, and which opportunities rose or fell.
                      </div>
                    </div>
                    <Button size="sm" onClick={runV1V2Compare} disabled={v1v2Running || pool.length === 0} className="gap-1.5 shrink-0">
                      <BarChart3 className="h-3.5 w-3.5" />
                      {v1v2Running ? "Comparing…" : "Run V1 vs V2"}
                    </Button>
                  </div>

                  {!v1v2CompResult && !v1v2Running && (
                    <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-lg">
                      <BarChart3 className="h-10 w-10 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">Click <strong>Run V1 vs V2</strong> to compare scoring engines</p>
                      <p className="text-xs mt-1">Requires an organization selected and opportunities loaded</p>
                    </div>
                  )}

                  {v1v2Running && (
                    <div className="text-center py-12 text-muted-foreground">
                      <div className="inline-flex items-center gap-2 animate-pulse">
                        <Zap className="h-5 w-5 text-primary" />
                        <span className="text-sm font-medium">Scoring {pool.length.toLocaleString()} opportunities with V1 and V2…</span>
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
                              <th className="px-3 py-2 font-medium w-20 text-center">V2 Score</th>
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
                                {expandedV2Row === row.opp_id && row.v2Trace && (
                                  <tr className="bg-muted/30 border-b border-border/30">
                                    <td colSpan={7} className="px-4 py-3">
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                                        <div>
                                          <div className="font-semibold mb-2">V2 Dimension Scores</div>
                                          <div className="space-y-1">
                                            {[
                                              { key: "eligibilityFit", label: "Eligibility", max: 20 },
                                              { key: "domainFit", label: "Domain", max: 20 },
                                              { key: "activityFit", label: "Activity", max: 15 },
                                              { key: "populationFit", label: "Population", max: 10 },
                                              { key: "geographyFit", label: "Geography", max: 10 },
                                              { key: "organizationTypeFit", label: "Org Type", max: 10 },
                                              { key: "capacityFit", label: "Capacity", max: 10 },
                                              { key: "fundingFit", label: "Funding", max: 5 },
                                            ].map(({ key, label, max }) => {
                                              const val = (row.v2Trace!.dimensions as any)[key] as number;
                                              const pct = Math.round((val / max) * 100);
                                              return (
                                                <div key={key} className="flex items-center gap-2">
                                                  <span className="w-24 text-muted-foreground shrink-0">{label}</span>
                                                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                                    <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                                                  </div>
                                                  <span className="font-mono w-10 text-right">{val}/{max}</span>
                                                </div>
                                              );
                                            })}
                                          </div>
                                          <div className="mt-2 flex items-center gap-2 font-mono text-xs">
                                            <span className="text-muted-foreground">Base {row.v2Trace.baseScore}</span>
                                            {row.v2Trace.semanticBoost > 0 && <span className="text-emerald-600">+{row.v2Trace.semanticBoost}</span>}
                                            {row.v2Trace.penaltyTotal > 0 && <span className="text-red-500">−{row.v2Trace.penaltyTotal}</span>}
                                            <span className="font-bold">= {row.v2Trace.finalScore}</span>
                                          </div>
                                        </div>
                                        <div>
                                          <div className="font-semibold mb-2">Profile Classification</div>
                                          <div className="space-y-1 text-muted-foreground">
                                            <div><span className="font-medium text-foreground">Org class:</span> {row.v2Trace.orgProfile.orgClass}</div>
                                            <div><span className="font-medium text-foreground">Capacity band:</span> {row.v2Trace.orgProfile.capacityBand}</div>
                                            <div><span className="font-medium text-foreground">Opp type:</span> {row.v2Trace.oppProfile.opportunityType.replace(/_/g, " ")}</div>
                                            <div><span className="font-medium text-foreground">Complexity:</span> {row.v2Trace.oppProfile.complexityBand}</div>
                                            <div><span className="font-medium text-foreground">Geo scope:</span> {row.v2Trace.oppProfile.geographyScope}</div>
                                          </div>
                                          {row.v2Trace.penalties.length > 0 && (
                                            <div className="mt-2">
                                              <div className="font-semibold mb-1 text-red-600">Penalties</div>
                                              {row.v2Trace.penalties.map((p, pi) => (
                                                <div key={pi} className="text-red-600 text-[11px]">−{p.value} {p.type.replace(/_/g, " ")}: {p.reason}</div>
                                              ))}
                                            </div>
                                          )}
                                          {row.v2Trace.reasons.length > 0 && (
                                            <div className="mt-2">
                                              <div className="font-semibold mb-1 text-emerald-700">Why it ranked</div>
                                              {row.v2Trace.reasons.map((r, ri) => (
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

          </Tabs>
        )}
      </div>
    </div>
  );
}
