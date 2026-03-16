import React from "react";
import { SourceTabs } from "@/components/SourceTabs";
import { LayoutDashboard, ShieldCheck } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen w-full bg-background selection:bg-primary/20 selection:text-primary">
      {/* Hero Section */}
      <div className="relative overflow-hidden border-b border-border/40">
        {/* Background Image & Overlay */}
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
              Discover Federal & State <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400">Funding Opportunities</span>
            </h1>
            
            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl">
              A unified interface to search, filter, and track public grants across 8 major governmental and institutional databases in real-time.
            </p>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="relative z-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-10 pb-20">
        <SourceTabs />
      </main>

      {/* Minimal Footer */}
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
