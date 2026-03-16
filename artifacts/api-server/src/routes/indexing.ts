import { Router, type IRouter } from "express";
import {
  runSourceIndex,
  runAllIndexing,
  getProgress,
  getAllProgress,
  requestStop,
  requestStopAll,
} from "../lib/indexing/runIndexer";
import {
  getIndexedStats,
  getIndexedRecords,
  deleteRecordsBySource,
  deleteAllRecords,
  ensureTables,
} from "../lib/indexing/storage";
import { SOURCE_CONFIGS } from "../lib/indexing/sourceConfigs";

const router: IRouter = Router();

let tablesInitialized = false;
async function maybeInit() {
  if (!tablesInitialized) {
    await ensureTables();
    tablesInitialized = true;
  }
}

router.get("/indexing/sources", async (_req, res): Promise<void> => {
  await maybeInit();
  const stats = await getIndexedStats();
  const progress = getAllProgress();
  const progressMap = new Map(progress.map((p) => [p.sourceKey, p]));

  const sources = SOURCE_CONFIGS.map((cfg) => {
    const p = progressMap.get(cfg.sourceKey);
    return {
      ...cfg,
      indexedCount: stats.bySource[cfg.sourceKey] ?? 0,
      lastStatus: p?.status ?? "idle",
      lastFetched: p?.totalFetched ?? 0,
      lastInserted: p?.totalInserted ?? 0,
      completedAt: p?.completedAt ?? null,
      stopReason: p?.stopReason ?? null,
    };
  });

  res.json({ sources });
});

router.get("/indexing/progress", (_req, res): void => {
  res.json({ progress: getAllProgress() });
});

router.get("/indexing/progress/:sourceKey", (req, res): void => {
  const { sourceKey } = req.params;
  res.json(getProgress(sourceKey));
});

router.get("/indexing/stats", async (_req, res): Promise<void> => {
  await maybeInit();
  try {
    const stats = await getIndexedStats();
    res.json(stats);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

router.post("/indexing/run/:sourceKey", async (req, res): Promise<void> => {
  const { sourceKey } = req.params;
  const keyword = typeof req.query.keyword === "string" ? req.query.keyword : "research";

  const cfg = SOURCE_CONFIGS.find((s) => s.sourceKey === sourceKey);
  if (!cfg) {
    res.status(404).json({ error: `Unknown source: ${sourceKey}` });
    return;
  }

  const current = getProgress(sourceKey);
  if (current.status === "running") {
    res.status(409).json({ error: "Already running" });
    return;
  }

  runSourceIndex(sourceKey, keyword).catch((err) => {
    console.error(`[indexer] error running ${sourceKey}:`, err);
  });

  res.json({ started: true, sourceKey, keyword });
});

router.post("/indexing/run-all", async (req, res): Promise<void> => {
  const keyword = typeof req.query.keyword === "string" ? req.query.keyword : "research";
  runAllIndexing(keyword).catch((err) => {
    console.error(`[indexer] error running all:`, err);
  });
  res.json({ started: true, keyword });
});

router.post("/indexing/stop/:sourceKey", (req, res): void => {
  const { sourceKey } = req.params;
  requestStop(sourceKey);
  res.json({ stopped: true, sourceKey });
});

router.post("/indexing/stop-all", (_req, res): void => {
  requestStopAll();
  res.json({ stopped: true });
});

router.delete("/indexing/reset/:sourceKey", async (req, res): Promise<void> => {
  await maybeInit();
  const { sourceKey } = req.params;
  try {
    const deleted = await deleteRecordsBySource(sourceKey);
    res.json({ deleted, sourceKey });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

router.delete("/indexing/reset-all", async (_req, res): Promise<void> => {
  await maybeInit();
  try {
    await deleteAllRecords();
    res.json({ deleted: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

router.get("/indexing/records", async (req, res): Promise<void> => {
  await maybeInit();
  try {
    const opts = {
      source: typeof req.query.source === "string" ? req.query.source : undefined,
      classification: typeof req.query.classification === "string" ? req.query.classification : undefined,
      keyword: typeof req.query.keyword === "string" ? req.query.keyword : undefined,
      limit: parseInt(String(req.query.limit ?? "50"), 10),
      offset: parseInt(String(req.query.offset ?? "0"), 10),
    };
    const result = await getIndexedRecords(opts);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

router.get("/indexing/records/for-algorithm", async (_req, res): Promise<void> => {
  await maybeInit();
  try {
    const result = await getIndexedRecords({
      classification: "active_opportunity",
      limit: 50000,
      offset: 0,
    });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
