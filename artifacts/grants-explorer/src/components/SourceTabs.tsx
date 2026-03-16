import React, { useState, useEffect, useRef } from "react";
import {
  useGetGrantsGov,
  useGetSbir,
  useGetThreeSixtyGiving,
  useGetCaGrants,
  useGetUsaSpending,
  useGetNih,
  useGetNsf,
  useGetWorldBank,
  useGetSimplerGrants,
  useGetSamGov,
  useGetTedEu,
} from "@workspace/api-client-react";
import { GrantList } from "./GrantList";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useDebounce } from "use-debounce";
import type { GrantItem } from "@workspace/api-client-react/src/generated/api.schemas";

const PAGE_SIZE = 12;

const SOURCES = [
  { id: "simplergrants", label: "Simpler Grants" },
  { id: "samgov", label: "SAM.gov" },
  { id: "tedeu", label: "TED EU" },
  { id: "grantsgov", label: "Grants.gov" },
  { id: "sbir", label: "SBIR/STTR" },
  { id: "nsf", label: "NSF Awards" },
  { id: "nih", label: "NIH RePORTER" },
  { id: "usaspending", label: "USASpending" },
  { id: "cagrants", label: "California Grants" },
  { id: "threesixtygiving", label: "360Giving" },
  { id: "worldbank", label: "World Bank" },
];

/* ─────────────────────────────────────────────────────────────────────────
   Generic accumulating hook — wraps any single-page react-query result
   and exposes a stable list + loadMore callback.
   Rules-of-hooks: callers must always invoke this unconditionally.
───────────────────────────────────────────────────────────────────────── */
function useAccumulator(
  data: { items?: GrantItem[]; total?: number } | undefined,
  isSuccess: boolean,
  keyword: string,
  offset: number,
) {
  const [allItems, setAllItems] = useState<GrantItem[]>([]);
  const [total, setTotal] = useState<number | undefined>();
  const prevKeyword = useRef(keyword);

  useEffect(() => {
    if (keyword !== prevKeyword.current) {
      prevKeyword.current = keyword;
      setAllItems([]);
      setTotal(undefined);
    }
  }, [keyword]);

  useEffect(() => {
    if (isSuccess && data) {
      if (data.total !== undefined) setTotal(data.total);
      const incoming = data.items ?? [];
      setAllItems((prev) => (offset === 0 ? [...incoming] : [...prev, ...incoming]));
    }
  }, [isSuccess, data]);

  return { allItems, total };
}

/* ─────────────────────────────────────────────────────────────────────────
   Per-source tab components — each owns its own offset state.
   They are always rendered (just hidden) so state isn't lost on tab switch.
───────────────────────────────────────────────────────────────────────── */

function SimplerGrantsTab({ keyword }: { keyword: string }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [keyword]);
  const q = useGetSimplerGrants({ keyword, rows: PAGE_SIZE, offset });
  const { allItems, total } = useAccumulator(q.data, q.isSuccess, keyword, offset);
  return (
    <GrantList items={allItems} total={total} isLoading={q.isLoading} isLoadingMore={q.isFetching && offset > 0}
      error={q.error as Error | null} sourceName="Simpler Grants"
      onLoadMore={() => setOffset((p) => p + PAGE_SIZE)}
      hasMore={total !== undefined ? allItems.length < total : false} />
  );
}

function SamGovTab({ keyword }: { keyword: string }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [keyword]);
  const q = useGetSamGov({ keyword, rows: PAGE_SIZE, offset });
  const { allItems, total } = useAccumulator(q.data, q.isSuccess, keyword, offset);
  return (
    <GrantList items={allItems} total={total} isLoading={q.isLoading} isLoadingMore={q.isFetching && offset > 0}
      error={q.error as Error | null} sourceName="SAM.gov"
      onLoadMore={() => setOffset((p) => p + PAGE_SIZE)}
      hasMore={total !== undefined ? allItems.length < total : false} />
  );
}

function TedEuTab({ keyword }: { keyword: string }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [keyword]);
  const q = useGetTedEu({ keyword, rows: PAGE_SIZE, offset });
  const { allItems, total } = useAccumulator(q.data, q.isSuccess, keyword, offset);
  return (
    <GrantList items={allItems} total={total} isLoading={q.isLoading} isLoadingMore={q.isFetching && offset > 0}
      error={q.error as Error | null} sourceName="TED EU"
      onLoadMore={() => setOffset((p) => p + PAGE_SIZE)}
      hasMore={total !== undefined ? allItems.length < total : false} />
  );
}

function GrantsGovTab({ keyword }: { keyword: string }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [keyword]);
  const q = useGetGrantsGov({ keyword, rows: PAGE_SIZE, offset });
  const { allItems, total } = useAccumulator(q.data, q.isSuccess, keyword, offset);
  return (
    <GrantList items={allItems} total={total} isLoading={q.isLoading} isLoadingMore={q.isFetching && offset > 0}
      error={q.error as Error | null} sourceName="Grants.gov"
      onLoadMore={() => setOffset((p) => p + PAGE_SIZE)}
      hasMore={total !== undefined ? allItems.length < total : false} />
  );
}

function SbirTab({ keyword }: { keyword: string }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [keyword]);
  const q = useGetSbir({ keyword, rows: PAGE_SIZE, offset });
  const { allItems, total } = useAccumulator(q.data, q.isSuccess, keyword, offset);
  return (
    <GrantList items={allItems} total={total} isLoading={q.isLoading} isLoadingMore={q.isFetching && offset > 0}
      error={q.error as Error | null} sourceName="SBIR/STTR"
      onLoadMore={() => setOffset((p) => p + PAGE_SIZE)}
      hasMore={total !== undefined ? allItems.length < total : false} />
  );
}

function NsfTab({ keyword }: { keyword: string }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [keyword]);
  const q = useGetNsf({ keyword, rows: PAGE_SIZE, offset });
  const { allItems, total } = useAccumulator(q.data, q.isSuccess, keyword, offset);
  return (
    <GrantList items={allItems} total={total} isLoading={q.isLoading} isLoadingMore={q.isFetching && offset > 0}
      error={q.error as Error | null} sourceName="NSF Awards"
      onLoadMore={() => setOffset((p) => p + PAGE_SIZE)}
      hasMore={total !== undefined ? allItems.length < total : false} />
  );
}

function NihTab({ keyword }: { keyword: string }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [keyword]);
  const q = useGetNih({ keyword, rows: PAGE_SIZE, offset });
  const { allItems, total } = useAccumulator(q.data, q.isSuccess, keyword, offset);
  return (
    <GrantList items={allItems} total={total} isLoading={q.isLoading} isLoadingMore={q.isFetching && offset > 0}
      error={q.error as Error | null} sourceName="NIH RePORTER"
      onLoadMore={() => setOffset((p) => p + PAGE_SIZE)}
      hasMore={total !== undefined ? allItems.length < total : false} />
  );
}

function UsaSpendingTab({ keyword }: { keyword: string }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [keyword]);
  const q = useGetUsaSpending({ keyword, rows: PAGE_SIZE, offset });
  const { allItems, total } = useAccumulator(q.data, q.isSuccess, keyword, offset);
  return (
    <GrantList items={allItems} total={total} isLoading={q.isLoading} isLoadingMore={q.isFetching && offset > 0}
      error={q.error as Error | null} sourceName="USASpending"
      onLoadMore={() => setOffset((p) => p + PAGE_SIZE)}
      hasMore={total !== undefined ? allItems.length < total : false} />
  );
}

function CaGrantsTab({ keyword }: { keyword: string }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [keyword]);
  const q = useGetCaGrants({ keyword, rows: PAGE_SIZE, offset });
  const { allItems, total } = useAccumulator(q.data, q.isSuccess, keyword, offset);
  return (
    <GrantList items={allItems} total={total} isLoading={q.isLoading} isLoadingMore={q.isFetching && offset > 0}
      error={q.error as Error | null} sourceName="California Grants"
      onLoadMore={() => setOffset((p) => p + PAGE_SIZE)}
      hasMore={total !== undefined ? allItems.length < total : false} />
  );
}

function ThreeSixtyGivingTab({ keyword }: { keyword: string }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [keyword]);
  const q = useGetThreeSixtyGiving({ keyword, rows: PAGE_SIZE, offset });
  const { allItems, total } = useAccumulator(q.data, q.isSuccess, keyword, offset);
  return (
    <GrantList items={allItems} total={total} isLoading={q.isLoading} isLoadingMore={q.isFetching && offset > 0}
      error={q.error as Error | null} sourceName="360Giving"
      onLoadMore={() => setOffset((p) => p + PAGE_SIZE)}
      hasMore={total !== undefined ? allItems.length < total : false} />
  );
}

function WorldBankTab({ keyword }: { keyword: string }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [keyword]);
  const q = useGetWorldBank({ keyword, rows: PAGE_SIZE, offset });
  const { allItems, total } = useAccumulator(q.data, q.isSuccess, keyword, offset);
  return (
    <GrantList items={allItems} total={total} isLoading={q.isLoading} isLoadingMore={q.isFetching && offset > 0}
      error={q.error as Error | null} sourceName="World Bank"
      onLoadMore={() => setOffset((p) => p + PAGE_SIZE)}
      hasMore={total !== undefined ? allItems.length < total : false} />
  );
}

const TAB_COMPONENTS: Record<string, React.ComponentType<{ keyword: string }>> = {
  simplergrants: SimplerGrantsTab,
  samgov: SamGovTab,
  tedeu: TedEuTab,
  grantsgov: GrantsGovTab,
  sbir: SbirTab,
  nsf: NsfTab,
  nih: NihTab,
  usaspending: UsaSpendingTab,
  cagrants: CaGrantsTab,
  threesixtygiving: ThreeSixtyGivingTab,
  worldbank: WorldBankTab,
};

/* ─────────────────────────────────────────────────────────────────────────
   Main export
───────────────────────────────────────────────────────────────────────── */
export function SourceTabs() {
  const [searchTerm, setSearchTerm] = React.useState("");
  const [debouncedKeyword] = useDebounce(searchTerm, 600);

  return (
    <div className="w-full space-y-8">
      <div className="bg-card border border-border/50 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between z-10 relative backdrop-blur-xl bg-card/80">
        <div className="relative w-full md:max-w-md group">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
          </div>
          <Input
            type="search"
            placeholder="Search across all government grants..."
            className="pl-10 h-12 w-full bg-background border-2 border-border focus-visible:border-primary focus-visible:ring-primary/20 rounded-xl text-base transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="text-sm text-muted-foreground flex items-center gap-2 font-medium bg-muted/50 px-4 py-2 rounded-lg border border-border/50">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Live Data Sync
        </div>
      </div>

      <Tabs defaultValue={SOURCES[0].id} className="w-full">
        <div className="overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 hide-scrollbar">
          <TabsList className="inline-flex h-14 items-center justify-start rounded-xl bg-muted/50 p-1 w-auto min-w-full sm:min-w-0 border border-border/50">
            {SOURCES.map((source) => (
              <TabsTrigger
                key={source.id}
                value={source.id}
                className="h-12 px-6 rounded-lg font-medium text-sm data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all duration-200"
              >
                {source.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="mt-6 min-h-[500px]">
          {SOURCES.map((source) => {
            const TabComp = TAB_COMPONENTS[source.id];
            return (
              <TabsContent key={source.id} value={source.id} className="m-0 outline-none">
                <TabComp keyword={debouncedKeyword} />
              </TabsContent>
            );
          })}
        </div>
      </Tabs>
    </div>
  );
}
