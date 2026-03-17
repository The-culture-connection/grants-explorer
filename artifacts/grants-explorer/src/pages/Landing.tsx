import React from "react";
import { Link } from "wouter";
import {
  LayoutDashboard, ShieldCheck, Sparkles, Database, Globe, Search,
  ArrowRight, CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const FEATURES = [
  { icon: <Globe className="h-5 w-5 text-primary" />, title: "11 Live Data Sources", desc: "SAM.gov, Grants.gov, Simpler Grants, World Bank, TED EU, NIH, NSF, SBIR, USASpending, CA Grants, 360Giving." },
  { icon: <Sparkles className="h-5 w-5 text-primary" />, title: "V3 AI Matching", desc: "Our RankFix algorithm scores every grant against your organization's profile, surfacing the best-fit opportunities first." },
  { icon: <Search className="h-5 w-5 text-primary" />, title: "Keyword Search", desc: "Search across all government databases simultaneously with live results and source filtering." },
  { icon: <Database className="h-5 w-5 text-primary" />, title: "Track Applications", desc: "Save opportunities, mark applied, record win/loss outcomes, and review your complete grant history." },
];

const STATS = [
  { value: "11", label: "Data Sources" },
  { value: "200+", label: "Grants Ranked per Run" },
  { value: "Real-Time", label: "Live Data Sync" },
  { value: "Free", label: "To Use" },
];

export default function Landing() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen w-full bg-background">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-semibold text-sm text-foreground">
            <LayoutDashboard className="h-4 w-4 text-primary" />
            Grants Explorer
          </div>
          <div className="flex items-center gap-2">
            {user ? (
              <Link href="/">
                <Button size="sm" className="h-7 gap-1.5 text-xs px-3 bg-primary hover:bg-primary/90">
                  Go to Dashboard <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/profilecreation">
                  <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs px-3">Sign In</Button>
                </Link>
                <Link href="/profilecreation">
                  <Button size="sm" className="h-7 gap-1.5 text-xs px-3 bg-primary hover:bg-primary/90">Get Started</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div className="relative overflow-hidden border-b border-border/40">
        <div className="absolute inset-0 z-0">
          <img
            src={`${BASE}/images/hero-bg.png`}
            alt=""
            className="w-full h-full object-cover opacity-[0.12] dark:opacity-[0.08] mix-blend-luminosity"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/70 to-background" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-28">
          <div className="flex flex-col items-center text-center max-w-3xl mx-auto space-y-7">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium">
              <ShieldCheck className="w-4 h-4" />
              Official Government Data Explorer
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-extrabold text-foreground tracking-tight">
              Find the Right Federal & State{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400">
                Funding Opportunities
              </span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl">
              Grants Explorer aggregates 11 major government and institutional databases,
              then uses AI to rank the best-fit opportunities for your specific organization.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mt-2">
              <Link href={user ? "/" : "/profilecreation"}>
                <Button size="lg" className="gap-2 min-w-[180px]">
                  <Sparkles className="h-4 w-4" />
                  {user ? "Go to Dashboard" : "Get Started Free"}
                </Button>
              </Link>
              {!user && (
                <Link href="/profilecreation">
                  <Button size="lg" variant="outline" className="gap-2 min-w-[140px]">
                    Sign In <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="border-b border-border/40 bg-muted/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-3xl font-black text-primary mb-1">{s.value}</div>
                <div className="text-sm text-muted-foreground font-medium">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-3">Everything your team needs</h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            From discovery to application tracking — all in one place.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {FEATURES.map((f) => (
            <div key={f.title} className="border border-border/60 rounded-2xl p-6 bg-card hover:shadow-md transition-all space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  {f.icon}
                </div>
                <h3 className="font-semibold text-foreground">{f.title}</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div className="border-t border-border/40 bg-muted/20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <h2 className="text-2xl font-bold text-foreground text-center mb-12">How it works</h2>
          <div className="space-y-6">
            {[
              { n: "1", title: "Create your profile", desc: "Fill out your organization's mission, program areas, geography, budget, and keywords in our guided setup wizard." },
              { n: "2", title: "Run V3 Matches", desc: "Our algorithm scans 200+ opportunities from all active sources and scores each one against your profile." },
              { n: "3", title: "Track your pipeline", desc: "Save top picks, mark grants as applied, record win/loss outcomes, and search across all databases by keyword." },
            ].map((step) => (
              <div key={step.n} className="flex gap-5 items-start">
                <div className="shrink-0 w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
                  {step.n}
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-1">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Link href={user ? "/" : "/profilecreation"}>
              <Button size="lg" className="gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {user ? "Back to Dashboard" : "Start Finding Grants"}
              </Button>
            </Link>
          </div>
        </div>
      </div>

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
