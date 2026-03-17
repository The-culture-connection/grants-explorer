import React, { useState, useRef, useCallback } from "react";
import { Link } from "wouter";
import { SourceTabs } from "@/components/SourceTabs";
import {
  LayoutDashboard, Sparkles, RefreshCw, User, LogOut,
  ChevronRight, ExternalLink, Trophy, AlertCircle, X, Bookmark,
  BookmarkCheck, CheckSquare, Square, Inbox, Clock, Filter, Eye,
  ThumbsUp, ThumbsDown, Database, BookOpen,
  ShieldAlert, UserPlus, Users, Check, TrendingUp, Target,
  BarChart3, Zap, Star
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/context/AuthContext";
import type { OrgProfile, NormalizedOpportunity } from "@/lib/algorithm/types";
import type { OrgProfileData } from "@/context/AuthContext";
import { getTopMatchesV3 } from "@/lib/v3/matcherV3";
import type { V3ScoreTrace } from "@/lib/v3/types";
import { OrgProfileForm } from "@/components/OrgProfileForm";
import { loadOpportunityPool, coerceOrgProfile } from "@/lib/poolLoader";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;
const PAGE_SIZE = 20;

// ─── Types ────────────────────────────────────────────────────────────────────
type OppStatus = "saved" | "applied";
type OppOutcome = "win" | "loss";

interface OppEntry {
  status: OppStatus;
  outcome?: OppOutcome;
  title: string;
  agency: string;
  score?: number;
  url: string;
  source: string;
  fundingType: string;
  maxAward?: number;
  closeDate?: string;
}

// Minimal shape shared by GrantItem for save/apply handlers
interface ExplorerGrant {
  id?: string | null;
  title?: string | null;
  agency?: string | null;
  url?: string | null;
  source?: string | null;
  deadline?: string | null;
}

interface ViewedEntry {
  title: string;
  agency?: string;
  url?: string;
  source: string;
  score?: number;
  viewedAt: number;
}

// ─── Opp Status Hook ──────────────────────────────────────────────────────────
function useOppStatus(userId: string | undefined) {
  const statusKey = userId ? `ge_opp_status_${userId}` : null;
  const viewedKey = userId ? `ge_opp_viewed_${userId}` : null;

  const [statuses, setStatuses] = useState<Record<string, OppEntry>>(() => {
    if (!statusKey) return {};
    try { return JSON.parse(localStorage.getItem(statusKey) || "{}"); } catch { return {}; }
  });
  const [viewedItems, setViewedItems] = useState<Record<string, ViewedEntry>>(() => {
    if (!viewedKey) return {};
    try { return JSON.parse(localStorage.getItem(viewedKey) || "{}"); } catch { return {}; }
  });

  const setStatus = useCallback((id: string, status: OppStatus, entry: Omit<OppEntry, "status" | "outcome">) => {
    setStatuses((prev) => {
      if (prev[id]?.status === status) {
        const next = { ...prev }; delete next[id];
        if (statusKey) localStorage.setItem(statusKey, JSON.stringify(next));
        return next;
      }
      const next = { ...prev, [id]: { ...prev[id], ...entry, status } };
      if (statusKey) localStorage.setItem(statusKey, JSON.stringify(next));
      return next;
    });
  }, [statusKey]);

  const setOutcome = useCallback((id: string, outcome: OppOutcome) => {
    setStatuses((prev) => {
      if (!prev[id]) return prev;
      const cur = prev[id];
      const next = { ...prev, [id]: { ...cur, outcome: cur.outcome === outcome ? undefined : outcome } };
      if (statusKey) localStorage.setItem(statusKey, JSON.stringify(next));
      return next;
    });
  }, [statusKey]);

  const removeStatus = useCallback((id: string) => {
    setStatuses((prev) => {
      const next = { ...prev }; delete next[id];
      if (statusKey) localStorage.setItem(statusKey, JSON.stringify(next));
      return next;
    });
  }, [statusKey]);

  const addViewed = useCallback((id: string, entry: ViewedEntry) => {
    setViewedItems((prev) => {
      const next = { ...prev, [id]: { ...entry, viewedAt: Date.now() } };
      if (viewedKey) localStorage.setItem(viewedKey, JSON.stringify(next));
      return next;
    });
  }, [viewedKey]);

  return { statuses, viewedItems, setStatus, setOutcome, removeStatus, addViewed };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreLabel(s: number) {
  if (s >= 80) return { label: "Excellent", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500", ring: "ring-emerald-400/50", light: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800" };
  if (s >= 60) return { label: "Strong", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500", ring: "ring-blue-400/50", light: "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800" };
  if (s >= 40) return { label: "Moderate", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500", ring: "ring-amber-400/50", light: "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800" };
  return { label: "Low", color: "text-slate-500 dark:text-slate-400", bg: "bg-slate-400", ring: "ring-slate-300/50", light: "bg-muted/30 border-border/40" };
}

function isExpired(d?: string) { return d ? new Date(d) < new Date() : false; }

function initials(email: string) {
  const parts = email.split("@")[0].split(/[._-]/);
  return parts.length > 1
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : email.slice(0, 2).toUpperCase();
}

// ─── Admin: Add Admin Modal ────────────────────────────────────────────────────
function AddAdminModal({ onClose }: { onClose: () => void }) {
  const { addAdmin } = useAuth();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      await addAdmin(email.toLowerCase().trim());
      setMsg(`${email} has been granted admin access`);
      setStatus("ok");
      setEmail("");
    } catch (err: any) {
      setMsg(err.message || "Failed");
      setStatus("error");
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <UserPlus className="h-4 w-4 text-primary" />
            </div>
            <h2 className="text-sm font-semibold">Grant Admin Access</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground">Enter the email of an existing user to grant them admin access.</p>
        <form onSubmit={submit} className="space-y-3">
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="w-full px-3 py-2 text-sm border border-border rounded-xl bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          />
          {msg && (
            <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${status === "ok" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-600 border border-red-200"}`}>
              {status === "ok" ? <Check className="h-3 w-3 shrink-0" /> : <AlertCircle className="h-3 w-3 shrink-0" />}
              {msg}
            </div>
          )}
          <Button type="submit" className="w-full gap-2" disabled={status === "loading"}>
            {status === "loading" ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Granting…</> : <><UserPlus className="h-3.5 w-3.5" />Grant Admin Access</>}
          </Button>
        </form>
      </div>
    </div>
  );
}

// ─── Grant Card ───────────────────────────────────────────────────────────────
function GrantCard({ trace, rank, entry, onSave, onApply, onView }: {
  trace: V3ScoreTrace; rank: number; entry?: OppEntry;
  onSave: () => void; onApply: () => void; onView: () => void;
}) {
  const opp = trace.opp;
  const score = Math.round(trace.finalScore);
  const sl = scoreLabel(score);
  const isSaved = entry?.status === "saved";
  const isApplied = entry?.status === "applied";

  return (
    <div className={`group relative border rounded-2xl p-5 space-y-4 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 ${sl.light}`}>
      {/* Rank ribbon */}
      <div className="flex items-start gap-4">
        {/* Score circle */}
        <div className={`shrink-0 relative w-14 h-14 rounded-2xl ${sl.bg} ring-4 ${sl.ring} flex flex-col items-center justify-center text-white shadow-sm`}>
          <span className="text-lg font-black leading-none">{score}</span>
          <span className="text-[9px] font-medium opacity-80">/ 100</span>
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">#{rank}</span>
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-semibold border-0 ${sl.color} bg-transparent`}>{sl.label} Match</Badge>
            {(isSaved || isApplied) && (
              <Badge className={`text-[10px] px-1.5 py-0 ${isApplied ? "bg-emerald-500" : "bg-primary"} text-white border-0`}>
                {isApplied ? "✓ Applied" : "Saved"}
              </Badge>
            )}
          </div>
          <h3 className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{opp.title || "Untitled Opportunity"}</h3>
          {opp.agency && <p className="text-xs text-muted-foreground truncate">{opp.agency}</p>}
        </div>
      </div>

      {opp.description && (
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{opp.description}</p>
      )}

      {/* Meta chips */}
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-background/60 border border-border/60 text-[10px] font-medium text-muted-foreground capitalize">
          {opp.source.replace(/_/g, " ")}
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-background/60 border border-border/60 text-[10px] font-medium text-muted-foreground capitalize">
          {opp.funding_type.replace(/_/g, " ")}
        </span>
        {opp.max_award && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-background/60 border border-border/60 text-[10px] font-medium text-muted-foreground">
            <TrendingUp className="h-2.5 w-2.5" /> Up to ${opp.max_award.toLocaleString()}
          </span>
        )}
        {opp.close_date && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-medium ${isExpired(opp.close_date) ? "bg-red-50 border-red-200 text-red-500 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400" : "bg-background/60 border-border/60 text-muted-foreground"}`}>
            <Clock className="h-2.5 w-2.5" />
            {isExpired(opp.close_date) ? "Expired" : `Closes ${new Date(opp.close_date).toLocaleDateString()}`}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-black/5 dark:border-white/5">
        <button onClick={onSave}
          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl transition-all ${isSaved
            ? "bg-primary text-primary-foreground shadow-sm"
            : "bg-background/80 border border-border/60 text-muted-foreground hover:border-primary/40 hover:text-primary"}`}>
          {isSaved ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
          {isSaved ? "Saved" : "Save"}
        </button>
        <button onClick={onApply}
          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl transition-all ${isApplied
            ? "bg-emerald-500 text-white shadow-sm"
            : "bg-background/80 border border-border/60 text-muted-foreground hover:border-emerald-400/50 hover:text-emerald-600"}`}>
          {isApplied ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          {isApplied ? "Applied" : "Mark Applied"}
        </button>
        {opp.url && (
          <a href={opp.url} target="_blank" rel="noopener noreferrer" onClick={onView}
            className="ml-auto flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            View <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Saved Entry Card ─────────────────────────────────────────────────────────
function SavedEntryCard({ id, entry, onRemove, onToggleApplied, onSetOutcome, onView }: {
  id: string; entry: OppEntry; onRemove: () => void;
  onToggleApplied: () => void; onSetOutcome: (o: OppOutcome) => void; onView: () => void;
}) {
  const expired = isExpired(entry.closeDate);
  const isApplied = entry.status === "applied";
  const outcome = entry.outcome;
  const sl = scoreLabel(entry.score ?? 0);

  return (
    <div className={`border rounded-2xl p-4 space-y-3 bg-background transition-all ${expired ? "opacity-60" : "hover:shadow-sm"}`}>
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-10 h-10 rounded-xl ${sl.bg} flex flex-col items-center justify-center text-white shadow-sm`}>
          <span className="text-sm font-black leading-none">{Math.round(entry.score ?? 0)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <Badge className={`text-[10px] px-1.5 py-0 border-0 ${isApplied ? "bg-emerald-500" : "bg-primary"} text-white`}>
              {isApplied ? "✓ Applied" : "Saved"}
            </Badge>
            {expired && <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-red-300 text-red-500">Expired</Badge>}
            {outcome === "win" && <Badge className="text-[10px] px-1.5 py-0 bg-emerald-500 text-white border-0">🏆 Won</Badge>}
            {outcome === "loss" && <Badge className="text-[10px] px-1.5 py-0 bg-slate-500 text-white border-0">✗ Not Awarded</Badge>}
          </div>
          <h4 className="text-sm font-semibold text-foreground leading-snug">{entry.title}</h4>
          {entry.agency && <p className="text-xs text-muted-foreground">{entry.agency}</p>}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-muted border border-border/50 text-[10px] font-medium text-muted-foreground capitalize">{entry.source.replace(/_/g, " ")}</span>
        {entry.maxAward && <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-muted border border-border/50 text-[10px] font-medium text-muted-foreground">Up to ${entry.maxAward.toLocaleString()}</span>}
        {entry.closeDate && <span className={`inline-flex items-center px-2 py-0.5 rounded-lg border text-[10px] font-medium ${expired ? "bg-red-50 border-red-200 text-red-500" : "bg-muted border-border/50 text-muted-foreground"}`}>
          {expired ? "⚠ Expired" : "Closes"} {new Date(entry.closeDate).toLocaleDateString()}
        </span>}
      </div>

      <div className="space-y-2 pt-1 border-t border-border/30">
        <div className="flex items-center gap-2 flex-wrap">
          {entry.url && <a href={entry.url} target="_blank" rel="noopener noreferrer" onClick={onView} className="flex items-center gap-1 text-xs text-primary hover:underline font-medium">View <ExternalLink className="h-3 w-3" /></a>}
          <button onClick={onToggleApplied} className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg transition-all ${isApplied ? "bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400" : "border border-border/60 text-muted-foreground hover:border-emerald-300 hover:text-emerald-600"}`}>
            {isApplied ? <CheckSquare className="h-3 w-3" /> : <Square className="h-3 w-3" />}
            {isApplied ? "Applied" : "Mark Applied"}
          </button>
          <button onClick={onRemove} className="ml-auto text-xs text-muted-foreground hover:text-red-500 transition-colors flex items-center gap-1">
            <X className="h-3 w-3" /> Remove
          </button>
        </div>
        {isApplied && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-medium">Outcome:</span>
            <button onClick={() => onSetOutcome("win")} className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-all ${outcome === "win" ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400" : "border-border/60 text-muted-foreground hover:border-emerald-300 hover:text-emerald-600"}`}>
              <ThumbsUp className="h-3 w-3" /> Win
            </button>
            <button onClick={() => onSetOutcome("loss")} className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-all ${outcome === "loss" ? "border-slate-400 bg-slate-50 dark:bg-slate-900/40 text-slate-600 dark:text-slate-400" : "border-border/60 text-muted-foreground hover:border-slate-300 hover:text-slate-600"}`}>
              <ThumbsDown className="h-3 w-3" /> Loss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ViewedEntryCard({ id, entry, savedStatus }: { id: string; entry: ViewedEntry; savedStatus?: OppStatus }) {
  return (
    <div className="border rounded-2xl p-4 space-y-2 bg-background hover:shadow-sm transition-all">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-8 h-8 rounded-xl bg-muted flex items-center justify-center">
          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border/50 text-muted-foreground">Viewed</Badge>
            {savedStatus === "saved" && <Badge className="text-[10px] px-1.5 py-0 bg-primary text-white border-0">Saved</Badge>}
            {savedStatus === "applied" && <Badge className="text-[10px] px-1.5 py-0 bg-emerald-500 text-white border-0">✓ Applied</Badge>}
          </div>
          <h4 className="text-sm font-semibold text-foreground leading-snug">{entry.title}</h4>
          {entry.agency && <p className="text-xs text-muted-foreground">{entry.agency}</p>}
        </div>
        {entry.score !== undefined && (
          <div className={`shrink-0 w-9 h-9 rounded-xl ${scoreLabel(entry.score).bg} flex items-center justify-center text-white text-xs font-black shadow-sm`}>
            {Math.round(entry.score)}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-muted border border-border/50 text-[10px] font-medium text-muted-foreground capitalize">{entry.source.replace(/_/g, " ")}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{new Date(entry.viewedAt).toLocaleDateString()}</span>
        {entry.url && <a href={entry.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline font-medium">View <ExternalLink className="h-3 w-3" /></a>}
      </div>
    </div>
  );
}

// ─── Saved Panel ──────────────────────────────────────────────────────────────
type SavedFilter = "saved" | "applied" | "inactive" | "viewed";

function SavedPanel({ statuses, viewedItems, onRemove, onToggleApplied, onSetOutcome, onView, onClose }: {
  statuses: Record<string, OppEntry>; viewedItems: Record<string, ViewedEntry>;
  onRemove: (id: string) => void; onToggleApplied: (id: string, entry: OppEntry) => void;
  onSetOutcome: (id: string, o: OppOutcome) => void; onView: (id: string, e: ViewedEntry) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<SavedFilter>("saved");
  const se = Object.entries(statuses);
  const ve = Object.entries(viewedItems).sort(([, a], [, b]) => b.viewedAt - a.viewedAt);

  const counts = {
    saved:    se.filter(([, e]) => e.status === "saved" && !isExpired(e.closeDate)).length,
    applied:  se.filter(([, e]) => e.status === "applied" && !isExpired(e.closeDate)).length,
    inactive: se.filter(([, e]) => isExpired(e.closeDate)).length,
    viewed:   ve.length,
  };

  const filtered = se.filter(([, e]) => {
    if (filter === "saved") return e.status === "saved" && !isExpired(e.closeDate);
    if (filter === "applied") return e.status === "applied" && !isExpired(e.closeDate);
    if (filter === "inactive") return isExpired(e.closeDate);
    return false;
  });

  const tabs: { key: SavedFilter; label: string; icon: React.ReactNode }[] = [
    { key: "saved",    label: "Saved",    icon: <Bookmark className="h-3.5 w-3.5" /> },
    { key: "applied",  label: "Applied",  icon: <CheckSquare className="h-3.5 w-3.5" /> },
    { key: "inactive", label: "Inactive", icon: <Clock className="h-3.5 w-3.5" /> },
    { key: "viewed",   label: "Viewed",   icon: <Eye className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-background border-l border-border shadow-2xl flex flex-col h-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <Inbox className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">My Opportunities</h2>
              <p className="text-[11px] text-muted-foreground">{se.length} total tracked</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex border-b border-border/60 shrink-0 bg-muted/20">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setFilter(t.key)}
              className={`flex-1 flex items-center justify-center gap-1 py-3 text-[11px] font-medium transition-all border-b-2 ${filter === t.key ? "border-primary text-primary bg-background" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-background/50"}`}>
              {t.icon}
              <span className="hidden sm:inline">{t.label}</span>
              {counts[t.key] > 0 && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${filter === t.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{counts[t.key]}</span>}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filter === "viewed" ? (
            ve.length === 0
              ? <div className="flex flex-col items-center justify-center h-full text-center py-16 gap-3">
                  <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center"><Eye className="h-7 w-7 text-muted-foreground/40" /></div>
                  <p className="text-sm text-muted-foreground">Click "View" on any matched grant<br />to track it here.</p>
                </div>
              : ve.map(([id, e]) => <ViewedEntryCard key={id} id={id} entry={e} savedStatus={statuses[id]?.status} />)
          ) : (
            filtered.length === 0
              ? <div className="flex flex-col items-center justify-center h-full text-center py-16 gap-3">
                  <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                    {filter === "saved" && <Bookmark className="h-7 w-7 text-muted-foreground/40" />}
                    {filter === "applied" && <CheckSquare className="h-7 w-7 text-muted-foreground/40" />}
                    {filter === "inactive" && <Clock className="h-7 w-7 text-muted-foreground/40" />}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {filter === "saved" && "No saved opportunities yet."}
                    {filter === "applied" && "No applied opportunities yet."}
                    {filter === "inactive" && "No expired opportunities."}
                  </p>
                </div>
              : filtered.map(([id, e]) => (
                  <SavedEntryCard key={id} id={id} entry={e}
                    onRemove={() => onRemove(id)}
                    onToggleApplied={() => onToggleApplied(id, e)}
                    onSetOutcome={(o) => onSetOutcome(id, o)}
                    onView={() => onView(id, { title: e.title, agency: e.agency, url: e.url, source: e.source, score: e.score, viewedAt: Date.now() })}
                  />
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
    try { await updateProfile(profile); onClose(); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Organization Profile</h2>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                user?.role === "admin"
                  ? "bg-amber-500/20 text-amber-700 dark:text-amber-400"
                  : "bg-muted text-muted-foreground"
              }`}>
                {user?.role === "admin" ? "Admin" : "User"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-xs text-red-500 hover:text-red-600 hover:bg-red-50 gap-1.5" onClick={() => { logout(); onClose(); }}>
              <LogOut className="h-3.5 w-3.5" /> Sign Out
            </Button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted transition-colors"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-5">
          <OrgProfileForm initial={user?.org_profile} onSave={handleSave} onCancel={onClose} saving={saving} saveLabel="Save Changes" />
        </div>
      </div>
    </div>
  );
}

type ResultFilter = "all" | "saved" | "applied" | "inactive";

// ─── V3 Panel ─────────────────────────────────────────────────────────────────
function V3Panel({ statuses, onSave, onApply, onView }: {
  statuses: Record<string, OppEntry>;
  onSave: (t: V3ScoreTrace) => void;
  onApply: (t: V3ScoreTrace) => void;
  onView: (t: V3ScoreTrace) => void;
}) {
  const { user } = useAuth();
  const [v3Running, setV3Running] = useState(false);
  const [v3Results, setV3Results] = useState<V3ScoreTrace[]>([]);
  const [v3Page, setV3Page] = useState(0);
  const [v3Error, setV3Error] = useState("");
  const [v3Ran, setV3Ran] = useState(false);
  const [totalFound, setTotalFound] = useState(0);
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const resultsRef = useRef<HTMLDivElement>(null);

  async function runV3() {
    if (!user?.org_profile) { setV3Error("Please complete your organization profile first."); return; }
    setV3Running(true); setV3Error(""); setV3Results([]); setV3Page(0); setResultFilter("all");
    try {
      // Use shared poolLoader — identical data pipeline as AlgorithmAudit
      const pool = await loadOpportunityPool(API);
      const profile = coerceOrgProfile(user.org_profile, user.id);
      const allResults = getTopMatchesV3(profile, pool, 200);
      setTotalFound(allResults.length); setV3Results(allResults); setV3Ran(true);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch { setV3Error("Failed to load opportunity pool. Please try again."); }
    finally { setV3Running(false); }
  }

  const filteredResults = v3Results.filter((t) => {
    const e = statuses[t.opp.id]; const exp = isExpired(t.opp.close_date);
    if (resultFilter === "saved") return e?.status === "saved" && !exp;
    if (resultFilter === "applied") return e?.status === "applied" && !exp;
    if (resultFilter === "inactive") return exp;
    return !exp;
  });
  const pagedResults = filteredResults.slice(0, (v3Page + 1) * PAGE_SIZE);
  const hasMore = pagedResults.length < filteredResults.length;

  const filterCounts = {
    all: v3Results.filter((t) => !isExpired(t.opp.close_date)).length,
    saved: v3Results.filter((t) => statuses[t.opp.id]?.status === "saved" && !isExpired(t.opp.close_date)).length,
    applied: v3Results.filter((t) => statuses[t.opp.id]?.status === "applied" && !isExpired(t.opp.close_date)).length,
    inactive: v3Results.filter((t) => isExpired(t.opp.close_date)).length,
  };

  const scoreGroups = v3Ran ? {
    excellent: v3Results.filter((t) => t.finalScore >= 80).length,
    strong: v3Results.filter((t) => t.finalScore >= 60 && t.finalScore < 80).length,
    moderate: v3Results.filter((t) => t.finalScore >= 40 && t.finalScore < 60).length,
  } : null;

  const filters: { key: ResultFilter; label: string; icon: React.ReactNode }[] = [
    { key: "all",      label: "All Matches",  icon: <Target className="h-3 w-3" /> },
    { key: "saved",    label: "Saved",        icon: <Bookmark className="h-3 w-3" /> },
    { key: "applied",  label: "Applied",      icon: <CheckSquare className="h-3 w-3" /> },
    { key: "inactive", label: "Expired",      icon: <Clock className="h-3 w-3" /> },
  ];

  // Pre-run state
  if (!v3Ran && !v3Error) {
    return (
      <div className="rounded-3xl border border-border/60 bg-gradient-to-br from-primary/5 via-background to-blue-500/5 overflow-hidden">
        <div className="p-8 md:p-10 flex flex-col md:flex-row items-center gap-8">
          <div className="flex-1 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground">AI Grant Matching</h2>
                <p className="text-xs text-muted-foreground">Powered by V3 RankFix algorithm</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-md">
              {user?.org_profile
                ? `Scan 200+ live opportunities and rank them by fit for ${(user.org_profile as any).name || "your organization"} using your profile data.`
                : "Complete your organization profile to unlock personalized grant matching."}
            </p>
            <div className="flex items-center gap-3">
              <Button onClick={runV3} disabled={v3Running || !user?.org_profile} size="lg" className="gap-2 shadow-sm">
                <Sparkles className="h-4 w-4" />
                Run AI Matching
              </Button>
              {!user?.org_profile && (
                <p className="text-xs text-muted-foreground">Profile required</p>
              )}
            </div>
          </div>
          <div className="shrink-0 grid grid-cols-3 gap-3">
            {[
              { label: "Sources", value: "4", icon: <Database className="h-4 w-4" />, color: "text-blue-500" },
              { label: "Max Results", value: "200", icon: <BarChart3 className="h-4 w-4" />, color: "text-emerald-500" },
              { label: "Algorithm", value: "V3", icon: <Zap className="h-4 w-4" />, color: "text-amber-500" },
            ].map((s) => (
              <div key={s.label} className="text-center px-4 py-3 rounded-2xl bg-background/70 border border-border/50 shadow-sm">
                <div className={`flex justify-center mb-1 ${s.color}`}>{s.icon}</div>
                <div className="text-xl font-black text-foreground">{s.value}</div>
                <div className="text-[10px] text-muted-foreground font-medium">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (v3Running) {
    return (
      <div className="rounded-3xl border border-border/60 bg-muted/20 p-12 flex flex-col items-center gap-4 text-center">
        <div className="w-16 h-16 rounded-3xl bg-primary/10 flex items-center justify-center">
          <Sparkles className="h-7 w-7 text-primary animate-pulse" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">Analyzing opportunities…</h3>
          <p className="text-sm text-muted-foreground mt-1">Scoring against your organization profile</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" /> Running V3 RankFix
        </div>
      </div>
    );
  }

  // Error state
  if (v3Error) {
    return (
      <div className="rounded-3xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-8 flex flex-col items-center gap-4 text-center">
        <AlertCircle className="h-8 w-8 text-red-500" />
        <div>
          <h3 className="font-semibold text-foreground">Matching failed</h3>
          <p className="text-sm text-red-600 dark:text-red-400 mt-1">{v3Error}</p>
        </div>
        <Button onClick={runV3} variant="outline" className="gap-2"><RefreshCw className="h-4 w-4" /> Try Again</Button>
      </div>
    );
  }

  // Results
  return (
    <div ref={resultsRef} className="space-y-6">
      {/* Results header + stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-bold text-foreground">Your Top Matches</h2>
            <Badge className="bg-primary/10 text-primary border border-primary/20 font-semibold text-[10px]">V3 AI-ranked</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{totalFound}</span> grants scored for{" "}
            <span className="font-semibold text-foreground">{(user?.org_profile as any)?.name || "your org"}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {scoreGroups && (
            <>
              <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 font-medium">
                <Star className="h-3 w-3" /> {scoreGroups.excellent} excellent
              </div>
              <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 font-medium">
                <TrendingUp className="h-3 w-3" /> {scoreGroups.strong} strong
              </div>
            </>
          )}
          <Button variant="outline" size="sm" className="gap-1.5 ml-auto" onClick={runV3} disabled={v3Running}>
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 p-1 bg-muted/40 rounded-2xl w-fit border border-border/50">
        {filters.map((f) => (
          <button key={f.key} onClick={() => { setResultFilter(f.key); setV3Page(0); }}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all ${resultFilter === f.key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {f.icon} {f.label}
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${resultFilter === f.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{filterCounts[f.key]}</span>
          </button>
        ))}
      </div>

      {pagedResults.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-3">
            <Target className="h-6 w-6 opacity-40" />
          </div>
          <p className="text-sm">{resultFilter === "all" ? "No active matching grants found." : `No ${resultFilter} grants in your results.`}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {pagedResults.map((trace) => (
            <GrantCard key={trace.opp.id} trace={trace} rank={filteredResults.indexOf(trace) + 1}
              entry={statuses[trace.opp.id]}
              onSave={() => onSave(trace)} onApply={() => onApply(trace)} onView={() => onView(trace)} />
          ))}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" className="gap-2 rounded-xl" onClick={() => setV3Page((p) => p + 1)}>
            Load {Math.min(PAGE_SIZE, filteredResults.length - pagedResults.length)} more results
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Home ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const { user } = useAuth();
  const isAdmin = user?.is_admin === true;

  const [showProfile, setShowProfile] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [adminViewMode, setAdminViewMode] = useState<"admin" | "user">("admin");

  const { statuses, viewedItems, setStatus, setOutcome, removeStatus, addViewed } = useOppStatus(user?.id);
  const totalSaved = Object.keys(statuses).length;

  function handleSave(trace: V3ScoreTrace) {
    const opp = trace.opp;
    setStatus(opp.id, "saved", { title: opp.title, agency: opp.agency, score: trace.finalScore, url: opp.url, source: opp.source, fundingType: opp.funding_type, maxAward: opp.max_award, closeDate: opp.close_date });
  }
  function handleApply(trace: V3ScoreTrace) {
    const opp = trace.opp;
    setStatus(opp.id, "applied", { title: opp.title, agency: opp.agency, score: trace.finalScore, url: opp.url, source: opp.source, fundingType: opp.funding_type, maxAward: opp.max_award, closeDate: opp.close_date });
  }
  function handleView(trace: V3ScoreTrace) {
    addViewed(trace.opp.id, { title: trace.opp.title, agency: trace.opp.agency, url: trace.opp.url, source: trace.opp.source, score: trace.finalScore, viewedAt: Date.now() });
  }

  // Adapters for GrantItem save/apply (SourceTabs explorer cards)
  function handleSaveGrant(grant: ExplorerGrant) {
    if (!grant.id) return;
    const cur = statuses[grant.id]?.status;
    if (cur === "saved") { removeStatus(grant.id); return; }
    setStatus(grant.id, "saved", { title: grant.title ?? "", agency: grant.agency ?? "", url: grant.url ?? "", source: grant.source ?? "", fundingType: "grant", closeDate: grant.deadline ?? undefined });
  }
  function handleApplyGrant(grant: ExplorerGrant) {
    if (!grant.id) return;
    const cur = statuses[grant.id]?.status;
    if (cur === "applied") { removeStatus(grant.id); return; }
    setStatus(grant.id, "applied", { title: grant.title ?? "", agency: grant.agency ?? "", url: grant.url ?? "", source: grant.source ?? "", fundingType: "grant", closeDate: grant.deadline ?? undefined });
  }

  // Map OppEntry statuses to GrantStatus for explorer cards
  const explorerStatuses: Record<string, "saved" | "applied" | "won" | null> = Object.fromEntries(
    Object.entries(statuses).map(([id, e]) => [
      id,
      e.status === "saved" || e.status === "applied" ? e.status : null,
    ])
  );

  const savedCount   = Object.values(statuses).filter((e) => e.status === "saved").length;
  const appliedCount = Object.values(statuses).filter((e) => e.status === "applied").length;
  const wonCount     = Object.values(statuses).filter((e) => e.outcome === "win").length;
  const orgName      = (user?.org_profile as any)?.name as string | undefined;
  const orgType      = (user?.org_profile as any)?.org_type as string | undefined;

  return (
    <div className="min-h-screen w-full bg-background">
      {showProfile  && <ProfileModal onClose={() => setShowProfile(false)} />}
      {showAddAdmin && <AddAdminModal onClose={() => setShowAddAdmin(false)} />}
      {showSaved && (
        <SavedPanel
          statuses={statuses} viewedItems={viewedItems}
          onRemove={removeStatus}
          onToggleApplied={(id, e) => { const n: OppStatus = e.status === "applied" ? "saved" : "applied"; setStatus(id, n, e); }}
          onSetOutcome={setOutcome}
          onView={(id, e) => addViewed(id, e)}
          onClose={() => setShowSaved(false)}
        />
      )}

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/95 backdrop-blur-md shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shadow-sm">
              <LayoutDashboard className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="font-bold text-sm text-foreground">Grants Explorer</span>
            {isAdmin && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700">
                Admin
              </span>
            )}
          </div>

          {/* Center: admin view toggle */}
          {isAdmin && (
            <div className="flex items-center border border-border/60 rounded-xl p-1 bg-muted/30 gap-0.5">
              <button onClick={() => setAdminViewMode("admin")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${adminViewMode === "admin" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                <ShieldAlert className="h-3 w-3" /> Admin View
              </button>
              <button onClick={() => setAdminViewMode("user")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${adminViewMode === "user" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                <Users className="h-3 w-3" /> User Preview
              </button>
            </div>
          )}

          {/* Right actions */}
          <div className="flex items-center gap-2">
            {isAdmin && adminViewMode === "admin" && (
              <>
                <Link href="/indexing">
                  <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                    <Database className="h-3.5 w-3.5" /> Indexing
                  </Button>
                </Link>
                <Link href="/audit">
                  <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                    <BookOpen className="h-3.5 w-3.5" /> Audit
                  </Button>
                </Link>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs font-semibold border-primary/30 text-primary hover:bg-primary/5"
                  onClick={() => setShowAddAdmin(true)}>
                  <UserPlus className="h-3.5 w-3.5" /> Add Admin
                </Button>
              </>
            )}

            <button onClick={() => setShowSaved(true)}
              className="relative flex items-center gap-1.5 h-8 px-3 rounded-xl border border-border/60 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/50 transition-all">
              <Inbox className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Saved</span>
              {totalSaved > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center font-bold shadow-sm">
                  {totalSaved > 9 ? "9+" : totalSaved}
                </span>
              )}
            </button>

            <button onClick={() => setShowProfile(true)}
              className="flex items-center gap-2 h-8 px-2.5 rounded-xl bg-primary/10 border border-primary/20 hover:bg-primary/20 transition-all">
              <span className="text-primary font-bold text-xs leading-none">
                {user?.email ? initials(user.email) : <User className="h-3.5 w-3.5" />}
              </span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none ${
                user?.role === "admin"
                  ? "bg-amber-500/20 text-amber-700 dark:text-amber-400"
                  : "bg-muted text-muted-foreground"
              }`}>
                {user?.role === "admin" ? "Admin" : "User"}
              </span>
            </button>
          </div>
        </div>
      </nav>

      {/* ── Admin tools bar ── */}
      {isAdmin && adminViewMode === "admin" && (
        <div className="bg-amber-50/80 dark:bg-amber-950/20 border-b border-amber-200/60 dark:border-amber-800/40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                <span className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide">Admin Console</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Link href="/indexing">
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs bg-background border-border/60 hover:bg-muted">
                    <Database className="h-3 w-3" /> Indexing Tool
                  </Button>
                </Link>
                <Link href="/audit">
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs bg-background border-border/60 hover:bg-muted">
                    <BookOpen className="h-3 w-3" /> Algorithm Audit
                  </Button>
                </Link>
                <Link href="/algorithm">
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs bg-background border-border/60 hover:bg-muted">
                    <Sparkles className="h-3 w-3" /> Algorithm V1
                  </Button>
                </Link>
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs bg-background border-primary/30 text-primary hover:bg-primary/5"
                  onClick={() => setShowAddAdmin(true)}>
                  <UserPlus className="h-3 w-3" /> Add Admin
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Welcome strip ── */}
      <div className="border-b border-border/40 bg-muted/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-xl font-bold text-foreground">
                {orgName ? `Welcome back, ${orgName}` : "Welcome to Grants Explorer"}
              </h1>
              <div className="flex items-center gap-2 flex-wrap">
                {orgType && (
                  <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 capitalize">
                    {orgType.replace(/_/g, " ")}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{user?.email}</span>
              </div>
            </div>
            {/* Quick stats */}
            <div className="flex items-center gap-3">
              {[
                { label: "Saved", value: savedCount, color: "text-primary bg-primary/10 border-primary/20" },
                { label: "Applied", value: appliedCount, color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800" },
                { label: "Won", value: wonCount, color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" },
              ].map((s) => (
                <div key={s.label} className={`flex flex-col items-center px-4 py-2 rounded-2xl border ${s.color} min-w-[60px]`}>
                  <span className="text-lg font-black leading-none">{s.value}</span>
                  <span className="text-[10px] font-medium opacity-80 mt-0.5">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Main sections ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16 py-10 pb-24">

        {/* V3 Matching */}
        <section>
          <V3Panel statuses={statuses} onSave={handleSave} onApply={handleApply} onView={handleView} />
        </section>

        {/* Source browser */}
        <section>
          <SourceTabs
            statuses={explorerStatuses}
            onSave={handleSaveGrant}
            onApply={handleApplyGrant}
          />
        </section>
      </div>

      {/* Footer */}
      <footer className="border-t border-border/40 bg-muted/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col md:flex-row justify-between items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2 font-medium">
            <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center">
              <LayoutDashboard className="h-3 w-3 text-primary" />
            </div>
            Grants Explorer &copy; {new Date().getFullYear()}
          </div>
          <p>Aggregating open government data for public benefit.</p>
        </div>
      </footer>
    </div>
  );
}
