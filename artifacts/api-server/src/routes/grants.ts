import { Router, type IRouter } from "express";
import {
  GetGrantsGovResponse,
  GetSbirResponse,
  GetThreeSixtyGivingResponse,
  GetCaGrantsResponse,
  GetUsaSpendingResponse,
  GetNihResponse,
  GetNsfResponse,
  GetWorldBankResponse,
  GetSimplerGrantsResponse,
  GetSamGovResponse,
  GetTedEuResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function getKeyword(q: unknown): string {
  return typeof q === "string" && q.trim() ? q.trim() : "research";
}

function getRows(q: unknown): number {
  const n = parseInt(String(q), 10);
  return isNaN(n) || n <= 0 ? 10 : Math.min(n, 25);
}

router.get("/grants/grantsgov", async (req, res): Promise<void> => {
  const keyword = getKeyword(req.query.keyword);
  const rows = getRows(req.query.rows);

  try {
    const response = await fetch("https://apply07.grants.gov/grantsws/rest/opportunities/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, rows, oppStatuses: "forecasted|posted" }),
    });
    if (!response.ok) throw new Error(`Grants.gov responded ${response.status}`);
    const data = await response.json() as Record<string, unknown>;

    const rawOpps = Array.isArray((data as any).oppHits) ? (data as any).oppHits : [];
    const items = rawOpps.slice(0, rows).map((opp: any) => ({
      id: String(opp.id ?? opp.oppNum ?? Math.random()),
      title: opp.title ?? opp.oppTitle ?? "Untitled",
      description: opp.synopsis ?? opp.description ?? "",
      amount: opp.awardCeiling ? `$${Number(opp.awardCeiling).toLocaleString()}` : undefined,
      deadline: opp.closeDate ?? opp.deadlineDate ?? undefined,
      agency: opp.agencyName ?? opp.agency ?? undefined,
      url: opp.id ? `https://www.grants.gov/search-results-detail/${opp.id}` : undefined,
      status: opp.oppStatus ?? undefined,
    }));

    const result = GetGrantsGovResponse.parse({
      source: "Grants.gov",
      total: (data as any).hitCount ?? items.length,
      items,
    });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/grants/sbir", async (req, res): Promise<void> => {
  const keyword = getKeyword(req.query.keyword);
  const rows = getRows(req.query.rows);

  try {
    // SBIR.gov uses a POST-based search API
    const response = await fetch(`https://www.sbir.gov/api/solicitations.json?keyword=${encodeURIComponent(keyword)}&rows=${rows}`, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "grants-explorer/1.0",
      },
    });

    if (!response.ok) {
      // Fallback: use USASpending for SBIR awards filtered by SBIR agencies
      const payload = {
        filters: {
          award_type_codes: ["02", "03", "04", "05"],
          keywords: [keyword, "small business"],
          agencies: [{ type: "awarding", tier: "toptier", name: "Small Business Administration" }],
        },
        fields: ["Award ID", "Recipient Name", "Award Amount", "Description", "Start Date", "End Date", "Awarding Agency"],
        limit: rows,
        sort: "Award Amount",
        order: "desc",
      };
      const fallback = await fetch("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const fallbackData = await fallback.json() as Record<string, unknown>;
      const rawItems = Array.isArray((fallbackData as any).results) ? (fallbackData as any).results : [];
      const items = rawItems.slice(0, rows).map((award: any, i: number) => ({
        id: String(award["Award ID"] ?? i),
        title: award["Recipient Name"] ?? "Unnamed Recipient",
        description: award["Description"] ?? "",
        amount: award["Award Amount"] ? `$${Number(award["Award Amount"]).toLocaleString()}` : undefined,
        deadline: award["End Date"] ?? undefined,
        agency: award["Awarding Agency"] ?? "SBA",
        url: award["Award ID"] ? `https://www.usaspending.gov/award/${award["Award ID"]}` : undefined,
        status: "Award",
      }));
      const result = GetSbirResponse.parse({ source: "SBIR (via USASpending)", total: items.length, items });
      res.json(result);
      return;
    }

    const data = await response.json() as unknown[];
    const rawItems = Array.isArray(data) ? data : [];
    const items = rawItems.slice(0, rows).map((sol: any) => ({
      id: String(sol.solicitation_id ?? sol.contract ?? Math.random()),
      title: sol.solicitation_title ?? sol.title ?? "Untitled",
      description: sol.solicitation_topics ?? sol.description ?? "",
      amount: sol.award_ceiling ? `$${Number(sol.award_ceiling).toLocaleString()}` : undefined,
      deadline: sol.open_date ?? sol.close_date ?? undefined,
      agency: sol.agency ?? undefined,
      url: sol.solicitation_id ? `https://www.sbir.gov/solicitation/${sol.solicitation_id}` : undefined,
      status: sol.solicitation_year ?? undefined,
    }));

    const result = GetSbirResponse.parse({ source: "SBIR", total: items.length, items });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/grants/threesixtygiving", async (req, res): Promise<void> => {
  const keyword = getKeyword(req.query.keyword);
  const pageSize = Math.max(getRows(req.query.rows), 10);

  try {
    // Use UKRI Gateway to Research API (UK research funding, aligns with 360Giving UK grant data)
    const url = `https://gtr.ukri.org/gtr/api/projects?q=${encodeURIComponent(keyword)}&s=${pageSize}&p=1`;
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
    });
    if (!response.ok) throw new Error(`UKRI Gateway responded ${response.status}`);
    const data = await response.json() as Record<string, unknown>;

    const rawItems = Array.isArray((data as any).project) ? (data as any).project : [];
    const items = rawItems.slice(0, pageSize).map((proj: any) => {
      const fund = proj.links?.link?.find((l: any) => l.rel === "FUND");
      const leadOrgLink = proj.links?.link?.find((l: any) => l.rel === "LEAD_ORG");
      return {
        id: String(proj.id ?? Math.random()),
        title: proj.title ?? "Untitled Project",
        description: proj.abstractText ? String(proj.abstractText).slice(0, 400) + (String(proj.abstractText).length > 400 ? "..." : "") : "",
        amount: fund?.start ? undefined : undefined,
        deadline: proj.fund?.end ? new Date(proj.fund.end).toLocaleDateString() : undefined,
        agency: proj.fund?.funder?.name ?? "UKRI",
        url: proj.id ? `https://gtr.ukri.org/projects?ref=${encodeURIComponent(proj.grantReference ?? proj.id)}` : undefined,
        status: proj.status ?? undefined,
      };
    });

    const result = GetThreeSixtyGivingResponse.parse({
      source: "360Giving / UKRI",
      total: (data as any).totalSize ?? items.length,
      items,
    });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/grants/cagrants", async (req, res): Promise<void> => {
  const keyword = getKeyword(req.query.keyword);
  const rows = getRows(req.query.rows);

  try {
    // California Grants Portal API
    const url = `https://api.grants.ca.gov/api/v1/grants?pageSize=${rows}&categories=${encodeURIComponent(keyword)}`;
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "grants-explorer/1.0",
      },
    });

    if (!response.ok) {
      // Fallback: query USASpending for California state-awarded grants
      const payload = {
        filters: {
          award_type_codes: ["02", "03", "04", "05"],
          keywords: [keyword],
          place_of_performance_locations: [{ country: "USA", state: "CA" }],
        },
        fields: ["Award ID", "Recipient Name", "Award Amount", "Description", "Start Date", "End Date", "Awarding Agency"],
        limit: rows,
        sort: "Award Amount",
        order: "desc",
      };
      const fallback = await fetch("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const fallbackData = await fallback.json() as Record<string, unknown>;
      const rawItems = Array.isArray((fallbackData as any).results) ? (fallbackData as any).results : [];
      const items = rawItems.slice(0, rows).map((award: any, i: number) => ({
        id: String(award["Award ID"] ?? i),
        title: award["Recipient Name"] ?? "Unnamed Recipient",
        description: award["Description"] ?? "",
        amount: award["Award Amount"] ? `$${Number(award["Award Amount"]).toLocaleString()}` : undefined,
        deadline: award["End Date"] ?? undefined,
        agency: award["Awarding Agency"] ?? undefined,
        url: award["Award ID"] ? `https://www.usaspending.gov/award/${award["Award ID"]}` : undefined,
        status: "Active",
      }));
      const result = GetCaGrantsResponse.parse({ source: "California Grants (via USASpending)", total: items.length, items });
      res.json(result);
      return;
    }

    const text = await response.text();
    if (text.trim().startsWith("<")) {
      throw new Error("CA Grants returned HTML");
    }

    const data = JSON.parse(text) as Record<string, unknown>;
    const rawItems = Array.isArray((data as any).results) ? (data as any).results :
                     Array.isArray((data as any).data) ? (data as any).data :
                     Array.isArray(data) ? data as unknown[] : [];
    const items = (rawItems as any[]).slice(0, rows).map((grant: any) => ({
      id: String(grant.id ?? grant.grantId ?? Math.random()),
      title: grant.title ?? grant.grantTitle ?? grant.name ?? "Untitled",
      description: grant.description ?? grant.purpose ?? "",
      amount: grant.maxAward ? `$${Number(grant.maxAward).toLocaleString()}` : undefined,
      deadline: grant.deadline ?? grant.closeDate ?? undefined,
      agency: grant.agency ?? grant.fundingAgency ?? grant.organization ?? undefined,
      url: grant.url ?? grant.link ?? undefined,
      status: grant.status ?? undefined,
    }));

    const result = GetCaGrantsResponse.parse({
      source: "California Grants",
      total: (data as any).total ?? items.length,
      items,
    });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/grants/usaspending", async (req, res): Promise<void> => {
  const keyword = getKeyword(req.query.keyword);
  const rows = getRows(req.query.rows);

  try {
    const payload = {
      filters: {
        award_type_codes: ["02", "03", "04", "05"],
        keywords: [keyword],
      },
      fields: ["Award ID", "Recipient Name", "Award Amount", "Total Outlays", "Description", "Start Date", "End Date", "Awarding Agency"],
      limit: rows,
      sort: "Award Amount",
      order: "desc",
    };

    const response = await fetch("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`USASpending responded ${response.status}`);
    const data = await response.json() as Record<string, unknown>;

    const rawItems = Array.isArray((data as any).results) ? (data as any).results : [];
    const items = rawItems.slice(0, rows).map((award: any) => ({
      id: String(award["Award ID"] ?? Math.random()),
      title: award["Recipient Name"] ?? "Unnamed Recipient",
      description: award["Description"] ?? "",
      amount: award["Award Amount"] ? `$${Number(award["Award Amount"]).toLocaleString()}` : undefined,
      deadline: award["End Date"] ?? undefined,
      agency: award["Awarding Agency"] ?? undefined,
      url: award["Award ID"] ? `https://www.usaspending.gov/award/${award["Award ID"]}` : undefined,
      status: undefined,
    }));

    const result = GetUsaSpendingResponse.parse({
      source: "USASpending",
      total: (data as any).page_metadata?.total ?? items.length,
      items,
    });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/grants/nih", async (req, res): Promise<void> => {
  const keyword = getKeyword(req.query.keyword);
  const rows = getRows(req.query.rows);

  try {
    const payload = {
      criteria: {
        search_projects_params: {
          query: keyword,
        },
      },
      include_fields: ["ProjectNum", "ProjectTitle", "AbstractText", "AwardAmount", "ProjectStartDate", "ProjectEndDate", "Organization", "AgencyCode"],
      limit: rows,
      offset: 0,
    };

    const response = await fetch("https://api.reporter.nih.gov/v2/projects/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`NIH RePORTER responded ${response.status}`);
    const data = await response.json() as Record<string, unknown>;

    const rawItems = Array.isArray((data as any).results) ? (data as any).results : [];
    const items = rawItems.slice(0, rows).map((proj: any) => ({
      id: String(proj.project_num ?? Math.random()),
      title: proj.project_title ?? "Untitled Project",
      description: proj.abstract_text ? String(proj.abstract_text).slice(0, 400) + (String(proj.abstract_text).length > 400 ? "..." : "") : "",
      amount: proj.award_amount ? `$${Number(proj.award_amount).toLocaleString()}` : undefined,
      deadline: proj.project_end_date ?? undefined,
      agency: proj.agency_code ?? proj.organization?.org_name ?? undefined,
      url: proj.project_num ? `https://reporter.nih.gov/search/${encodeURIComponent(proj.project_num)}` : undefined,
      status: undefined,
    }));

    const result = GetNihResponse.parse({
      source: "NIH RePORTER",
      total: (data as any).meta?.total ?? items.length,
      items,
    });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/grants/nsf", async (req, res): Promise<void> => {
  const keyword = getKeyword(req.query.keyword);
  const rows = getRows(req.query.rows);

  try {
    const url = `https://api.nsf.gov/services/v1/awards.json?keyword=${encodeURIComponent(keyword)}&rpp=${rows}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`NSF responded ${response.status}`);
    const data = await response.json() as Record<string, unknown>;

    const rawItems = Array.isArray((data as any).response?.award) ? (data as any).response.award : [];
    const items = rawItems.slice(0, rows).map((award: any) => ({
      id: String(award.id ?? Math.random()),
      title: award.title ?? "Untitled",
      description: award.abstractText ? String(award.abstractText).slice(0, 400) + (String(award.abstractText).length > 400 ? "..." : "") : "",
      amount: award.fundsObligatedAmt ? `$${Number(award.fundsObligatedAmt).toLocaleString()}` : undefined,
      deadline: award.expDate ?? undefined,
      agency: "NSF",
      url: award.id ? `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${award.id}` : undefined,
      status: undefined,
    }));

    const result = GetNsfResponse.parse({
      source: "NSF Awards",
      total: (data as any).response?.metadata?.totalCount ?? items.length,
      items,
    });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/grants/worldbank", async (req, res): Promise<void> => {
  const keyword = getKeyword(req.query.keyword);
  const rows = getRows(req.query.rows);

  try {
    const url = `https://search.worldbank.org/api/v2/projects?format=json&q=${encodeURIComponent(keyword)}&rows=${rows}&fl=id,project_name,totalamt,closingdate,countryname,status,url,boardapprovaldate,lendinginstr`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`World Bank responded ${response.status}`);
    const data = await response.json() as Record<string, unknown>;

    const projects = (data as any).projects ?? {};
    const rawItems = Object.values(projects).filter((v) => typeof v === "object" && v !== null) as any[];
    const items = rawItems.slice(0, rows).map((proj: any) => ({
      id: String(proj.id ?? Math.random()),
      title: proj.project_name ?? "Untitled Project",
      description: proj.lendinginstr ?? "",
      amount: proj.totalamt ? `$${Number(String(proj.totalamt).replace(/,/g, "")).toLocaleString()}` : undefined,
      deadline: proj.closingdate ?? undefined,
      agency: proj.countryname ? (Array.isArray(proj.countryname) ? proj.countryname[0] : proj.countryname) : "World Bank",
      url: proj.url ?? (proj.id ? `https://projects.worldbank.org/en/projects-operations/project-detail/${proj.id}` : undefined),
      status: proj.status ?? undefined,
    }));

    const result = GetWorldBankResponse.parse({
      source: "World Bank",
      total: Number((data as any).total?.value ?? (data as any).total ?? items.length),
      items,
    });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/grants/samgov", async (req, res): Promise<void> => {
  const keyword = getKeyword(req.query.keyword);
  const rows = getRows(req.query.rows);
  const apiKey = process.env.SAM_GOV_API_KEY;

  if (!apiKey) {
    res.status(500).json({ error: "SAM_GOV_API_KEY environment variable is not set" });
    return;
  }

  try {
    // SAM.gov requires date range within 1 year
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 90);
    const fmt = (d: Date) =>
      `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

    const params = new URLSearchParams({
      limit: String(rows),
      api_key: apiKey,
      postedFrom: fmt(from),
      postedTo: fmt(now),
      ptype: "o,k,p,r,s,g,i,a,u",
    });
    if (keyword && keyword !== "research") {
      params.set("keyword", keyword);
    }

    const url = `https://api.sam.gov/opportunities/v2/search?${params.toString()}`;
    const response = await fetch(url);
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`SAM.gov responded ${response.status}: ${errText.slice(0, 200)}`);
    }
    const data = await response.json() as Record<string, unknown>;

    const rawItems = Array.isArray((data as any).opportunitiesData) ? (data as any).opportunitiesData : [];
    const items = rawItems.slice(0, rows).map((opp: any) => ({
      id: String(opp.noticeId ?? Math.random()),
      title: opp.title ?? "Untitled",
      description: opp.typeOfSetAsideDescription
        ? `${opp.type ?? ""} — ${opp.typeOfSetAsideDescription}`
        : opp.type ?? "",
      amount: undefined,
      deadline: opp.responseDeadLine ?? opp.archiveDate ?? undefined,
      agency: opp.fullParentPathName
        ? String(opp.fullParentPathName).split(".")[0]
        : undefined,
      url: opp.noticeId
        ? `https://sam.gov/opp/${opp.noticeId}/view`
        : undefined,
      status: opp.active === "Yes" ? "Active" : opp.active ?? undefined,
    }));

    const result = GetSamGovResponse.parse({
      source: "SAM.gov",
      total: (data as any).totalRecords ?? items.length,
      items,
    });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/grants/tedeu", async (req, res): Promise<void> => {
  const keyword = getKeyword(req.query.keyword);
  const rows = Math.max(getRows(req.query.rows), 1);

  try {
    // Build query: TED EU expert search uses YYYYMMDD format for dates
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateFmt = (d: Date) =>
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const queryStr = keyword && keyword !== "research"
      ? `TI ~ "${keyword}"`
      : `DT >= ${dateFmt(thirtyDaysAgo)}`;

    const payload = {
      query: queryStr,
      fields: ["ND", "TI", "DT", "AU", "CY"],
      limit: rows,
      page: 1,
    };

    const response = await fetch("https://api.ted.europa.eu/v3/notices/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`TED EU responded ${response.status}: ${errText.slice(0, 200)}`);
    }
    const data = await response.json() as Record<string, unknown>;

    const rawItems = Array.isArray((data as any).notices) ? (data as any).notices : [];

    function pickLang(obj: unknown): string | undefined {
      if (!obj || typeof obj !== "object") return undefined;
      const o = obj as Record<string, unknown>;
      const val = o["eng"] ?? o["fre"] ?? o["deu"] ?? Object.values(o)[0];
      if (Array.isArray(val)) return val[0] ? String(val[0]) : undefined;
      return val ? String(val) : undefined;
    }

    const items = rawItems.slice(0, rows).map((notice: any) => {
      const nd = notice.ND ?? notice.nd;
      const title = pickLang(notice.TI) ?? pickLang(notice.ti) ?? "Untitled Notice";
      const authority = pickLang(notice.AU) ?? pickLang(notice.au) ?? undefined;
      const country = Array.isArray(notice.CY) ? notice.CY[0] : notice.CY ?? undefined;
      const date = Array.isArray(notice.DT) ? notice.DT[0] : notice.DT ?? undefined;

      return {
        id: String(nd ?? Math.random()),
        title,
        description: authority ? `Contracting authority: ${authority}` : "",
        amount: undefined,
        deadline: date ? new Date(date).toLocaleDateString("en-GB") : undefined,
        agency: country ?? authority ?? "EU",
        url: nd ? `https://ted.europa.eu/en/notice/-/detail/${nd}` : undefined,
        status: "Published",
      };
    });

    const totalPages = (data as any).totalNoticeCount ?? (data as any).total ?? items.length;
    const result = GetTedEuResponse.parse({
      source: "TED EU",
      total: typeof totalPages === "number" ? totalPages : items.length,
      items,
    });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/grants/simplergrants", async (req, res): Promise<void> => {
  const keyword = getKeyword(req.query.keyword);
  const rows = getRows(req.query.rows);
  const apiKey = process.env.SIMPLER_GRANTS_API_KEY;

  if (!apiKey) {
    res.status(500).json({ error: "SIMPLER_GRANTS_API_KEY environment variable is not set" });
    return;
  }

  try {
    const payload: Record<string, unknown> = {
      pagination: {
        page_offset: 1,
        page_size: rows,
        sort_order: [{ order_by: "post_date", sort_direction: "descending" }],
      },
    };

    // Add keyword filter if provided
    if (keyword && keyword !== "research") {
      payload.filters = {
        opportunity_title: { one_of: [keyword] },
      };
    }

    const response = await fetch("https://api.simpler.grants.gov/v1/opportunities/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`Simpler Grants responded ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const rawItems = Array.isArray((data as any).data) ? (data as any).data : [];

    const items = rawItems.slice(0, rows).map((opp: any) => {
      const summary = opp.summary ?? {};
      return {
        id: String(opp.opportunity_id ?? opp.legacy_opportunity_id ?? Math.random()),
        title: opp.opportunity_title ?? "Untitled",
        description: summary.summary_description
          ? String(summary.summary_description).slice(0, 400) + (String(summary.summary_description).length > 400 ? "..." : "")
          : "",
        amount: summary.award_ceiling
          ? `$${Number(summary.award_ceiling).toLocaleString()}`
          : summary.estimated_total_program_funding
          ? `$${Number(summary.estimated_total_program_funding).toLocaleString()}`
          : undefined,
        deadline: summary.close_date ?? summary.forecasted_close_date ?? undefined,
        agency: opp.agency_name ?? opp.top_level_agency_name ?? opp.agency ?? undefined,
        url: opp.opportunity_id
          ? `https://simpler.grants.gov/opportunity/${opp.opportunity_id}`
          : undefined,
        status: opp.opportunity_status ?? undefined,
      };
    });

    const pagination = (data as any).pagination_info ?? {};
    const result = GetSimplerGrantsResponse.parse({
      source: "Simpler Grants",
      total: pagination.total_records ?? items.length,
      items,
    });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

export default router;
