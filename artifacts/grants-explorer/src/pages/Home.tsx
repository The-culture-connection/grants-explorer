import React, { useState, useRef } from "react";
import { Link } from "wouter";
import { SourceTabs } from "@/components/SourceTabs";
import {
  LayoutDashboard, ShieldCheck, FlaskConical, Database, BookOpen,
  Sparkles, RefreshCw, User, LogOut, ChevronRight, ExternalLink,
  Trophy, AlertCircle, X
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

const ACTIVE_SOURCES = new Set([
  "simpler_grants", "grants_gov", "world_bank", "ted_eu",
]);

const PAGE_SIZE = 20;

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

function GrantCard({ trace, rank }: { trace: V3ScoreTrace; rank: number }) {
  const opp = trace.opp;
  const score = Math.round(trace.finalScore);
  return (
    <div className={`border rounded-xl p-4 space-y-2.5 transition-all hover:shadow-md ${scoreBg(score)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${score >= 75 ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300" : score >= 50 ? "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300" : "bg-muted text-muted-foreground"}`}>
            #{rank}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground leading-tight line-clamp-2">{opp.title || "Untitled Opportunity"}</h3>
            {opp.agency && <p className="text-xs text-muted-foreground mt-0.5">{opp.agency}</p>}
          </div>
        </div>
        <div className={`shrink-0 text-right`}>
          <div className={`text-2xl font-black ${scoreColor(score)}`}>{score}</div>
          <div className="text-[10px] text-muted-foreground">/ 100</div>
        </div>
      </div>

      {opp.description && (
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{opp.description}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{opp.source.replace(/_/g, " ")}</Badge>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{opp.funding_type.replace(/_/g, " ")}</Badge>
        {opp.max_award && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            Up to ${opp.max_award.toLocaleString()}
          </Badge>
        )}
        {opp.close_date && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            Closes {new Date(opp.close_date).toLocaleDateString()}
          </Badge>
        )}
        {opp.url && (
          <a
            href={opp.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 text-[10px] text-primary hover:underline font-medium"
          >
            View <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </div>
  );
}

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

export default function Home() {
  const { user } = useAuth();
  const [showProfile, setShowProfile] = useState(false);

  const [v3Running, setV3Running] = useState(false);
  const [v3Results, setV3Results] = useState<V3ScoreTrace[]>([]);
  const [v3Page, setV3Page] = useState(0);
  const [v3Error, setV3Error] = useState("");
  const [v3Ran, setV3Ran] = useState(false);
  const [totalFound, setTotalFound] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);

  async function runV3() {
    if (!user?.org_profile) {
      setV3Error("Please set up your organization profile first using the Edit Profile button.");
      return;
    }
    setV3Running(true);
    setV3Error("");
    setV3Results([]);
    setV3Page(0);
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
    } catch (err: any) {
      setV3Error("Failed to load opportunity pool. Make sure the indexing service is running.");
    } finally {
      setV3Running(false);
    }
  }

  const pagedResults = v3Results.slice(0, (v3Page + 1) * PAGE_SIZE);
  const hasMore = pagedResults.length < v3Results.length;

  return (
    <div className="min-h-screen w-full bg-background selection:bg-primary/20 selection:text-primary">
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}

      {/* Top Nav */}
      <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-semibold text-sm text-foreground">
            <LayoutDashboard className="h-4 w-4 text-primary" />
            Grants Explorer
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/indexing"
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary border border-border/60 hover:border-primary/40 px-3 py-1.5 rounded-lg transition-all"
            >
              <Database className="h-3.5 w-3.5" />
              Indexing Tool
            </Link>
            <Link
              href="/algorithm"
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary border border-border/60 hover:border-primary/40 px-3 py-1.5 rounded-lg transition-all"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              Algorithm V1
            </Link>
            <Link
              href="/audit"
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary border border-border/60 hover:border-primary/40 px-3 py-1.5 rounded-lg transition-all"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Algorithm Audit
            </Link>

            <div className="w-px h-4 bg-border/60" />

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
              {v3Running ? (
                <><RefreshCw className="h-3 w-3 animate-spin" /> Running…</>
              ) : (
                <><Sparkles className="h-3 w-3" /> Run V3 Matches</>
              )}
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
        <div ref={resultsRef} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          {v3Error ? (
            <div className="flex items-center gap-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {v3Error}
            </div>
          ) : (
            <div className="space-y-6">
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
                    </span>{" "}
                    · showing {pagedResults.length}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={runV3}
                  disabled={v3Running}
                >
                  <RefreshCw className={`h-3 w-3 ${v3Running ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>

              {pagedResults.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No matching grants found. Try expanding your organization profile keywords or geography.
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {pagedResults.map((trace, i) => (
                    <GrantCard key={trace.opp.id} trace={trace} rank={i + 1} />
                  ))}
                </div>
              )}

              {hasMore && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => setV3Page((p) => p + 1)}
                  >
                    Load next {Math.min(PAGE_SIZE, v3Results.length - pagedResults.length)} results
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Content Area */}
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
