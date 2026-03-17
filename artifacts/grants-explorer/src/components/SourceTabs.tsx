import React, { useState, useEffect, useRef } from "react";
import {
  useGetGrantsGov, useGetSbir, useGetThreeSixtyGiving, useGetCaGrants,
  useGetUsaSpending, useGetNih, useGetNsf, useGetWorldBank,
  useGetSimplerGrants, useGetSamGov, useGetTedEu,
} from "@workspace/api-client-react";
import { GrantList } from "./GrantList";
import { Search, Layers } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useDebounce } from "use-debounce";
import type { GrantItem } from "@workspace/api-client-react/src/generated/api.schemas";
import type { GrantStatus } from "./GrantCard";

const PAGE_SIZE = 12;

const SOURCES = [
  { id: "simplergrants", label: "Simpler Grants" },
  { id: "samgov",        label: "SAM.gov" },
  { id: "tedeu",         label: "TED EU" },
  { id: "grantsgov",    label: "Grants.gov" },
  { id: "sbir",          label: "SBIR / STTR" },
  { id: "nsf",           label: "NSF Awards" },
  { id: "nih",           label: "NIH RePORTER" },
  { id: "usaspending",   label: "USASpending" },
  { id: "cagrants",      label: "CA Grants" },
  { id: "threesixtygiving", label: "360Giving" },
  { id: "worldbank",     label: "World Bank" },
];

/* ── Per-source pager ── */
function useSourcePager(
  useHookFn: (p: { keyword: string; rows: number; offset: number }) => any,
  keyword: string,
) {
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<GrantItem[]>([]);
  const [total, setTotal] = useState<number | undefined>();
  const prevKeyword = useRef(keyword);

  useEffect(() => {
    if (keyword !== prevKeyword.current) {
      prevKeyword.current = keyword;
      setOffset(0);
      setItems([]);
      setTotal(undefined);
    }
  }, [keyword]);

  const q = useHookFn({ keyword, rows: PAGE_SIZE, offset });

  useEffect(() => {
    if (q.isSuccess && q.data) {
      if (q.data.total !== undefined) setTotal(q.data.total);
      const incoming: GrantItem[] = q.data.items ?? [];
      setItems((prev) => (offset === 0 ? incoming : [...prev, ...incoming]));
    }
  }, [q.isSuccess, q.data]);

  const loadMore = () => setOffset((p) => p + PAGE_SIZE);
  const hasMore = total !== undefined ? items.length < total : false;

  return { items, total, isLoading: q.isLoading, isFetching: q.isFetching, error: q.error as Error | null, loadMore, hasMore };
}

interface SourceTabsProps {
  statuses?: Record<string, GrantStatus>;
  onSave?: (grant: GrantItem) => void;
  onApply?: (grant: GrantItem) => void;
}

/* ── Main export ── */
export function SourceTabs({ statuses, onSave, onApply }: SourceTabsProps = {}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedKeyword] = useDebounce(searchTerm, 600);
  const [activeSource, setActiveSource] = useState<string>("all");

  const simpler     = useSourcePager(useGetSimplerGrants,   debouncedKeyword);
  const sam         = useSourcePager(useGetSamGov,           debouncedKeyword);
  const ted         = useSourcePager(useGetTedEu,            debouncedKeyword);
  const grantsGov   = useSourcePager(useGetGrantsGov,        debouncedKeyword);
  const sbir        = useSourcePager(useGetSbir,             debouncedKeyword);
  const nsf         = useSourcePager(useGetNsf,              debouncedKeyword);
  const nih         = useSourcePager(useGetNih,              debouncedKeyword);
  const usa         = useSourcePager(useGetUsaSpending,      debouncedKeyword);
  const ca          = useSourcePager(useGetCaGrants,         debouncedKeyword);
  const threeSixty  = useSourcePager(useGetThreeSixtyGiving, debouncedKeyword);
  const worldBank   = useSourcePager(useGetWorldBank,        debouncedKeyword);

  const sourceDataMap: Record<string, typeof simpler> = {
    simplergrants: simpler, samgov: sam, tedeu: ted, grantsgov: grantsGov,
    sbir, nsf, nih, usaspending: usa, cagrants: ca, threesixtygiving: threeSixty, worldbank: worldBank,
  };

  const allItems: GrantItem[] = [
    ...simpler.items, ...sam.items, ...ted.items, ...grantsGov.items,
    ...sbir.items, ...nsf.items, ...nih.items, ...usa.items,
    ...ca.items, ...threeSixty.items, ...worldBank.items,
  ];
  const allTotal = [simpler, sam, ted, grantsGov, sbir, nsf, nih, usa, ca, threeSixty, worldBank]
    .reduce((acc, s) => acc + (s.total ?? 0), 0);
  const allLoading = [simpler, sam, ted, grantsGov, sbir, nsf, nih, usa, ca, threeSixty, worldBank]
    .some((s) => s.isLoading && s.items.length === 0);
  const allSources = [simpler, sam, ted, grantsGov, sbir, nsf, nih, usa, ca, threeSixty, worldBank];
  const allError = allSources.every((s) => s.error && s.items.length === 0)
    ? (allSources.find((s) => s.error)?.error ?? null)
    : null;
  const allHasMore = allSources.some((s) => s.hasMore);

  function loadMoreAll() {
    allSources.forEach((s) => { if (s.hasMore) s.loadMore(); });
  }

  const isAll = activeSource === "all";
  const activeData = isAll ? null : sourceDataMap[activeSource];
  const displayItems   = isAll ? allItems  : (activeData?.items ?? []);
  const displayTotal   = isAll ? allTotal  : activeData?.total;
  const displayLoading = isAll ? allLoading : (activeData?.isLoading ?? false) && displayItems.length === 0;
  const displayError   = isAll ? allError  : (activeData?.error ?? null);
  const displayHasMore = isAll ? allHasMore : (activeData?.hasMore ?? false);
  const displayLoadMore = isAll ? loadMoreAll : (activeData?.loadMore ?? (() => {}));
  const displayIsFetching = isAll
    ? allSources.some((s) => s.isFetching)
    : (activeData?.isFetching ?? false);
  const displaySourceName = isAll
    ? "All Sources"
    : SOURCES.find((s) => s.id === activeSource)?.label ?? activeSource;

  const countFor = (id: string) => sourceDataMap[id]?.items.length ?? 0;

  return (
    <div className="w-full space-y-6">
      {/* Search bar */}
      <div className="bg-card border border-border/50 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between backdrop-blur-xl bg-card/80">
        <div className="relative w-full md:max-w-md group">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
          </div>
          <Input
            type="search"
            placeholder="Perform keyword search..."
            className="pl-10 h-12 w-full bg-background border-2 border-border focus-visible:border-primary focus-visible:ring-primary/20 rounded-xl text-base transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="text-sm text-muted-foreground flex items-center gap-2 font-medium bg-muted/50 px-4 py-2 rounded-lg border border-border/50 shrink-0">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Live Data Sync
        </div>
      </div>

      {/* Source filter pills */}
      <div className="overflow-x-auto pb-2 -mx-1 px-1">
        <div className="flex items-center gap-2 w-max">
          <button
            onClick={() => setActiveSource("all")}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium border transition-all shrink-0
              ${activeSource === "all"
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-background text-muted-foreground border-border/60 hover:border-primary/40 hover:text-primary"}`}
          >
            <Layers className="h-3 w-3" />
            All Sources
            {allItems.length > 0 && (
              <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${activeSource === "all" ? "bg-white/20" : "bg-muted"}`}>
                {allItems.length}
              </span>
            )}
          </button>

          {SOURCES.map((src) => {
            const count = countFor(src.id);
            const isActive = activeSource === src.id;
            return (
              <button
                key={src.id}
                onClick={() => setActiveSource(src.id)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium border transition-all shrink-0
                  ${isActive
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-background text-muted-foreground border-border/60 hover:border-primary/40 hover:text-primary"}`}
              >
                {src.label}
                {count > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${isActive ? "bg-white/20" : "bg-muted"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Results */}
      <div className="min-h-[500px]">
        <GrantList
          items={displayItems}
          total={displayTotal}
          isLoading={displayLoading}
          isLoadingMore={displayIsFetching && displayItems.length > 0}
          error={displayError}
          sourceName={displaySourceName}
          onLoadMore={displayLoadMore}
          hasMore={displayHasMore}
          statuses={statuses}
          onSave={onSave}
          onApply={onApply}
        />
      </div>
    </div>
  );
}
