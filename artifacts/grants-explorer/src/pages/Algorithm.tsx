import React, { useState, useMemo } from "react";
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
  AlertTriangle, Info, Filter, Search, BarChart3, Code,
} from "lucide-react";

import { SOURCE_CONFIGS } from "@/lib/algorithm/sources";
import { MOCK_ORGANIZATIONS, ALL_MOCK_OPPORTUNITIES, MOCK_OPPORTUNITIES_ACTIVE } from "@/lib/algorithm/mockData";
import { filterToActiveOpportunities, getTopMatches, scoreMatch } from "@/lib/algorithm/matcher";
import type { OrgProfile, NormalizedOpportunity, MatchResult } from "@/lib/algorithm/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n?: number) =>
  n != null ? `$${n.toLocaleString()}` : "—";

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

function csvToArray(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono font-semibold">{value}/{max}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

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
        {/* Score bars */}
        <div className="space-y-2 p-3 bg-background/60 rounded-lg border border-border/40">
          <ScoreBar label="Mission / Topic Fit" value={score.mission_topic_fit} max={35} color="bg-blue-500" />
          <ScoreBar label="Eligibility Fit" value={score.eligibility_fit} max={25} color="bg-violet-500" />
          <ScoreBar label="Geography Fit" value={score.geography_fit} max={15} color="bg-emerald-500" />
          <ScoreBar label="Funding Size Fit" value={score.funding_size_fit} max={15} color="bg-amber-500" />
          <ScoreBar label="Maturity Fit" value={score.maturity_fit} max={10} color="bg-orange-400" />
        </div>

        {/* Award range */}
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <DollarSign className="h-3 w-3" />
            {fmt(opp.min_award)} – {fmt(opp.max_award)}
          </span>
          {opp.close_date && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Closes {opp.close_date}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Globe className="h-3 w-3" />
            {opp.geography.join(", ")}
          </span>
        </div>

        {/* Reasons + Risks accordion */}
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
                    {reasons.map((r, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-foreground">
                        <span className="text-emerald-500 mt-0.5 shrink-0">✓</span>{r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {risks.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-amber-700 mb-1.5 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Caution Flags
                  </div>
                  <ul className="space-y-1">
                    {risks.map((r, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-foreground">
                        <span className="text-amber-500 mt-0.5 shrink-0">⚠</span>{r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Raw JSON toggle */}
              <div>
                <button
                  onClick={() => setShowJson((v) => !v)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Code className="h-3 w-3" />
                  {showJson ? "Hide" : "Show"} raw normalized JSON
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

        <a
          href={opp.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" /> View Opportunity
        </a>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AlgorithmPage() {
  // ── Org state ───────────────────────────────────────────────────────────
  const [selectedMockId, setSelectedMockId] = useState<string>(MOCK_ORGANIZATIONS[0].id);
  const [customOrg, setCustomOrg] = useState<OrgProfile>(EMPTY_ORG);
  const [orgMode, setOrgMode] = useState<"mock" | "custom">("mock");
  const [showOrgJson, setShowOrgJson] = useState(false);

  const activeOrg = orgMode === "mock"
    ? (MOCK_ORGANIZATIONS.find((o) => o.id === selectedMockId) ?? MOCK_ORGANIZATIONS[0])
    : customOrg;

  // ── Opportunity pool state ───────────────────────────────────────────────
  const [poolFilter, setPoolFilter] = useState({ source: "", keyword: "", fundingType: "" });
  const [showExcluded, setShowExcluded] = useState(false);

  const { active: activePool, excluded: excludedPool } = useMemo(
    () => filterToActiveOpportunities(ALL_MOCK_OPPORTUNITIES),
    []
  );

  const filteredPool = useMemo(() => {
    const pool = showExcluded ? ALL_MOCK_OPPORTUNITIES : activePool;
    return pool.filter((opp) => {
      if (poolFilter.source && opp.source !== poolFilter.source) return false;
      if (poolFilter.fundingType && opp.funding_type !== poolFilter.fundingType) return false;
      if (poolFilter.keyword) {
        const kw = poolFilter.keyword.toLowerCase();
        const haystack = `${opp.title} ${opp.description} ${opp.keywords.join(" ")} ${opp.categories.join(" ")}`.toLowerCase();
        if (!haystack.includes(kw)) return false;
      }
      return true;
    });
  }, [showExcluded, activePool, poolFilter]);

  // ── Match results state ──────────────────────────────────────────────────
  const [matchResults, setMatchResults] = useState<MatchResult[] | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runStats, setRunStats] = useState<{
    total: number; active: number; excluded: number; eligible: number; scored: number;
  } | null>(null);

  const runAlgorithm = () => {
    setIsRunning(true);
    setTimeout(() => {
      const { active, excluded } = filterToActiveOpportunities(ALL_MOCK_OPPORTUNITIES);
      const allScored = active.map((opp) => scoreMatch(activeOrg, opp));
      const eligible = allScored.filter((r) => r.passes_eligibility);
      const top = getTopMatches(activeOrg, ALL_MOCK_OPPORTUNITIES, 10);

      setRunStats({
        total: ALL_MOCK_OPPORTUNITIES.length,
        active: active.length,
        excluded: excluded.length,
        eligible: eligible.length,
        scored: top.length,
      });
      setMatchResults(top);
      setIsRunning(false);
    }, 600);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top Nav */}
      <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to Explorer
          </Link>
          <div className="flex items-center gap-2 font-semibold text-sm text-foreground">
            <FlaskConical className="h-4 w-4 text-primary" />
            Algorithm V1 Testing Center
            <Badge variant="secondary" className="text-xs font-mono">DEV</Badge>
          </div>
        </div>
      </nav>
      {/* Header */}
      <div className="border-b border-border/60 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <p className="text-sm text-muted-foreground">
            Rules-based funding-match engine · 8 active opportunity sources · 3 intelligence-only sources excluded · Full explainability output
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        {/* ─── Section 1: Source Status Panel ─────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Database className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Section 1 — Source Status Panel</h2>
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs">
              8 active · 3 excluded
            </Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {SOURCE_CONFIGS.map((src) => (
              <Card
                key={src.id}
                className={`border ${src.status === "active"
                  ? "border-emerald-200 bg-emerald-50/40"
                  : "border-red-200 bg-red-50/30 opacity-80"
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="font-medium text-sm leading-tight">{src.name}</div>
                    {src.status === "active" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mb-2">{src.category}</div>
                  <Badge
                    variant="outline"
                    className={`text-xs ${src.status === "active"
                      ? "border-emerald-400 text-emerald-700 bg-emerald-50"
                      : "border-red-300 text-red-600 bg-red-50"
                    }`}
                  >
                    {src.status === "active" ? "Active Opportunity Source" : "Excluded from V1"}
                  </Badge>
                  {src.exclusion_reason && (
                    <p className="text-xs text-muted-foreground mt-2 italic leading-tight">
                      {src.exclusion_reason}
                    </p>
                  )}
                  <div className="text-xs text-muted-foreground mt-2 font-mono">
                    {MOCK_OPPORTUNITIES_ACTIVE.filter((o) => o.source === src.id).length} mock records
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <Separator />

        {/* ─── Section 2: Organization Tester Panel ───────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Section 2 — Organization Tester</h2>
          </div>

          <Tabs value={orgMode} onValueChange={(v) => setOrgMode(v as "mock" | "custom")}>
            <TabsList className="mb-4">
              <TabsTrigger value="mock">Use Mock Organization</TabsTrigger>
              <TabsTrigger value="custom">Manual Entry</TabsTrigger>
            </TabsList>

            <TabsContent value="mock">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1 max-w-sm">
                  <Label className="text-xs font-medium mb-1.5 block">Select Mock Organization</Label>
                  <Select value={selectedMockId} onValueChange={setSelectedMockId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MOCK_ORGANIZATIONS.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name} · {o.org_type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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
                    <Label className="text-xs font-medium mb-1.5 block">{label}</Label>
                    <Input
                      type={type === "number" ? "number" : "text"}
                      value={
                        type === "csv"
                          ? ((customOrg as any)[key] as string[]).join(", ")
                          : String((customOrg as any)[key])
                      }
                      onChange={(e) =>
                        setCustomOrg((prev) => ({
                          ...prev,
                          [key]: type === "number"
                            ? Number(e.target.value)
                            : type === "csv"
                            ? csvToArray(e.target.value)
                            : e.target.value,
                        }))
                      }
                      className="text-sm h-9"
                    />
                  </div>
                ))}
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={customOrg.has_501c3}
                      onChange={(e) => setCustomOrg((p) => ({ ...p, has_501c3: e.target.checked }))}
                      className="rounded"
                    />
                    Has 501(c)(3)
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={customOrg.is_small_business}
                      onChange={(e) => setCustomOrg((p) => ({ ...p, is_small_business: e.target.checked }))}
                      className="rounded"
                    />
                    Small Business
                  </label>
                </div>
                <div>
                  <Label className="text-xs font-medium mb-1.5 block">Org Type</Label>
                  <Select
                    value={customOrg.org_type}
                    onValueChange={(v) => setCustomOrg((p) => ({ ...p, org_type: v as any }))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["nonprofit", "small_business", "university", "government", "individual", "other"].map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {/* Active org profile display */}
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
                <button
                  onClick={() => setShowOrgJson((v) => !v)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  {showOrgJson ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  Raw JSON
                </button>
              </div>
              <div className="flex flex-wrap gap-1 mb-2">
                {activeOrg.keywords.map((k, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">{k}</Badge>
                ))}
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

        {/* ─── Section 3: Opportunity Pool Viewer ─────────────────────────── */}
        <section>
          <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Section 3 — Opportunity Pool Viewer</h2>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="outline" className="text-xs font-mono">
                {activePool.length} active
              </Badge>
              <Badge variant="outline" className="text-xs font-mono text-red-600 border-red-200">
                {excludedPool.length} excluded
              </Badge>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer text-muted-foreground hover:text-foreground">
                <input
                  type="checkbox"
                  checked={showExcluded}
                  onChange={(e) => setShowExcluded(e.target.checked)}
                  className="rounded"
                />
                Show excluded sources
              </label>
            </div>
          </div>

          {showExcluded && (
            <div className="mb-4 flex items-start gap-2 text-xs bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-lg">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                <strong>{excludedPool.length} records from excluded sources</strong> (USASpending, NIH RePORTER, NSF Awards) are
                visible below for inspection but are intentionally filtered out of all V1 match operations.
              </span>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-4 p-3 bg-muted/30 rounded-xl border border-border/40">
            <Filter className="h-4 w-4 text-muted-foreground self-center" />
            <div className="flex-1 min-w-36 max-w-xs">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search keyword..."
                  className="pl-8 h-8 text-xs"
                  value={poolFilter.keyword}
                  onChange={(e) => setPoolFilter((p) => ({ ...p, keyword: e.target.value }))}
                />
              </div>
            </div>
            <Select
              value={poolFilter.source || "__all__"}
              onValueChange={(v) => setPoolFilter((p) => ({ ...p, source: v === "__all__" ? "" : v }))}
            >
              <SelectTrigger className="h-8 text-xs w-44">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All sources</SelectItem>
                {SOURCE_CONFIGS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={poolFilter.fundingType || "__all__"}
              onValueChange={(v) => setPoolFilter((p) => ({ ...p, fundingType: v === "__all__" ? "" : v }))}
            >
              <SelectTrigger className="h-8 text-xs w-40">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All types</SelectItem>
                {["grant", "contract", "procurement", "cooperative_agreement", "fellowship"].map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" className="h-8 text-xs"
              onClick={() => setPoolFilter({ source: "", keyword: "", fundingType: "" })}>
              Clear
            </Button>
          </div>

          <div className="text-xs text-muted-foreground mb-3 font-mono">
            Showing {filteredPool.length} of {showExcluded ? ALL_MOCK_OPPORTUNITIES.length : activePool.length} records
          </div>

          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {filteredPool.map((opp) => {
              const isExcluded = !activePool.find((a) => a.id === opp.id);
              return (
                <Card key={opp.id} className={`border ${isExcluded ? "border-red-200 bg-red-50/30" : "border-border/50"}`}>
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Badge variant={isExcluded ? "destructive" : "outline"} className="text-xs">
                            {opp.source_raw}
                          </Badge>
                          <Badge variant="secondary" className="text-xs capitalize">
                            {opp.funding_type.replace("_", " ")}
                          </Badge>
                          <Badge variant="outline" className="text-xs capitalize">{opp.status}</Badge>
                          {isExcluded && (
                            <Badge className="text-xs bg-red-100 text-red-700 border-red-300">
                              EXCLUDED
                            </Badge>
                          )}
                        </div>
                        <div className="font-medium text-sm line-clamp-1">{opp.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{opp.agency}</div>
                      </div>
                      <div className="text-xs text-right shrink-0">
                        <div className="font-medium text-foreground">{fmt(opp.min_award)} – {fmt(opp.max_award)}</div>
                        {opp.close_date && (
                          <div className="text-muted-foreground">Due {opp.close_date}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {opp.geography.map((g, i) => (
                        <span key={i} className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                          <Globe className="h-2.5 w-2.5" />{g}
                        </span>
                      ))}
                      {opp.categories.slice(0, 3).map((c, i) => (
                        <Badge key={i} variant="secondary" className="text-xs h-5">{c}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <Separator />

        {/* ─── Section 4: Match Results Panel ─────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Target className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Section 4 — Match Results</h2>
          </div>

          <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-background mb-6">
            <CardContent className="p-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium mb-1">Ready to match against:</div>
                  <div className="text-base font-bold">{activeOrg.name || "Custom Organization"}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {activeOrg.org_type} · {activePool.length} active opportunities in pool
                  </div>
                </div>
                <Button
                  size="lg"
                  onClick={runAlgorithm}
                  disabled={isRunning}
                  className="shrink-0 gap-2 px-8"
                >
                  <Zap className={`h-4 w-4 ${isRunning ? "animate-pulse" : ""}`} />
                  {isRunning ? "Running Algorithm V1..." : "Run Algorithm V1"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {runStats && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
              {[
                { label: "Total Records", value: runStats.total, color: "text-foreground" },
                { label: "Active-Source Records", value: runStats.active, color: "text-emerald-600" },
                { label: "Excluded Records", value: runStats.excluded, color: "text-red-500" },
                { label: "Eligible Matches", value: runStats.eligible, color: "text-blue-600" },
                { label: "Top Results", value: runStats.scored, color: "text-primary" },
              ].map(({ label, value, color }) => (
                <Card key={label} className="border-border/50">
                  <CardContent className="p-3 text-center">
                    <div className={`text-2xl font-bold ${color}`}>{value}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {matchResults === null && !isRunning && (
            <div className="text-center py-16 text-muted-foreground">
              <FlaskConical className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select an organization and click <strong>Run Algorithm V1</strong> to see match results.</p>
            </div>
          )}

          {isRunning && (
            <div className="text-center py-16 text-muted-foreground">
              <div className="inline-flex items-center gap-2 animate-pulse">
                <Zap className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium">Running scoring engine…</span>
              </div>
            </div>
          )}

          {matchResults && matchResults.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <XCircle className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No eligible matches found for this organization profile.</p>
            </div>
          )}

          {matchResults && matchResults.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
                <ChevronRight className="h-3 w-3" />
                Top {matchResults.length} matches sorted by score — excluded sources filtered before scoring
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {matchResults.map((result, i) => (
                  <MatchCard key={result.opportunity.id} result={result} index={i} />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
