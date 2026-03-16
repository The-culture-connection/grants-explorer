import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  Database, Play, Square, RotateCcw, RefreshCw, CheckCircle2, XCircle,
  Clock, AlertTriangle, BarChart3, Filter, Search, ChevronLeft, ChevronRight,
  LayoutDashboard, FlaskConical, Zap, Info, Eye, EyeOff, Layers, BookOpen,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

// ─── Types ─────────────────────────────────────────────────────────────────

interface SourceInfo {
  sourceKey: string;
  displayName: string;
  classification: "active_opportunity" | "historical_intelligence";
  paginationType: string;
  pageSize: number;
  enabled: boolean;
  requiresAuth: boolean;
  notes?: string;
  indexedCount: number;
  lastStatus: string;
  lastFetched: number;
  lastInserted: number;
  completedAt: string | null;
  stopReason: string | null;
}

interface SourceProgress {
  sourceKey: string;
  status: "idle" | "running" | "completed" | "failed" | "stopped";
  currentPage: number;
  totalFetched: number;
  totalInserted: number;
  totalSkipped: number;
  totalErrors: number;
  stopReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  logLines: string[];
}

interface IndexedRecord {
  id: string;
  source: string;
  source_record_id: string;
  classification: string;
  title: string;
  agency: string | null;
  funding_type: string | null;
  status: string | null;
  close_date: string | null;
  min_award: number | null;
  max_award: number | null;
  geography: string[] | string | null;
  url: string | null;
  normalized_at: string;
  dedupe_key: string;
}

interface IndexStats {
  total: number;
  active: number;
  historical: number;
  bySource: Record<string, number>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const fmt = (n?: number | null) => n != null ? `$${n.toLocaleString()}` : "—";

function statusColor(s: string) {
  if (s === "completed") return "text-emerald-600";
  if (s === "running") return "text-blue-500 animate-pulse";
  if (s === "failed") return "text-red-500";
  if (s === "stopped") return "text-amber-600";
  return "text-muted-foreground";
}

function statusBadge(s: string) {
  if (s === "completed") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (s === "running") return "bg-blue-100 text-blue-700 border-blue-200";
  if (s === "failed") return "bg-red-100 text-red-700 border-red-200";
  if (s === "stopped") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-muted text-muted-foreground border-border";
}

function geoDisplay(g: string[] | string | null): string {
  if (!g) return "—";
  if (Array.isArray(g)) return g.slice(0, 2).join(", ");
  try { return JSON.parse(g).slice(0, 2).join(", "); } catch { return String(g); }
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function IndexingToolPage() {
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [progress, setProgress] = useState<Record<string, SourceProgress>>({});
  const [stats, setStats] = useState<IndexStats | null>(null);
  const [keyword, setKeyword] = useState("research");
  const [runningAll, setRunningAll] = useState(false);

  const [records, setRecords] = useState<IndexedRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordPage, setRecordPage] = useState(0);
  const [recordFilter, setRecordFilter] = useState({ source: "", classification: "", keyword: "" });

  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const RECORDS_PER_PAGE = 50;

  const fetchSources = useCallback(async () => {
    try {
      const r = await fetch(`${API}/indexing/sources`);
      const d = await r.json();
      setSources(d.sources ?? []);
    } catch {}
  }, []);

  const fetchProgress = useCallback(async () => {
    try {
      const r = await fetch(`${API}/indexing/progress`);
      const d = await r.json();
      const map: Record<string, SourceProgress> = {};
      for (const p of d.progress ?? []) map[p.sourceKey] = p;
      setProgress(map);
      const anyRunning = Object.values(map).some((p) => p.status === "running");
      if (!anyRunning) setRunningAll(false);
    } catch {}
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const r = await fetch(`${API}/indexing/stats`);
      if (r.ok) setStats(await r.json());
    } catch {}
  }, []);

  const fetchRecords = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(RECORDS_PER_PAGE), offset: String(recordPage * RECORDS_PER_PAGE) });
    if (recordFilter.source) params.set("source", recordFilter.source);
    if (recordFilter.classification) params.set("classification", recordFilter.classification);
    if (recordFilter.keyword) params.set("keyword", recordFilter.keyword);
    try {
      const r = await fetch(`${API}/indexing/records?${params}`);
      const d = await r.json();
      setRecords(d.records ?? []);
      setRecordsTotal(d.total ?? 0);
    } catch {}
  }, [recordPage, recordFilter]);

  useEffect(() => {
    fetchSources();
    fetchStats();
    fetchRecords();
  }, [fetchSources, fetchStats, fetchRecords]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      fetchProgress();
      fetchStats();
      fetchSources();
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchProgress, fetchStats, fetchSources]);

  useEffect(() => {
    fetchRecords();
  }, [recordFilter, recordPage, fetchRecords]);

  const runSource = async (sourceKey: string) => {
    setLoadingAction(`run_${sourceKey}`);
    await fetch(`${API}/indexing/run/${sourceKey}?keyword=${encodeURIComponent(keyword)}`, { method: "POST" });
    setLoadingAction(null);
    fetchProgress();
  };

  const stopSource = async (sourceKey: string) => {
    await fetch(`${API}/indexing/stop/${sourceKey}`, { method: "POST" });
    fetchProgress();
  };

  const resetSource = async (sourceKey: string) => {
    setLoadingAction(`reset_${sourceKey}`);
    await fetch(`${API}/indexing/reset/${sourceKey}`, { method: "DELETE" });
    setLoadingAction(null);
    fetchSources();
    fetchStats();
    fetchRecords();
  };

  const runAll = async () => {
    setRunningAll(true);
    await fetch(`${API}/indexing/run-all?keyword=${encodeURIComponent(keyword)}`, { method: "POST" });
    fetchProgress();
  };

  const stopAll = async () => {
    await fetch(`${API}/indexing/stop-all`, { method: "POST" });
    fetchProgress();
    setRunningAll(false);
  };

  const resetAll = async () => {
    if (!confirm("Reset ALL indexed records? This cannot be undone.")) return;
    setLoadingAction("reset_all");
    await fetch(`${API}/indexing/reset-all`, { method: "DELETE" });
    setLoadingAction(null);
    fetchSources();
    fetchStats();
    fetchRecords();
  };

  const toggleLog = (key: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const anyRunning = Object.values(progress).some((p) => p.status === "running");
  const activeSources = sources.filter((s) => s.classification === "active_opportunity");
  const historicalSources = sources.filter((s) => s.classification === "historical_intelligence");

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
              <LayoutDashboard className="h-3.5 w-3.5" /> Explorer
            </Link>
            <span className="text-border">|</span>
            <Link href="/algorithm" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
              <FlaskConical className="h-3.5 w-3.5" /> Algorithm V1
            </Link>
            <span className="text-border">|</span>
            <Link href="/audit" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
              <BookOpen className="h-3.5 w-3.5" /> Algorithm Audit
            </Link>
          </div>
          <div className="flex items-center gap-2 font-semibold text-sm text-foreground">
            <Database className="h-4 w-4 text-primary" />
            Indexing Tool
            <Badge variant="secondary" className="text-xs font-mono">DEV</Badge>
          </div>
        </div>
      </nav>

      {/* Stats Bar */}
      {stats && (
        <div className="border-b border-border/40 bg-muted/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap gap-6 text-sm">
            <span className="flex items-center gap-1.5 font-semibold">{stats.total.toLocaleString()} <span className="text-muted-foreground font-normal">total indexed records</span></span>
            <span className="flex items-center gap-1.5 text-emerald-600 font-semibold">{stats.active.toLocaleString()} <span className="text-muted-foreground font-normal">active opportunities</span></span>
            <span className="flex items-center gap-1.5 text-amber-600 font-semibold">{stats.historical.toLocaleString()} <span className="text-muted-foreground font-normal">historical records</span></span>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">

        {/* ─── Section 1: Source Configuration ──────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Layers className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Section 1 — Source Configuration</h2>
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs">{activeSources.length} active</Badge>
            <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs">{historicalSources.length} historical</Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sources.map((src) => {
              const p = progress[src.sourceKey];
              const isActive = src.classification === "active_opportunity";
              return (
                <Card key={src.sourceKey} className={`border ${isActive ? "border-emerald-200/60" : "border-amber-200/60"}`}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-sm">{src.displayName}</div>
                        <div className="text-xs text-muted-foreground">{src.paginationType} pagination · {src.pageSize}/page</div>
                      </div>
                      <Badge variant="outline" className={`text-xs shrink-0 ${isActive ? "border-emerald-300 text-emerald-700" : "border-amber-300 text-amber-700"}`}>
                        {isActive ? "active_opp" : "historical"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono font-semibold text-primary">{(stats?.bySource[src.sourceKey] ?? src.indexedCount).toLocaleString()} indexed</span>
                      <Badge className={`text-xs border ${statusBadge(p?.status ?? src.lastStatus)}`}>
                        {p?.status ?? src.lastStatus ?? "idle"}
                      </Badge>
                    </div>
                    {src.requiresAuth && (
                      <div className="text-xs text-amber-600 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Requires API key
                      </div>
                    )}
                    {src.notes && <div className="text-xs text-muted-foreground italic truncate">{src.notes}</div>}
                    {p && p.status !== "idle" && (
                      <div className="text-xs text-muted-foreground font-mono">
                        pg {p.currentPage} · {p.totalFetched} fetched · {p.totalInserted} inserted
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <Separator />

        {/* ─── Section 2: Full Index Runner ─────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Section 2 — Full Index Runner</h2>
          </div>

          {/* Global controls */}
          <Card className="border-primary/20 bg-primary/5 mb-6">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-48 max-w-sm">
                  <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder="Search keyword for all sources"
                      className="h-9 text-sm"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Used as the search keyword for all sources during indexing</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={runAll} disabled={anyRunning || runningAll} size="sm" className="gap-1.5">
                    <Play className="h-3.5 w-3.5" />
                    Run All Sources
                  </Button>
                  <Button onClick={stopAll} variant="outline" size="sm" className="gap-1.5" disabled={!anyRunning}>
                    <Square className="h-3.5 w-3.5" />
                    Stop All
                  </Button>
                  <Button onClick={resetAll} variant="outline" size="sm" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                    disabled={loadingAction === "reset_all"}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset All
                  </Button>
                  <Button onClick={() => { fetchProgress(); fetchStats(); fetchSources(); }} variant="ghost" size="sm" className="gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Refresh
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Per-source runners */}
          <div className="space-y-2">
            {sources.map((src) => {
              const p = progress[src.sourceKey];
              const isRunning = p?.status === "running";
              const logOpen = expandedLogs.has(src.sourceKey);

              return (
                <Card key={src.sourceKey} className={`border ${isRunning ? "border-blue-200 bg-blue-50/30" : "border-border/50"}`}>
                  <CardContent className="p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{src.displayName}</span>
                          <Badge className={`text-xs border ${statusBadge(p?.status ?? "idle")}`}>
                            {p?.status ?? "idle"}
                          </Badge>
                          {p?.stopReason && (
                            <span className="text-xs text-muted-foreground font-mono">→ {p.stopReason}</span>
                          )}
                        </div>
                        {p && p.status !== "idle" && (
                          <div className="flex flex-wrap gap-4 mt-1 text-xs text-muted-foreground font-mono">
                            <span>page: {p.currentPage}</span>
                            <span>fetched: {p.totalFetched}</span>
                            <span>inserted: {p.totalInserted}</span>
                            <span>skipped: {p.totalSkipped}</span>
                            <span>errors: {p.totalErrors}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-mono text-muted-foreground">
                          {(stats?.bySource[src.sourceKey] ?? src.indexedCount).toLocaleString()} in DB
                        </span>
                        {!isRunning ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs gap-1"
                            onClick={() => runSource(src.sourceKey)}
                            disabled={loadingAction === `run_${src.sourceKey}`}
                          >
                            <Play className="h-3 w-3" /> Index
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs gap-1 border-red-200 text-red-600"
                            onClick={() => stopSource(src.sourceKey)}
                          >
                            <Square className="h-3 w-3" /> Stop
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs gap-1 text-red-500"
                          onClick={() => resetSource(src.sourceKey)}
                          disabled={isRunning || loadingAction === `reset_${src.sourceKey}`}
                        >
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                        {p && p.logLines.length > 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs gap-1"
                            onClick={() => toggleLog(src.sourceKey)}
                          >
                            {logOpen ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            Logs
                          </Button>
                        )}
                      </div>
                    </div>

                    {logOpen && p && p.logLines.length > 0 && (
                      <div className="mt-2 bg-background border border-border/50 rounded-lg p-2.5 font-mono text-xs max-h-48 overflow-y-auto space-y-0.5">
                        {p.logLines.map((line, i) => (
                          <div key={i} className={`leading-relaxed ${line.includes("ERROR") ? "text-red-500" : line.includes("Finished") ? "text-emerald-600" : "text-foreground"}`}>
                            {line}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <Separator />

        {/* ─── Section 3: Indexed Data Viewer ───────────────────────────── */}
        <section>
          <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Section 3 — Indexed Data Viewer</h2>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs">{recordsTotal.toLocaleString()} records</Badge>
              <Button size="sm" variant="ghost" onClick={fetchRecords} className="h-7 gap-1 text-xs">
                <RefreshCw className="h-3 w-3" /> Refresh
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 mb-4 p-3 bg-muted/30 rounded-xl border border-border/40">
            <Filter className="h-4 w-4 text-muted-foreground self-center" />
            <div className="relative flex-1 min-w-40 max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Keyword search..."
                className="pl-8 h-8 text-xs"
                value={recordFilter.keyword}
                onChange={(e) => { setRecordFilter((p) => ({ ...p, keyword: e.target.value })); setRecordPage(0); }}
              />
            </div>
            <Select value={recordFilter.source || "__all__"} onValueChange={(v) => { setRecordFilter((p) => ({ ...p, source: v === "__all__" ? "" : v })); setRecordPage(0); }}>
              <SelectTrigger className="h-8 text-xs w-48"><SelectValue placeholder="All sources" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All sources</SelectItem>
                {sources.map((s) => <SelectItem key={s.sourceKey} value={s.sourceKey}>{s.displayName}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={recordFilter.classification || "__all__"} onValueChange={(v) => { setRecordFilter((p) => ({ ...p, classification: v === "__all__" ? "" : v })); setRecordPage(0); }}>
              <SelectTrigger className="h-8 text-xs w-44"><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All classifications</SelectItem>
                <SelectItem value="active_opportunity">Active Opportunities</SelectItem>
                <SelectItem value="historical_intelligence">Historical Intelligence</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setRecordFilter({ source: "", classification: "", keyword: "" }); setRecordPage(0); }}>
              Clear
            </Button>
          </div>

          {records.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground border border-dashed rounded-xl">
              <Database className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No indexed records yet. Run the indexer above to populate the database.</p>
            </div>
          ) : (
            <>
              <div className="border rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border/60">
                        {["Source", "Classification", "Title", "Agency", "Type", "Status", "Close Date", "Max Award", "Geography"].map((h) => (
                          <th key={h} className="text-left font-medium text-muted-foreground px-3 py-2 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {records.map((rec) => (
                        <tr key={rec.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-3 py-2 whitespace-nowrap">
                            <Badge variant="outline" className="text-xs">{rec.source}</Badge>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <Badge className={`text-xs border ${rec.classification === "active_opportunity" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                              {rec.classification === "active_opportunity" ? "active" : "historical"}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 max-w-xs">
                            <a href={rec.url ?? undefined} target="_blank" rel="noopener noreferrer" className="hover:underline text-primary line-clamp-1">
                              {rec.title}
                            </a>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground truncate max-w-[120px]">{rec.agency ?? "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap capitalize">{rec.funding_type ?? "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap capitalize">{rec.status ?? "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{rec.close_date ?? "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap font-mono">{fmt(rec.max_award)}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{geoDisplay(rec.geography)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-muted-foreground">
                  Showing {recordPage * RECORDS_PER_PAGE + 1}–{Math.min((recordPage + 1) * RECORDS_PER_PAGE, recordsTotal)} of {recordsTotal.toLocaleString()}
                </span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="h-7 px-2" disabled={recordPage === 0} onClick={() => setRecordPage((p) => p - 1)}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-xs text-muted-foreground">Page {recordPage + 1} / {Math.ceil(recordsTotal / RECORDS_PER_PAGE)}</span>
                  <Button size="sm" variant="outline" className="h-7 px-2" disabled={(recordPage + 1) * RECORDS_PER_PAGE >= recordsTotal} onClick={() => setRecordPage((p) => p + 1)}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>

        <Separator />

        {/* ─── Section 4: Diagnostics Panel ─────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Section 4 — Diagnostics: Why Only 26 Results?</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <Card className="border-amber-200 bg-amber-50/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-amber-600" />
                  Root Cause: Server-side getRows() cap
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-2">
                <p>The display API in <code className="bg-muted px-1 rounded">grants.ts</code> uses:</p>
                <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">{"Math.min(n, 25)"}</pre>
                <p>This caps every fetch request at <strong>25 records max</strong>. Combined with a default of <code className="bg-muted px-1 rounded">12</code>, the main tabs only show ≤25 results per page regardless of what the source APIs return.</p>
                <p className="text-amber-700 font-medium">Status: This is intentional for display tabs but NOT for the indexer.</p>
              </CardContent>
            </Card>

            <Card className="border-emerald-200 bg-emerald-50/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  How the Indexer Bypasses This
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-2">
                <p>The indexing engine calls external APIs <em>directly</em> — never through the capped display route. It uses:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Page sizes of 50–500 per request (per-source)</li>
                  <li>Async generators that loop until exhausted</li>
                  <li>Safety limits: max 1,000 pages, max 100,000 records</li>
                  <li>Retries with exponential backoff</li>
                </ul>
              </CardContent>
            </Card>
          </div>

          <Accordion type="multiple">
            <AccordionItem value="stop-reasons" className="border rounded-lg px-4 mb-2">
              <AccordionTrigger className="text-sm font-medium hover:no-underline py-3">
                Stop Reason Reference — all possible stop conditions
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    ["no_more_pages", "emerald", "Normal completion — source returned no more results"],
                    ["empty_batch", "emerald", "API returned empty array — all records fetched"],
                    ["manual_stop", "amber", "User clicked Stop during indexing run"],
                    ["max_pages_safety_limit", "amber", "Hit 1,000 page safety cap (configurable)"],
                    ["max_records_safety_limit", "amber", "Hit 100,000 record safety cap (configurable)"],
                    ["api_error", "red", "Unrecoverable API error after retries"],
                  ].map(([reason, color, desc]) => (
                    <div key={reason} className={`p-3 rounded-lg border ${color === "emerald" ? "border-emerald-200 bg-emerald-50/40" : color === "amber" ? "border-amber-200 bg-amber-50/40" : "border-red-200 bg-red-50/40"}`}>
                      <div className="font-mono text-xs font-semibold mb-1">{reason}</div>
                      <div className="text-xs text-muted-foreground">{desc}</div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="per-source-status" className="border rounded-lg px-4 mb-2">
              <AccordionTrigger className="text-sm font-medium hover:no-underline py-3">
                Per-source run diagnostics
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="space-y-2">
                  {Object.values(progress).filter((p) => p.status !== "idle").map((p) => (
                    <div key={p.sourceKey} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg border border-border/40 text-xs">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold">{p.sourceKey}</span>
                          <Badge className={`text-xs border ${statusBadge(p.status)}`}>{p.status}</Badge>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-muted-foreground">
                          <span>Pages: <strong>{p.currentPage}</strong></span>
                          <span>Fetched: <strong>{p.totalFetched}</strong></span>
                          <span>Inserted: <strong>{p.totalInserted}</strong></span>
                          <span>Errors: <strong>{p.totalErrors}</strong></span>
                        </div>
                        {p.stopReason && (
                          <div className="mt-1 font-mono text-amber-600">Stop: {p.stopReason}</div>
                        )}
                      </div>
                    </div>
                  ))}
                  {Object.values(progress).every((p) => p.status === "idle") && (
                    <p className="text-sm text-muted-foreground text-center py-4">Run the indexer to see diagnostics here.</p>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="hidden-limits" className="border rounded-lg px-4">
              <AccordionTrigger className="text-sm font-medium hover:no-underline py-3">
                Hidden limit audit — where limits exist in the codebase
              </AccordionTrigger>
              <AccordionContent className="pb-4 space-y-3 text-xs">
                <div className="space-y-2">
                  {[
                    {
                      file: "artifacts/api-server/src/routes/grants.ts",
                      limit: "Math.min(n, 25)",
                      scope: "Display tabs only",
                      safe: true,
                      note: "This is the getRows() cap. It limits what the display tabs show but the indexer bypasses this entirely by calling external APIs directly.",
                    },
                    {
                      file: "artifacts/grants-explorer/src/lib/algorithm/matcher.ts",
                      limit: "limit = 10",
                      scope: "Algorithm top-N results",
                      safe: true,
                      note: "The getTopMatches() function returns top 10 by default. This is configurable; pass a higher limit to get more results from the matcher.",
                    },
                    {
                      file: "Indexing safety caps",
                      limit: "maxPages=1000, maxRecords=100000",
                      scope: "Full indexer only",
                      safe: true,
                      note: "These safety caps prevent infinite loops. They are set generously and will not block normal indexing runs.",
                    },
                  ].map((item) => (
                    <div key={item.file} className="p-3 bg-muted/30 rounded-lg border border-border/50">
                      <div className="flex items-start gap-2">
                        {item.safe ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />}
                        <div>
                          <div className="font-mono font-semibold">{item.file}</div>
                          <div className="mt-0.5">Limit: <code className="bg-background px-1 rounded">{item.limit}</code> — Scope: <span className="text-muted-foreground">{item.scope}</span></div>
                          <div className="text-muted-foreground mt-1">{item.note}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>

        <Separator />

        {/* ─── Section 5: Algorithm Integration ────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <FlaskConical className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Section 5 — Algorithm V1 Integration</h2>
          </div>

          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="font-semibold text-sm mb-2">Current indexed pool available for matching:</div>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                      <strong>{stats?.active.toLocaleString() ?? 0}</strong> active opportunities (used for V1 matching)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                      <strong>{stats?.historical.toLocaleString() ?? 0}</strong> historical records (excluded from V1)
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    The Algorithm V1 page has a toggle to switch between using the <strong>{stats?.active ?? 0 > 20 ? "full indexed pool" : "mock dataset (26 records)"}</strong>. Once you index records here, the algorithm will use them.
                  </p>
                </div>
                <Link href="/algorithm">
                  <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
                    <FlaskConical className="h-3.5 w-3.5" />
                    Go to Algorithm V1
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </section>

      </div>
    </div>
  );
}
