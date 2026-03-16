import React from "react";
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

export function SourceTabs() {
  const [activeTab, setActiveTab] = React.useState(SOURCES[0].id);
  const [searchTerm, setSearchTerm] = React.useState("");
  const [debouncedKeyword] = useDebounce(searchTerm, 600);

  const queryParams = { keyword: debouncedKeyword, rows: 12 };

  const simplerGrantsQuery = useGetSimplerGrants(queryParams, { query: { enabled: activeTab === "simplergrants" } });
  const samGovQuery = useGetSamGov(queryParams, { query: { enabled: activeTab === "samgov" } });
  const tedEuQuery = useGetTedEu(queryParams, { query: { enabled: activeTab === "tedeu" } });
  const grantsGovQuery = useGetGrantsGov(queryParams, { query: { enabled: activeTab === "grantsgov" } });
  const sbirQuery = useGetSbir(queryParams, { query: { enabled: activeTab === "sbir" } });
  const nsfQuery = useGetNsf(queryParams, { query: { enabled: activeTab === "nsf" } });
  const nihQuery = useGetNih(queryParams, { query: { enabled: activeTab === "nih" } });
  const usaSpendingQuery = useGetUsaSpending(queryParams, { query: { enabled: activeTab === "usaspending" } });
  const caGrantsQuery = useGetCaGrants(queryParams, { query: { enabled: activeTab === "cagrants" } });
  const threeSixtyQuery = useGetThreeSixtyGiving(queryParams, { query: { enabled: activeTab === "threesixtygiving" } });
  const worldBankQuery = useGetWorldBank(queryParams, { query: { enabled: activeTab === "worldbank" } });

  const getQueryForTab = (tabId: string) => {
    switch (tabId) {
      case "simplergrants": return simplerGrantsQuery;
      case "samgov": return samGovQuery;
      case "tedeu": return tedEuQuery;
      case "grantsgov": return grantsGovQuery;
      case "sbir": return sbirQuery;
      case "nsf": return nsfQuery;
      case "nih": return nihQuery;
      case "usaspending": return usaSpendingQuery;
      case "cagrants": return caGrantsQuery;
      case "threesixtygiving": return threeSixtyQuery;
      case "worldbank": return worldBankQuery;
      default: return simplerGrantsQuery;
    }
  };

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

      <Tabs defaultValue={SOURCES[0].id} onValueChange={setActiveTab} className="w-full">
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
            const query = getQueryForTab(source.id);
            return (
              <TabsContent key={source.id} value={source.id} className="m-0 outline-none">
                <GrantList 
                  items={query.data?.items} 
                  total={query.data?.total}
                  isLoading={query.isLoading || (query.isFetching && !query.data)} 
                  error={query.error as Error | null}
                  sourceName={source.label}
                />
              </TabsContent>
            );
          })}
        </div>
      </Tabs>
    </div>
  );
}
