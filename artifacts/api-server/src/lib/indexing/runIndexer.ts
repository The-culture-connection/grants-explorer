import { normalizeRecord } from "./normalize";
import { upsertRecords, saveIndexingRun, ensureTables } from "./storage";
import { getSourceConfig, SOURCE_CONFIGS } from "./sourceConfigs";

// ─── In-memory progress state ──────────────────────────────────────────────

export interface SourceProgress {
  sourceKey: string;
  status: "idle" | "running" | "completed" | "failed" | "stopped";
  currentPage: number;
  totalFetched: number;
  totalInserted: number;
  totalSkipped: number;
  totalErrors: number;
  stopReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  logLines: string[];
}

const progressMap = new Map<string, SourceProgress>();
const stopFlags = new Set<string>();
let tablesReady = false;

export function getProgress(sourceKey: string): SourceProgress {
  return progressMap.get(sourceKey) ?? {
    sourceKey,
    status: "idle",
    currentPage: 0,
    totalFetched: 0,
    totalInserted: 0,
    totalSkipped: 0,
    totalErrors: 0,
    stopReason: null,
    startedAt: null,
    completedAt: null,
    logLines: [],
  };
}

export function getAllProgress(): SourceProgress[] {
  return SOURCE_CONFIGS.map((s) => getProgress(s.sourceKey));
}

function initProgress(sourceKey: string): void {
  progressMap.set(sourceKey, {
    sourceKey,
    status: "running",
    currentPage: 0,
    totalFetched: 0,
    totalInserted: 0,
    totalSkipped: 0,
    totalErrors: 0,
    stopReason: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    logLines: [`[${new Date().toISOString()}] Started indexing ${sourceKey}`],
  });
}

function log(sourceKey: string, msg: string): void {
  const p = progressMap.get(sourceKey);
  if (!p) return;
  const line = `[${new Date().toISOString()}] ${msg}`;
  p.logLines = [...p.logLines.slice(-99), line];
  console.log(`[indexer:${sourceKey}] ${msg}`);
}

function finish(sourceKey: string, stopReason: string, status: "completed" | "failed" | "stopped"): void {
  const p = progressMap.get(sourceKey);
  if (!p) return;
  p.status = status;
  p.stopReason = stopReason;
  p.completedAt = new Date().toISOString();
  log(sourceKey, `Finished — ${stopReason} | fetched=${p.totalFetched} inserted=${p.totalInserted} skipped=${p.totalSkipped} errors=${p.totalErrors}`);
}

export function requestStop(sourceKey: string): void {
  stopFlags.add(sourceKey);
}

export function requestStopAll(): void {
  for (const s of SOURCE_CONFIGS) stopFlags.add(s.sourceKey);
}

// ─── Retry with backoff ────────────────────────────────────────────────────

async function fetchWithRetry(fn: () => Promise<Response>, retries = 3): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const r = await fn();
      if (r.ok) return r;
      if (r.status === 429 || r.status >= 500) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
      return r;
    } catch (e) {
      lastErr = e;
      await sleep(500 * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Per-source fetch functions ────────────────────────────────────────────

async function* fetchSimplerGrants(keyword: string): AsyncGenerator<any[]> {
  const apiKey = process.env["SIMPLER_GRANTS_API_KEY"] ?? "";
  let page = 1;
  const pageSize = 100;
  while (true) {
    const resp = await fetchWithRetry(() => fetch("https://api.simpler.grants.gov/v1/opportunities/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({
        query: keyword,
        pagination: { page_offset: page, page_size: pageSize, order_by: "opportunity_id", sort_direction: "ascending" },
      }),
    }));
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.log(`[indexer:simpler_grants] HTTP ${resp.status}: ${text.slice(0, 200)}`);
      return;
    }
    const data = await resp.json() as any;
    const items: any[] = Array.isArray(data.data) ? data.data : [];
    if (items.length === 0) return;
    yield items;
    const paginationInfo = data.pagination_info ?? {};
    const totalPages = paginationInfo.total_pages ?? 1;
    if (page >= totalPages) return;
    page++;
  }
}

async function* fetchGrantsGov(keyword: string): AsyncGenerator<any[]> {
  let offset = 0;
  const rows = 100;
  while (true) {
    const resp = await fetchWithRetry(() => fetch("https://apply07.grants.gov/grantsws/rest/opportunities/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, rows, startRecordNum: offset, oppStatuses: "forecasted|posted" }),
    }));
    if (!resp.ok) { yield []; return; }
    const data = await resp.json() as any;
    const items: any[] = Array.isArray(data.oppHits) ? data.oppHits : [];
    if (items.length === 0) return;
    yield items;
    const total = data.hitCount ?? 0;
    offset += items.length;
    if (offset >= total) return;
  }
}

async function* fetchSamGov(keyword: string): AsyncGenerator<any[]> {
  const apiKey = process.env["SAM_GOV_API_KEY"] ?? "";
  let offset = 0;
  const limit = 100;
  const today = new Date();
  // SAM.gov requires postedFrom and postedTo within the same calendar year
  const postedFrom = new Date(today.getFullYear(), 0, 1); // Jan 1 of current year
  const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

  while (true) {
    const params = new URLSearchParams({
      q: keyword,
      api_key: apiKey,
      postedFrom: fmt(postedFrom),
      postedTo: fmt(today),
      limit: String(limit),
      offset: String(offset),
    });
    const resp = await fetchWithRetry(() => fetch(`https://api.sam.gov/opportunities/v2/search?${params}`));
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.log(`[indexer:sam_gov] HTTP ${resp.status}: ${text.slice(0, 200)}`);
      return;
    }
    const data = await resp.json() as any;
    const items: any[] = Array.isArray(data.opportunitiesData) ? data.opportunitiesData : [];
    if (items.length === 0) return;
    yield items;
    const total = data.totalRecords ?? 0;
    offset += items.length;
    if (offset >= total) return;
  }
}

async function* fetchSbir(_keyword: string): AsyncGenerator<any[]> {
  // SBIR.gov public API is currently unavailable (returns 403/404).
  // Source disabled until a working endpoint is confirmed.
  console.log("[indexer:sbir] API unavailable — sbir.gov public JSON endpoint returns 403. Skipping.");
  return;
}

async function* fetchThreeSixtyGiving(_keyword: string): AsyncGenerator<any[]> {
  // 360Giving public API (api.threesixtygiving.org) is currently returning 404 for all endpoints.
  // Source disabled until their API is restored or a new endpoint is available.
  console.log("[indexer:threesixtygiving] API unavailable — api.threesixtygiving.org returns 404. Skipping.");
  return;
}

async function* fetchCaGrants(_keyword: string): AsyncGenerator<any[]> {
  // California Grants Portal (grantsportal.ca.gov) does not have a public JSON API.
  // The grants.ca.gov website is WordPress-based with no programmatic access endpoint.
  // Source disabled until an official API is available.
  console.log("[indexer:california_grants] No public API available — grantsportal.ca.gov DNS does not resolve. Skipping.");
  return;
}

async function* fetchWorldBank(keyword: string): AsyncGenerator<any[]> {
  let offset = 0;
  const rows = 100;
  while (true) {
    const url = `https://search.worldbank.org/api/v2/projects?format=json&qterm=${encodeURIComponent(keyword)}&rows=${rows}&os=${offset}&status=Active`;
    const resp = await fetchWithRetry(() => fetch(url));
    if (!resp.ok) { yield []; return; }
    const data = await resp.json() as any;
    const projectsObj = data.projects ?? {};
    const items: any[] = Array.isArray(projectsObj) ? projectsObj : Object.values(projectsObj).filter((v) => typeof v === "object" && v !== null && !(v as any).total);
    if (items.length === 0) return;
    yield items;
    const total = parseInt(projectsObj.total ?? projectsObj.totalCount ?? "0", 10);
    offset += items.length;
    if (offset >= total || items.length < rows) return;
  }
}

async function* fetchTedEu(keyword: string): AsyncGenerator<any[]> {
  let page = 1;
  while (true) {
    const resp = await fetchWithRetry(() => fetch("https://api.ted.europa.eu/v3/notices/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: `TI ~ "${keyword}"`,
        fields: ["BT-21-Procedure", "BT-05(a)-notice", "BT-02-notice"],
        page,
        scope: 1,
      }),
    }));
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.log(`[indexer:ted_eu] HTTP ${resp.status}: ${text.slice(0, 200)}`);
      return;
    }
    const data = await resp.json() as any;
    const items: any[] = Array.isArray(data.notices) ? data.notices : [];
    if (items.length === 0) return;
    yield items;
    const total = data.totalNoticeCount ?? 0;
    const fetched = page * items.length;
    if (fetched >= total || items.length < 10) return;
    page++;
  }
}

async function* fetchUsaSpending(keyword: string): AsyncGenerator<any[]> {
  let lastId: string | null = null;
  const limit = 100;
  while (true) {
    const payload: any = {
      filters: { award_type_codes: ["02", "03", "04", "05"], keywords: [keyword] },
      fields: ["Award ID", "Recipient Name", "Award Amount", "Description", "Start Date", "End Date", "Awarding Agency", "Award Type"],
      limit,
      sort: "Award Amount",
      order: "desc",
    };
    if (lastId) payload.last_record_unique_id = lastId;

    const resp = await fetchWithRetry(() => fetch("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }));
    if (!resp.ok) return;
    const data = await resp.json() as any;
    const items: any[] = Array.isArray(data.results) ? data.results : [];
    if (items.length === 0) return;
    yield items;
    lastId = data.page_metadata?.last_record_unique_id ?? null;
    if (!lastId || items.length < limit) return;
  }
}

async function* fetchNih(keyword: string): AsyncGenerator<any[]> {
  let offset = 0;
  const limit = 500;
  while (true) {
    const resp = await fetchWithRetry(() => fetch("https://api.reporter.nih.gov/v2/projects/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        criteria: { search_projects_params: { query: keyword } },
        include_fields: ["ProjectNum", "ProjectTitle", "AbstractText", "AwardAmount", "ProjectStartDate", "ProjectEndDate", "Organization", "AgencyCode"],
        limit,
        offset,
      }),
    }));
    if (!resp.ok) return;
    const data = await resp.json() as any;
    const items: any[] = Array.isArray(data.results) ? data.results : [];
    if (items.length === 0) return;
    yield items;
    const total = data.meta?.total ?? 0;
    offset += items.length;
    if (offset >= total) return;
  }
}

async function* fetchNsf(keyword: string): AsyncGenerator<any[]> {
  let offset = 1;
  const rpp = 25;
  while (true) {
    const url = `https://api.nsf.gov/services/v1/awards.json?keyword=${encodeURIComponent(keyword)}&rpp=${rpp}&offset=${offset}&printFields=id,title,fundsObligatedAmt,startDate,expDate,abstractText`;
    const resp = await fetchWithRetry(() => fetch(url));
    if (!resp.ok) return;
    const data = await resp.json() as any;
    const items: any[] = Array.isArray(data.response?.award) ? data.response.award : [];
    if (items.length === 0) return;
    yield items;
    offset += items.length;
    if (items.length < rpp) return;
  }
}

function getGenerator(sourceKey: string, keyword: string): AsyncGenerator<any[]> {
  switch (sourceKey) {
    case "simpler_grants": return fetchSimplerGrants(keyword);
    case "grants_gov": return fetchGrantsGov(keyword);
    case "sam_gov": return fetchSamGov(keyword);
    case "sbir": return fetchSbir(keyword);
    case "threesixtygiving": return fetchThreeSixtyGiving(keyword);
    case "california_grants": return fetchCaGrants(keyword);
    case "world_bank": return fetchWorldBank(keyword);
    case "ted_eu": return fetchTedEu(keyword);
    case "usaspending": return fetchUsaSpending(keyword);
    case "nih_reporter": return fetchNih(keyword);
    case "nsf_awards": return fetchNsf(keyword);
    default: return (async function* () { yield []; })();
  }
}

// ─── Main indexer ──────────────────────────────────────────────────────────

const SAFETY_MAX_PAGES = 1000;
const SAFETY_MAX_RECORDS = 100000;

export async function runSourceIndex(sourceKey: string, keyword = "research"): Promise<void> {
  if (!tablesReady) {
    await ensureTables();
    tablesReady = true;
  }

  const config = getSourceConfig(sourceKey);
  if (!config) throw new Error(`Unknown source: ${sourceKey}`);

  stopFlags.delete(sourceKey);
  initProgress(sourceKey);

  const p = progressMap.get(sourceKey)!;
  const runId = `run_${sourceKey}_${Date.now()}`;

  log(sourceKey, `Config: pageSize=${config.pageSize} maxPages=${config.maxPages} classification=${config.classification}`);

  const gen = getGenerator(sourceKey, keyword);
  let page = 0;
  let stopReason = "no_more_pages";

  try {
    for await (const batch of gen) {
      if (stopFlags.has(sourceKey)) {
        stopReason = "manual_stop";
        break;
      }

      page++;
      p.currentPage = page;

      if (page > SAFETY_MAX_PAGES) {
        stopReason = "max_pages_safety_limit";
        break;
      }

      if (p.totalFetched >= SAFETY_MAX_RECORDS) {
        stopReason = "max_records_safety_limit";
        break;
      }

      if (batch.length === 0) {
        stopReason = "empty_batch";
        break;
      }

      p.totalFetched += batch.length;
      log(sourceKey, `Page ${page}: fetched ${batch.length} records (total so far: ${p.totalFetched})`);

      const normalized = batch
        .map((raw) => normalizeRecord(sourceKey, raw))
        .filter((r): r is NonNullable<typeof r> => r !== null);

      const stats = await upsertRecords(normalized);
      p.totalInserted += stats.inserted;
      p.totalSkipped += stats.skipped;
      p.totalErrors += stats.errors;

      log(sourceKey, `Page ${page}: normalized=${normalized.length} inserted=${stats.inserted} skipped=${stats.skipped} errors=${stats.errors}`);

      await sleep(100);
    }
  } catch (err) {
    stopReason = "api_error";
    const msg = err instanceof Error ? err.message : String(err);
    log(sourceKey, `ERROR: ${msg}`);
    finish(sourceKey, stopReason, "failed");

    await saveIndexingRun({
      id: runId,
      source: sourceKey,
      status: "failed",
      totalFetched: p.totalFetched,
      totalInserted: p.totalInserted,
      totalUpdated: 0,
      totalSkipped: p.totalSkipped,
      totalErrors: p.totalErrors,
      lastPage: page,
      stopReason,
      errorMessage: msg,
      completedAt: new Date(),
    });
    return;
  }

  finish(sourceKey, stopReason, "completed");

  await saveIndexingRun({
    id: runId,
    source: sourceKey,
    status: "completed",
    totalFetched: p.totalFetched,
    totalInserted: p.totalInserted,
    totalUpdated: 0,
    totalSkipped: p.totalSkipped,
    totalErrors: p.totalErrors,
    lastPage: page,
    stopReason,
    errorMessage: null,
    completedAt: new Date(),
  });
}

export async function runAllIndexing(keyword = "research"): Promise<void> {
  for (const cfg of SOURCE_CONFIGS) {
    if (!cfg.enabled) continue;
    await runSourceIndex(cfg.sourceKey, keyword);
  }
}
