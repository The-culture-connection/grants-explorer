import React, { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2, XCircle, FlaskConical, ChevronRight, Zap, Database,
  Building2, Target, Globe, DollarSign, Calendar, ExternalLink, Eye, EyeOff,
  AlertTriangle, Filter, Search, BarChart3, RefreshCw, Code,
  TrendingUp, TrendingDown, Minus, ArrowUpDown,
} from "lucide-react";

import { SOURCE_CONFIGS } from "@/lib/algorithm/sources";
import { MOCK_ORGANIZATIONS } from "@/lib/algorithm/mockData";
import { getTopMatches, scoreMatch } from "@/lib/algorithm/matcher";
import type { OrgProfile, NormalizedOpportunity, MatchResult } from "@/lib/algorithm/types";
import { getTopMatchesV2, compareV1V2 } from "@/lib/v2/matcherV2";
import type { V2ScoreTrace, V2Penalty } from "@/lib/v2/types";
import { getTopMatchesHybrid } from "@/lib/v2/matcherHybrid";
import type { HybridScoreTrace, HybridDimensions } from "@/lib/v2/types";
import { HYBRID_DIMENSION_MAXES } from "@/lib/v2/types";
import { getTopMatchesV3 } from "@/lib/v3/matcherV3";
import type { V3ScoreTrace } from "@/lib/v3/types";
import { V3_DIMENSION_MAXES } from "@/lib/v3/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n?: number | null) => n != null ? `$${n.toLocaleString()}` : "—";

const scoreColor = (n: number) => {
  if (n >= 70) return "text-emerald-600 font-bold";
  if (n >= 50) return "text-amber-600 font-bold";
  return "text-red-500 font-bold";
};

const scoreBg = (n: number) => {
  if (n >= 70) return "bg-emerald-50 border-emerald-200";
  if (n >= 50) return "bg-amber-50 border-amber-200";
  return "bg-red-50 border-red-200";
};

const EMPTY_ORG: OrgProfile = {
  id: "custom", name: "", org_type: "nonprofit", mission: "", program_areas: [],
  population_served: [], geography: [], annual_budget: 0, years_in_operation: 0,
  has_501c3: false, is_small_business: false, keywords: [],
};

function csvToArray(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

// ─── V1 ScoreBar ──────────────────────────────────────────────────────────────

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono font-semibold">{value}/{max}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── V1 Match Card ────────────────────────────────────────────────────────────

function MatchCard({ result, index }: { result: MatchResult; index: number }) {
  const [showJson, setShowJson] = useState(false);
  const { opportunity: opp, score, reasons, risks } = result;

  return (
    <Card className={`border ${scoreBg(score.total)}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-muted-foreground">#{index + 1}</span>
              <Badge variant="outline" className="text-xs">{opp.source_raw}</Badge>
              <Badge variant="secondary" className="text-xs capitalize">{opp.funding_type.replace("_", " ")}</Badge>
            </div>
            <CardTitle className="text-base leading-snug line-clamp-2">{opp.title}</CardTitle>
            <CardDescription className="mt-1 text-xs">{opp.agency}</CardDescription>
          </div>
          <div className="text-right shrink-0">
            <div className={`text-3xl ${scoreColor(score.total)}`}>{score.total}</div>
            <div className="text-xs text-muted-foreground">/ 100</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 p-3 bg-background/60 rounded-lg border border-border/40">
          <ScoreBar label="Mission / Topic Fit" value={score.mission_topic_fit} max={60} color="bg-blue-500" />
          <ScoreBar label="Eligibility Fit" value={score.eligibility_fit} max={20} color="bg-violet-500" />
          <ScoreBar label="Geography Fit" value={score.geography_fit} max={10} color="bg-emerald-500" />
          <ScoreBar label="Funding Fit" value={score.funding_size_fit} max={5} color="bg-amber-500" />
          <ScoreBar label="Maturity Fit" value={score.maturity_fit} max={5} color="bg-orange-400" />
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />{fmt(opp.min_award)} – {fmt(opp.max_award)}</span>
          {opp.close_date && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Closes {opp.close_date}</span>}
          <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{opp.geography.join(", ")}</span>
        </div>
        <Accordion type="single" collapsible>
          <AccordionItem value="explain" className="border rounded-lg px-3">
            <AccordionTrigger className="text-xs py-2 hover:no-underline font-medium">
              Scoring Explanation ({reasons.length} reasons, {risks.length} risks)
            </AccordionTrigger>
            <AccordionContent className="pb-3 space-y-3">
              {reasons.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-emerald-700 mb-1.5 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Positive Signals
                  </div>
                  <ul className="space-y-1">
                    {reasons.map((r, i) => <li key={i} className="flex items-start gap-1.5 text-xs"><span className="text-emerald-500 mt-0.5 shrink-0">✓</span>{r}</li>)}
                  </ul>
                </div>
              )}
              {risks.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-amber-700 mb-1.5 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Caution Flags
                  </div>
                  <ul className="space-y-1">
                    {risks.map((r, i) => <li key={i} className="flex items-start gap-1.5 text-xs"><span className="text-amber-500 mt-0.5 shrink-0">⚠</span>{r}</li>)}
                  </ul>
                </div>
              )}
              <div>
                <button onClick={() => setShowJson(v => !v)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <Code className="h-3 w-3" />{showJson ? "Hide" : "Show"} raw JSON
                </button>
                {showJson && (
                  <pre className="mt-2 text-xs bg-muted p-3 rounded-lg overflow-auto max-h-64 border border-border/50 leading-relaxed">
                    {JSON.stringify({ opportunity: opp, score, reasons, risks }, null, 2)}
                  </pre>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        <a href={opp.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
          <ExternalLink className="h-3 w-3" /> View Opportunity
        </a>
      </CardContent>
    </Card>
  );
}


// ─── Hybrid Match Card ────────────────────────────────────────────────────────

const HYBRID_DIM_CONFIG: Array<{
  key: keyof HybridDimensions;
  label: string;
  color: string;
  signal?: string;
}> = [
  { key: "missionDomain", label: "Mission / Domain",     color: "bg-blue-500",    signal: "60% V1 keyword + 40% V2 taxonomy" },
  { key: "eligibility",   label: "Eligibility",          color: "bg-violet-500",  signal: "max(V1 type check, V2 classifier)" },
  { key: "orgTypeFit",    label: "Org Type Fit",         color: "bg-indigo-500",  signal: "V2 org-vs-opp type matrix" },
  { key: "activityFit",   label: "Activity Model",       color: "bg-cyan-500",    signal: "V2 activity tag matching" },
  { key: "geographyFit",  label: "Geography",            color: "bg-emerald-500", signal: "50% V1 text geo + 50% V2 scope" },
  { key: "capacityFit",   label: "Capacity Fit",         color: "bg-amber-500",   signal: "V2 capacity vs complexity" },
  { key: "fundingFit",    label: "Funding Fit",          color: "bg-orange-400",  signal: "50% V1 realism + 50% V2 band" },
  { key: "populationFit", label: "Population Served",    color: "bg-pink-500",    signal: "V2 population tag matching" },
];

function HybridMatchCard({ trace, index }: { trace: HybridScoreTrace; index: number }) {
  const [showTrace, setShowTrace] = useState(false);
  const [showSubs, setShowSubs]   = useState(false);
  const [showJson, setShowJson]   = useState(false);
  const opp = trace.opp;
  const op  = trace.oppProfile;
  const org = trace.orgProfile;

  return (
    <Card className={`border ${scoreBg(trace.finalScore)}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-muted-foreground">#{index + 1}</span>
              <Badge variant="outline" className="text-xs">{opp.source}</Badge>
              <Badge variant="secondary" className="text-xs">{op.opportunityType.replace(/_/g, " ")}</Badge>
              <Badge className="text-xs bg-primary/10 text-primary border-primary/20">{org.orgClass}</Badge>
            </div>
            <CardTitle className="text-base leading-snug line-clamp-2">{opp.title}</CardTitle>
            <CardDescription className="mt-1 text-xs">{opp.agency}</CardDescription>
          </div>
          <div className="text-right shrink-0">
            <div className={`text-3xl ${scoreColor(trace.finalScore)}`}>{trace.finalScore}</div>
            <div className="text-xs text-muted-foreground">/ 100</div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 8 hybrid dimension bars */}
        <div className="space-y-2">
          {HYBRID_DIM_CONFIG.map(({ key, label, color, signal }) => {
            const val = trace.dimensions[key];
            const max = HYBRID_DIMENSION_MAXES[key];
            const pct = Math.round((val / max) * 100);
            return (
              <div key={key} className="space-y-0.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span title={signal}>{label}</span>
                  <span className="font-mono font-semibold">{val}/{max}</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Score formula */}
        <div className="flex items-center gap-2 text-xs font-mono flex-wrap bg-muted/40 rounded-lg px-3 py-2">
          <span className="text-muted-foreground">Base {trace.baseScore}</span>
          {trace.semanticBoost > 0 && <span className="text-emerald-600">+{trace.semanticBoost} semantic</span>}
          {trace.maturityBoost > 0 && <span className="text-emerald-600">+{trace.maturityBoost} maturity</span>}
          {trace.penaltyTotal > 0 && <span className="text-red-500">−{trace.penaltyTotal} penalty</span>}
          <span className="font-bold text-foreground ml-auto">= {trace.finalScore}</span>
        </div>

        {/* Penalties */}
        {trace.penalties.length > 0 && (
          <div className="space-y-1">
            {trace.penalties.map((p: V2Penalty, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-red-600 bg-red-50 border border-red-100 px-2 py-1 rounded">
                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                <span><span className="font-medium">{p.type.replace(/_/g, " ")}</span> −{p.value}: {p.reason}</span>
              </div>
            ))}
          </div>
        )}

        {/* Meta row */}
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />{fmt(opp.min_award)} – {fmt(opp.max_award)}</span>
          {opp.close_date && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Closes {opp.close_date}</span>}
          <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{op.geographyScope}</span>
          <span className="text-primary/70">complexity: {op.complexityBand}</span>
        </div>

        {/* Reasons/Risks + sub-signals accordion */}
        <Accordion type="single" collapsible>
          <AccordionItem value="explain" className="border rounded-lg px-3">
            <AccordionTrigger className="text-xs py-2 hover:no-underline font-medium">
              Analysis ({trace.reasons.length} signals · {trace.risks.length} risks)
            </AccordionTrigger>
            <AccordionContent className="pb-3 space-y-3">
              {trace.reasons.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-emerald-700 mb-1.5 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Why it ranked
                  </div>
                  <ul className="space-y-1">
                    {trace.reasons.map((r, i) => <li key={i} className="flex items-start gap-1.5 text-xs"><span className="text-emerald-500 mt-0.5 shrink-0">✓</span>{r}</li>)}
                  </ul>
                </div>
              )}
              {trace.risks.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-amber-700 mb-1.5 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Caution Flags
                  </div>
                  <ul className="space-y-1">
                    {trace.risks.map((r, i) => <li key={i} className="flex items-start gap-1.5 text-xs"><span className="text-amber-500 mt-0.5 shrink-0">⚠</span>{r}</li>)}
                  </ul>
                </div>
              )}

              {/* Profile classification */}
              <div className="bg-muted/40 rounded-lg p-2.5 space-y-1.5 border border-border/40 text-xs">
                <div className="font-medium text-muted-foreground mb-1">Profile Classification</div>
                <div className="flex flex-wrap gap-1">
                  <span className="text-muted-foreground">Org class:</span>
                  <Badge variant="outline" className="text-xs py-0 h-4">{org.orgClass}</Badge>
                  <span className="text-muted-foreground ml-2">Capacity:</span>
                  <Badge variant="outline" className="text-xs py-0 h-4">{org.capacityBand}</Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  <span className="text-muted-foreground">Opp type:</span>
                  <Badge variant="outline" className="text-xs py-0 h-4">{op.opportunityType.replace(/_/g, " ")}</Badge>
                  <span className="text-muted-foreground ml-2">Complexity:</span>
                  <Badge variant="outline" className="text-xs py-0 h-4">{op.complexityBand}</Badge>
                </div>
              </div>

              {/* Sub-signals toggle */}
              <button onClick={() => setShowSubs(v => !v)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <BarChart3 className="h-3 w-3" />{showSubs ? "Hide" : "Show"} V1 + V2 sub-signals
              </button>
              {showSubs && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono bg-muted/30 p-2.5 rounded-lg border border-border/30">
                  <span className="text-muted-foreground">V1 keyword</span><span>{trace.subSignals.v1KeywordScore}/60</span>
                  <span className="text-muted-foreground">V2 domain tags</span><span>{trace.subSignals.v2DomainScore}/20</span>
                  <span className="text-muted-foreground">V1 eligibility</span><span>{trace.subSignals.v1EligibilityScore}/20</span>
                  <span className="text-muted-foreground">V2 eligibility</span><span>{trace.subSignals.v2EligibilityScore}/20</span>
                  <span className="text-muted-foreground">V1 geo</span><span>{trace.subSignals.v1GeoScore}/10</span>
                  <span className="text-muted-foreground">V2 geo</span><span>{trace.subSignals.v2GeoScore}/10</span>
                  <span className="text-muted-foreground">V1 funding</span><span>{trace.subSignals.v1FundingScore}/5</span>
                  <span className="text-muted-foreground">V2 funding</span><span>{trace.subSignals.v2FundingScore}/5</span>
                  <span className="text-muted-foreground">V1 maturity</span><span>{trace.subSignals.v1MaturityScore}/5</span>
                </div>
              )}

              {/* Audit trace toggle */}
              <button onClick={() => setShowTrace(v => !v)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <Code className="h-3 w-3" />{showTrace ? "Hide" : "Show"} full scoring trace
              </button>
              {showTrace && (
                <div className="space-y-0.5">
                  {trace.audit_trace.map((line, i) => (
                    <div key={i} className="text-xs font-mono bg-muted/50 px-2 py-1 rounded leading-relaxed">{line}</div>
                  ))}
                </div>
              )}

              <button onClick={() => setShowJson(v => !v)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <Code className="h-3 w-3" />{showJson ? "Hide" : "Show"} raw JSON
              </button>
              {showJson && (
                <pre className="mt-1 text-xs bg-muted p-3 rounded-lg overflow-auto max-h-64 border border-border/50 leading-relaxed">
                  {JSON.stringify({ finalScore: trace.finalScore, dimensions: trace.dimensions, subSignals: trace.subSignals, baseScore: trace.baseScore, semanticBoost: trace.semanticBoost, maturityBoost: trace.maturityBoost, penalties: trace.penalties }, null, 2)}
                </pre>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <a href={opp.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
          <ExternalLink className="h-3 w-3" /> View Opportunity
        </a>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

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

export default function AlgorithmPage() {
  // ── Org state ─────────────────────────────────────────────────────────────
  const [selectedMockId, setSelectedMockId] = useState(MOCK_ORGANIZATIONS[0].id);
  const [customOrg, setCustomOrg] = useState<OrgProfile>(EMPTY_ORG);
  const [orgMode, setOrgMode] = useState<"mock" | "custom">("mock");
  const [showOrgJson, setShowOrgJson] = useState(false);

  const activeOrg = orgMode === "mock"
    ? (MOCK_ORGANIZATIONS.find(o => o.id === selectedMockId) ?? MOCK_ORGANIZATIONS[0])
    : customOrg;

  // ── Pool ──────────────────────────────────────────────────────────────────
  const [pool, setPool] = useState<NormalizedOpportunity[]>([]);
  const [poolLoading, setPoolLoading] = useState(true);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [poolStats, setPoolStats] = useState<{ total: number; active: number; historical: number; bySource: Record<string, number> } | null>(null);

  useEffect(() => {
    loadPool();
  }, []);

  async function loadPool() {
    setPoolLoading(true);
    setPoolError(null);
    try {
      const [statsRes, recordsRes] = await Promise.all([
        fetch(`${API}/indexing/stats`),
        fetch(`${API}/indexing/records/for-algorithm`),
      ]);
      setPoolStats(await statsRes.json());
      const data = await recordsRes.json();
      setPool((data.records ?? []).map(dbRecordToOpportunity));
    } catch {
      setPoolError("Failed to load opportunity pool from database.");
    }
    setPoolLoading(false);
  }

  const refreshPool = () => {
    setPool([]); setPoolStats(null);
    setV1Results(null); setHybridResults(null); setRunStats(null);
    loadPool();
  };

  // ── Pool Filters ──────────────────────────────────────────────────────────
  const [poolFilter, setPoolFilter] = useState({ source: "", keyword: "", fundingType: "" });
  const filteredPool = useMemo(() => pool.filter(opp => {
    if (poolFilter.source && opp.source !== poolFilter.source) return false;
    if (poolFilter.fundingType && opp.funding_type !== poolFilter.fundingType) return false;
    if (poolFilter.keyword) {
      const kw = poolFilter.keyword.toLowerCase();
      if (!`${opp.title} ${opp.description} ${opp.keywords.join(" ")}`.toLowerCase().includes(kw)) return false;
    }
    return true;
  }), [pool, poolFilter]);

  // ── Compare mode toggle ───────────────────────────────────────────────────
  const [compareMode, setCompareMode] = useState(false);

  // ── Scorer mode ───────────────────────────────────────────────────────────
  const [scorerMode, setScorerMode] = useState<"hybrid" | "v3">("hybrid");

  // ── Results ───────────────────────────────────────────────────────────────
  const [v1Results, setV1Results] = useState<MatchResult[] | null>(null);
  const [hybridResults, setHybridResults] = useState<HybridScoreTrace[] | null>(null);
  const [v3Results, setV3Results] = useState<V3ScoreTrace[] | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runStats, setRunStats] = useState<{ total: number; eligible: number; scored: number } | null>(null);

  const runAlgorithm = () => {
    setIsRunning(true);
    setTimeout(() => {
      if (scorerMode === "v3") {
        const v3 = getTopMatchesV3(activeOrg, pool, compareMode ? 20 : 10);
        setV3Results(v3);
        setHybridResults(null);
        setRunStats({ total: pool.length, eligible: v3.length, scored: v3.length });
        if (compareMode) {
          const hybrid = getTopMatchesHybrid(activeOrg, pool, 20);
          setHybridResults(hybrid);
        }
        setV1Results(null);
      } else {
        const hybrid = getTopMatchesHybrid(activeOrg, pool, compareMode ? 20 : 10);
        setHybridResults(hybrid);
        setV3Results(null);
        setRunStats({ total: pool.length, eligible: hybrid.length, scored: hybrid.length });
        if (compareMode) {
          const v1 = getTopMatches(activeOrg, pool, 20);
          setV1Results(v1);
        } else {
          setV1Results(null);
        }
      }
      setIsRunning(false);
    }, 800);
  };

  // ── Comparison data (V1 vs Hybrid) ────────────────────────────────────────
  const comparisonRows = useMemo(() => {
    if (!v1Results || !hybridResults || !compareMode) return [];
    // Map hybrid results to V2ScoreTrace shape for comparison (uses finalScore)
    const v1Mapped = v1Results.map(r => ({ opp: r.opportunity, score: r.score }));
    const hybridAsV2: V2ScoreTrace[] = hybridResults.map(h => ({
      org: h.org, opp: h.opp, orgProfile: h.orgProfile, oppProfile: h.oppProfile,
      passes_eligibility: h.passes_eligibility, eligibility_reason: h.eligibility_reason,
      dimensions: {
        eligibilityFit: h.dimensions.eligibility,
        domainFit: Math.round((h.dimensions.missionDomain / 25) * 20),
        activityFit: Math.round((h.dimensions.activityFit / 10) * 15),
        populationFit: Math.round((h.dimensions.populationFit / 5) * 10),
        geographyFit: h.dimensions.geographyFit,
        organizationTypeFit: Math.round((h.dimensions.orgTypeFit / 12) * 10),
        capacityFit: h.dimensions.capacityFit,
        fundingFit: Math.round((h.dimensions.fundingFit / 8) * 5),
      },
      baseScore: h.baseScore, semanticBoost: h.semanticBoost + h.maturityBoost,
      penalties: h.penalties, penaltyTotal: h.penaltyTotal,
      finalScore: h.finalScore, reasons: h.reasons, risks: h.risks, audit_trace: h.audit_trace,
    }));
    return compareV1V2(v1Mapped, hybridAsV2);
  }, [v1Results, hybridResults, compareMode]);

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-xs font-medium text-muted-foreground hover:text-foreground">← Explorer</Link>
            <span className="text-border text-xs">|</span>
            <Link href="/indexing" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
              <Database className="h-3.5 w-3.5" /> Indexing
            </Link>
            <span className="text-border text-xs">|</span>
            <Link href="/audit" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
              <BarChart3 className="h-3.5 w-3.5" /> Audit
            </Link>
          </div>
          <div className="flex items-center gap-2 font-semibold text-sm text-foreground">
            <FlaskConical className="h-4 w-4 text-primary" />
            Algorithm Testing Center
            <Badge variant="secondary" className="text-xs font-mono">V2</Badge>
          </div>
        </div>
      </nav>

      {/* Header */}
      <div className="border-b border-border/60 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <p className="text-sm text-muted-foreground">
            Hybrid V2 scoring engine · keyword overlap + profile-to-profile matching · 8 weighted dimensions · 8 active opportunity sources
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        {/* ── Pool Status Bar ───────────────────────────────────────────────── */}
        <Card className="border-border/50 bg-muted/20">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Database className="h-5 w-5 text-primary shrink-0" />
                <div>
                  <div className="font-semibold text-sm">Live Opportunity Pool</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {poolLoading ? "Loading from database…" : poolError ? poolError
                      : `${pool.length.toLocaleString()} active opportunities from ${Object.keys(poolStats?.bySource ?? {}).length} sources`}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {!poolLoading && !poolError && poolStats && (
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    {SOURCE_CONFIGS.filter(s => s.status === "active" && (poolStats.bySource[s.id] ?? 0) > 0).map(s => (
                      <span key={s.id} className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                        {s.id}: {(poolStats.bySource[s.id] ?? 0).toLocaleString()}
                      </span>
                    ))}
                  </div>
                )}
                {poolLoading && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={refreshPool} disabled={poolLoading}>
                  <RefreshCw className="h-3 w-3" /> Refresh
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Section 1: Source Status ──────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Database className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Section 1 — Source Status Panel</h2>
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs">8 active · 3 excluded</Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {SOURCE_CONFIGS.map(src => (
              <Card key={src.id} className={`border ${src.status === "active" ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/30 opacity-80"}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="font-medium text-sm leading-tight">{src.name}</div>
                    {src.status === "active" ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />}
                  </div>
                  <div className="text-xs text-muted-foreground mb-2">{src.category}</div>
                  <Badge variant="outline" className={`text-xs ${src.status === "active" ? "border-emerald-400 text-emerald-700 bg-emerald-50" : "border-red-300 text-red-600 bg-red-50"}`}>
                    {src.status === "active" ? "Active" : "Excluded"}
                  </Badge>
                  {src.exclusion_reason && <p className="text-xs text-muted-foreground mt-2 italic leading-tight">{src.exclusion_reason}</p>}
                  <div className="text-xs text-muted-foreground mt-2 font-mono">
                    {poolLoading ? "loading…" : `${(poolStats?.bySource?.[src.id] ?? 0).toLocaleString()} records`}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <Separator />

        {/* ── Section 2: Organization Tester ───────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Section 2 — Organization Profile</h2>
          </div>
          <Tabs value={orgMode} onValueChange={v => setOrgMode(v as "mock" | "custom")}>
            <TabsList className="mb-4">
              <TabsTrigger value="mock">Sample Organizations</TabsTrigger>
              <TabsTrigger value="custom">Manual Entry</TabsTrigger>
            </TabsList>
            <TabsContent value="mock">
              <div className="flex-1 max-w-sm">
                <Label className="text-xs font-medium mb-1.5 block">Select Sample Organization</Label>
                <Select value={selectedMockId} onValueChange={setSelectedMockId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MOCK_ORGANIZATIONS.map(o => <SelectItem key={o.id} value={o.id}>{o.name} · {o.org_type}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>
            <TabsContent value="custom">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 bg-muted/30 p-4 rounded-xl border border-border/50">
                {[
                  { key: "name", label: "Organization Name", type: "text" },
                  { key: "mission", label: "Mission Statement", type: "text" },
                  { key: "annual_budget", label: "Annual Budget ($)", type: "number" },
                  { key: "years_in_operation", label: "Years in Operation", type: "number" },
                  { key: "geography", label: "Geography (comma-separated)", type: "csv" },
                  { key: "program_areas", label: "Program Areas (comma-separated)", type: "csv" },
                  { key: "population_served", label: "Population Served (comma-separated)", type: "csv" },
                  { key: "keywords", label: "Keywords (comma-separated)", type: "csv" },
                ].map(({ key, label, type }) => (
                  <div key={key}>
                    <Label className="text-xs font-medium mb-1 block">{label}</Label>
                    <Input className="text-sm h-9" type={type === "number" ? "number" : "text"}
                      value={type === "csv" ? (customOrg as any)[key]?.join(", ") ?? "" : String((customOrg as any)[key] ?? "")}
                      onChange={e => setCustomOrg(p => ({
                        ...p,
                        [key]: type === "number" ? Number(e.target.value) : type === "csv" ? csvToArray(e.target.value) : e.target.value,
                      }))}
                    />
                  </div>
                ))}
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={customOrg.has_501c3} onChange={e => setCustomOrg(p => ({ ...p, has_501c3: e.target.checked }))} className="rounded" />
                    Has 501(c)(3)
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={customOrg.is_small_business} onChange={e => setCustomOrg(p => ({ ...p, is_small_business: e.target.checked }))} className="rounded" />
                    Small Business
                  </label>
                </div>
                <div>
                  <Label className="text-xs font-medium mb-1.5 block">Org Type</Label>
                  <Select value={customOrg.org_type} onValueChange={v => setCustomOrg(p => ({ ...p, org_type: v as any }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["nonprofit", "small_business", "university", "government", "individual", "other"].map(t => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <Card className="mt-4 border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <div className="font-semibold text-sm">{activeOrg.name || "—"}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {activeOrg.org_type} · Budget {fmt(activeOrg.annual_budget)} · {activeOrg.years_in_operation} yrs
                    {activeOrg.has_501c3 && " · 501(c)(3)"}
                    {activeOrg.is_small_business && " · Small Business"}
                  </div>
                </div>
                <button onClick={() => setShowOrgJson(v => !v)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0">
                  {showOrgJson ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />} Raw JSON
                </button>
              </div>
              <div className="flex flex-wrap gap-1 mb-2">
                {activeOrg.keywords.map((k, i) => <Badge key={i} variant="secondary" className="text-xs">{k}</Badge>)}
              </div>
              <div className="text-xs text-muted-foreground line-clamp-2">{activeOrg.mission}</div>
              {showOrgJson && (
                <pre className="mt-3 text-xs bg-background p-3 rounded-lg overflow-auto max-h-48 border border-border/50">
                  {JSON.stringify(activeOrg, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>
        </section>

        <Separator />

        {/* ── Section 3: Pool Viewer ────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Section 3 — Opportunity Pool</h2>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="outline" className="text-xs font-mono">{pool.length.toLocaleString()} total</Badge>
              <Badge variant="outline" className="text-xs font-mono text-primary border-primary/30">{filteredPool.length.toLocaleString()} filtered</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 mb-4 p-3 bg-muted/30 rounded-xl border border-border/40">
            <Filter className="h-4 w-4 text-muted-foreground self-center" />
            <div className="flex-1 min-w-36 max-w-xs relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search keyword..." className="pl-8 h-8 text-xs" value={poolFilter.keyword}
                onChange={e => setPoolFilter(p => ({ ...p, keyword: e.target.value }))} />
            </div>
            <Select value={poolFilter.source || "__all__"} onValueChange={v => setPoolFilter(p => ({ ...p, source: v === "__all__" ? "" : v }))}>
              <SelectTrigger className="h-8 text-xs w-44"><SelectValue placeholder="All sources" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All sources</SelectItem>
                {SOURCE_CONFIGS.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={poolFilter.fundingType || "__all__"} onValueChange={v => setPoolFilter(p => ({ ...p, fundingType: v === "__all__" ? "" : v }))}>
              <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All types</SelectItem>
                {["grant", "contract", "procurement", "cooperative_agreement", "fellowship"].map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setPoolFilter({ source: "", keyword: "", fundingType: "" })}>Clear</Button>
          </div>

          {poolLoading && (
            <div className="text-center py-12 text-muted-foreground">
              <RefreshCw className="h-8 w-8 mx-auto mb-2 animate-spin opacity-40" />
              <p className="text-sm">Loading from database…</p>
            </div>
          )}
          {poolError && !poolLoading && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-lg">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {poolError}
            </div>
          )}
          {!poolLoading && !poolError && pool.length > 0 && (
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              <div className="text-xs text-muted-foreground mb-2 font-mono">Showing {filteredPool.length.toLocaleString()} of {pool.length.toLocaleString()} records</div>
              {filteredPool.slice(0, 200).map(opp => (
                <Card key={opp.id} className="border border-border/50">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Badge variant="outline" className="text-xs">{opp.source_raw}</Badge>
                          <Badge variant="secondary" className="text-xs capitalize">{opp.funding_type.replace("_", " ")}</Badge>
                        </div>
                        <div className="font-medium text-sm line-clamp-1">{opp.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{opp.agency}</div>
                      </div>
                      <div className="text-xs text-right shrink-0">
                        <div className="font-medium">{fmt(opp.min_award)} – {fmt(opp.max_award)}</div>
                        {opp.close_date && <div className="text-muted-foreground">Due {opp.close_date}</div>}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {filteredPool.length > 200 && <div className="text-xs text-center text-muted-foreground py-2">…and {(filteredPool.length - 200).toLocaleString()} more</div>}
            </div>
          )}
        </section>

        <Separator />

        {/* ── Section 4: Match Results ──────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Target className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Section 4 — Match Results</h2>
          </div>

          {/* Run controls */}
          <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-background mb-6">
            <CardContent className="p-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="text-sm font-medium mb-2">Matching: <strong>{activeOrg.name || "Custom Organization"}</strong></div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex gap-1">
                      <button
                        className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${scorerMode === "hybrid" ? "bg-primary text-white border-primary" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
                        onClick={() => setScorerMode("hybrid")}>
                        V2 Hybrid
                      </button>
                      <button
                        className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${scorerMode === "v3" ? "bg-violet-600 text-white border-violet-600" : "border-violet-300 text-violet-600 hover:bg-violet-50"}`}
                        onClick={() => setScorerMode("v3")}>
                        V3 RankFix
                      </button>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {scorerMode === "v3"
                        ? compareMode ? "V3 RankFix vs V2 Hybrid side-by-side" : "specificity-first · phrase-priority · intent-aware"
                        : compareMode ? "V2 (Hybrid) vs V1 (Keyword Only) side-by-side" : "8-dimension hybrid scorer · keyword + profile matching"}
                    </div>
                    <button
                      className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${compareMode ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
                      onClick={() => setCompareMode(v => !v)}>
                      <ArrowUpDown className="h-3 w-3" /> {compareMode ? "Exit Compare" : scorerMode === "v3" ? "Compare with V2" : "Compare with V1"}
                    </button>
                  </div>
                </div>
                <Button
                  size="lg" onClick={runAlgorithm}
                  disabled={isRunning || poolLoading || pool.length === 0}
                  className={`shrink-0 gap-2 px-8 ${scorerMode === "v3" ? "bg-violet-600 hover:bg-violet-700" : ""}`}
                >
                  <Zap className={`h-4 w-4 ${isRunning ? "animate-pulse" : ""}`} />
                  {isRunning ? "Running…" : compareMode
                    ? (scorerMode === "v3" ? "Run V3 + V2 Compare" : "Run V2 + V1 Compare")
                    : (scorerMode === "v3" ? "Run V3 RankFix" : "Run Algorithm V2")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Stats */}
          {runStats && (
            <div className="grid grid-cols-3 gap-3 mb-6">
              {[
                { label: "Opportunities Scored", value: runStats.total },
                { label: "Passed Eligibility", value: runStats.eligible },
                { label: "Top Matches Returned", value: runStats.scored },
              ].map(({ label, value }) => (
                <Card key={label} className="border-border/50">
                  <CardContent className="p-3 text-center">
                    <div className="text-2xl font-bold text-primary">{value.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Empty states */}
          {!hybridResults && !v3Results && !isRunning && (
            <div className="text-center py-16 text-muted-foreground">
              <FlaskConical className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select an organization and click <strong>Run {scorerMode === "v3" ? "V3 RankFix" : "Algorithm V2"}</strong> to see match results.</p>
              <p className="text-xs mt-1 text-muted-foreground/70">{scorerMode === "v3" ? "V3 RankFix uses phrase-priority matching and strict eligibility gates" : "Hybrid V2 blends V1 keyword matching with V2 profile scoring across 8 dimensions"}</p>
            </div>
          )}
          {isRunning && (
            <div className="text-center py-16 text-muted-foreground">
              <div className="inline-flex items-center gap-2 animate-pulse">
                <Zap className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium">Scoring {pool.length.toLocaleString()} opportunities with Hybrid V2…</span>
              </div>
            </div>
          )}

          {/* Compare Mode — V1 keyword vs V2 Hybrid */}
          {compareMode && comparisonRows.length > 0 && !isRunning && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ArrowUpDown className="h-4 w-4 text-primary" />
                V1 (Keyword Only) vs V2 (Hybrid) — Rank Comparison
              </div>
              <div className="overflow-auto rounded-lg border border-border/60">
                <table className="w-full text-xs border-collapse min-w-[700px]">
                  <thead>
                    <tr className="bg-muted/60 text-left">
                      <th className="px-3 py-2 font-medium text-muted-foreground">Title</th>
                      <th className="px-3 py-2 font-medium text-muted-foreground w-24">Source</th>
                      <th className="px-3 py-2 font-medium text-muted-foreground w-20 text-center">V1 Score</th>
                      <th className="px-3 py-2 font-medium text-muted-foreground w-20 text-center">V2 Hybrid</th>
                      <th className="px-3 py-2 font-medium text-muted-foreground w-20 text-center">Rank Δ</th>
                      <th className="px-3 py-2 font-medium text-muted-foreground w-20 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonRows.slice(0, 25).map((row, i) => (
                      <tr key={row.oppId} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                        <td className="px-3 py-1.5 max-w-0">
                          <div className="truncate font-medium" title={row.title}>{row.title}</div>
                          <div className="text-muted-foreground text-[10px]">{row.opportunityType.replace(/_/g, " ")} · {row.orgClass}</div>
                        </td>
                        <td className="px-3 py-1.5">
                          <Badge variant="outline" className="text-[10px] px-1 py-0 font-mono">{row.source}</Badge>
                        </td>
                        <td className="px-3 py-1.5 text-center font-mono tabular-nums">
                          {row.v1Score != null ? <span className={scoreColor(row.v1Score)}>{row.v1Score}</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-center font-mono tabular-nums">
                          {row.v2Score != null ? <span className={scoreColor(row.v2Score)}>{row.v2Score}</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {row.rankDelta == null ? <Minus className="h-3 w-3 mx-auto text-muted-foreground" />
                            : row.rankDelta > 0 ? <span className="text-emerald-600 font-medium flex items-center justify-center gap-0.5"><TrendingUp className="h-3 w-3" />+{row.rankDelta}</span>
                            : row.rankDelta < 0 ? <span className="text-red-500 font-medium flex items-center justify-center gap-0.5"><TrendingDown className="h-3 w-3" />{row.rankDelta}</span>
                            : <Minus className="h-3 w-3 mx-auto text-muted-foreground" />}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <Badge className={`text-[10px] px-1.5 py-0 ${
                            row.flag === "rose" ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                            : row.flag === "fell" ? "bg-red-100 text-red-700 border-red-200"
                            : row.flag === "new" ? "bg-blue-100 text-blue-700 border-blue-200"
                            : row.flag === "dropped" ? "bg-gray-100 text-gray-600 border-gray-200"
                            : "bg-muted text-muted-foreground"}`}>{row.flag}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Side-by-side top 5 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
                <div>
                  <div className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">V1</Badge> Top 5 — Keyword Overlap Only
                  </div>
                  <div className="space-y-3">
                    {(v1Results ?? []).slice(0, 5).map((r, i) => <MatchCard key={r.opportunity.id} result={r} index={i} />)}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Badge variant="outline" className="font-mono bg-primary/5 border-primary/30 text-primary">V2 Hybrid</Badge> Top 5 — 8-Dimension Hybrid Scorer
                  </div>
                  <div className="space-y-3">
                    {(hybridResults ?? []).slice(0, 5).map((r, i) => <HybridMatchCard key={r.opp.id} trace={r} index={i} />)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Primary results — Hybrid V2 */}
          {!compareMode && !isRunning && scorerMode === "hybrid" && hybridResults !== null && (
            hybridResults.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <XCircle className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No eligible matches found for this organization.</p>
                <p className="text-xs mt-1 opacity-70">Try adding more keywords, program areas, or broadening the organization profile.</p>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
                  <ChevronRight className="h-3 w-3" />
                  Top {hybridResults.length} matches — V2 Hybrid (keyword overlap + profile matching + penalty engine)
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {hybridResults.map((r, i) => <HybridMatchCard key={r.opp.id} trace={r} index={i} />)}
                </div>
              </div>
            )
          )}

          {/* Primary results — V3 RankFix */}
          {!compareMode && !isRunning && scorerMode === "v3" && v3Results !== null && (
            v3Results.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <XCircle className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No eligible matches found.</p>
                <p className="text-xs mt-1 opacity-70">V3 applies stricter eligibility — try broadening the org profile.</p>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
                  <ChevronRight className="h-3 w-3" />
                  Top {v3Results.length} matches — V3 RankFix (phrase-priority · specificity-first · intent-aware)
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {v3Results.map((t, i) => {
                    const sub = t.subSignals;
                    return (
                      <Card key={t.opp.id} className={`border ${t.finalScore >= 70 ? "border-emerald-200" : t.finalScore >= 50 ? "border-amber-200" : "border-border/60"}`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-[10px] font-bold text-violet-600 bg-violet-50 px-1.5 rounded">#{i + 1}</span>
                                <span className="text-[10px] text-muted-foreground">{t.opp.source}</span>
                              </div>
                              <div className="font-medium text-sm leading-snug line-clamp-2">{t.opp.title}</div>
                              <div className="text-xs text-muted-foreground mt-0.5">{t.opp.agency}</div>
                            </div>
                            <div className={`text-2xl font-black shrink-0 ${scoreColor(t.finalScore)}`}>{t.finalScore}</div>
                          </div>
                          {/* V3 dimension mini-bars */}
                          <div className="space-y-1 mb-2">
                            {(Object.entries(t.dimensions) as [string, number][]).slice(0, 5).map(([dim, score]) => {
                              const max = V3_DIMENSION_MAXES[dim as keyof typeof V3_DIMENSION_MAXES] ?? 10;
                              const pct = max > 0 ? (score / max) * 100 : 0;
                              return (
                                <div key={dim} className="flex items-center gap-1.5">
                                  <div className="w-24 text-[10px] text-muted-foreground">{dim.replace(/([A-Z])/g, " $1").toLowerCase().trim()}</div>
                                  <div className="flex-1 bg-muted rounded-full h-1">
                                    <div className={`h-1 rounded-full ${pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${pct}%` }} />
                                  </div>
                                  <div className="text-[10px] font-mono text-muted-foreground">{score}/{max}</div>
                                </div>
                              );
                            })}
                          </div>
                          {/* Specificity signals */}
                          <div className="flex gap-2 flex-wrap mt-1">
                            {sub.exactPhraseMatches.length > 0 && (
                              <span className="text-[10px] bg-violet-50 text-violet-600 border border-violet-200 rounded px-1.5 py-0.5">
                                {sub.exactPhraseMatches.length} phrase{sub.exactPhraseMatches.length > 1 ? "s" : ""} matched
                              </span>
                            )}
                            {sub.specificityRatio > 0 && (
                              <span className="text-[10px] bg-muted rounded px-1.5 py-0.5 text-muted-foreground">
                                specificity {(sub.specificityRatio * 100).toFixed(0)}%
                              </span>
                            )}
                            {t.penalties.length > 0 && (
                              <span className="text-[10px] bg-red-50 text-red-600 border border-red-200 rounded px-1.5 py-0.5">
                                −{t.penaltyTotal} penalties
                              </span>
                            )}
                          </div>
                          {/* Reasons */}
                          {t.reasons.length > 0 && (
                            <div className="mt-2 text-xs text-emerald-700">
                              <CheckCircle2 className="h-3 w-3 inline mr-1" />{t.reasons[0]}
                            </div>
                          )}
                          {t.opp.url && (
                            <a href={t.opp.url} target="_blank" rel="noopener noreferrer" className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline">
                              <ExternalLink className="h-3 w-3" />View opportunity
                            </a>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )
          )}
        </section>
      </div>
    </div>
  );
}
