import type { SourceClassification } from "./sourceConfigs";

export interface NormalizedRecord {
  id: string;
  source: string;
  sourceRecordId: string;
  classification: SourceClassification;
  title: string;
  description: string;
  agency: string | null;
  fundingType: string | null;
  status: string | null;
  openDate: string | null;
  closeDate: string | null;
  minAward: number | null;
  maxAward: number | null;
  eligibility: string[];
  categories: string[];
  keywords: string[];
  geography: string[];
  url: string | null;
  rawPayload: unknown;
  dedupeKey: string;
}

function makeDedupeKey(source: string, recordId: string): string {
  return `${source}::${recordId}`;
}

function makeId(dedupeKey: string): string {
  // Simple deterministic ID from dedupeKey
  let hash = 0;
  for (let i = 0; i < dedupeKey.length; i++) {
    const char = dedupeKey.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `idx_${Math.abs(hash).toString(36)}_${dedupeKey.slice(0, 32).replace(/[^a-z0-9]/gi, "_")}`;
}

function parseAmount(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,]/g, ""));
  return isNaN(n) || n <= 0 ? null : Math.round(n);
}

function toArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

// ─── Per-source normalizers ────────────────────────────────────────────────

export function normalizeSimplerGrants(raw: any): NormalizedRecord | null {
  const id = String(raw.opportunity_id ?? raw.legacy_opportunity_id ?? "");
  if (!id) return null;
  const summary = raw.summary ?? {};
  const title = raw.opportunity_title ?? "Untitled";
  const dedupeKey = makeDedupeKey("simpler_grants", id);
  return {
    id: makeId(dedupeKey),
    source: "simpler_grants",
    sourceRecordId: id,
    classification: "active_opportunity",
    title,
    description: String(summary.summary_description ?? "").slice(0, 600),
    agency: raw.agency_name ?? raw.top_level_agency_name ?? null,
    fundingType: "grant",
    status: raw.opportunity_status ?? null,
    openDate: summary.post_date ?? null,
    closeDate: summary.close_date ?? summary.forecasted_close_date ?? null,
    minAward: parseAmount(summary.award_floor),
    maxAward: parseAmount(summary.award_ceiling ?? summary.estimated_total_program_funding),
    eligibility: toArray(summary.applicant_types),
    categories: toArray(raw.category ?? []),
    keywords: [],
    geography: ["United States"],
    url: `https://simpler.grants.gov/opportunity/${id}`,
    rawPayload: raw,
    dedupeKey,
  };
}

export function normalizeGrantsGov(raw: any): NormalizedRecord | null {
  const id = String(raw.id ?? raw.oppNum ?? "");
  if (!id) return null;
  const dedupeKey = makeDedupeKey("grants_gov", id);
  return {
    id: makeId(dedupeKey),
    source: "grants_gov",
    sourceRecordId: id,
    classification: "active_opportunity",
    title: raw.title ?? raw.oppTitle ?? "Untitled",
    description: String(raw.synopsis ?? raw.description ?? "").slice(0, 600),
    agency: raw.agencyName ?? raw.agency ?? null,
    fundingType: raw.fundingCategory ?? "grant",
    status: raw.oppStatus ?? null,
    openDate: raw.openDate ?? null,
    closeDate: raw.closeDate ?? raw.deadlineDate ?? null,
    minAward: parseAmount(raw.awardFloor),
    maxAward: parseAmount(raw.awardCeiling),
    eligibility: toArray(raw.eligibility),
    categories: toArray(raw.fundingCategory),
    keywords: [],
    geography: ["United States"],
    url: `https://www.grants.gov/search-results-detail/${id}`,
    rawPayload: raw,
    dedupeKey,
  };
}

export function normalizeSamGov(raw: any): NormalizedRecord | null {
  const id = String(raw.noticeId ?? raw.solicitationNumber ?? "");
  if (!id) return null;
  const dedupeKey = makeDedupeKey("sam_gov", id);
  return {
    id: makeId(dedupeKey),
    source: "sam_gov",
    sourceRecordId: id,
    classification: "active_opportunity",
    title: raw.title ?? "Untitled",
    description: String(raw.description ?? raw.synopsis ?? "").slice(0, 600),
    agency: raw.fullParentPathName ?? raw.organizationHierarchy?.[0]?.name ?? null,
    fundingType: raw.type === "o" ? "procurement" : raw.type ?? "contract",
    status: raw.active === true ? "active" : raw.active,
    openDate: raw.postedDate ?? null,
    closeDate: raw.responseDeadLine ?? raw.archiveDate ?? null,
    minAward: null,
    maxAward: parseAmount(raw.baseAndAllOptionsValue),
    eligibility: raw.typeOfSetAside ? [raw.typeOfSetAside] : [],
    categories: raw.naicsCode ? [`NAICS: ${raw.naicsCode}`] : [],
    keywords: [],
    geography: ["United States"],
    url: raw.uiLink ?? `https://sam.gov/opp/${id}/view`,
    rawPayload: raw,
    dedupeKey,
  };
}

export function normalizeSbir(raw: any): NormalizedRecord | null {
  const id = String(raw.solicitation_id ?? raw.program_solicitation_id ?? raw.solicitation_number ?? "");
  if (!id) return null;
  const dedupeKey = makeDedupeKey("sbir", id);
  return {
    id: makeId(dedupeKey),
    source: "sbir",
    sourceRecordId: id,
    classification: "active_opportunity",
    title: raw.solicitation_title ?? raw.program_title ?? "Untitled",
    description: String(raw.program_description ?? raw.abstract ?? "").slice(0, 600),
    agency: raw.agency ?? raw.branch ?? null,
    fundingType: raw.program === "STTR" ? "cooperative_agreement" : "grant",
    status: raw.open_date && raw.close_date ? "active" : null,
    openDate: raw.open_date ?? raw.release_date ?? null,
    closeDate: raw.close_date ?? raw.submission_deadline ?? null,
    minAward: null,
    maxAward: parseAmount(raw.award_ceiling ?? raw.program_year_1_funding),
    eligibility: ["small_business"],
    categories: toArray(raw.program_solicitation_agency_interest_area ?? raw.technology_topic),
    keywords: [],
    geography: ["United States"],
    url: raw.solicitation_link ?? `https://www.sbir.gov/solicitations`,
    rawPayload: raw,
    dedupeKey,
  };
}

export function normalizeThreeSixtyGiving(raw: any): NormalizedRecord | null {
  const id = String(raw["Identifier"] ?? raw.id ?? "");
  if (!id) return null;
  const dedupeKey = makeDedupeKey("threesixtygiving", id);
  return {
    id: makeId(dedupeKey),
    source: "threesixtygiving",
    sourceRecordId: id,
    classification: "active_opportunity",
    title: raw["Title"] ?? raw.title ?? "Untitled",
    description: String(raw["Description"] ?? raw.description ?? "").slice(0, 600),
    agency: raw["Funding Org:Name"] ?? raw.fundingOrganization?.name ?? null,
    fundingType: "grant",
    status: "active",
    openDate: raw["Award Date"] ?? null,
    closeDate: null,
    minAward: parseAmount(raw["Amount Applied For"]),
    maxAward: parseAmount(raw["Amount Awarded"]),
    eligibility: [],
    categories: toArray(raw["Grant Programme:Title"]),
    keywords: [],
    geography: ["United Kingdom"],
    url: raw["URL"] ?? "https://grantsnav.threesixtygiving.org/",
    rawPayload: raw,
    dedupeKey,
  };
}

export function normalizeCaGrants(raw: any): NormalizedRecord | null {
  const id = String(raw.id ?? raw.grant_id ?? "");
  if (!id) return null;
  const dedupeKey = makeDedupeKey("california_grants", id);
  return {
    id: makeId(dedupeKey),
    source: "california_grants",
    sourceRecordId: id,
    classification: "active_opportunity",
    title: raw.title ?? raw.grant_title ?? "Untitled",
    description: String(raw.description ?? raw.purpose ?? "").slice(0, 600),
    agency: raw.agency ?? raw.administering_agency ?? null,
    fundingType: "grant",
    status: raw.status ?? "active",
    openDate: raw.published_date ?? null,
    closeDate: raw.deadline ?? raw.due_date ?? null,
    minAward: parseAmount(raw.funding_minimum ?? raw.min_award),
    maxAward: parseAmount(raw.funding_maximum ?? raw.max_award),
    eligibility: toArray(raw.applicant_type ?? raw.eligibility),
    categories: toArray(raw.category ?? raw.funding_area),
    keywords: [],
    geography: ["California", "United States"],
    url: raw.url ?? raw.link ?? `https://www.grants.ca.gov/grants/${id}/`,
    rawPayload: raw,
    dedupeKey,
  };
}

export function normalizeWorldBank(raw: any): NormalizedRecord | null {
  const id = String(raw.id ?? "");
  if (!id) return null;
  const dedupeKey = makeDedupeKey("world_bank", id);
  return {
    id: makeId(dedupeKey),
    source: "world_bank",
    sourceRecordId: id,
    classification: "active_opportunity",
    title: raw.title ?? raw.project_name ?? "Untitled",
    description: String(raw.project_abstract ?? raw.description ?? "").slice(0, 600),
    agency: raw.borrower ?? raw.ibrd_country ?? null,
    fundingType: "procurement",
    status: raw.status ?? "active",
    openDate: raw.boardapprovaldate ?? raw.approvaldate ?? null,
    closeDate: raw.closingdate ?? null,
    minAward: null,
    maxAward: parseAmount(raw.totalamt ?? raw.lendprojectcost),
    eligibility: [],
    categories: toArray(raw.theme_namecode ?? raw.sector_namecode),
    keywords: [],
    geography: [raw.countryname ?? "International"],
    url: raw.url ?? `https://projects.worldbank.org/en/projects-operations/project-detail/${id}`,
    rawPayload: raw,
    dedupeKey,
  };
}

export function normalizeTedEu(raw: any): NormalizedRecord | null {
  const id = String(raw.noticeNumber ?? raw.ND ?? "");
  if (!id) return null;
  const dedupeKey = makeDedupeKey("ted_eu", id);
  return {
    id: makeId(dedupeKey),
    source: "ted_eu",
    sourceRecordId: id,
    classification: "active_opportunity",
    title: raw.title?.[0]?.value ?? raw.noticeTitle ?? "Untitled",
    description: String(raw.shortDescription?.[0]?.value ?? raw.description ?? "").slice(0, 600),
    agency: raw.buyer?.[0]?.officialName ?? raw.CA ?? null,
    fundingType: "procurement",
    status: "active",
    openDate: raw.publicationDate?.startsWith("20") ? raw.publicationDate : null,
    closeDate: raw.deadline ?? raw.DT ?? null,
    minAward: null,
    maxAward: parseAmount(raw.totalValueOfBusiness ?? raw.contractValue),
    eligibility: [],
    categories: toArray(raw.mainCpvCode?.codeValue ?? []),
    keywords: [],
    geography: [raw.isoCountry ?? "European Union"],
    url: raw.noticeNumber ? `https://ted.europa.eu/en/notice/-/detail/${raw.noticeNumber}` : "https://ted.europa.eu/en/search",
    rawPayload: raw,
    dedupeKey,
  };
}

export function normalizeUsaSpending(raw: any): NormalizedRecord | null {
  const id = String(raw["Award ID"] ?? raw.award_id ?? "");
  if (!id) return null;
  const dedupeKey = makeDedupeKey("usaspending", id);
  return {
    id: makeId(dedupeKey),
    source: "usaspending",
    sourceRecordId: id,
    classification: "historical_intelligence",
    title: raw["Recipient Name"] ?? raw.recipient_name ?? "Unnamed Recipient",
    description: String(raw["Description"] ?? raw.description ?? "").slice(0, 600),
    agency: raw["Awarding Agency"] ?? raw.awarding_agency_name ?? null,
    fundingType: raw["Award Type"] ?? "grant",
    status: "archived",
    openDate: raw["Start Date"] ?? null,
    closeDate: raw["End Date"] ?? null,
    minAward: parseAmount(raw["Award Amount"]),
    maxAward: parseAmount(raw["Award Amount"]),
    eligibility: [],
    categories: [],
    keywords: [],
    geography: ["United States"],
    url: id ? `https://www.usaspending.gov/award/${encodeURIComponent(id)}` : "https://www.usaspending.gov/search/",
    rawPayload: raw,
    dedupeKey,
  };
}

export function normalizeNih(raw: any): NormalizedRecord | null {
  const id = String(raw.project_num ?? "");
  if (!id) return null;
  const dedupeKey = makeDedupeKey("nih_reporter", id);
  return {
    id: makeId(dedupeKey),
    source: "nih_reporter",
    sourceRecordId: id,
    classification: "historical_intelligence",
    title: raw.project_title ?? "Untitled Project",
    description: String(raw.abstract_text ?? "").slice(0, 600),
    agency: raw.agency_code ?? raw.organization?.org_name ?? null,
    fundingType: "grant",
    status: "archived",
    openDate: raw.project_start_date ?? null,
    closeDate: raw.project_end_date ?? null,
    minAward: null,
    maxAward: parseAmount(raw.award_amount),
    eligibility: [],
    categories: [],
    keywords: [],
    geography: ["United States"],
    url: id ? `https://reporter.nih.gov/search/${encodeURIComponent(id)}` : "https://reporter.nih.gov/",
    rawPayload: raw,
    dedupeKey,
  };
}

export function normalizeNsf(raw: any): NormalizedRecord | null {
  const id = String(raw.id ?? "");
  if (!id) return null;
  const dedupeKey = makeDedupeKey("nsf_awards", id);
  return {
    id: makeId(dedupeKey),
    source: "nsf_awards",
    sourceRecordId: id,
    classification: "historical_intelligence",
    title: raw.title ?? "Untitled",
    description: String(raw.abstractText ?? "").slice(0, 600),
    agency: "NSF",
    fundingType: "grant",
    status: "archived",
    openDate: raw.startDate ?? null,
    closeDate: raw.expDate ?? null,
    minAward: null,
    maxAward: parseAmount(raw.fundsObligatedAmt),
    eligibility: [],
    categories: [],
    keywords: [],
    geography: ["United States"],
    url: id ? `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${id}` : "https://www.nsf.gov/awardsearch/",
    rawPayload: raw,
    dedupeKey,
  };
}

export function normalizeRecord(sourceKey: string, raw: any): NormalizedRecord | null {
  try {
    switch (sourceKey) {
      case "simpler_grants": return normalizeSimplerGrants(raw);
      case "grants_gov": return normalizeGrantsGov(raw);
      case "sam_gov": return normalizeSamGov(raw);
      case "sbir": return normalizeSbir(raw);
      case "threesixtygiving": return normalizeThreeSixtyGiving(raw);
      case "california_grants": return normalizeCaGrants(raw);
      case "world_bank": return normalizeWorldBank(raw);
      case "ted_eu": return normalizeTedEu(raw);
      case "usaspending": return normalizeUsaSpending(raw);
      case "nih_reporter": return normalizeNih(raw);
      case "nsf_awards": return normalizeNsf(raw);
      default: return null;
    }
  } catch {
    return null;
  }
}
