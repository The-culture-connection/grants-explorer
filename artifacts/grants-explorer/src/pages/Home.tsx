import React, { useState, useRef, useCallback } from "react";
import { Link } from "wouter";
import { SourceTabs } from "@/components/SourceTabs";
import {
  LayoutDashboard, Sparkles, RefreshCw, User, LogOut,
  ChevronRight, ExternalLink, Trophy, AlertCircle, X, Bookmark,
  BookmarkCheck, CheckSquare, Square, Inbox, Clock, Filter, Eye,
  Home as HomeIcon, ThumbsUp, ThumbsDown, Database, BookOpen,
  ShieldAlert, UserPlus, Users, Check
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

// ─── Types ────────────────────────────────────────────────────────────────────

type OppStatus = "saved" | "applied";
type OppOutcome = "win" | "loss";

interface OppEntry {
  status: OppStatus;
  outcome?: OppOutcome;
  title: string;
  agency: string;
  score: number;
  url: string;
  source: string;
  fundingType: string;
  maxAward?: number;
  closeDate?: string;
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

function useOppStatus(userId: number | undefined) {
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

function dbRecordToOpportunity(rec: any): NormalizedOpportunity {
  return {
    id: rec.id ?? rec.external_id ?? String(Math.random()),
    source: rec.source ?? "unknown", source_raw: rec.source_raw ?? rec.source ?? "",
    title: rec.title ?? "", description: rec.description ?? "",
    agency: rec.agency ?? rec.organization ?? "", funding_type: rec.funding_type ?? "grant",
    status: rec.status ?? "active", open_date: rec.open_date ?? rec.posted_date,
    close_date: rec.close_date ?? rec.deadline, min_award: rec.min_award ?? rec.award_floor,
    max_award: rec.max_award ?? rec.award_ceiling ?? rec.funding_amount,
    eligibility: Array.isArray(rec.eligibility) ? rec.eligibility : [],
    categories: Array.isArray(rec.categories) ? rec.categories : [],
    keywords: Array.isArray(rec.keywords) ? rec.keywords : [],
    geography: Array.isArray(rec.geography) ? rec.geography : [],
    url: rec.url ?? "",
  };
}

function scoreColor(s: number) {
  if (s >= 75) return "text-emerald-600 dark:text-emerald-400";
  if (s >= 50) return "text-blue-600 dark:text-blue-400";
  if (s >= 30) return "text-yellow-600 dark:text-yellow-400";
  return "text-muted-foreground";
}

function scoreBg(s: number) {
  if (s >= 75) return "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800";
  if (s >= 50) return "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800";
  if (s >= 30) return "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800";
  return "bg-muted/30 border-border/40";
}

function isExpired(d?: string) { return d ? new Date(d) < new Date() : false; }

// ─── Admin: Add Admin Modal ───────────────────────────────────────────────────

function AddAdminModal({ onClose }: { onClose: () => void }) {
  const { token } = useAuth();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    try {
      const r = await fetch(`${API}/auth/admin/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email }),
      });
      const data = await r.json();
      if (!r.ok) { setMsg(data.error || "Failed"); setStatus("error"); }
      else { setMsg(data.message || `${email} is now an admin`); setStatus("ok"); setEmail(""); }
    } catch { setMsg("Network error"); setStatus("error"); }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Add Admin</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground">Enter the email of an existing user to grant them admin access.</p>
        <form onSubmit={submit} className="space-y-3">
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {msg && (
            <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${status === "ok" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-600 border border-red-200"}`}>
              {status === "ok" ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
              {msg}
            </div>
          )}
          <Button type="submit" size="sm" className="w-full" disabled={status === "loading"}>
            {status === "loading" ? <><RefreshCw className="h-3 w-3 animate-spin mr-1.5" />Granting…</> : "Grant Admin Access"}
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
  const opp = trace.opp; const score = Math.round(trace.finalScore);
  const isSaved = entry?.status === "saved"; const isApplied = entry?.status === "applied";
  return (
    <div className={`border rounded-xl p-5 space-y-3 transition-all hover:shadow-md ${scoreBg(score)}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold
            ${score >= 75 ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300"
              : score >= 50 ? "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300"
              : "bg-muted text-muted-foreground"}`}>#{rank}</div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground leading-snug">{opp.title || "Untitled"}</h3>
            {opp.agency && <p className="text-xs text-muted-foreground mt-0.5">{opp.agency}</p>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-2xl font-black ${scoreColor(score)}`}>{score}</div>
          <div className="text-[10px] text-muted-foreground">/ 100</div>
        </div>
      </div>
      {opp.description && <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{opp.description}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{opp.source.replace(/_/g, " ")}</Badge>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{opp.funding_type.replace(/_/g, " ")}</Badge>
        {opp.max_award && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Up to ${opp.max_award.toLocaleString()}</Badge>}
        {opp.close_date && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Closes {new Date(opp.close_date).toLocaleDateString()}</Badge>}
      </div>
      <div className="flex items-center gap-2 pt-1 border-t border-border/30 flex-wrap">
        <button onClick={onSave} className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${isSaved ? "border-primary/40 bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:border-primary/30 hover:text-primary"}`}>
          {isSaved ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
          {isSaved ? "Saved" : "Save"}
        </button>
        <button onClick={onApply} className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${isApplied ? "border-emerald-400/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400" : "border-border/50 text-muted-foreground hover:border-emerald-400/40 hover:text-emerald-600"}`}>
          {isApplied ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          {isApplied ? "Applied" : "Mark Applied"}
        </button>
        {opp.url && (
          <a href={opp.url} target="_blank" rel="noopener noreferrer" onClick={onView}
            className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline font-medium">
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
  const expired = isExpired(entry.closeDate); const isApplied = entry.status === "applied"; const outcome = entry.outcome;
  return (
    <div className={`border rounded-xl p-4 space-y-2.5 bg-background ${expired ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${isApplied ? "border-emerald-400/60 text-emerald-600 dark:text-emerald-400" : "border-primary/40 text-primary"}`}>
              {isApplied ? "✓ Applied" : "Saved"}
            </Badge>
            {expired && <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-red-300 text-red-500">Expired</Badge>}
            {outcome === "win" && <Badge className="text-[10px] px-1.5 py-0 bg-emerald-500 text-white border-0">🏆 Won</Badge>}
            {outcome === "loss" && <Badge className="text-[10px] px-1.5 py-0 bg-red-500 text-white border-0">✗ Not Awarded</Badge>}
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
        {entry.maxAward && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Up to ${entry.maxAward.toLocaleString()}</Badge>}
        {entry.closeDate && <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${expired ? "border-red-300 text-red-500" : ""}`}>
          {expired ? "⚠ Expired" : "Closes"} {new Date(entry.closeDate).toLocaleDateString()}
        </Badge>}
      </div>
      <div className="space-y-2 pt-1 border-t border-border/30">
        <div className="flex items-center gap-2 flex-wrap">
          {entry.url && <a href={entry.url} target="_blank" rel="noopener noreferrer" onClick={onView} className="flex items-center gap-1 text-xs text-primary hover:underline font-medium">View <ExternalLink className="h-3 w-3" /></a>}
          <button onClick={onToggleApplied} className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border transition-all ${isApplied ? "border-emerald-400/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400" : "border-border/50 text-muted-foreground hover:border-emerald-400/40 hover:text-emerald-600"}`}>
            {isApplied ? <CheckSquare className="h-3 w-3" /> : <Square className="h-3 w-3" />}
            {isApplied ? "Applied" : "Mark Applied"}
          </button>
          <button onClick={onRemove} className="ml-auto text-xs text-muted-foreground hover:text-red-500 transition-colors flex items-center gap-1"><X className="h-3 w-3" /> Remove</button>
        </div>
        {isApplied && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-medium">Outcome:</span>
            <button onClick={() => onSetOutcome("win")} className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-all ${outcome === "win" ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400" : "border-border/50 text-muted-foreground hover:border-emerald-400/50 hover:text-emerald-600"}`}>
              <ThumbsUp className="h-3 w-3" /> Win
            </button>
            <button onClick={() => onSetOutcome("loss")} className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-all ${outcome === "loss" ? "border-red-400 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400" : "border-border/50 text-muted-foreground hover:border-red-400/50 hover:text-red-600"}`}>
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
    <div className="border rounded-xl p-4 space-y-2 bg-background">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border/50 text-muted-foreground"><Eye className="h-2.5 w-2.5 mr-1 inline" />Viewed</Badge>
            {savedStatus === "saved" && <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/40 text-primary">Saved</Badge>}
            {savedStatus === "applied" && <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-400/60 text-emerald-600">✓ Applied</Badge>}
          </div>
          <h4 className="text-sm font-semibold text-foreground leading-snug">{entry.title}</h4>
          {entry.agency && <p className="text-xs text-muted-foreground">{entry.agency}</p>}
        </div>
        {entry.score !== undefined && (
          <div className="shrink-0 text-right">
            <div className={`text-xl font-black ${scoreColor(entry.score)}`}>{Math.round(entry.score)}</div>
            <div className="text-[10px] text-muted-foreground">/ 100</div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{entry.source.replace(/_/g, " ")}</Badge>
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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-background border-l border-border shadow-2xl flex flex-col h-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">My Opportunities</h2>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{se.length}</Badge>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex border-b border-border/60 shrink-0">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setFilter(t.key)}
              className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-all border-b-2 ${filter === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {t.icon}
              <span className="hidden sm:inline">{t.label}</span>
              {counts[t.key] > 0 && <span className={`text-[10px] px-1 rounded-full ${filter === t.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{counts[t.key]}</span>}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filter === "viewed" ? (
            ve.length === 0
              ? <div className="flex flex-col items-center justify-center h-full text-center py-16 gap-3 text-muted-foreground"><Eye className="h-10 w-10 opacity-20" /><p className="text-sm">Click "View" on any matched grant to track it here.</p></div>
              : ve.map(([id, e]) => <ViewedEntryCard key={id} id={id} entry={e} savedStatus={statuses[id]?.status} />)
          ) : (
            filtered.length === 0
              ? <div className="flex flex-col items-center justify-center h-full text-center py-16 gap-3 text-muted-foreground">
                  {filter === "saved" && <><Bookmark className="h-10 w-10 opacity-20" /><p className="text-sm">No saved opportunities yet.</p></>}
                  {filter === "applied" && <><CheckSquare className="h-10 w-10 opacity-20" /><p className="text-sm">No applied opportunities yet.</p></>}
                  {filter === "inactive" && <><Clock className="h-10 w-10 opacity-20" /><p className="text-sm">No expired opportunities in your list.</p></>}
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div><h2 className="text-sm font-semibold">Edit Organization Profile</h2><p className="text-xs text-muted-foreground">{user?.email}</p></div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="text-xs text-red-500 hover:text-red-600 hover:bg-red-50 gap-1" onClick={() => { logout(); onClose(); }}>
              <LogOut className="h-3.5 w-3.5" /> Sign Out
            </Button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-5">
          <OrgProfileForm initial={user?.org_profile} onSave={handleSave} onCancel={onClose} saving={saving} saveLabel="Save Changes" />
        </div>
      </div>
    </div>
  );
}

// ─── Result Filter Tab ────────────────────────────────────────────────────────

type ResultFilter = "all" | "saved" | "applied" | "inactive";

// ─── V3 Panel (shared by both admin + user views) ─────────────────────────────

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
    if (!user?.org_profile) { setV3Error("Please set up your organization profile first."); return; }
    setV3Running(true); setV3Error(""); setV3Results([]); setV3Page(0); setResultFilter("all");
    try {
      const r = await fetch(`${API}/indexing/records/for-algorithm`);
      const data = await r.json();
      const pool: NormalizedOpportunity[] = (data.records ?? []).map(dbRecordToOpportunity).filter((o: NormalizedOpportunity) => ACTIVE_SOURCES.has(o.source));
      const allResults = getTopMatchesV3(user.org_profile as unknown as OrgProfile, pool, 200);
      setTotalFound(allResults.length); setV3Results(allResults); setV3Ran(true);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch { setV3Error("Failed to load opportunity pool."); }
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
  const filters: { key: ResultFilter; label: string; icon: React.ReactNode }[] = [
    { key: "all", label: "All", icon: <Filter className="h-3 w-3" /> },
    { key: "saved", label: "Saved", icon: <Bookmark className="h-3 w-3" /> },
    { key: "applied", label: "Applied", icon: <CheckSquare className="h-3 w-3" /> },
    { key: "inactive", label: "Inactive", icon: <Clock className="h-3 w-3" /> },
  ];

  return (
    <div className="space-y-5">
      {/* Run button row */}
      <div className="flex items-center gap-3">
        <Button onClick={runV3} disabled={v3Running} className="gap-2">
          {v3Running ? <><RefreshCw className="h-4 w-4 animate-spin" />Analyzing…</> : <><Sparkles className="h-4 w-4" />Run V3 Matches</>}
        </Button>
        {v3Ran && !v3Error && (
          <span className="text-xs text-muted-foreground">
            {totalFound} grants matched for <span className="font-medium text-foreground">{(user?.org_profile as any)?.name || "your org"}</span>
          </span>
        )}
      </div>

      {v3Error && (
        <div className="flex items-center gap-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" /> {v3Error}
        </div>
      )}

      {v3Ran && !v3Error && (
        <div ref={resultsRef} className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold text-foreground">V3 RankFix — Top Matches</h3>
              <Badge className="text-[10px] px-1.5">AI-ranked</Badge>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={runV3} disabled={v3Running}>
              <RefreshCw className={`h-3 w-3 ${v3Running ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
          {/* Filter tabs */}
          <div className="flex items-center gap-1 border border-border/60 rounded-xl p-1 bg-muted/30 w-fit">
            {filters.map((f) => (
              <button key={f.key} onClick={() => { setResultFilter(f.key); setV3Page(0); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${resultFilter === f.key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {f.icon} {f.label}
                <span className={`text-[10px] px-1 rounded-full ${resultFilter === f.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{filterCounts[f.key]}</span>
              </button>
            ))}
          </div>
          {pagedResults.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {resultFilter === "all" ? "No matching grants found." : `No ${resultFilter} grants in your results.`}
            </div>
          ) : (
            <div className="space-y-4">
              {pagedResults.map((trace) => (
                <GrantCard key={trace.opp.id} trace={trace} rank={filteredResults.indexOf(trace) + 1}
                  entry={statuses[trace.opp.id]}
                  onSave={() => onSave(trace)} onApply={() => onApply(trace)} onView={() => onView(trace)} />
              ))}
            </div>
          )}
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" className="gap-2" onClick={() => setV3Page((p) => p + 1)}>
                Load next {Math.min(PAGE_SIZE, filteredResults.length - pagedResults.length)} results <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {!v3Ran && !v3Error && (
        <div className="text-center py-10 text-muted-foreground">
          <p className="text-sm">{user?.org_profile ? "Click Run V3 Matches above to find personalized grants." : "Set up your organization profile to get matched grants."}</p>
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
  // Admin: "admin" view or "user" preview view
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

  // The user-facing content (same whether admin previewing or actual user)
  const userContent = (
    <div className="space-y-10">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <V3Panel statuses={statuses} onSave={handleSave} onApply={handleApply} onView={handleView} />
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <SourceTabs />
      </div>
    </div>
  );

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
      <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-semibold text-sm text-foreground shrink-0">
            <LayoutDashboard className="h-4 w-4 text-primary" />
            Grants Explorer
            {isAdmin && <Badge className="text-[9px] px-1.5 py-0 bg-primary/10 text-primary border border-primary/20 font-medium ml-1">Admin</Badge>}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto">
            {/* Admin-only view toggle */}
            {isAdmin && (
              <div className="flex items-center border border-border/60 rounded-lg p-0.5 bg-muted/30 shrink-0">
                <button onClick={() => setAdminViewMode("admin")}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${adminViewMode === "admin" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  <ShieldAlert className="h-3 w-3" /> Admin
                </button>
                <button onClick={() => setAdminViewMode("user")}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${adminViewMode === "user" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  <Users className="h-3 w-3" /> User View
                </button>
              </div>
            )}

            {/* Admin-only tool buttons */}
            {isAdmin && adminViewMode === "admin" && (
              <>
                <Link href="/indexing">
                  <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs px-2.5 shrink-0">
                    <Database className="h-3 w-3" /> Indexing
                  </Button>
                </Link>
                <Link href="/audit">
                  <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs px-2.5 shrink-0">
                    <BookOpen className="h-3 w-3" /> Audit
                  </Button>
                </Link>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs px-2.5 shrink-0 text-primary border-primary/40"
                  onClick={() => setShowAddAdmin(true)}>
                  <UserPlus className="h-3 w-3" /> Add Admin
                </Button>
              </>
            )}

            {/* Home link (non-admin, or admin in user view) */}
            {(!isAdmin || adminViewMode === "user") && (
              <Link href="/landing">
                <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs px-2.5 text-muted-foreground hover:text-foreground shrink-0">
                  <HomeIcon className="h-3 w-3" /> Home
                </Button>
              </Link>
            )}

            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs px-2.5 relative shrink-0"
              onClick={() => setShowSaved(true)}>
              <Inbox className="h-3 w-3" /> Saved
              {totalSaved > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] flex items-center justify-center font-bold">
                  {totalSaved > 9 ? "9+" : totalSaved}
                </span>
              )}
            </Button>

            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs px-2.5 shrink-0"
              onClick={() => setShowProfile(true)}>
              <User className="h-3 w-3" /> Profile
            </Button>
          </div>
        </div>
      </nav>

      {/* ── Admin tools panel ── */}
      {isAdmin && adminViewMode === "admin" && (
        <div className="bg-primary/5 border-b border-primary/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 mr-2">
                <ShieldAlert className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">Admin Dashboard</span>
              </div>
              <Link href="/indexing">
                <Button variant="outline" size="sm" className="gap-2">
                  <Database className="h-3.5 w-3.5" /> Indexing Tool
                </Button>
              </Link>
              <Link href="/audit">
                <Button variant="outline" size="sm" className="gap-2">
                  <BookOpen className="h-3.5 w-3.5" /> Algorithm Audit
                </Button>
              </Link>
              <Link href="/algorithm">
                <Button variant="outline" size="sm" className="gap-2">
                  <Sparkles className="h-3.5 w-3.5" /> Algorithm V1
                </Button>
              </Link>
              <Button variant="outline" size="sm" className="gap-2 text-primary border-primary/40"
                onClick={() => setShowAddAdmin(true)}>
                <UserPlus className="h-3.5 w-3.5" /> Add Admin
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      {userContent}

      {/* Footer */}
      <footer className="border-t border-border/50 bg-muted/20 py-8">
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
