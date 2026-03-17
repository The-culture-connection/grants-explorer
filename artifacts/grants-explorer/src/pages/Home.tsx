import React, { useState, useRef, useCallback, useEffect } from "react";
import { SourceTabs } from "@/components/SourceTabs";
import {
  LayoutDashboard, ShieldCheck, Sparkles, RefreshCw, User, LogOut,
  ChevronRight, ExternalLink, Trophy, AlertCircle, X, Bookmark,
  BookmarkCheck, CheckSquare, Square, Inbox, Clock, Filter
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/context/AuthContext";
import type { OrgProfile, NormalizedOpportunity } from "@/lib/algorithm/types";
import type { OrgProfileData } from "@/context/AuthContext";
import { getTopMatchesV3 } from "@/lib/v3/matcherV3";
import type { V3ScoreTrace } from "@/lib/v3/types";
import { OrgProfileForm } from "@/components/OrgProfileForm";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

const ACTIVE_SOURCES = new Set(["simpler_grants", "grants_gov", "world_bank", "ted_eu"]);
const PAGE_SIZE = 20;

// ─── Opportunity Status (localStorage) ──────────────────────────────────────

type OppStatus = "saved" | "applied";

interface OppEntry {
  status: OppStatus;
  title: string;
  agency: string;
  score: number;
  url: string;
  source: string;
  fundingType: string;
  maxAward?: number;
  closeDate?: string;
}

function useOppStatus(userId: number | undefined) {
  const storageKey = userId ? `ge_opp_status_${userId}` : null;

  const [statuses, setStatuses] = useState<Record<string, OppEntry>>(() => {
    if (!storageKey) return {};
    try { return JSON.parse(localStorage.getItem(storageKey) || "{}"); }
    catch { return {}; }
  });

  const persist = useCallback((next: Record<string, OppEntry>) => {
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next));
    setStatuses(next);
  }, [storageKey]);

  const setStatus = useCallback((id: string, status: OppStatus, entry: Omit<OppEntry, "status">) => {
    setStatuses((prev) => {
      if (prev[id]?.status === status) {
        const next = { ...prev };
        delete next[id];
        if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      }
      const next = { ...prev, [id]: { ...entry, status } };
      if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }, [storageKey]);

  const removeStatus = useCallback((id: string) => {
    setStatuses((prev) => {
      const next = { ...prev };
      delete next[id];
      if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }, [storageKey]);

  return { statuses, setStatus, removeStatus };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dbRecordToOpportunity(rec: any): NormalizedOpportunity {
  return {
    id: rec.id ?? rec.external_id ?? String(Math.random()),
    source: rec.source ?? "unknown",
    source_raw: rec.source_raw ?? rec.source ?? "",
    title: rec.title ?? "",
    description: rec.description ?? "",
    agency: rec.agency ?? rec.organization ?? "",
    funding_type: rec.funding_type ?? "grant",
    status: rec.status ?? "active",
    open_date: rec.open_date ?? rec.posted_date,
    close_date: rec.close_date ?? rec.deadline,
    min_award: rec.min_award ?? rec.award_floor,
    max_award: rec.max_award ?? rec.award_ceiling ?? rec.funding_amount,
    eligibility: Array.isArray(rec.eligibility) ? rec.eligibility : [],
    categories: Array.isArray(rec.categories) ? rec.categories : [],
    keywords: Array.isArray(rec.keywords) ? rec.keywords : [],
    geography: Array.isArray(rec.geography) ? rec.geography : [],
    url: rec.url ?? "",
  };
}

function scoreColor(score: number) {
  if (score >= 75) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 50) return "text-blue-600 dark:text-blue-400";
  if (score >= 30) return "text-yellow-600 dark:text-yellow-400";
  return "text-muted-foreground";
}

function scoreBg(score: number) {
  if (score >= 75) return "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800";
  if (score >= 50) return "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800";
  if (score >= 30) return "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800";
  return "bg-muted/30 border-border/40";
}

function isExpired(closeDate?: string): boolean {
  if (!closeDate) return false;
  return new Date(closeDate) < new Date();
}

// ─── Grant Card ───────────────────────────────────────────────────────────────

interface GrantCardProps {
  trace: V3ScoreTrace;
  rank: number;
  entry?: OppEntry;
  onSave: () => void;
  onApply: () => void;
}

function GrantCard({ trace, rank, entry, onSave, onApply }: GrantCardProps) {
  const opp = trace.opp;
  const score = Math.round(trace.finalScore);
  const expired = isExpired(opp.close_date);
  const isSaved = entry?.status === "saved";
  const isApplied = entry?.status === "applied";

  return (
    <div className={`border rounded-xl p-5 space-y-3 transition-all hover:shadow-md ${scoreBg(score)} ${expired ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold
            ${score >= 75 ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300"
              : score >= 50 ? "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300"
              : "bg-muted text-muted-foreground"}`}>
            #{rank}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground leading-snug">{opp.title || "Untitled Opportunity"}</h3>
            {opp.agency && <p className="text-xs text-muted-foreground mt-0.5">{opp.agency}</p>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-2xl font-black ${scoreColor(score)}`}>{score}</div>
          <div className="text-[10px] text-muted-foreground">/ 100</div>
        </div>
      </div>

      {opp.description && (
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{opp.description}</p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{opp.source.replace(/_/g, " ")}</Badge>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{opp.funding_type.replace(/_/g, " ")}</Badge>
        {opp.max_award && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            Up to ${opp.max_award.toLocaleString()}
          </Badge>
        )}
        {opp.close_date && (
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 ${expired ? "border-red-300 text-red-500 dark:border-red-800 dark:text-red-400" : ""}`}
          >
            {expired ? "⚠ Expired" : "Closes"} {new Date(opp.close_date).toLocaleDateString()}
          </Badge>
        )}
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2 pt-1 border-t border-border/30">
        <button
          onClick={onSave}
          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all
            ${isSaved
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border/50 text-muted-foreground hover:border-primary/30 hover:text-primary"}`}
        >
          {isSaved ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
          {isSaved ? "Saved" : "Save"}
        </button>

        <button
          onClick={onApply}
          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all
            ${isApplied
              ? "border-emerald-400/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400"
              : "border-border/50 text-muted-foreground hover:border-emerald-400/40 hover:text-emerald-600"}`}
        >
          {isApplied ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          {isApplied ? "Applied" : "Mark Applied"}
        </button>

        {opp.url && (
          <a
            href={opp.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline font-medium"
          >
            View grant <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Saved Entry Card (for the panel) ────────────────────────────────────────

function SavedEntryCard({ id, entry, onRemove }: { id: string; entry: OppEntry; onRemove: () => void }) {
  const expired = isExpired(entry.closeDate);
  return (
    <div className={`border rounded-xl p-4 space-y-2.5 bg-background ${expired ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 ${entry.status === "applied" ? "border-emerald-400/60 text-emerald-600 dark:text-emerald-400" : "border-primary/40 text-primary"}`}
            >
              {entry.status === "applied" ? "✓ Applied" : "Saved"}
            </Badge>
            {expired && <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-red-300 text-red-500">Expired</Badge>}
          </div>
          <h4 className="text-sm font-semibold text-foreground leading-snug">{entry.title}</h4>
          {entry.agency && <p className="text-xs text-muted-foreground">{entry.agency}</p>}
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-xl font-black ${scoreColor(entry.score)}`}>{Math.round(entry.score)}</div>
          <div className="text-[10px] text-muted-foreground">/ 100</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{entry.source.replace(/_/g, " ")}</Badge>
        {entry.maxAward && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">Up to ${entry.maxAward.toLocaleString()}</Badge>
        )}
        {entry.closeDate && (
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${expired ? "border-red-300 text-red-500" : ""}`}>
            {expired ? "⚠ Expired" : "Closes"} {new Date(entry.closeDate).toLocaleDateString()}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2 pt-1 border-t border-border/30">
        {entry.url && (
          <a href={entry.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline font-medium">
            View grant <ExternalLink className="h-3 w-3" />
          </a>
        )}
        <button onClick={onRemove} className="ml-auto text-xs text-muted-foreground hover:text-red-500 transition-colors flex items-center gap-1">
          <X className="h-3 w-3" /> Remove
        </button>
      </div>
    </div>
  );
}

// ─── Saved Panel ─────────────────────────────────────────────────────────────

type SavedFilter = "saved" | "applied" | "inactive";

function SavedPanel({ statuses, onRemove, onClose }: {
  statuses: Record<string, OppEntry>;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<SavedFilter>("saved");

  const all = Object.entries(statuses);

  const filtered = all.filter(([, e]) => {
    if (filter === "saved") return e.status === "saved" && !isExpired(e.closeDate);
    if (filter === "applied") return e.status === "applied" && !isExpired(e.closeDate);
    if (filter === "inactive") return isExpired(e.closeDate);
    return true;
  });

  const counts = {
    saved: all.filter(([, e]) => e.status === "saved" && !isExpired(e.closeDate)).length,
    applied: all.filter(([, e]) => e.status === "applied" && !isExpired(e.closeDate)).length,
    inactive: all.filter(([, e]) => isExpired(e.closeDate)).length,
  };

  const tabs: { key: SavedFilter; label: string; icon: React.ReactNode }[] = [
    { key: "saved", label: "Saved", icon: <Bookmark className="h-3.5 w-3.5" /> },
    { key: "applied", label: "Applied", icon: <CheckSquare className="h-3.5 w-3.5" /> },
    { key: "inactive", label: "Inactive", icon: <Clock className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-background border-l border-border shadow-2xl flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">My Opportunities</h2>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{all.length}</Badge>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex border-b border-border/60 shrink-0">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-all border-b-2 ${filter === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t.icon}
              {t.label}
              {counts[t.key] > 0 && (
                <span className={`text-[10px] px-1 rounded-full ${filter === t.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                  {counts[t.key]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-16 gap-3">
              {filter === "saved" && <Bookmark className="h-10 w-10 opacity-20" />}
              {filter === "applied" && <CheckSquare className="h-10 w-10 opacity-20" />}
              {filter === "inactive" && <Clock className="h-10 w-10 opacity-20" />}
              <p className="text-sm">
                {filter === "saved" && "No saved opportunities yet. Run V3 Matches and save ones you're interested in."}
                {filter === "applied" && "No applied opportunities yet. Mark grants as applied after submitting."}
                {filter === "inactive" && "No expired opportunities in your list."}
              </p>
            </div>
          ) : (
            filtered.map(([id, entry]) => (
              <SavedEntryCard key={id} id={id} entry={entry} onRemove={() => onRemove(id)} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Profile Modal ────────────────────────────────────────────────────────────

function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, updateProfile, logout } = useAuth();
  const [saving, setSaving] = useState(false);

  async function handleSave(profile: OrgProfileData) {
    setSaving(true);
    try {
      await updateProfile(profile);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Edit Organization Profile</h2>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 gap-1"
              onClick={() => { logout(); onClose(); }}
            >
              <LogOut className="h-3.5 w-3.5" /> Sign Out
            </Button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-5">
          <OrgProfileForm
            initial={user?.org_profile}
            onSave={handleSave}
            onCancel={onClose}
            saving={saving}
            saveLabel="Save Changes"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Result Filter ────────────────────────────────────────────────────────────

type ResultFilter = "all" | "saved" | "applied" | "inactive";

// ─── Home ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const { user } = useAuth();
  const [showProfile, setShowProfile] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  const { statuses, setStatus, removeStatus } = useOppStatus(user?.id);

  const [v3Running, setV3Running] = useState(false);
  const [v3Results, setV3Results] = useState<V3ScoreTrace[]>([]);
  const [v3Page, setV3Page] = useState(0);
  const [v3Error, setV3Error] = useState("");
  const [v3Ran, setV3Ran] = useState(false);
  const [totalFound, setTotalFound] = useState(0);
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const resultsRef = useRef<HTMLDivElement>(null);

  const totalSaved = Object.values(statuses).length;

  async function runV3() {
    if (!user?.org_profile) {
      setV3Error("Please set up your organization profile first using the Edit Profile button.");
      return;
    }
    setV3Running(true);
    setV3Error("");
    setV3Results([]);
    setV3Page(0);
    setResultFilter("all");
    try {
      const r = await fetch(`${API}/indexing/records/for-algorithm`);
      const data = await r.json();
      const pool: NormalizedOpportunity[] = (data.records ?? [])
        .map(dbRecordToOpportunity)
        .filter((o: NormalizedOpportunity) => ACTIVE_SOURCES.has(o.source));
      const orgProfile = user.org_profile as unknown as OrgProfile;
      const allResults = getTopMatchesV3(orgProfile, pool, 200);
      setTotalFound(allResults.length);
      setV3Results(allResults);
      setV3Ran(true);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch {
      setV3Error("Failed to load opportunity pool. Make sure the indexing service is running.");
    } finally {
      setV3Running(false);
    }
  }

  function handleSave(trace: V3ScoreTrace) {
    const opp = trace.opp;
    setStatus(opp.id, "saved", {
      title: opp.title,
      agency: opp.agency,
      score: trace.finalScore,
      url: opp.url,
      source: opp.source,
      fundingType: opp.funding_type,
      maxAward: opp.max_award,
      closeDate: opp.close_date,
    });
  }

  function handleApply(trace: V3ScoreTrace) {
    const opp = trace.opp;
    setStatus(opp.id, "applied", {
      title: opp.title,
      agency: opp.agency,
      score: trace.finalScore,
      url: opp.url,
      source: opp.source,
      fundingType: opp.funding_type,
      maxAward: opp.max_award,
      closeDate: opp.close_date,
    });
  }

  const filteredResults = v3Results.filter((t) => {
    const entry = statuses[t.opp.id];
    const expired = isExpired(t.opp.close_date);
    if (resultFilter === "saved") return entry?.status === "saved" && !expired;
    if (resultFilter === "applied") return entry?.status === "applied" && !expired;
    if (resultFilter === "inactive") return expired;
    return true;
  });

  const pagedResults = filteredResults.slice(0, (v3Page + 1) * PAGE_SIZE);
  const hasMore = pagedResults.length < filteredResults.length;

  const filterCounts = {
    all: v3Results.length,
    saved: v3Results.filter((t) => statuses[t.opp.id]?.status === "saved" && !isExpired(t.opp.close_date)).length,
    applied: v3Results.filter((t) => statuses[t.opp.id]?.status === "applied" && !isExpired(t.opp.close_date)).length,
    inactive: v3Results.filter((t) => isExpired(t.opp.close_date)).length,
  };

  const resultFilters: { key: ResultFilter; label: string; icon: React.ReactNode }[] = [
    { key: "all", label: "All", icon: <Filter className="h-3 w-3" /> },
    { key: "saved", label: "Saved", icon: <Bookmark className="h-3 w-3" /> },
    { key: "applied", label: "Applied", icon: <CheckSquare className="h-3 w-3" /> },
    { key: "inactive", label: "Inactive", icon: <Clock className="h-3 w-3" /> },
  ];

  return (
    <div className="min-h-screen w-full bg-background selection:bg-primary/20 selection:text-primary">
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
      {showSaved && (
        <SavedPanel
          statuses={statuses}
          onRemove={removeStatus}
          onClose={() => setShowSaved(false)}
        />
      )}

      {/* Top Nav */}
      <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-semibold text-sm text-foreground">
            <LayoutDashboard className="h-4 w-4 text-primary" />
            Grants Explorer
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs px-3 relative"
              onClick={() => setShowSaved(true)}
            >
              <Inbox className="h-3 w-3" />
              Saved Opportunities
              {totalSaved > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center font-bold">
                  {totalSaved > 9 ? "9+" : totalSaved}
                </span>
              )}
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs px-3"
              onClick={() => setShowProfile(true)}
            >
              <User className="h-3 w-3" />
              Edit Profile
            </Button>

            <Button
              size="sm"
              className="h-7 gap-1.5 text-xs px-3 bg-primary hover:bg-primary/90"
              onClick={runV3}
              disabled={v3Running}
            >
              {v3Running
                ? <><RefreshCw className="h-3 w-3 animate-spin" /> Running…</>
                : <><Sparkles className="h-3 w-3" /> Run V3 Matches</>}
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="relative overflow-hidden border-b border-border/40">
        <div className="absolute inset-0 z-0">
          <img
            src={`${import.meta.env.BASE_URL}images/hero-bg.png`}
            alt="Abstract structural background"
            className="w-full h-full object-cover opacity-[0.15] dark:opacity-10 mix-blend-luminosity"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/80 to-background" />
        </div>
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24">
          <div className="flex flex-col items-center text-center max-w-3xl mx-auto space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-4">
              <ShieldCheck className="w-4 h-4" />
              <span>Official Government Data Explorer</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-extrabold text-foreground tracking-tight drop-shadow-sm">
              Discover Federal & State{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400">
                Funding Opportunities
              </span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl">
              A unified interface to search, filter, and track public grants across 11 major governmental and institutional databases in real-time.
            </p>
            {user?.org_profile && !v3Ran && (
              <Button onClick={runV3} disabled={v3Running} size="lg" className="gap-2 mt-2">
                {v3Running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {v3Running ? "Analyzing grants…" : `Find Grants for ${(user.org_profile as any).name || "My Org"}`}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* V3 Results Panel */}
      {(v3Ran || v3Error) && (
        <div ref={resultsRef} className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          {v3Error ? (
            <div className="flex items-center gap-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {v3Error}
            </div>
          ) : (
            <div className="space-y-5">
              {/* Results header */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Trophy className="h-5 w-5 text-primary" />
                    <h2 className="text-lg font-bold text-foreground">V3 RankFix — Top Matches</h2>
                    <Badge className="text-[10px] px-1.5">AI-ranked</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {totalFound} grants matched for{" "}
                    <span className="font-medium text-foreground">
                      {(user?.org_profile as any)?.name || "your organization"}
                    </span>
                    {resultFilter !== "all" && ` · showing ${filteredResults.length} ${resultFilter}`}
                  </p>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={runV3} disabled={v3Running}>
                  <RefreshCw className={`h-3 w-3 ${v3Running ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>

              {/* Filter tabs */}
              <div className="flex items-center gap-1 border border-border/60 rounded-xl p-1 bg-muted/30 w-fit">
                {resultFilters.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => { setResultFilter(f.key); setV3Page(0); }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                      ${resultFilter === f.key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {f.icon}
                    {f.label}
                    <span className={`text-[10px] px-1 rounded-full ${resultFilter === f.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {filterCounts[f.key]}
                    </span>
                  </button>
                ))}
              </div>

              {/* Cards — single column */}
              {pagedResults.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground text-sm space-y-2">
                  {resultFilter === "all"
                    ? "No matching grants found. Try expanding your organization profile keywords or geography."
                    : resultFilter === "saved"
                    ? "No saved grants in this view. Click the Bookmark button on any result to save it."
                    : resultFilter === "applied"
                    ? "No applied grants yet. Mark a grant as applied after you submit."
                    : "No expired grants in your results."}
                </div>
              ) : (
                <div className="space-y-4">
                  {pagedResults.map((trace, i) => (
                    <GrantCard
                      key={trace.opp.id}
                      trace={trace}
                      rank={filteredResults.indexOf(trace) + 1}
                      entry={statuses[trace.opp.id]}
                      onSave={() => handleSave(trace)}
                      onApply={() => handleApply(trace)}
                    />
                  ))}
                </div>
              )}

              {hasMore && (
                <div className="flex justify-center">
                  <Button variant="outline" className="gap-2" onClick={() => setV3Page((p) => p + 1)}>
                    Load next {Math.min(PAGE_SIZE, filteredResults.length - pagedResults.length)} results
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Content */}
      <main className="relative z-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-10 pb-20">
        <SourceTabs />
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 bg-muted/20 py-8 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="w-4 h-4" />
            <span className="font-medium">Grants Explorer</span>
            <span>&copy; {new Date().getFullYear()}</span>
          </div>
          <p>Aggregating open data for public benefit.</p>
        </div>
      </footer>
    </div>
  );
}
