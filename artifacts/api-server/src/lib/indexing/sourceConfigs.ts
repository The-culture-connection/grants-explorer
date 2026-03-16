export type SourceClassification = "active_opportunity" | "historical_intelligence";
export type PaginationType = "offset" | "page" | "cursor" | "none";

export interface SourceConfig {
  sourceKey: string;
  displayName: string;
  classification: SourceClassification;
  paginationType: PaginationType;
  pageSize: number;
  maxPages: number;
  enabled: boolean;
  requiresAuth: boolean;
  notes?: string;
}

export const SOURCE_CONFIGS: SourceConfig[] = [
  {
    sourceKey: "simpler_grants",
    displayName: "Simpler Grants",
    classification: "active_opportunity",
    paginationType: "page",
    pageSize: 100,
    maxPages: 200,
    enabled: true,
    requiresAuth: true,
    notes: "POST /api/v1/opportunities/search — uses page_number + page_size, has pagination_info.total_pages",
  },
  {
    sourceKey: "grants_gov",
    displayName: "Grants.gov Search",
    classification: "active_opportunity",
    paginationType: "offset",
    pageSize: 100,
    maxPages: 200,
    enabled: true,
    requiresAuth: false,
    notes: "POST startRecordNum + rows, hitCount for total",
  },
  {
    sourceKey: "sam_gov",
    displayName: "SAM.gov Opportunities",
    classification: "active_opportunity",
    paginationType: "offset",
    pageSize: 100,
    maxPages: 200,
    enabled: true,
    requiresAuth: true,
    notes: "GET offset + limit, totalRecords in response",
  },
  {
    sourceKey: "sbir",
    displayName: "SBIR/STTR",
    classification: "active_opportunity",
    paginationType: "offset",
    pageSize: 100,
    maxPages: 200,
    enabled: true,
    requiresAuth: false,
    notes: "GET start + rows, total in response",
  },
  {
    sourceKey: "threesixtygiving",
    displayName: "360Giving / UKRI",
    classification: "active_opportunity",
    paginationType: "page",
    pageSize: 100,
    maxPages: 100,
    enabled: true,
    requiresAuth: false,
    notes: "360Giving grants nav API, uses offset+limit pagination",
  },
  {
    sourceKey: "california_grants",
    displayName: "California Grants Portal",
    classification: "active_opportunity",
    paginationType: "page",
    pageSize: 100,
    maxPages: 100,
    enabled: true,
    requiresAuth: false,
    notes: "California grants.ca.gov API",
  },
  {
    sourceKey: "world_bank",
    displayName: "World Bank Procurement",
    classification: "active_opportunity",
    paginationType: "offset",
    pageSize: 100,
    maxPages: 100,
    enabled: true,
    requiresAuth: false,
    notes: "GET os (offset) + rows, total in response",
  },
  {
    sourceKey: "ted_eu",
    displayName: "TED EU",
    classification: "active_opportunity",
    paginationType: "page",
    pageSize: 50,
    maxPages: 200,
    enabled: true,
    requiresAuth: false,
    notes: "POST page + pageSize, totalNoticeCount in response",
  },
  {
    sourceKey: "usaspending",
    displayName: "USASpending",
    classification: "historical_intelligence",
    paginationType: "cursor",
    pageSize: 100,
    maxPages: 100,
    enabled: true,
    requiresAuth: false,
    notes: "POST API, last_record_unique_id cursor pagination",
  },
  {
    sourceKey: "nih_reporter",
    displayName: "NIH RePORTER",
    classification: "historical_intelligence",
    paginationType: "offset",
    pageSize: 500,
    maxPages: 50,
    enabled: true,
    requiresAuth: false,
    notes: "POST API, offset + limit, meta.total for total",
  },
  {
    sourceKey: "nsf_awards",
    displayName: "NSF Awards",
    classification: "historical_intelligence",
    paginationType: "offset",
    pageSize: 25,
    maxPages: 200,
    enabled: true,
    requiresAuth: false,
    notes: "GET rpp + offset, totalCount in metadata",
  },
];

export function getSourceConfig(sourceKey: string): SourceConfig | undefined {
  return SOURCE_CONFIGS.find((s) => s.sourceKey === sourceKey);
}
